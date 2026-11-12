# Interrupted MCP diagnostics: normal CLI and native child proof

Product HEAD: `fd429b3827b65ede726fcb8c2c93e2e58cff0a3d`.
BASE: `bc56f785b2d4e30e5c34bea6123747cfbcf18816`.
Verified 2026-11-12 UTC with Node 26.12.1 and normal clean `qaRuntime` builds.

Actual `node openclaw.mjs mcp probe` and `mcp doctor --probe` run in a
controlling PTY and start a local synthetic stdio MCP server through the normal
native process owner. The server records its real PID, initialize/tools-list
requests and responses. In pending cases it withholds initialization while
remaining cooperative with stdin closure. No provider, Gateway, model or
production channel is involved.

Both heads use the same frozen collector and scenarios:

```sh
python3 mcp-diagnostic-cancel-proof-v2.py --worktree BASE_CHECKOUT --node NODE26 --out FRESH_BASE_OUTPUT
python3 check-mcp-diagnostic-proof.py FRESH_BASE_OUTPUT/receipt.json --expect red
python3 mcp-diagnostic-cancel-proof-v2.py --worktree HEAD_CHECKOUT --node NODE26 --out FRESH_HEAD_OUTPUT
python3 check-mcp-diagnostic-proof.py FRESH_HEAD_OUTPUT/receipt.json --expect green
```

| Scenarios | BASE | HEAD |
| --- | --- | --- |
| Probe JSON Ctrl-C; probe human SIGTERM; doctor probe JSON Ctrl-C | Launcher SIGKILL after 2.041–2.045 s | Natural 130/143 after 178/198/183 ms |
| Direct server PID at CLI exit | Still present; collector separately records later cleanup | Absent before collector cleanup |
| Normal probe | Exit 0, one discovered tool | Same |
| Provider exits 7 | CLI exit 1 with diagnostics | Same |
| Static doctor | Exit 0, zero server launches | Same |
| Configure with successful probe | Exit 0, stored requestTimeoutMs becomes 61000 | Same, independent file readback |
| Configure with failed probe | Exit 1, exact original config bytes | Same |

All eight fixed-head cases pass the separate strict checker. No collector
watchdog fires. Canceled diagnostics publish no result, diagnostic report or
late failure. All read-case configurations retain bytes; successful/failed
write controls are checked against the actual resulting configuration file.
All sixteen BASE/HEAD terminal streams and configuration readbacks were
independently verified. `base-streams.txt` and `head-streams.txt` preserve actual
PTY output; both receipts include commands, real peer events, PIDs, timings and
config readbacks. Private local paths are replaced by portable labels in the
public copies. Original collector bytes remain unchanged.

The host's GLIBC 2.28 cannot load the pinned proc-safe 0.4.2 GNU helper. That
setup failure was retained and is not counted as RED. Both accepted runs use
the same task-owned Ubuntu 24.04 image with GLIBC 2.39, Python, Git and
libatomic, the same canonical Node binary and the unchanged pinned dependency.
Image ID: `sha256:6b5f77cec2874613e85a77520f2f8f114ccdb76e2c858e552fff2def1e8f8f9e`.
The container has no external network, a read-only root, temporary isolated
state and the same unprivileged UID; only the task evidence area is writable.
The host's old Docker 17 requires seccomp unconfined for modern libc threading.
No native helper bypass or dependency patch was used. Container PID observations
cover the direct synthetic child, not arbitrary descendants.

The repair binds only the fresh private CLI diagnostic runtime to the existing
read action signal, starts disposal on interruption and joins cleanup before
returning. Ordinary and uncertain cleanup errors retain their error paths.
Add/configure preflight callers retain their existing default; shared agent
catalog and admitted OAuth refresh/publication owners are unchanged. Existing
report rendering moved unchanged to its existing owner because the command
registration file is over its grandfathered line cap.

Production +104/-43 lines across two files, including that report relocation;
one two-row lifecycle regression adds 46 LF with its exact allocation. Both
rows fail BASE at the intended disposal assertion. Final four-file CLI,
HTTP-cleanup, process-exit and import-boundary checks pass 51 tests. Types,
typed lint, format, budgets, line caps, mock audit, normal hooks and clean build
pass. Final source and native receipts pass independent adversarial review
through the explicitly authorized GPT6.1Sol fallback, not an official
autoreview-tool run.

Not tested: real external MCP services, Docker MCP servers, OAuth refresh with
real credentials, arbitrary descendants, production state/channels, Windows,
macOS or full repository CI. Combined PTY output is inspected; separate stdout
and stderr are not claimed. Servers are stopped after each observation, no
task containers remain after the collector exits, and isolated evidence
fixtures are retained. BASE collector-only cleanup is explicitly recorded and
never presented as product success.
