#!/usr/bin/env python3
"""Task-only native Gateway byte-preservation probe; never imports product helpers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time


def sha(data):
    return hashlib.sha256(data).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("--repo", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--node", required=True)
parser.add_argument("--expect-head", required=True)
parser.add_argument("--expect", choices=["red", "green"], required=True)
args = parser.parse_args()
repo = Path(args.repo).resolve()
out = Path(args.output).resolve()
if out.exists():
    raise SystemExit("Use a fresh, nonexistent task-owned output directory")
out.mkdir(parents=True)
node = str(Path(args.node).resolve())
for directory in ["home", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "tmp", "state", "workspace"]:
    (out / directory).mkdir()
workspace = out / "workspace"
config_path = out / "openclaw.json"
token = "task-only-agent-utf8-v2-local-token"
config_path.write_text(json.dumps({
    "gateway": {"mode": "local", "auth": {"mode": "token", "token": token}, "controlUi": {"enabled": False}},
    "agents": {"entries": {"main": {"workspace": str(workspace)}}},
}) + "\n")
env = {
    "PATH": str(Path(node).parent) + ":/usr/bin:/bin",
    "HOME": str(out / "home"), "USERPROFILE": str(out / "home"),
    "XDG_CONFIG_HOME": str(out / "xdg-config"), "XDG_CACHE_HOME": str(out / "xdg-cache"),
    "XDG_DATA_HOME": str(out / "xdg-data"), "XDG_STATE_HOME": str(out / "xdg-state"),
    "TMPDIR": str(out / "tmp"), "TMP": str(out / "tmp"), "TEMP": str(out / "tmp"),
    "OPENCLAW_CONFIG_PATH": str(config_path), "OPENCLAW_STATE_DIR": str(out / "state"),
    "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "NO_COLOR": "1", "TERM": "dumb",
}


def git(*argv):
    return subprocess.check_output(["git", *argv], cwd=repo, env=env, text=True).strip()


def binding():
    head = git("rev-parse", "HEAD")
    dirty = git("status", "--porcelain", "--untracked-files=no")
    stamp = json.loads((repo / "dist/build-info.json").read_text())
    files = ["openclaw.mjs", "dist/entry.js", "dist/index.js", "dist/build-info.json", "src/gateway/server-methods/agents-files.ts"]
    return {"head": head, "tracked_status": dirty, "build_stamp": stamp,
            "file_sha256": {f: sha((repo / f).read_bytes()) for f in files if (repo / f).exists()},
            "pass": head == args.expect_head and not dirty and stamp.get("commit") == head}


receipt = {
    "expected": args.expect, "expected_head": args.expect_head,
    "collector_sha256": sha(Path(__file__).read_bytes()), "binding_before": binding(),
    "environment": env, "environment_policy": "Explicit allowlist; no parent environment copied",
    "isolation_limit": "HOME/XDG/tmp/state/config are task-owned. This is not an OS filesystem or network sandbox; product package/dependency reads are expected.",
    "runs": [], "fixture_actions": [], "cases": [],
    "fixture_cleanup": "Retained for review; no fixture deletion is claimed",
}
if not receipt["binding_before"]["pass"]:
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit("HEAD/build-stamp/clean binding failed before execution")
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
receipt["port"] = port
base_argv = [node, str(repo / "openclaw.mjs")]
gateway_argv = base_argv + ["gateway", "run", "--port", str(port), "--bind", "loopback"]
receipt["gateway_argv"] = gateway_argv
log = (out / "gateway.log").open("w")
start = time.monotonic()
gateway = subprocess.Popen(gateway_argv, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
receipt["owned_process"] = {"pid": gateway.pid, "process_group": gateway.pid, "new_session": True}


def fixture(name, raw, label):
    path = workspace / name
    path.write_bytes(raw)
    receipt["fixture_actions"].append({"case": label, "action": "explicit task-fixture reset", "path": str(path), "hex": raw.hex(), "sha256": sha(raw)})
    return path


def call(method, params, label):
    argv = base_argv + ["gateway", "call", method, "--url", f"ws://127.0.0.1:{port}", "--token", token,
                        "--params", json.dumps(params, ensure_ascii=False), "--json", "--timeout", "10000"]
    t = time.monotonic()
    result = subprocess.run(argv, cwd=repo, env=env, text=True, capture_output=True, timeout=25)
    receipt["runs"].append({"case": label, "method": method, "params": params, "argv": argv,
                            "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
                            "elapsed_seconds": time.monotonic() - t})
    return result, json.loads(result.stdout) if result.returncode == 0 else None


def record(label, before, after, config_before, red, green, extra=None):
    item = {"name": label, "before_hex": before.hex(), "after_hex": after.hex(), "before_sha256": sha(before),
            "after_sha256": sha(after), "bytes_preserved": before == after,
            "config_sha256_before": config_before, "config_sha256_after": sha(config_path.read_bytes()),
            "observed_red": red, "observed_green": green, "pass": red if args.expect == "red" else green}
    item.update(extra or {})
    receipt["cases"].append(item)


try:
    for _ in range(120):
        if gateway.poll() is not None:
            raise RuntimeError(f"Owned Gateway exited during startup: {gateway.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError("Owned Gateway startup timeout")

    bad = b"# Instructions\nKeep caf\xe9 terminology.\n"
    label = "malformed-get-dirty-save"
    target = fixture("AGENTS.md", bad, label)
    cfg = sha(config_path.read_bytes())
    read, payload = call("agents.files.get", {"agentId": "main", "name": "AGENTS.md"}, label)
    write = None
    if payload is not None:
        text = payload["file"]["content"] + "\nAdditional ordinary instruction.\n"
        write, _ = call("agents.files.set", {"agentId": "main", "name": "AGENTS.md", "content": text,
                        "expectedHash": payload["file"]["hash"], "expectedWorkspace": payload["workspace"]}, label)
    after = target.read_bytes()
    red = payload is not None and "\ufffd" in payload["file"]["content"] and write is not None and write.returncode == 0 and b"caf\xef\xbf\xbd" in after
    green = read.returncode != 0 and after == bad and sha(config_path.read_bytes()) == cfg
    record(label, bad, after, cfg, red, green)

    label = "cached-raw-hash-checked-save"
    target = fixture("AGENTS.md", bad, label)
    cfg = sha(config_path.read_bytes())
    # Models a draft/token returned by the old lossy reader, independent of this HEAD's get refusal.
    cached = bad.decode("utf-8", errors="replace") + "\nCached ordinary instruction.\n"
    write, _ = call("agents.files.set", {"agentId": "main", "name": "AGENTS.md", "content": cached,
                    "expectedHash": sha(bad), "expectedWorkspace": str(workspace)}, label)
    after = target.read_bytes()
    record(label, bad, after, cfg, write.returncode == 0 and after == cached.encode(),
           write.returncode != 0 and after == bad and sha(config_path.read_bytes()) == cfg,
           {"cached_token_origin": "Exact original bytes; equivalent to old reader raw CAS hash; no source helper invoked"})

    label = "valid-unicode-bom-literal-replacement"
    valid = "\ufeff# Instructions\n模型 😀 café and literal \ufffd.\n".encode()
    target = fixture("AGENTS.md", valid, label)
    cfg = sha(config_path.read_bytes())
    read, payload = call("agents.files.get", {"agentId": "main", "name": "AGENTS.md"}, label)
    exact = payload is not None and payload["file"]["content"].encode() == valid and payload["file"]["hash"] == sha(valid)
    changed = valid + "\n追加 instruction.\n".encode()
    write = None
    if payload is not None:
        write, _ = call("agents.files.set", {"agentId": "main", "name": "AGENTS.md", "content": changed.decode(),
                        "expectedHash": payload["file"]["hash"], "expectedWorkspace": payload["workspace"]}, label)
    after = target.read_bytes()
    ok = exact and write is not None and write.returncode == 0 and after == changed and sha(config_path.read_bytes()) == cfg
    record(label, valid, after, cfg, ok, ok, {"exact_expected_after_hex": changed.hex(), "control": True})

    label = "intentional-blind-set"
    target = fixture("AGENTS.md", bad, label)
    cfg = sha(config_path.read_bytes())
    replacement = "# Explicit replacement\n合法 Unicode 😀.\n".encode()
    write, _ = call("agents.files.set", {"agentId": "main", "name": "AGENTS.md", "content": replacement.decode()}, label)
    after = target.read_bytes()
    ok = write.returncode == 0 and after == replacement and sha(config_path.read_bytes()) == cfg
    record(label, bad, after, cfg, ok, ok, {"control": True, "precondition": "No expectedHash; intentional full replacement remains supported"})

    label = "identity-update-malformed-preread"
    identity = b"# Identity\n- Name: Old\n- Vibe: caf\xe9\n"
    target = fixture("IDENTITY.md", identity, label)
    cfg = sha(config_path.read_bytes())
    update, _ = call("agents.update", {"agentId": "main", "name": "New"}, label)
    after = target.read_bytes()
    record(label, identity, after, cfg, update.returncode == 0 and b"caf\xef\xbf\xbd" in after and b"- Name: New" in after,
           update.returncode != 0 and after == identity and sha(config_path.read_bytes()) == cfg,
           {"config_mutation_scope": "This RPC may update task-owned config on RED; no model/provider or external config is supplied"})
except Exception as error:
    receipt["error"] = repr(error)
finally:
    cleanup = {"scope": "Only the process group created by this collector; fixtures retained", "sent": []}
    if gateway.poll() is None:
        os.killpg(gateway.pid, signal.SIGTERM)
        cleanup["sent"].append("SIGTERM")
    try:
        gateway.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(gateway.pid, signal.SIGKILL)
        cleanup["sent"].append("SIGKILL")
        gateway.wait(timeout=5)
    cleanup["leader_exit"] = gateway.returncode
    try:
        os.killpg(gateway.pid, 0)
        cleanup["owned_process_group_absent"] = False
    except ProcessLookupError:
        cleanup["owned_process_group_absent"] = True
    log.close()
    receipt["process_cleanup"] = cleanup
    receipt["binding_after"] = binding()
    receipt["config_final_sha256"] = sha(config_path.read_bytes())
    receipt["elapsed_seconds"] = time.monotonic() - start
    receipt["pass"] = (not receipt.get("error") and len(receipt["cases"]) == 5 and all(c["pass"] for c in receipt["cases"])
                       and receipt["binding_before"]["pass"] and receipt["binding_after"]["pass"]
                       and receipt["binding_before"] == receipt["binding_after"] and cleanup["owned_process_group_absent"])
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"pass": receipt["pass"], "error": receipt.get("error"), "cases": [{"name": c["name"], "pass": c["pass"]} for c in receipt["cases"]],
                      "elapsed_seconds": receipt["elapsed_seconds"], "receipt": str(out / "receipt.json")}))
raise SystemExit(0 if receipt["pass"] else 1)
