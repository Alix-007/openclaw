# Cron read interruption: actual CLI observations

Product HEAD: `1ea4cc3557bb7022a2d6c6546264f1227e8dc862`.
Clean BASE: `c324818cbf86074f34578d07f381b0d2835955a1`.
Verified 2026-11-11 UTC using Node 26.12.1 and the normal `qaRuntime` build.

The public production entry is `node openclaw.mjs cron status`, `cron get`,
`cron runs`, or read-only `cron scratch`. The `automations runs --all` alias is
included. Each case uses isolated HOME, state, workspace and configuration,
a real controlling PTY, and a compatible local WebSocket protocol peer.
The peer records the challenge/connect exchange and correlated read request.
Its replies contain openly synthetic Cron data; this is not a real Gateway
database, scheduler execution, provider or channel-effects test.

## Same-command red and green

Both collectors in this directory are byte-identical between BASE and HEAD.
After the normal build in each clean checkout, run:

```sh
python3 cron-read-cancel-proof-v1.py BASE_CHECKOUT FRESH_BASE_OUTPUT NODE26 red
python3 cron-read-cancel-proof-v1.py HEAD_CHECKOUT FRESH_HEAD_OUTPUT NODE26 green
```

The Python collector invokes the actual `openclaw.mjs` subprocess. Ctrl-C is
delivered as the PTY's VINTR byte; SIGTERM targets only its owned process group.
Stderr is redirected to a regular diagnostic file while stdin/stdout keep the
controlling PTY. A request must be recorded as held before interruption is sent.
Exit status, output, process settlement and socket closure are measured before
any harness cleanup. The normal CLI launcher, not the collector watchdog,
supplies the two-second SIGKILL observed on BASE.

| Cases | BASE | HEAD |
| --- | --- | --- |
| 14 INT/TERM read interrupts, including connection setup | SIGKILL (-9), 2049.95–2064.48 ms | Natural 130/143, 106.65–130.33 ms |
| Correlated peer closure after the read interrupt | About two seconds | 30.38–43.85 ms |
| Seven ordinary read controls | Exit 0 | Exit 0, identical output |
| Two ordinary write controls | Exit 0 | Exit 0, identical output |
| Three interrupted write/preparatory-read receipt controls | Exit 130, receipt retained | Exit 130, receipt retained, identical output |
| Ordinary RPC error | Exit 1, error retained | Exit 1, identical output |

All 14 HEAD read interrupts are quiet after the accepted signal apart from the
existing root cleanup notice and terminal echo/CSI. BASE output is also quiet;
the demonstrated BASE defect is unsettled owned work and transport, not a late
payload observed before the launcher's kill deadline.

`base-receipt.json` and `head-receipt.json` retain case commands, timings,
correlated peer events, raw-output hashes and cleanup observations. The actual
terminal, diagnostic and peer streams are inspectable in `base-streams.txt`
and `head-streams.txt`. Private local paths are replaced with portable labels;
the original local observations and hashes are retained by the author.

## Scope and controls

The three Cron registration modules capture the existing command work signal
only for these public reads, forward it to the existing Gateway RPC owner,
and prevent post-interrupt result/error publication. Existing list/show and
run-wait behavior is retained. All mutation calls, including scratch revision
preparation and the final CAS receipt, retain their existing custody.
Production change: +59/-27 lines; tests: +26/-7 lines, with a separate 19-LF
allocation. No configuration, protocol/schema, permission-policy or upgrade
changes are introduced.

199 focused tests, scoped types, typed lint, canonical format, test allocation,
line-cap and unchanged-mock-factory checks passed. See `focused-tests.log`,
`checks.json` and `independent-review.md`. The review is the user-authorized
independent adversarial fallback, not an official autoreview-tool run.

All 27 configuration files were independently reconstructed and compared;
all matched their original bytes. There were zero surviving owned CLI groups,
zero unclosed peer connections and zero collector watchdog kills. Test peers
were stopped after observation; only isolated fixtures were retained.
Actual Gateway storage/scheduler effects, remote providers, production user
data, Windows/macOS and full repository CI were not tested by this collector.
