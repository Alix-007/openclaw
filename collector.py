#!/usr/bin/env python3
"""External proof: normal CLI, actual terminal VINTR, passive loopback HTTP."""
import errno
import hashlib
import http.server
import json
import os
from pathlib import Path
import pty
import select
import signal
import socket
import subprocess
import sys
import threading
import time

checkout, output, node = (Path(x).resolve() for x in sys.argv[1:4])
expectation = sys.argv[4]
assert expectation in ("red", "green")
assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout).strip()
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
build = json.loads((checkout / "dist/.buildstamp").read_text())
assert build["head"] == head and build["inputsClean"] is True
output.mkdir()
for name in ("home", "state", "workspace", "tmp"):
    (output / name).mkdir()
sha = lambda data: hashlib.sha256(data).hexdigest()
receipt = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "head": head, "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=checkout, text=True).strip(),
           "buildStamp": build, "collectorSHA256": sha(Path(__file__).read_bytes()), "expectation": expectation,
           "entry": "normal openclaw.mjs in its controlling PTY, without no-respawn override",
           "boundary": "Actual skills verify/--card -> native ClawHub HTTP -> terminal Ctrl-C -> passive HTTP peer and process/PTY readback",
           "cases": [], "result": "RUNNING"}
active = None
lock = threading.Lock()
verification = {"schema": "clawhub.skill.verify.v1", "ok": True, "decision": "pass", "reasons": [],
                "slug": "weather", "displayName": "Synthetic verification completed", "publisherHandle": "demo-owner",
                "skill": {}, "publisher": {}, "version": "1.0.0", "card": {"available": True, "url": "/proof-card"},
                "artifact": {}, "provenance": None, "security": {}, "signature": {}}
card = "# Synthetic verified card completed\n"
def save():
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        current = active
        row = {"method": "GET", "path": self.path, "requestAtMonotonic": time.monotonic(),
               "authorizationPresent": bool(self.headers.get("Authorization")), "bodyReleased": False, "peerClosed": False}
        with lock:
            current["requests"].append(row)
        is_verify = self.path.startswith("/api/v1/skills/weather/verify")
        assert is_verify or self.path == "/proof-card", self.path
        payload = json.dumps(verification).encode() if is_verify else card.encode()
        hold = current["interrupt"] and ((current["kind"] == "verification" and is_verify) or (current["kind"] == "card" and not is_verify))
        self.send_response(200)
        self.send_header("content-type", "application/json" if is_verify else "text/markdown; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        if hold:
            prefix = payload[:12]
            self.wfile.write(prefix)
            self.wfile.flush()
            row["prefixWrittenBytes"] = len(prefix)
            row["prefixWrittenAtMonotonic"] = time.monotonic()
            current["heldResponseReady"].set()
            end = time.monotonic() + 6
            while time.monotonic() < end:
                readable, _, _ = select.select([self.connection], [], [], min(0.05, end - time.monotonic()))
                if readable:
                    try:
                        closed = self.connection.recv(1, socket.MSG_PEEK) == b""
                    except ConnectionResetError:
                        closed = True
                    if closed:
                        row["peerClosed"] = True
                        row["peerClosedAtMonotonic"] = time.monotonic()
                        return
            payload = payload[12:]
        try:
            self.wfile.write(payload)
            self.wfile.flush()
            row["bodyReleased"] = True
            row["bodyReleasedAtMonotonic"] = time.monotonic()
        except (BrokenPipeError, ConnectionResetError):
            row["peerClosed"] = True
            row["peerClosedAtMonotonic"] = time.monotonic()

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = False
thread = threading.Thread(target=server.serve_forever)
thread.start()
config = output / "config.json"
config.write_text(json.dumps({"agents": {"defaults": {"workspace": str(output / "workspace")}}}))
config.chmod(0o600)
config_before = sha(config.read_bytes())
env = {"PATH": str(node.parent) + ":/usr/bin:/bin", "HOME": str(output / "home"), "USERPROFILE": str(output / "home"),
       "OPENCLAW_STATE_DIR": str(output / "state"), "OPENCLAW_CONFIG_PATH": str(config), "TMPDIR": str(output / "tmp"),
       "OPENCLAW_DISABLE_BUNDLED_PLUGINS": "1", "OPENCLAW_CLAWHUB_URL": f"http://127.0.0.1:{server.server_port}",
       "CLAWHUB_CONFIG_PATH": str(output / "no-clawhub-config.json"), "CLAWHUB_DISABLE_TELEMETRY": "1",
       "NO_COLOR": "1", "TERM": "xterm-256color"}

def run(kind, interrupt):
    global active
    label = kind + ("-interrupt" if interrupt else "-control")
    current = {"kind": kind, "interrupt": interrupt, "requests": [], "heldResponseReady": threading.Event()}
    active = current
    command = [str(node), str(checkout / "openclaw.mjs"), "skills", "verify", "@demo-owner/weather"]
    if kind == "card":
        command.append("--card")
    started = time.monotonic()
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(checkout)
        os.execve(str(node), command, env)
    data = bytearray()
    sent, status, exited = None, None, None
    eof, watchdog = False, False
    try:
        while time.monotonic() - started < 40:
            if interrupt and sent is None and current["heldResponseReady"].is_set():
                sent = time.monotonic()
                os.write(master, b"\x03")
            ready, _, _ = select.select([master], [], [], 0.03)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                    if chunk:
                        data.extend(chunk)
                    else:
                        eof = True
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    eof = True
            if status is None:
                got, value = os.waitpid(pid, os.WNOHANG)
                if got:
                    status, exited = value, time.monotonic()
            if status is not None and eof:
                break
        if status is None:
            watchdog = True
            os.killpg(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
            exited = time.monotonic()
    finally:
        os.close(master)
    text = data.decode(errors="replace")
    marker = "Synthetic verified card completed" if kind == "card" else "Synthetic verification completed"
    row = {"label": label, "command": command, "requests": current["requests"], "seconds": round(exited - started, 4),
           "exitCode": os.waitstatus_to_exitcode(status), "signalNumber": os.WTERMSIG(status) if os.WIFSIGNALED(status) else None,
           "safetyKill": watchdog, "ptyEofDrained": eof, "interruptSent": sent is not None,
           "interruptToExitMs": round((exited - sent) * 1000, 2) if sent else None,
           "lateResultPresent": marker in text if interrupt else None, "output": text,
           "interruptToPeerCloseMs": [round((x["peerClosedAtMonotonic"] - sent) * 1000, 2) if sent and x.get("peerClosedAtMonotonic") else None for x in current["requests"]]}
    (output / (label + ".pty.log")).write_bytes(data)
    receipt["cases"].append(row)
    save()
    assert not watchdog and eof, "Harness timeout is not a product verdict"
    assert len(current["requests"]) == (2 if kind == "card" else 1)
    assert not any(x["authorizationPresent"] for x in current["requests"])
    if not interrupt:
        assert row["exitCode"] == 0 and marker in text
    else:
        row["cooperativeCancellationPassed"] = row["exitCode"] == 130 and row["signalNumber"] is None and not row["lateResultPresent"]
    save()
    return row

try:
    for kind in ("verification", "card"):
        run(kind, False)
        run(kind, True)
    canceled = [x for x in receipt["cases"] if x["interruptSent"]]
    actual_green = all(x["cooperativeCancellationPassed"] for x in canceled)
    receipt["result"] = "GREEN" if actual_green else "RED"
    receipt["expectationMatched"] = actual_green == (expectation == "green")
    assert receipt["expectationMatched"]
    assert sha(config.read_bytes()) == config_before
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout).strip()
except BaseException as error:
    receipt["result"] = "BLOCKED_OR_FAILED_SETUP"
    receipt["error"] = repr(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    receipt["cleanup"] = {"serverClosed": True, "directCliChildrenWaited": True, "privateSyntheticStateRetained": True,
                          "productionServiceTouched": False, "externalGatewayOrModelOrChannelUsed": False}
    save()
print(json.dumps({"head": head, "result": receipt["result"], "cases": [{k: x[k] for k in ("label", "exitCode", "signalNumber", "seconds", "interruptToExitMs", "lateResultPresent")} for x in receipt["cases"]]}, indent=2))
