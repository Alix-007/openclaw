# Interrupted initial session selection: real Gateway proof

Product HEAD: `498f9aa34950c32f4d4525dc9b23030ad28ba5e7`.
BASE: `bc56f785b2d4e30e5c34bea6123747cfbcf18816`.
Verified 2026-11-12 UTC, Linux, Node 26.12.1, normal clean `qaRuntime` builds.

The actual `node openclaw.mjs sessions tail` CLI runs in a controlling PTY.
An isolated, normally built Gateway reads one canonical synthetic SQLite
session and trajectory event. A transparent WebSocket proxy forwards the
actual protocol and holds a successful Gateway reply before the CLI consumes
it. This establishes the pending initial selection read through the normal
transport, storage and process boundaries.

Run the same three collector files on both builds:

```sh
python3 scout-tail-selection-proof.py BASE_CHECKOUT FRESH_BASE_OUTPUT NODE26 red
python3 scout-tail-selection-proof.py HEAD_CHECKOUT FRESH_HEAD_OUTPUT NODE26 green
```

| Scenarios | BASE | HEAD |
| --- | --- | --- |
| Five interrupted initial reads: finite/follow INT/TERM and initial connect INT | Launcher SIGKILL after 2034.40–2042.11 ms | Natural 130/143 in 92.79–107.33 ms |
| Correlated client connection closure | 2028.63–2036.46 ms after interruption | 4.55–10.52 ms after interruption |
| Ordinary finite tail | Exit 0, stored marker rendered | Same |
| Ordinary follow, then Ctrl-C after marker | Exit 130 | Exit 130 |
| Explicit session key | Exit 0, marker, no selection RPC | Same |

BASE output already stayed quiet. The demonstrated defect is an unsettled
initial request and client, rather than a late payload seen before forceful
exit. HEAD interrupts remain quiet apart from the standard root cancellation
notice and PTY echo. All sixteen cases retain configuration bytes, drain PTY
EOF and have no owned CLI survivors or collector watchdog kills. Gateway and
proxy exit naturally during their subsequent explicit teardown; no owned
Gateway/proxy processes remain. The fixture independently reads back one
canonical trajectory row. `base-streams.txt` and `head-streams.txt` contain the
actual CLI, Gateway and proxy observations. `native-readback.json` records
stream hash verification before private local paths are replaced by labels.
The three frozen collector source files are unchanged.

The fix changes the one private initial selection read shared by finite and
following tail. It passes the existing command signal to the existing RPC
owner, and returns quietly after owned interruption. Explicit key/store
bypasses, ordinary unavailable fallback, other errors, and the existing
follow/broken-pipe outcomes stay covered. Production +12/-2 lines, one 32-LF
regression and its exact allocation. No new options, schema, configuration,
permissions, dependencies or migration behavior.

The final owner suite passes 29 tests, including the regression that first
failed at its intended completion assertion on BASE. The unchanged registrar
suite passes another 17 tests. Types, typed lint, canonical formatting,
test budget/line caps, existing mock audit, normal hooks and clean build pass.
The source and final native receipts received independent adversarial review
through the explicitly authorized GPT6.1Sol fallback; this is not an official
autoreview-tool run.

Limitations: Linux local isolated synthetic session only; no provider, real
user data/channel, Windows/macOS or full repository CI claim. The proof's
ancillary Gateway logs retain a sparse Control UI build failure, a plugin-feed
timeout and a deferred reload notice after proxy-port setup. Those paths are
outside this CLI selection proof; real successful Gateway replies and all
three controls are recorded on both heads. Isolated fixtures remain for
inspection; all task-owned runtime processes were stopped.
