# ID status: actual Gateway reply cancellation

Product HEAD: `a7a5630312e519d55bb56e0d986b26109d3bf134`.
Acceptance-red BASE: `b48d16bf6e98f0b9c1e110548fc46b3b35f2becd`.

The same frozen collector, fixture and proxy bytes run on normally built, clean checkouts of both commits. The collector launches `node openclaw.mjs id status` (JSON and text) through a controlling PTY against a normal, isolated Gateway. Setup uses the canonical OpenClaw ID authority to persist a valid local synthetic owner link in SQLite. A transparent WebSocket proxy forwards the handshake and requests, receives the **actual successful Gateway response**, then withholds either `openclawId.status` or `openclawId.people`. It never fabricates an ID response.

Run after the ordinary `qaRuntime` build with Node 26, Python 3, Git and a qualified Linux GLIBC >=2.39 environment:

```sh
python3 id-read-proof-v3.py "$CHECKOUT" "$OUTPUT" "$NODE26" red
python3 id-read-proof-v3.py "$CHECKOUT" "$OUTPUT" "$NODE26" green
```

Use different clean BASE and HEAD checkouts/output directories. `CHECKOUT` is the respective checkout, `OUTPUT` is a fresh private directory and `NODE26` is the Node 26 executable. The raw receipt records each actual CLI argv and the normal build stamp. Our environment was the isolated Ubuntu 24.04 image `sha256:6b5f77cec2874613e85a77520f2f8f114ccdb76e2c858e552fff2def1e8f8f9e`, with no external network, stock native dependencies, read-only container root, task-owned writable directories and the task-only `seccomp=unconfined` for Docker 17 / clone3 compatibility. No production installation was changed.

| Actual CLI case | BASE | HEAD |
|---|---|---|
| Status reply held, JSON + PTY Ctrl-C | launcher SIGKILL, 2035.26 ms | exit 130, 115.26 ms; target connection closed 11.13 ms |
| Status reply held, text + SIGTERM | launcher SIGKILL, 2034.52 ms | exit 143, 91.37 ms; target connection closed 5.33 ms |
| People reply held, JSON + PTY Ctrl-C | launcher SIGKILL, 2040.15 ms | exit 130, 96.34 ms; target connection closed 4.08 ms |
| People reply held, text + SIGTERM | launcher SIGKILL, 2034.46 ms | exit 143, 80.62 ms; target connection closed 2.95 ms |

All four HEAD cases produce only the existing interruption notice after the signal: no late status, JSON, generic command-failed banner or cancellation error. Each closes the particular connection whose real response was held; the people case also records the preceding successful status connection. The harness watchdog never fires. Owned CLI process groups are empty before harness cleanup.

Three controls pass on both revisions: uninterrupted JSON and text exit 0, and an ordinary wrong-token authentication failure exits 1. JSON readback confirms the actual Gateway's public binding sequence matches the canonical fixture's persisted binding. Configuration hashes remain unchanged. The Gateway and proxy stop cleanly with no owned surviving process.

`base-streams.txt` and `head-streams.txt` contain stdout/stderr and actual RPC request/response/close events; `native-readback.json` verifies original raw hashes before public path substitution. The two receipt files expose all observations and collector hashes. Collector bytes are unchanged. Private paths are replaced with portable labels in public copies; state databases, key files and actual credentials are excluded. The displayed CLI auth token is solely this isolated fixture's synthetic token.

Regression BASE: two intended public-output failures, nine existing controls pass. Repair: 12 tests across the registered-ID and rebind files pass in 17.223 s, including ordinary read errors, accepted-commit publication failures and rotation controls. Types, typed lint and formatting pass; normal clean exact-HEAD QA build passes in 279.448 s. See `checks.json`, `focused-tests.log`, and independent review.

Scope: production +22/-7 lines, tests +27/-0 lines; two files. Cancellation is opted into status reads only. No new configuration, protocol, schema, permission or migration requirement.

Not tested: live issuer/Discovery publication, external account sign-in, a production recovery/rebind operation, other operating systems or production load. Rebind behavior has existing focused regression controls; this proof does not claim a live key rotation or external identity service transaction.
