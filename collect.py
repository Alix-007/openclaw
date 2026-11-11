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
import urllib.request
import urllib.error
import tempfile
import zlib
import struct
import binascii
import shutil


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
    "browser": {"executablePath": "/usr/bin/google-chrome"},
    "plugins": {"allow": ["diffs"], "entries": {"diffs": {"enabled": True}}},
    "tools": {"profile": "full", "allow": ["diffs"]},
    "gateway": {"mode": "local", "auth": {"mode": "token", "token": token}, "controlUi": {"enabled": False}},
    "agents": {"entries": {"main": {"workspace": str(workspace)}}},
}) + "\n")
short_tmp = Path(tempfile.mkdtemp(prefix="ocdr-", dir="/tmp"))
env = {
    "PATH": str(Path(node).parent) + ":/usr/bin:/bin",
    "HOME": str(out / "home"), "USERPROFILE": str(out / "home"),
    "XDG_CONFIG_HOME": str(out / "xdg-config"), "XDG_CACHE_HOME": str(out / "xdg-cache"),
    "XDG_DATA_HOME": str(out / "xdg-data"), "XDG_STATE_HOME": str(out / "xdg-state"),
    "TMPDIR": str(short_tmp), "TMP": str(short_tmp), "TEMP": str(short_tmp),
    "OPENCLAW_CONFIG_PATH": str(config_path), "OPENCLAW_STATE_DIR": str(out / "state"),
    "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "NO_COLOR": "1", "TERM": "dumb",
}


def git(*argv):
    return subprocess.check_output(["git", *argv], cwd=repo, env=env, text=True).strip()


def binding():
    head = git("rev-parse", "HEAD")
    dirty = git("status", "--porcelain", "--untracked-files=no")
    stamp = json.loads((repo / "dist/build-info.json").read_text())
    files = ["openclaw.mjs", "dist/entry.js", "dist/index.js", "dist/build-info.json", "src/gateway/server-methods/agents-files.ts", "extensions/diffs/src/browser.runtime.ts", "extensions/diffs/src/config.ts", "extensions/diffs/src/render.ts", "extensions/diffs/src/tool.ts"]
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
receipt["pixel_budget"] = 8_000_000
receipt["short_tmp_retained"] = str(short_tmp)
receipt["initial_config_sha256"] = sha(config_path.read_bytes())
receipt["chrome_version"] = subprocess.check_output(["/usr/bin/google-chrome", "--version"],env=env,text=True).strip()
receipt["artifacts"] = []
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

    def decode_png(data):
        if data[:8] != b"\x89PNG\r\n\x1a\n": raise RuntimeError("Not PNG")
        pos=8; compressed=bytearray(); width=height=kind=depth=None; ended=False
        while pos < len(data):
            length=int.from_bytes(data[pos:pos+4],"big"); tag=data[pos+4:pos+8]; chunk=data[pos+8:pos+8+length]
            crc=int.from_bytes(data[pos+8+length:pos+12+length],"big")
            if binascii.crc32(tag+chunk)&0xffffffff != crc: raise RuntimeError("PNG CRC mismatch")
            if tag==b"IHDR":
                width,height,depth,kind,compression,filtering,interlace=struct.unpack(">IIBBBBB",chunk)
                if depth!=8 or kind not in [2,6] or compression or filtering or interlace: raise RuntimeError("Unsupported actual PNG encoding")
            elif tag==b"IDAT": compressed.extend(chunk)
            elif tag==b"IEND": ended=True; break
            pos+=12+length
        if not ended or width is None: raise RuntimeError("Incomplete PNG")
        bpp=3 if kind==2 else 4; stride=width*bpp; inflated=zlib.decompress(compressed)
        if len(inflated)!=height*(stride+1): raise RuntimeError("PNG scanline length mismatch")
        previous=bytearray(stride); digest=hashlib.sha256(); filters=set(); sample_colors=set()
        for row_index in range(height):
            offset=row_index*(stride+1); filt=inflated[offset]; filters.add(filt)
            row=bytearray(inflated[offset+1:offset+1+stride])
            if filt==1:
                for i in range(bpp,stride): row[i]=(row[i]+row[i-bpp])&255
            elif filt==2:
                for i in range(stride): row[i]=(row[i]+previous[i])&255
            elif filt in [3,4]:
                for i in range(stride):
                    left=row[i-bpp] if i>=bpp else 0; up=previous[i]; corner=previous[i-bpp] if i>=bpp else 0
                    if filt==3: predictor=(left+up)//2
                    else:
                        guess=left+up-corner; a=abs(guess-left); b=abs(guess-up); c=abs(guess-corner)
                        predictor=left if a<=b and a<=c else up if b<=c else corner
                    row[i]=(row[i]+predictor)&255
            elif filt!=0: raise RuntimeError("Invalid PNG row filter")
            digest.update(row)
            if row_index%max(1,height//32)==0:
                for x in range(0,width,max(1,width//32)): sample_colors.add(bytes(row[x*bpp:x*bpp+3]).hex())
            previous=row
        return {"width":width,"height":height,"pixels":width*height,"bit_depth":depth,"color_type":kind,"decoded_pixel_sha256":digest.hexdigest(),"filter_types":sorted(filters),"sample_color_count":len(sample_colors),"crc_verified":True,"full_scanlines_decoded":True}

    def render(label,count,scale):
        config_before=sha(config_path.read_bytes()); log_before=(out/"gateway.log").stat().st_size
        before="\n".join(f"line {i}: old value" for i in range(count)); after="\n".join(f"line {i}: new value" for i in range(count))
        request={"tool":"diffs","args":{"before":before,"after":after,"path":"example.txt","mode":"file","fileFormat":"png","fileQuality":"standard","fileScale":scale,"fileMaxWidth":960,"expandUnchanged":True}}
        req=urllib.request.Request(f"http://127.0.0.1:{port}/tools/invoke",data=json.dumps(request).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
        t=time.monotonic()
        try:
            with urllib.request.urlopen(req,timeout=60) as response: status=response.status; raw=response.read().decode()
        except urllib.error.HTTPError as error: status=error.code; raw=error.read().decode()
        payload=json.loads(raw); details=payload.get("result",{}).get("details",{}); returned=details.get("filePath")
        item={"name":label,"count":count,"scale_requested":scale,"request":request,"request_sha256":sha(json.dumps(request,sort_keys=True).encode()),"status":status,"raw_response":raw,"payload":payload,"rendered":bool(returned),"elapsed_seconds":time.monotonic()-t,"config_sha256_before":config_before,"config_sha256_after":sha(config_path.read_bytes()),"owned_log_delta":(out/"gateway.log").read_bytes()[log_before:].decode(errors="replace")}
        if returned:
            file=Path(returned); data=file.read_bytes(); image=decode_png(data); evidence=out/(label+".png"); evidence.write_bytes(data)
            item.update({"png":image,"artifact_sha256":sha(data),"file_bytes":len(data),"evidence":str(evidence),"file_scale_reported":details.get("fileScale"),"artifact_id":details.get("artifactId")})
            receipt["artifacts"].append({"id":details["artifactId"],"original":returned,"evidence":str(evidence),"sha256":sha(data)})
        receipt["cases"].append(item)
        return item

    def valid_artifact(item):
        if not item["rendered"]:return False
        details=item["payload"]["result"]["details"]; png=item["png"]
        return item["status"]==200 and item["payload"].get("ok")==True and details.get("fileBytes")==item["file_bytes"] and details.get("fileFormat")=="png" and 0<png["pixels"]<=8_000_000 and png["sample_color_count"]>2 and item["config_sha256_before"]==item["config_sha256_after"]

    small=render("small-scale4",2,4)
    small["pass"]=valid_artifact(small) and small["file_scale_reported"]==4
    normal=render("same-input-scale1",40,1)
    normal["pass"]=valid_artifact(normal) and normal["file_scale_reported"]==1
    target=render("same-input-auto-scale4",40,4)
    if args.expect=="red":
        target["pass"]=not target["rendered"] and target["status"]==500 and "image size limits" in target["owned_log_delta"] and target["config_sha256_before"]==target["config_sha256_after"]
    else:
        png=target.get("png",{}); reported=target.get("file_scale_reported",0)
        target["pass"]=valid_artifact(target) and normal["pass"] and 1<reported<4 and abs(png["width"]/normal["png"]["width"]-reported)<0.01 and abs(png["height"]/normal["png"]["height"]-reported)<0.01
    hard=render("hard-limit-scale1",200,1)
    hard["pass"]=not hard["rendered"] and hard["status"]==500 and "image size limits" in hard["owned_log_delta"] and hard["config_sha256_before"]==hard["config_sha256_after"]
    receipt["normal_input_sha256"]=sha(json.dumps({"before":normal["request"]["args"]["before"],"after":normal["request"]["args"]["after"]},sort_keys=True).encode())
    receipt["same_input_control_verified"]=normal["request"]["args"]["before"]==target["request"]["args"]["before"] and normal["request"]["args"]["after"]==target["request"]["args"]["after"]
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
    artifact_cleanup=[]
    for artifact in receipt["artifacts"]:
        file=Path(artifact["original"]); aid=artifact["id"]; evidence=Path(artifact["evidence"])
        if file.name!="preview.png" or file.parent.name!=aid or file.parent.parent!=Path("/tmp/openclaw/openclaw-diffs") or len(aid)!=20 or any(c not in "0123456789abcdef" for c in aid):
            receipt["error"]="Unexpected artifact cleanup path"; break
        if sha(file.read_bytes())!=artifact["sha256"] or sha(evidence.read_bytes())!=artifact["sha256"]:
            receipt["error"]="Artifact cleanup evidence mismatch"; break
        shutil.rmtree(file.parent)
        artifact_cleanup.append({**artifact,"original_removed":not file.parent.exists()})
    receipt["artifact_cleanup"]=artifact_cleanup
    receipt["artifact_cleanup_scope"]="Only exact returned task-generated IDs; hashed PNG evidence retained; short tmp/HOME/state fixtures retained"
    log.close()
    receipt["process_cleanup"] = cleanup
    receipt["binding_after"] = binding()
    receipt["config_final_sha256"] = sha(config_path.read_bytes())
    receipt["elapsed_seconds"] = time.monotonic() - start
    receipt["pass"] = (not receipt.get("error") and len(receipt["cases"]) == 4 and receipt.get("same_input_control_verified",False) and all(c["pass"] for c in receipt["cases"])
                       and receipt["binding_before"]["pass"] and receipt["binding_after"]["pass"]
                       and receipt["binding_before"] == receipt["binding_after"] and cleanup["owned_process_group_absent"])
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"pass": receipt["pass"], "error": receipt.get("error"), "cases": [{"name": c["name"], "pass": c["pass"]} for c in receipt["cases"]],
                      "elapsed_seconds": receipt["elapsed_seconds"], "receipt": str(out / "receipt.json")}))
raise SystemExit(0 if receipt["pass"] else 1)
