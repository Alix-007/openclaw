#!/usr/bin/env python3
"""Compare the real live skill with a real official CodexBar 60-day export.

Requires a separately verified official binary; never downloads or installs it.
All generated state is retained in a fresh directory beside this collector.
"""
import argparse
from datetime import datetime, time, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time as monotonic_time


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, required=True)
parser.add_argument("--expected-binary-sha256", required=True)
parser.add_argument("--subject-script", type=Path, required=True)
parser.add_argument("--subject-head", required=True)
parser.add_argument("--expected-subject-sha256", required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
resources = Path(__file__).resolve().parent
binary = args.binary.resolve(strict=True)
binary_hash = sha256(binary)
if binary_hash != args.expected_binary_sha256:
    raise SystemExit("Official binary hash does not match the supplied verified hash")
head = args.subject_head
subject = args.subject_script.resolve(strict=True)
if sha256(subject) != args.expected_subject_sha256:
    raise SystemExit("Subject source hash does not match the host-bound commit blob")
run_dir = args.out.resolve()
run_dir.mkdir(parents=True, exist_ok=False)
proof_home = run_dir / "home"
claude_config = proof_home / ".claude"
proof_bin = run_dir / "bin"
directories = [
    proof_bin, claude_config / "projects" / "proof", run_dir / "tmp",
    proof_home / ".config" / "codexbar", proof_home / ".cache",
    proof_home / ".local" / "share", proof_home / ".codex" / "sessions",
    proof_home / ".pi" / "agent" / "sessions",
]
for directory in directories:
    directory.mkdir(parents=True, exist_ok=True)
(proof_bin / "codexbar").symlink_to(binary)
# Construct from scratch: no inherited tokens, account settings, or session roots.
child_env = {
    "HOME": str(proof_home),
    "XDG_CONFIG_HOME": str(proof_home / ".config"),
    "XDG_CACHE_HOME": str(proof_home / ".cache"),
    "XDG_DATA_HOME": str(proof_home / ".local" / "share"),
    "CODEXBAR_CONFIG": str(proof_home / ".config" / "codexbar" / "config.json"),
    "CLAUDE_CONFIG_DIR": str(claude_config),
    "CLAUDE_SECURESTORAGE_CONFIG_DIR": str(claude_config),
    "TMPDIR": str(run_dir / "tmp"),
    "TMP": str(run_dir / "tmp"),
    "TEMP": str(run_dir / "tmp"),
    "PATH": str(proof_bin) + ":/usr/bin:/bin",
    "TZ": "UTC",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
}
today = datetime.now(timezone.utc).date()
old_day = today - timedelta(days=45)
model = "claude-sonnet-4-20250514"
rows = []
for label, day in (("recent", today), ("old", old_day)):
    at = datetime.combine(day, time(0), timezone.utc).isoformat().replace("+00:00", "Z")
    rows.append({
        "type": "assistant", "timestamp": at,
        "sessionId": "proof-session", "requestId": "proof-request-" + label,
        "isSidechain": False,
        "message": {"id": "proof-message-" + label, "model": model,
                    "usage": {"input_tokens": 1000, "output_tokens": 100,
                              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}},
    })
log = claude_config / "projects" / "proof" / "session.jsonl"
log.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")
receipt = {
    "status": "SETUP_PENDING", "base_head": head,
    "subject_script": str(subject), "subject_sha256": sha256(subject),
    "collector_sha256": sha256(Path(__file__)),
    "binary": str(binary), "binary_sha256": binary_hash,
    "upstream_release": "v0.84.0",
    "upstream_source_commit": "5bebf9a05e68059eae11d5031c7239f1aa1d49ef",
    "run_dir": str(run_dir), "child_environment": child_env,
    "fixture_log": str(log), "fixture_sha256": sha256(log), "fixture_rows": rows,
    "today_utc": str(today), "old_day_utc": str(old_day), "commands": [],
}
receipt_path = run_dir / "receipt.json"


def run(name, command, input_text=None):
    started = monotonic_time.monotonic()
    try:
        result = subprocess.run(command, cwd=run_dir, env=child_env, stdin=subprocess.DEVNULL if input_text is None else None,
                                input=input_text, text=True, capture_output=True, timeout=60)
        event = {"name": name, "command": command, "exit": result.returncode,
                 "stdout": result.stdout, "stderr": result.stderr}
    except subprocess.TimeoutExpired as error:
        event = {"name": name, "command": command, "timeout_seconds": 60,
                 "stdout": str(error.stdout or ""), "stderr": str(error.stderr or "")}
        receipt["commands"].append(event)
        raise RuntimeError("Native command timed out: " + name) from error
    event["elapsed_seconds"] = monotonic_time.monotonic() - started
    receipt["commands"].append(event)
    (run_dir / (name + ".stdout")).write_text(result.stdout, encoding="utf-8")
    (run_dir / (name + ".stderr")).write_text(result.stderr, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError("Native command failed: " + name)
    return result.stdout


def provider_payload(text):
    payload = json.loads(text)
    assert isinstance(payload, list), "Expected real CodexBar provider array"
    matches = [item for item in payload if item.get("provider") == "claude"]
    assert len(matches) == 1 and not matches[0].get("error"), "Claude export unavailable"
    return matches[0]


def cost_from_skill(text):
    payload = json.loads(text)
    costs = {item["model"]: item["totalCostUSD"] for item in payload["models"]}
    assert set(costs) == {model}, "Unexpected model from isolated fixture"
    assert isinstance(costs[model], (int, float)) and math.isfinite(costs[model]) and costs[model] > 0
    return costs[model]


try:
    codexbar = str(proof_bin / "codexbar")
    run("version", [codexbar, "--version"])
    run("cost-help", [codexbar, "cost", "--help"])
    skill_args = [sys.executable, str(subject), "--provider", "claude", "--mode", "all",
                  "--days", "60", "--format", "json"]
    live_text = run("skill-live-60", skill_args)
    default_text = run("codexbar-default", [codexbar, "cost", "--provider", "claude", "--format", "json"])
    wide_text = run("codexbar-60", [codexbar, "cost", "--provider", "claude", "--format", "json",
                                   "--days", "60", "--refresh"])
    export = run_dir / "export-60.json"
    export.write_text(wide_text, encoding="utf-8")
    # File/stdin ingestion must not invoke the optional live acquisition program.
    (proof_bin / "codexbar").unlink()
    control_text = run("skill-export-60", skill_args + ["--input", str(export)])
    stdin_text = run("skill-stdin-60", skill_args + ["--input", "-"], input_text=wide_text)
    (proof_bin / "codexbar").symlink_to(binary)
    no_days = run("skill-default", [sys.executable, str(subject), "--provider", "claude",
                                   "--mode", "all", "--format", "json"])
    short_days = run("skill-one-day", [sys.executable, str(subject), "--provider", "claude",
                                     "--mode", "all", "--days", "1", "--format", "json"])
    default = provider_payload(default_text)
    wide = provider_payload(wide_text)
    default_days = {row["date"] for row in default["daily"]}
    wide_days = {row["date"] for row in wide["daily"]}
    assert str(today) in default_days and str(old_day) not in default_days, "Default period setup invalid"
    assert {str(today), str(old_day)} <= wide_days, "Real 60-day export did not read both fixture dates"
    for row in wide["daily"]:
        if row["date"] in (str(today), str(old_day)):
            matches = [entry for entry in row["modelBreakdowns"] if entry["modelName"] == model]
            assert len(matches) == 1 and math.isfinite(matches[0]["cost"]) and matches[0]["cost"] > 0
    assert sha256(log) == receipt["fixture_sha256"], "Fixture bytes changed during native reads"
    live_cost = cost_from_skill(live_text)
    control_cost = cost_from_skill(control_text)
    assert math.isclose(cost_from_skill(stdin_text), control_cost, rel_tol=1e-10), "stdin/file totals differ"
    default_total = sum(entry["cost"] for row in default["daily"]
                        for entry in row["modelBreakdowns"] if entry["modelName"] == model)
    assert math.isclose(cost_from_skill(no_days), default_total, rel_tol=1e-10), "no-days default changed"
    assert math.isclose(cost_from_skill(short_days), default_total, rel_tol=1e-10), "one-day window changed"
    receipt["comparison"] = {"default_dates": sorted(default_days), "wide_dates": sorted(wide_days),
                             "live_skill_cost": live_cost, "export_control_cost": control_cost,
                             "old_record_read_by_real_binary": True,
                             "no_days_default_preserved": True, "one_day_control_pass": True,
                             "file_and_stdin_no_codexbar_controls_pass": True}
    if live_cost < control_cost and not math.isclose(live_cost, control_cost, rel_tol=1e-10, abs_tol=1e-12):
        receipt["status"] = "BASE_RED"
    elif math.isclose(live_cost, control_cost, rel_tol=1e-10, abs_tol=1e-12):
        receipt["status"] = "MATCHES_EXPORT_CONTROL"
    else:
        raise AssertionError("Unexpected live/control cost relationship")
except Exception as error:
    receipt["status"] = "SETUP_OR_PROOF_FAILURE"
    receipt["failure"] = type(error).__name__ + ": " + str(error)
finally:
    receipt["owned_home_files"] = [str(path.relative_to(proof_home)) for path in sorted(proof_home.rglob("*")) if path.is_file()]
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "receipt": str(receipt_path),
                      "comparison": receipt.get("comparison"), "failure": receipt.get("failure")}, indent=2))
if receipt["status"] == "SETUP_OR_PROOF_FAILURE":
    raise SystemExit(1)
