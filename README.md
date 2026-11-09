# Update status: accepted long timeout keeps inspection facts

Product head: `092d85541ea53c98f5eaa29ef3426ea39deb4e21`. Historical baseline: `be82aeb77bbc08661080049650679dc602d8d197`.

The unchanged actual CLI accepts `--timeout 2147484` seconds. On BASE, Node wraps its aggregate 2147484000ms timer to 1ms; status reports false overall timeouts and omits Git/dependency/history information. The candidate clamps the aggregate status budget once with the existing shared safe-timer policy (maximum 2147483647ms). The same safe budget governs its timer, admission deadline and remaining inspection allowance. Default30s floor and shorter network-check allowance remain.

## Actual native entry and command

Both refs use the same byte-identical `update-status-timeout-proof.py` (SHA256 `a21cfb0bb8aeabaa4e4be7b7577bc73923d9e96d0ebbd8093bb70fb90c77cac9`), actual Node 26.12.1, their own normal clean `cliStartup` build and independent HOME/state/config/workspace. The production entry is `openclaw.mjs update status`; canonical owner is `src/cli/update-cli/status.ts:updateStatusCommand`.

```sh
node CHECKOUT/openclaw.mjs update status --json --timeout 30
node CHECKOUT/openclaw.mjs update status --json --timeout 2147484
```

Reproduce the complete same-scenario matrix for each clean built checkout with a fresh output directory:

```sh
python3 update-status-timeout-proof.py "$BASE_CHECKOUT" "$BASE_EVIDENCE" "$NODE_BINARY" red
python3 update-status-timeout-proof.py "$HEAD_CHECKOUT" "$HEAD_EVIDENCE" "$NODE_BINARY" green
```

These commands require ordinarily installed workspace dependencies and its normal `cliStartup` build; no production update command is used. The frozen collector records command argv, original stdout/stderr, actual JSON readback, file hashes, process status and cleanup. The receipt command arrays preserve exact arguments with only task-specific path roles replaced.

## Observations

| Ref / input | Actual elapsed | Readback |
|---|---:|---|
| BASE /30s control |12.330s|exit0; expected actual Git SHA and deps status `ok`; no overflow warning |
| HEAD /30s control |11.487s|exit0; expected actual Git SHA and deps status `ok`; no overflow warning |
| BASE /2147484s |3.653s|exit0, but `TimeoutOverflowWarning`, timer forced to 1ms, `installKind=unknown`, false inspection/run-history timeout errors |
| HEAD /2147484s |6.054s|exit0; actual Git SHA `092d85541ea53c98f5eaa29ef3426ea39deb4e21`, deps `ok`, no overflow warning or false overall-timeout error |

Recorder/readback boundary: shipped CLI → actual Git/dependency/state inspection → captured stdout JSON/stderr and independent output-file hashes. These are measured correctness observations, not speed comparisons. No watchdog killed a process. All isolated configuration files remained byte-identical.

## Public redaction and hashes

`base-receipt.json` and `head-receipt.json` retain the actual stdout and diagnostic strings with only task-specific path prefixes replaced. They include each original private receipt hash. `rawStdoutSHA256` / `rawStderrSHA256` identify original pre-redaction file bytes; **they do not hash the public sanitized output**. `publishedStdoutSHA256` / `publishedStderrSHA256` hash the corresponding embedded sanitized UTF-8 strings. The collector file itself is copied unchanged and contains no task-specific filesystem paths.

`checks-summary.json` retains command/exit/duration/provenance, including earlier precommit check hashes. The normal `cliStartup` build passed at the exact head in 296.552s. The three committed blobs match the independently reviewed source bytes. Focused 6 tests, targeted semantic types, genuine typed lint, formatting and the exact 21-LF own test allocation ratchet passed; no new full-suite run is claimed.

## Cleanup and Not tested

Only isolated reader processes/config/state were used; all child CLIs were waited, fixtures retained, and no update, installation or service mutation was requested. The collector preserves its bounded safety-kill flag; all four cells report false.

Both normal readbacks still report optional npm dev registry `HTTP404` and an unstarted local Gateway `channels` error (`ECONNREFUSED`). These errors are retained, not presented as successful remote provider/Gateway checks. HEAD reports `update.git.artifacts.ready=false`; only the normal `cliStartup` target was built, not full-package artifact readiness. No actual upgrade/installer/restart, hosted provider/channel/model behavior, real production Gateway health, macOS/Windows matrix, arbitrary multi-day wait or durability/performance claim.

Publication file inventory is generated from frozen file bytes by the local `spec-template.json`. That spec contains private uploader paths and is **local orchestration only**, excluded from its public file list.
