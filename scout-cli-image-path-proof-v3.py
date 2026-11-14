#!/usr/bin/env python3
"""Native infer image path identity: real CLI, disk/backend and loopback HTTP."""
import base64
import email.parser
import email.policy
import hashlib
import http.server
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import zlib

checkout, output, node = (Path(x).resolve() for x in sys.argv[1:4])
mode = sys.argv[4]
assert mode in ("base", "head")
assert not output.exists(), "Use a fresh, task-owned evidence directory"
assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout).strip()
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
build = json.loads((checkout / "dist/.buildstamp").read_text())
assert build["head"] == head and build["inputsClean"] is True
output.mkdir()
for name in ("home", "state", "workspace", "tmp", "fixtures"):
    (output / name).mkdir()
fixtures = output / "fixtures"
(fixtures / "physical/nested").mkdir(parents=True)
(fixtures / "selected-link").symlink_to("physical/nested", target_is_directory=True)
digest = lambda b: hashlib.sha256(b).hexdigest()

def png(rgb):
    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))
    pixels = (b"\x00" + bytes(rgb) * 16) * 16
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")

intended, decoy = png((224, 68, 45)), png((22, 90, 200))
(fixtures / "physical/photo.png").write_bytes(intended)
(fixtures / "photo.png").write_bytes(decoy)
selected = fixtures / "selected-link/../photo.png"
assert selected.read_bytes() == intended
backend = output / "disk-recorder.py"
backend.write_text("import hashlib,json,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);b=p.read_bytes();o={'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}\nwith open(sys.argv[2],'a') as f:f.write(json.dumps(o)+'\\n')\nprint('selected-sha256:'+o['sha256'])\n")
disk_log = output / "backend-reads.jsonl"
requests = []
errors = []
active = None

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        try:
            assert self.path in ("/v1/images/edits", "/v1/chat/completions")
            body = self.rfile.read(int(self.headers["content-length"]))
            if self.path == "/v1/chat/completions":
                payload = json.loads(body)
                images = []
                for message in payload["messages"]:
                    content = message.get("content", [])
                    for part in content if isinstance(content, list) else []:
                        if part.get("type") == "image_url":
                            url = part["image_url"]["url"]
                            assert url.startswith("data:image/png;base64,")
                            image = base64.b64decode(url.split(",", 1)[1], validate=True)
                            images.append({"sha256": digest(image), "bytes": len(image)})
                assert images, "Model adapter must actually send image bytes"
                requests.append({"case": active, "path": self.path, "model": payload["model"], "headers": {k: ("[SYNTHETIC_AUTH_REDACTED]" if k.lower() == "authorization" else v) for k, v in self.headers.items()}, "bodySha256": digest(body), "images": images})
                chunks = [{"id": "synthetic-image-path", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "selected-sha256:" + images[0]["sha256"]}, "finish_reason": None}]}, {"id": "synthetic-image-path", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}]
                response = ("".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                return
            mime = email.parser.BytesParser(policy=email.policy.default).parsebytes(
                ("Content-Type: " + self.headers["content-type"] + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
            images = []
            for part in mime.iter_parts():
                if part.get_param("name", header="content-disposition") == "image[]":
                    image = part.get_payload(decode=True)
                    images.append({"filename": part.get_filename(), "sha256": digest(image), "bytes": len(image)})
            assert images, "Native adapter must actually upload input bytes"
            row = {"case": active, "path": self.path, "headers": {k: ("[SYNTHETIC_AUTH_REDACTED]" if k.lower() == "authorization" else v) for k, v in self.headers.items()}, "bodySha256": digest(body), "images": images}
            requests.append(row)
            response = json.dumps({"created": 1, "data": [{"b64_json": base64.b64encode(intended).decode()}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as error:
            errors.append(str(error))
            self.send_error(500)

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever)
thread.start()
config = output / "config.json"
config.write_text(json.dumps({
    "gateway": {"mode": "local"},
    "agents": {"defaults": {"workspace": str(output / "workspace")}, "entries": {"main": {}}},
    "models": {"providers": {"image-path": {"baseUrl": "http://127.0.0.1:%d/v1" % server.server_port, "apiKey": "synthetic-image-path-key", "api": "openai-completions", "request": {"allowPrivateNetwork": True}, "models": [{"id": "image-path", "name": "Synthetic image path", "reasoning": False, "input": ["text", "image"], "contextWindow": 128000, "maxTokens": 1024}]}, "openai": {"baseUrl": "http://127.0.0.1:%d/v1" % server.server_port, "apiKey": "synthetic-image-path-key", "api": "openai-completions", "models": [], "request": {"allowPrivateNetwork": True}}}},
    "tools": {"media": {"image": {"enabled": True}, "models": [{"type": "cli", "command": sys.executable, "args": [str(backend), "{{MediaPath}}", str(disk_log)], "capabilities": ["image"]}]}}
}))
config.chmod(0o600)
environment = {"PATH": str(node.parent) + ":/usr/bin:/bin", "HOME": str(output / "home"), "USERPROFILE": str(output / "home"), "OPENCLAW_STATE_DIR": str(output / "state"), "OPENCLAW_CONFIG_PATH": str(config), "TMPDIR": str(output / "tmp"), "NO_COLOR": "1", "TERM": "dumb", "OPENCLAW_QA_ALLOW_LOCAL_IMAGE_PROVIDER": "1"}
receipt = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "head": head, "buildStamp": build, "collectorSha256": digest(Path(__file__).read_bytes()), "expectedMode": mode, "loopbackOptIn": "Existing OPENCLAW_QA_ALLOW_LOCAL_IMAGE_PROVIDER=1 permits only the configured loopback OpenAI image fixture; actual adapter SSRF policy otherwise unchanged", "priorAttempt": "v1 retained at scout-cli-image-base: describe controls/RED succeeded; edit stopped before HTTP because explicit existing QA loopback opt-in was missing", "fixture": {"selected": str(selected), "osReadSha256": digest(selected.read_bytes()), "intendedSha256": digest(intended), "decoySha256": digest(decoy)}, "cases": [], "boundary": "Normal shipped CLI -> actual path selection/cache and configured local CLI reader; native bundled OpenAI image adapter -> real loopback multipart HTTP recorder -> independently read output PNG; model local simple-completion adapter -> actual HTTP/SSE recorder with decoded image bytes. No substituted product functions, live provider or external channel.", "result": "RUNNING"}
def save():
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")

def run(label, subcommand, paths, legal):
    global active
    active = label
    before_disk = len(disk_log.read_text().splitlines()) if disk_log.exists() else 0
    before_http = len(requests)
    command = [str(node), str(checkout / "openclaw.mjs"), "infer"]
    if subcommand == "model":
        command.extend(["model", "run", "--local", "--agent", "main", "--model", "image-path/image-path", "--prompt", "Read the synthetic image"])
    else:
        command.extend(["image", subcommand, "--agent", "main"])
    for path in paths:
        command.extend(["--file", str(path)])
    destination = output / (label + ".png")
    if subcommand == "edit":
        command.extend(["--prompt", "Preserve this synthetic image", "--model", "openai/gpt-image-1.5", "--output", str(destination)])
    command.append("--json")
    started = time.monotonic()
    result = subprocess.run(command, cwd=checkout, env=environment, capture_output=True, timeout=90)
    elapsed = time.monotonic() - started
    (output / (label + ".stdout")).write_bytes(result.stdout)
    (output / (label + ".stderr")).write_bytes(result.stderr)
    reads = [json.loads(x) for x in disk_log.read_text().splitlines()[before_disk:]] if disk_log.exists() else []
    sent = requests[before_http:]
    row = {"label": label, "command": command, "exitCode": result.returncode, "seconds": round(elapsed, 3), "diskReads": reads, "httpRequests": sent, "stdoutSHA256": digest(result.stdout), "stderrSHA256": digest(result.stderr), "legalControl": legal}
    receipt["cases"].append(row)
    save()
    assert result.returncode == 0, "CLI setup/product failed before byte-selection acceptance: " + label
    envelope = json.loads(result.stdout)
    assert envelope["ok"] is True
    hashes = [r["sha256"] for r in reads] if subcommand not in ("edit", "model") else [r["sha256"] for q in sent for r in q["images"]]
    assert len(hashes) == len(paths), "Every requested image must cross the real read boundary"
    assert hashes == [digest(intended)] * len(paths) if legal or mode == "head" else hashes == [digest(decoy)] + [digest(intended)] * (len(paths) - 1)
    if subcommand == "model":
        assert envelope["outputs"][0]["text"] == "selected-sha256:" + hashes[0]
        row["modelReplyReadback"] = envelope["outputs"][0]["text"]
    if subcommand == "edit":
        assert destination.read_bytes() == intended
        row["outputReadbackSHA256"] = digest(destination.read_bytes())
    row["result"] = "GREEN_CONTROL" if legal else "RED_WRONG_BYTES" if mode == "base" else "GREEN_INTENDED_BYTES"
    save()

try:
    run("model-physical-control", "model", [fixtures / "physical/photo.png"], True)
    run("model-parent-traversal", "model", [selected], False)
    run("describe-physical-control", "describe", [fixtures / "physical/photo.png"], True)
    run("describe-parent-traversal", "describe", [selected], False)
    run("describe-many-parent-traversal", "describe-many", [selected, fixtures / "physical/photo.png"], False)
    run("edit-physical-control", "edit", [fixtures / "physical/photo.png"], True)
    run("edit-parent-traversal", "edit", [selected], False)
    assert errors == []
    assert selected.read_bytes() == intended and (fixtures / "photo.png").read_bytes() == decoy
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout).strip()
    receipt["result"] = "RED_WITH_LEGAL_CONTROLS" if mode == "base" else "GREEN_WITH_LEGAL_CONTROLS"
except Exception as error:
    receipt["result"] = "BLOCKED"
    receipt["error"] = repr(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    receipt["serverErrors"] = errors
    receipt["cleanup"] = {"serverClosed": True, "productionTouched": False, "liveProvider": False, "externalMessages": False, "privateStateRetainedForReadback": str(output)}
    save()
    print(json.dumps({"result": receipt["result"], "head": head, "output": str(output), "cases": [{"label": r["label"], "result": r.get("result"), "exitCode": r["exitCode"]} for r in receipt["cases"]]}))
