# Gateway status cancellation — native proof

Product head: `86ae8c0bb19f9444ab4ffa1f3d00055ddecf79db`.
BASE: `be82aeb77bbc08661080049650679dc602d8d197`.
Both are clean normal `cliStartup` builds; their matching build stamps are in the complete receipts. HEAD build: PASS, 271.618 s. Same frozen collector on both builds, without bypassing the product entry or replacing its cancellation handler.

## Supported operator scenario and result

An operator keeps a controlling terminal for stdin/stdout but redirects diagnostics to a regular file. The collector starts the normal CLI, observes the pending `connect` or `status` request at a real loopback WebSocket peer, then writes the terminal's actual VINTR byte. It does not send a direct process signal. The peer and `synthetic-status-proof-token` are test fixtures, not credentials or a live Gateway.

```sh
"$NODE26" "$CHECKOUT/openclaw.mjs" gateway status --url "$PEER_URL" --token synthetic-status-proof-token --timeout 30000 --json 2>diagnostics.log
"$NODE26" "$CHECKOUT/openclaw.mjs" gateway status --url "$PEER_URL" --token synthetic-status-proof-token --timeout 30000 --json --require-rpc 2>diagnostics.log
```

`$PEER_URL` is the collector's ephemeral loopback listener. Observed in this single four-cell replay per build:

| Pending read | BASE exit after VINTR | HEAD exit after VINTR | BASE / HEAD natural peer close | Late status JSON BASE / HEAD |
| --- | ---: | ---: | ---: | --- |
| connect | 6315.51 ms, exit 130 | 171.15 ms, exit 130 | 6012.29 / 19.57 ms | yes / no |
| required status RPC | 6140.87 ms, exit 130 | 86.25 ms, exit 130 | 6009.21 / 9.25 ms | yes / no |

Both uninterrupted controls return exit 0 and actual valid status JSON on both builds. Every cell retains the original configuration; no watchdog kills were used. GREEN requires exit 130, naturally observed peer closure and CLI exit both within 1500 ms of VINTR, plus no late status JSON. These are acceptance observations, not a performance benchmark.

- [Complete BASE receipt](base-receipt.json) — two RED cells and two controls.
- [Complete HEAD receipt](head-receipt.json) — four GREEN cells.
- [Checks and exact command receipts](checks-summary.json).
- [Independent code review](independent-code-review.json) — retained pre-commit file-hash assessment via the authorized agent fallback, not an official autoreview-helper run. Root confirmed its six reviewed source hashes match committed HEAD; its then-pending build limitation is historical, and the current build/native results are in the HEAD receipt.
- [Inherited real-Gateway fixture attribution](fixture-attribution.json).

## Reproduce with the frozen collector

Use separate clean checkouts of the two SHAs above, prepared with the repository's frozen dependencies and Node26.12.1. Place both scripts from this directory side by side in `$PROOF_ROOT`; set `$CHECKOUT` to the selected checkout and `$NODE26` to the actual Node executable. These are the normal build and collector commands:

```sh
export PATH="${NODE26%/*}:$PATH"
cd "$CHECKOUT"
"$NODE26" --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup
python3 "$PROOF_ROOT/probe-status-proof-v4.py" "$CHECKOUT" "$PROOF_ROOT/replay-base" "$NODE26" red
# In the clean HEAD checkout, after the same normal build:
python3 "$PROOF_ROOT/probe-status-proof-v4.py" "$CHECKOUT" "$PROOF_ROOT/replay-head" "$NODE26" green
```

Choose fresh output directories; the collector refuses existing ones. It verifies clean tracked inputs, current HEAD and matching clean build stamp. The checked-in product is not patched by these scripts. The unchanged collector SHA256 is `d60006e9f2c0bd183c4a7f2d73a9c05c75c847c44db4ae2b05aeb4da41981a06`; the unchanged peer SHA256 is `5f7e1dcf6076066b2462ac1bfc3c6842e3e46bd55b1e0686bd6469a55cb1e12e`.

## Limits and cleanup

The earlier [full-stderr-TTY counterexample](counterexample-full-stderr-tty.json) canceled through Clack in 45.88 ms with exit 0 and no root interrupt acknowledgment. It falsified the unconditional-hang hypothesis. That earlier collector stopped with `BLOCKED_OR_UNEXPECTED` because its expected RED was absent. This repair proves the ordinary diagnostics-redirection scenario; it is not a universal terminal/exit-code change.

The filtered owner run passed 85 tests, with one existing platform skip and one excluded real-Gateway fixture. The initial unfiltered attempt failed because this host cannot initialize/retire that fixture's native child-reaping helper; the exact case fails on BASE too. No test assertion, source-level skip or timeout was weakened, and the retained fixture directories were not deleted. Do not describe the unfiltered suite as green.

The repair opts only `runDaemonStatus` into existing transport cancellation. Health, Doctor, dashboard, triage, support export, signal policy and admitted writes retain their existing contracts. Not tested: macOS/Windows, SIGTERM, real installed-service start/restart, live Gateway/plugin/provider/channel/model or upgrade behavior. No PR CI outcome is claimed here.

All owned CLI and peer processes were waited, and peer/server resources closed. Only isolated synthetic HOME/state/config/workspace/tmp directories were used. Fixtures are retained for inspection; real configuration, services and channels were not changed.

## Path redaction and hash boundaries

The complete JSON receipts are path-redacted transcriptions: private paths become `$PROOF_ROOT`, `$CHECKOUT` and `$NODE26`; original cases, numeric results, events, stdout and diagnostics remain. Publication annotations identify original receipt SHA256s. Existing `rawOutputSHA256`, `diagnosticsSHA256` and referenced evidence hashes still identify the original local collection bytes. They are not claimed to match strings after path substitution. The public manifest separately hashes the actual published, sanitized files. The two scripts alone retain their exact original bytes and original SHA256s.
