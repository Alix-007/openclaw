# Users list interruption: actual CLI observations

Product HEAD: `1d09cf0e2f370f5d4d82b6ca79c1fecf50449d52`.
Clean BASE: `c324818cbf86074f34578d07f381b0d2835955a1`.
Verified 2026-11-11 UTC with Node 26.12.1 and the normal `qaRuntime` build.

The entry is the actual `node openclaw.mjs users list` command, in JSON and
human modes. Each case owns an isolated HOME/config/state/workspace, a real
controlling PTY and a compatible local WebSocket peer. The peer records actual
challenge/connect and correlated RPC requests. It uses explicitly synthetic
profiles: this verifies CLI transport, output and process settlement, not real
Gateway identity storage, permissions or profile mutations.

## Frozen same-command proof

After the normal build in each clean checkout:

```sh
python3 users-read-cancel-proof-v2.py BASE_CHECKOUT FRESH_BASE_OUTPUT NODE26 red
python3 users-read-cancel-proof-v2.py HEAD_CHECKOUT FRESH_HEAD_OUTPUT NODE26 green
```

The original collector and peer bytes are identical at BASE and HEAD. The
collector requires the held connection/request before delivering PTY VINTR or
SIGTERM to the owned process group. Stderr is redirected to a regular file;
stdin/stdout retain the controlling PTY. Process exit and correlated peer close
must occur before harness cleanup.

| Cases | BASE | HEAD |
| --- | --- | --- |
| Six INT/TERM list interrupts, including handshake | Launcher SIGKILL (-9) after about 2.05 seconds | Natural 130/143 in 156.72–206.52 ms |
| Correlated peer close after interruption | About two seconds | 30.46–40.29 ms |
| Three ordinary list controls | Exit 0 | Exit 0, profile retained |
| Two ordinary admin-write controls | Exit 0, receipt retained | Exit 0, receipt retained |
| Interrupted link-email and merge receipts | Exit 130, receipt retained | Exit 130, receipt retained |
| Ordinary RPC error | Exit 1 | Exit 1, error retained |

All six HEAD interrupts are quiet after the accepted signal apart from the
existing root notice and PTY echo/CSI. The eight controls pass. Seven JSON
controls have byte-identical stdout; the human control asserts the exact final
profile row while allowing preceding startup output, whose version/commit and
banner may vary. It does not assert arbitrary-prefix silence in normal human
output. BASE's demonstrated defect is unsettled work and transport, not a late
payload observed before the launcher kill.

Actual terminal/diagnostic/peer streams are in `base-streams.txt` and
`head-streams.txt`; per-case commands, events, timings and hashes are in both
receipts. `native-readback.json` records separate raw-hash and reconstructed
configuration comparisons. Private local paths are replaced with portable
labels, while the original local observations are retained.

## Complete owner and validation

The single public read captures the existing command work signal, forwards it
to the canonical Gateway client with the existing read scope, and guards late
result/error publication. Both administrative writer actions retain their
existing scope and receipt path. Production +17/-7 lines; tests +52/-1 lines,
with an exact separate 51-LF allocation. No new public options, config,
protocol/schema, permission policy or upgrade behavior.

Ten focused tests, types, typed lint, canonical formatting, LF/line-cap and
unchanged-mock checks pass; the normal build and independent adversarial final
review also pass. The independent review is the explicitly authorized fallback,
not the official autoreview tool. See `checks.json`, `focused-tests.log` and
`independent-review.md`.

All 28 BASE/HEAD configuration files were independently reconstructed and
matched their original bytes. Raw output hashes matched; no owned CLI groups
or peer connections survived observation, and there were no collector watchdog
kills. Peers were stopped afterward; only isolated fixtures were retained.
Not tested: actual Gateway profile storage/authority/mutation effects, external
users or channels, Windows/macOS, or full repository CI.
