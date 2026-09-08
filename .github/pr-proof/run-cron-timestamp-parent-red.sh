#!/usr/bin/env bash
set -euo pipefail
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "[cron-timestamp-proof] FAILED (exit %s)\n" "$status" >&2; fi' EXIT
test "$#" -eq 3
source_root=$1
source_sha=$2
receipt_dir=$3
mode=${EXPECTATION_MODE:-parent}
case "$mode" in parent|product) ;; *) exit 2 ;; esac
test "${#source_sha}" -eq 40
controls_dir=$(cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$receipt_dir"
for zone in UTC Asia/Shanghai; do
  zone_dir="$receipt_dir/${zone//\//-}"
  mkdir -p "$zone_dir/state"
  node - "$zone_dir" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify({ logging: { level: 'debug', file: path.join(dir, 'runtime.log') } }));
NODE
  (
    cd "$source_root"
    env -u GH_TOKEN -u GITHUB_TOKEN -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
      TZ="$zone" OPENCLAW_STATE_DIR="$zone_dir/state" OPENCLAW_CONFIG_PATH="$zone_dir/openclaw.json" \
      pnpm exec tsx --tsconfig "$source_root/tsconfig.json" "$controls_dir/cron-timestamp.mts" "$source_root" "$zone_dir" "$mode"
  ) > "$zone_dir/stdout.txt" 2> "$zone_dir/stderr.txt"
done
printf 'source_sha=%s\nexpectation_mode=%s\ncontrols=passed\n' "$source_sha" "$mode" > "$receipt_dir/SUMMARY.txt"
