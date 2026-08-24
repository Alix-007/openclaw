#!/usr/bin/env bash
set -euo pipefail

artifact_dir="$RUNNER_TEMP/pr122200-emulator-proof"
mkdir -p "$artifact_dir"

test "$(git rev-parse HEAD)" = "$PRODUCT_SHA"

app_apk="$(find apps/android/app/build/outputs/apk/play/debug -name '*.apk' -type f -print -quit)"
test_apk="$(find apps/android/app/build/outputs/apk/androidTest/play/debug -name '*.apk' -type f -print -quit)"
test -n "$app_apk"
test -n "$test_apk"
adb install -r "$app_apk"
adb install -r "$test_apk"

runner_component="ai.openclaw.app.debug.test/androidx.test.runner.AndroidJUnitRunner"
target_package="ai.openclaw.app.debug"
adb shell pm list instrumentation \
  | tr -d '\r' \
  | grep -Fx "instrumentation:$runner_component (target=$target_package)"

set +e
timeout 240 adb shell am instrument -w -r \
  -e class ai.openclaw.app.ui.chat.AssistantDisclosureInteractionProof \
  "$runner_component" \
  | tee "$artifact_dir/instrumentation.txt"
test_status="${PIPESTATUS[0]}"
set -e
test "$test_status" -eq 0
grep -q '^OK (1 test)' "$artifact_dir/instrumentation.txt"
adb pull "/sdcard/Android/data/$target_package/files/pr122200-proof/." "$artifact_dir/interaction/"

for state in 01-preview 02-full 03-closed 04-retry 05-recovered 06-not-found 07-oversized 08-not-visible; do
  test -s "$artifact_dir/interaction/$state.png"
  test -s "$artifact_dir/interaction/$state.xml"
done
grep -q 'View all' "$artifact_dir/interaction/01-preview.xml"
grep -q 'content-desc="proof-state-preview"' "$artifact_dir/interaction/01-preview.xml"
grep -q 'Close' "$artifact_dir/interaction/02-full.xml"
grep -q 'content-desc="proof-state-full"' "$artifact_dir/interaction/02-full.xml"
grep -q 'View all' "$artifact_dir/interaction/03-closed.xml"
grep -q 'content-desc="proof-state-closed"' "$artifact_dir/interaction/03-closed.xml"
grep -q 'Retry' "$artifact_dir/interaction/04-retry.xml"
grep -q 'content-desc="proof-state-retry"' "$artifact_dir/interaction/04-retry.xml"
grep -q 'Close' "$artifact_dir/interaction/05-recovered.xml"
grep -q 'content-desc="proof-state-full"' "$artifact_dir/interaction/05-recovered.xml"
grep -q 'content-desc="proof-state-not-found"' "$artifact_dir/interaction/06-not-found.xml"
grep -q 'content-desc="proof-state-oversized"' "$artifact_dir/interaction/07-oversized.xml"
grep -q 'content-desc="proof-state-not-visible"' "$artifact_dir/interaction/08-not-visible.xml"
for state in 06-not-found 07-oversized 08-not-visible; do
  ! grep -Eq 'text="(Retry|View all|Close)"' "$artifact_dir/interaction/$state.xml"
done
text_artifacts=("$artifact_dir/instrumentation.txt" "$artifact_dir"/interaction/*.xml)
! rg -n -i \
  'token|public.?key|private.?key|device.?id|node.?id|credential|authorization|bearer|adbkey' \
  "${text_artifacts[@]}"
! rg -n -e '\b[[:xdigit:]]{64}\b' -e '[A-Za-z0-9+/=_-]{80,}' "${text_artifacts[@]}"
{
  echo "product_sha=$PRODUCT_SHA"
  echo "proof_sha=$PROOF_SHA"
  echo "emulator=true"
  echo "states=preview,full,closed,retry,recovered,not-found,oversized,not-visible"
  echo "instrumentation=OK (1 test)"
} >"$artifact_dir/manifest.txt"
(
  cd "$artifact_dir"
  find interaction -type f -print0 | sort -z | xargs -0 sha256sum >sha256sums.txt
)
