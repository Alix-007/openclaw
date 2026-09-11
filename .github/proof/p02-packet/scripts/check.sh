#!/usr/bin/env bash
# Run repository-owned checks. All evidence stays outside the checkout.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: bash check.sh /absolute/worktree P02|P09|P11" >&2
  exit 2
fi
repo=$(cd -- "$1" && pwd)
task=$2
packet=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repo"
node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (!((major === 24 && minor >= 16) || (major === 26 && minor >= 1))) {
  throw new Error("Use the verified repository Node floor: 24.16+ or 26.1+; do not validate this checkout on Node 22.");
}'
command -v pnpm >/dev/null
[[ -d node_modules ]] || { echo 'Run pnpm install --frozen-lockfile in this independent checkout first.' >&2; exit 2; }
base=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["base_commit"])' "$packet/manifest.json")
case "$task" in
  P02)
    files=(src/cli/nodes-cli/register.push.ts src/cli/nodes-cli/register.push.test.ts)
    tests=(src/cli/nodes-cli/register.push.test.ts)
    ;;
  P09)
    files=(extensions/memory-wiki/src/obsidian.ts extensions/memory-wiki/src/obsidian.discovery.test.ts)
    tests=(extensions/memory-wiki/src/obsidian.discovery.test.ts extensions/memory-wiki/src/obsidian.test.ts)
    ;;
  P11)
    files=(src/cli/fleet-cli/commands.runtime.ts src/cli/fleet-cli/commands.status-runtime.test.ts docs/cli/fleet.md)
    tests=(src/cli/fleet-cli/commands.status-runtime.test.ts src/cli/fleet-cli/commands.runtime.test.ts src/cli/fleet-cli/register.test.ts)
    ;;
  *) echo 'Unknown task' >&2; exit 2 ;;
esac
out=$(mktemp -d "$packet/evidence/${task}-official-XXXXXX")
git rev-parse HEAD > "$out/head-before-commit.txt"
git diff -- "${files[@]}" > "$out/unstaged-before-format.diff"
# Formatting is limited to task-owned paths, not the whole repository.
pnpm exec oxfmt --write "${files[@]}" 2>&1 | tee "$out/format.log"
node scripts/run-vitest.mjs run "${tests[@]}" 2>&1 | tee "$out/vitest.log"
# Include new tests in changed-file gates, without committing anything.
git add --intent-to-add -- "${files[@]}"
node scripts/check-changed.mjs --base "$base" -- "${files[@]}" 2>&1 | tee "$out/changed.log"
git diff --check
git diff -- "${files[@]}" > "$out/validated.diff"
sha256sum "$out/validated.diff" > "$out/validated.diff.sha256"
{
  printf '\n## Author-side repository validation\n\n'
  printf 'Executed on Node `%s`, pre-commit checkout `%s`.\n\n' "$(node --version)" "$(git rev-parse HEAD)"
  printf -- '- Repository Vitest command exited 0 for: `%s`.\n' "${tests[*]}"
  printf -- '- Task-scoped formatting, changed-file checks, and `git diff --check` passed.\n'
  printf -- '- Validated diff SHA-256: `%s`.\n' "$(sha256sum "$out/validated.diff" | cut -d' ' -f1)"
  printf -- '- This records local author checks, not upstream CI or live service/device proof.\n'
} > "$out/summary.md"
sha256sum "${files[@]}" > "$out/validated-files.sha256"
printf '%s\n' "$out" > "$packet/evidence/$task.last-check-dir"
printf 'Repository checks completed. Evidence: %s\n' "$out"
printf 'Independent review, current-main integration and live PR/ownership checks are still required before publication.\n'
