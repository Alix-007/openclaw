#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  printf 'usage: %s <exact-source-root> <expected-source-sha> <receipt-dir>\n' "$0" >&2
  exit 2
fi

source_root=$1
source_sha=$2
receipt_dir=$3
expectation_mode=${EXPECTATION_MODE:-parent}
case "$expectation_mode" in
  parent|product) ;;
  *) printf 'EXPECTATION_MODE must be parent or product\n' >&2; exit 2 ;;
esac
mkdir -p "$receipt_dir"

fixture_root="$receipt_dir/fixture"
home_dir="$receipt_dir/home"
state_dir="$receipt_dir/state"
config_dir="$receipt_dir/config"
log_file="$fixture_root/configured.log"
mkdir -p "$fixture_root" "$home_dir" "$state_dir" "$config_dir"

printf '{"logging":{"level":"silent","file":"%s"}}\n' "$log_file" > "$config_dir/openclaw.json"
printf '%s\n' \
  '{"time":"2026-09-07T00:00:01.000Z","0":"first","_meta":{"logLevelName":"INFO","name":"{\"module\":\"gateway/channels/smoke\"}"}}' \
  '{"time":"2026-09-07T00:00:02.000Z","0":"second","_meta":{"logLevelName":"INFO","name":"{\"module\":\"gateway/channels/smoke\"}"}}' \
  '{"time":"2026-09-07T00:00:03.000Z","0":"third","_meta":{"logLevelName":"INFO","name":"{\"module\":\"gateway/channels/smoke\"}"}}' \
  > "$log_file"

index_file="$receipt_dir/index.tsv"
failures_file="$receipt_dir/FAILURES.txt"
observations_file="$receipt_dir/OBSERVATIONS.txt"
: > "$index_file"
: > "$failures_file"
: > "$observations_file"
failures=0

config_sha_before=$(sha256sum "$config_dir/openclaw.json" | awk '{print $1}')
fixture_sha_before=$(sha256sum "$log_file" | awk '{print $1}')
printf 'expected_source_sha=%s\nactual_source_sha=%s\nexpectation_mode=%s\nconfig_file=%s\nfixture_file=%s\n' \
  "$source_sha" "$source_sha" "$expectation_mode" "$config_dir/openclaw.json" "$log_file" > "$receipt_dir/HEADS.txt"
printf '%s  %s\n' "$fixture_sha_before" "$log_file" > "$receipt_dir/FIXTURE.sha256"

record_failure() {
  printf '%s\n' "$1" | tee -a "$failures_file" >&2
  failures=$((failures + 1))
}

record_observation() {
  printf '%s\n' "$1" | tee -a "$observations_file"
}

run_cli() {
  local label=$1
  shift
  local stdout_file="$receipt_dir/$label.stdout"
  local stderr_file="$receipt_dir/$label.stderr"
  local argv_file="$receipt_dir/$label.argv"

  {
    printf 'label=%s\n' "$label"
    printf 'source_root=%s\n' "$source_root"
    printf 'source_sha=%s\n' "$source_sha"
    printf 'argv='; printf '%q ' pnpm --silent openclaw "$@"; printf '\n'
  } > "$argv_file"

  set +e
  (
    cd "$source_root"
    env \
      -u GH_TOKEN \
      -u GITHUB_TOKEN \
      -u OPENAI_API_KEY \
      -u ANTHROPIC_API_KEY \
      -u AWS_ACCESS_KEY_ID \
      -u AWS_SECRET_ACCESS_KEY \
      -u AWS_SESSION_TOKEN \
      -u GOOGLE_API_KEY \
      -u TELEGRAM_BOT_TOKEN \
      -u DISCORD_BOT_TOKEN \
      HOME="$home_dir" \
      XDG_CONFIG_HOME="$config_dir" \
      OPENCLAW_STATE_DIR="$state_dir" \
      OPENCLAW_CONFIG_PATH="$config_dir/openclaw.json" \
      pnpm --silent openclaw "$@"
  ) > "$stdout_file" 2> "$stderr_file"
  LAST_STATUS=$?
  set -e
  LAST_STDOUT_FILE=$stdout_file
  LAST_STDERR_FILE=$stderr_file

  printf 'label=%s exit=%s stdout=%s stderr=%s\n' \
    "$label" "$LAST_STATUS" "$stdout_file" "$stderr_file" | tee -a "$index_file"
  sha256sum "$stdout_file" "$stderr_file" | tee -a "$index_file"
  cat "$argv_file"
  if [ -s "$stdout_file" ]; then sed -n '1,24p' "$stdout_file"; fi
  if [ -s "$stderr_file" ]; then sed -n '1,24p' "$stderr_file"; fi
}

assert_parser_rejection() {
  local label=$1
  local expected_message=$2
  if [ "$LAST_STATUS" -eq 0 ]; then
    record_failure "$label: expected non-zero parser rejection, got exit 0"
    return
  fi
  if ! grep -Fq -- "$expected_message" "$LAST_STDOUT_FILE" \
    && ! grep -Fq -- "$expected_message" "$LAST_STDERR_FILE"; then
    record_failure "$label: missing parser message: $expected_message"
  fi
}

assert_success() {
  local label=$1
  if [ "$LAST_STATUS" -ne 0 ]; then
    record_failure "$label: expected exit 0, got $LAST_STATUS"
  fi
}

assert_json_messages() {
  local label=$1
  local expected_file=$2
  local expected_json=$3
  if [ "$LAST_STATUS" -ne 0 ]; then
    record_failure "$label: expected exit 0, got $LAST_STATUS"
    return
  fi
  if ! node - "$LAST_STDOUT_FILE" "$expected_file" "$expected_json" <<'NODE'
const fs = require("node:fs");
const [outputPath, expectedFile, expectedJson] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const expectedMessages = JSON.parse(expectedJson);
const actualMessages = Array.isArray(payload.lines) ? payload.lines.map((line) => line.message) : null;
if (payload.channel !== "all") throw new Error(`channel=${JSON.stringify(payload.channel)}`);
if (payload.file !== expectedFile) throw new Error(`file=${JSON.stringify(payload.file)}`);
if (JSON.stringify(actualMessages) !== JSON.stringify(expectedMessages)) {
  throw new Error(`messages=${JSON.stringify(actualMessages)}`);
}
NODE
  then
    record_failure "$label: JSON payload did not match configured fixture"
  fi
}

assert_json_object() {
  local label=$1
  if [ "$LAST_STATUS" -ne 0 ]; then
    record_failure "$label: expected exit 0, got $LAST_STATUS"
    return
  fi
  if ! node - "$LAST_STDOUT_FILE" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
  throw new Error("expected a JSON object");
}
if (!payload.auth || typeof payload.auth !== "object" || Array.isArray(payload.auth)) {
  throw new Error("expected auth object");
}
if (payload.auth.probes !== undefined && payload.auth.probes !== null) {
  throw new Error("unexpected auth.probes output");
}
const forbidden = /^(access|apiKey|credential|key|password|refresh|secret|token)$/iu;
const walk = (value) => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`credential-shaped field: ${key}`);
    walk(child);
  }
};
walk(payload.auth);
NODE
  then
    record_failure "$label: expected an observable JSON object"
  fi
}

# Warm the dist-backed wrapper before the matrix so the first real command does
# not conflate one-time build/bootstrap output with its JSON receipt.
run_cli version --version
assert_success version

# Parent mode records the unpatched baseline acceptance as an observation and
# remains green. Product mode flips only the explicit-empty assertions to the
# repaired parser rejection while preserving the same command/fixture receipt.
run_cli channels-empty channels logs --channel all --lines "" --json
if [ "$expectation_mode" = parent ]; then
  assert_json_messages channels-empty "$log_file" '["first","second","third"]'
  record_observation 'channels logs: explicit empty --lines accepted as default (parent gap)'
else
  assert_parser_rejection channels-empty "--lines must be a positive integer."
fi

run_cli channels-whitespace channels logs --channel all --lines "   " --json
assert_parser_rejection channels-whitespace "--lines must be a positive integer."

run_cli channels-valid-2 channels logs --channel all --lines 2 --json
assert_json_messages channels-valid-2 "$log_file" '["second","third"]'

run_cli channels-omitted channels logs --channel all --json
assert_json_messages channels-omitted "$log_file" '["first","second","third"]'

for option in probe-timeout probe-concurrency probe-max-tokens; do
  run_cli "models-${option}-empty" models status --json "--$option" ""
  if [ "$expectation_mode" = parent ]; then
    assert_json_object "models-${option}-empty"
    record_observation "models status: explicit empty --$option accepted as default (parent gap)"
  else
    assert_parser_rejection "models-${option}-empty" "--$option must be a positive"
  fi

  run_cli "models-${option}-whitespace" models status --json "--$option" "   "
  assert_parser_rejection "models-${option}-whitespace" "--$option must be a positive"

  run_cli "models-${option}-valid" models status --json "--$option" 1
  assert_json_object "models-${option}-valid"
done

run_cli models-omitted models status --json
assert_json_object models-omitted

config_sha_after=$(sha256sum "$config_dir/openclaw.json" | awk '{print $1}')
fixture_sha_after=$(sha256sum "$log_file" | awk '{print $1}')
printf '%s  %s\n' "$fixture_sha_after" "$log_file" > "$receipt_dir/FIXTURE.final.sha256"
printf 'config_sha_before=%s\nconfig_sha_after=%s\nfixture_sha_before=%s\nfixture_sha_after=%s\n' \
  "$config_sha_before" "$config_sha_after" "$fixture_sha_before" "$fixture_sha_after" \
  > "$receipt_dir/INPUT-INTEGRITY.txt"
if [ "$config_sha_before" != "$config_sha_after" ]; then
  record_failure 'configured JSON changed during CLI proof'
fi
if [ "$fixture_sha_before" != "$fixture_sha_after" ]; then
  record_failure 'synthetic configured log fixture changed during CLI proof'
fi

printf 'source_sha=%s\nexpectation_mode=%s\nfailures=%s\n' \
  "$source_sha" "$expectation_mode" "$failures" > "$receipt_dir/SUMMARY.txt"
if [ "$failures" -ne 0 ]; then
  printf '%s proof failures=%s\n' "$expectation_mode" "$failures" >&2
  exit 1
fi
printf '%s proof controls all passed\n' "$expectation_mode"
