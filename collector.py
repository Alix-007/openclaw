import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

checkout, output, node = map(lambda s: Path(s).absolute(), sys.argv[1:4])
mode = sys.argv[4]
output.mkdir(mode=0o700)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=checkout), "Tracked source must be clean"
stamp = json.loads((checkout / "dist/.buildstamp").read_text())
assert stamp["head"] == head and stamp["inputsClean"]
receipt = {"head": head, "buildStamp": stamp, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "collectorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "mode": mode, "cases": [], "result": "RUNNING", "boundary": "Normal shipped CLI worktrees create and list, real native Git separate administrative directory and checkout/file readback; disposable offline state only"}
def save():
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
try:
    for label, suffix in [("ordinary-metadata-control", ""), ("literal-metadata-space", " ")]:
        fixture = output / label
        fixture.mkdir()
        for name in ["home", "state", "tmp", "workspace"]:
            (fixture / name).mkdir()
        env = {"PATH": str(node.parent) + ":/usr/bin:/bin", "HOME": str(fixture / "home"), "USERPROFILE": str(fixture / "home"), "TMPDIR": str(fixture / "tmp"), "OPENCLAW_STATE_DIR": str(fixture / "state"), "OPENCLAW_CONFIG_PATH": str(fixture / "config.json"), "NO_COLOR": "1", "TERM": "dumb", "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}
        repo = fixture / "checkout"
        metadata = fixture / ("metadata" + suffix)
        config = {"gateway": {"mode": "local"}, "agents": {"entries": {"main": {"workspace": str(fixture / "workspace")}}}, "worktreeRoot": str(fixture / "managed")}
        (fixture / "config.json").write_text(json.dumps(config))
        def git(*args):
            result = subprocess.run(["git", *args], cwd=fixture, env=env, capture_output=True, timeout=30, check=True)
            return result.stdout.decode()
        git("init", "--initial-branch=main", "--separate-git-dir=" + str(metadata), str(repo))
        (repo / "marker.txt").write_text("independent native checkout marker\n")
        git("-C", str(repo), "add", "marker.txt")
        git("-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture commit")
        common_raw = git("-C", str(repo), "rev-parse", "--git-common-dir")
        assert common_raw == str(metadata) + "\n" and metadata.is_dir()
        command = [str(node), str(checkout / "openclaw.mjs"), "worktrees", "create", str(repo), "--name", "proof", "--base-ref", "refs/heads/main", "--json"]
        started = time.monotonic()
        result = subprocess.run(command, cwd=checkout, env=env, capture_output=True, timeout=90)
        (fixture / "create.stdout").write_bytes(result.stdout)
        (fixture / "create.stderr").write_bytes(result.stderr)
        row = {"label": label, "command": command, "nativeCommonDirectoryOutput": common_raw, "metadataStillExists": metadata.is_dir(), "exitCode": result.returncode, "seconds": round(time.monotonic()-started, 3), "stdout": result.stdout.decode(errors="replace"), "stderr": result.stderr.decode(errors="replace")}
        receipt["cases"].append(row)
        save()
        should_succeed = not suffix or mode == "head"
        if should_succeed:
            assert result.returncode == 0, "Legal control or fixed input did not create a checkout"
            record = json.loads(result.stdout)
            created = Path(record["path"])
            row["markerReadback"] = (created / "marker.txt").read_text()
            assert row["markerReadback"] == "independent native checkout marker\n"
            listed = subprocess.run([str(node), str(checkout / "openclaw.mjs"), "worktrees", "list", "--json"], cwd=checkout, env=env, capture_output=True, timeout=90)
            (fixture / "list.stdout").write_bytes(listed.stdout)
            (fixture / "list.stderr").write_bytes(listed.stderr)
            assert listed.returncode == 0
            inventory = json.loads(listed.stdout)
            row["listReadback"] = any(p["id"] == record["id"] and p["path"] == record["path"] for p in inventory["worktrees"])
            assert row["listReadback"]
            row["result"] = "GREEN_CONTROL" if not suffix else "GREEN"
        else:
            assert result.returncode != 0
            error = json.loads(result.stdout)["error"]["message"]
            assert str(metadata).rstrip() in error and "ENOENT" in error, "Failure must be the literal native metadata path collapsing, not a setup error"
            row["result"] = "RED_LITERAL_METADATA_PATH_LOST"
        save()
    receipt["result"] = "RED_WITH_LEGAL_CONTROL" if mode == "base" else "GREEN"
except Exception as error:
    receipt["result"] = "BLOCKED_OR_UNEXPECTED"
    receipt["error"] = repr(error)
    raise
finally:
    receipt["cleanup"] = {"productionTouched": False, "remoteProviderOrChannelUsed": False, "childProcessesWaited": True, "disposableGitAndStateRetainedForInspection": True}
    save()
