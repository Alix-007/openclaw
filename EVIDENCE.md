# Session listing: cancel a pending real Gateway connection

Product HEAD: `1c7a491f44ba3e38ea9d84b2d521752c6c6313fd`. Acceptance-red BASE: `b48d16bf6e98f0b9c1e110548fc46b3b35f2becd`.

Identical frozen collector and fixture bytes run on clean, normally built `qaRuntime` checkouts of both revisions. The fixture persists one real session via the canonical SQLite session accessor. A normal isolated Gateway is started and verified healthy; the built `node openclaw.mjs sessions list` command uses its actual inspected lock/port to read the prepared model catalog.

To reproduce an unresponsive local Gateway without replacing its protocol, only the task-owned Gateway process group is temporarily SIGSTOPped. `/proc` correlates an ESTABLISHED connection to file descriptors of the actual CLI process group before PTY Ctrl-C or SIGTERM is sent. The Gateway is resumed after each CLI has exited. **This exercises a pending connection/handshake; it does not claim an authenticated RPC reply was held.**

BASE receives the ordinary interruption notice but the launcher must send emergency SIGKILL at 2035.65/2042.11 ms. HEAD exits 130/143 within 148.61 ms; its owned socket closes within 34.18 ms. Both HEAD cases print only the existing interruption notice, have no late session JSON/table/fallback warning, and leave no owned CLI process before harness cleanup. The harness watchdog never fires.

Three legal controls pass on both heads: uninterrupted JSON and text against the running real Gateway exit 0; the JSON contains the persisted session ID, `ollama/synthetic-read-model` and capacity 8192. Explicit `--store` while the Gateway is stopped also exits 0, reads back the same persisted session, and opens no Gateway socket. Config hashes remain unchanged throughout; the Gateway exits cleanly with no owned survivor.

Actual HEAD cases:

- json-control: exit 0; interrupt-to-exit=None ms, socket-close=None ms; GREEN_EXISTING_CONTROL.
- human-control: exit 0; interrupt-to-exit=None ms, socket-close=None ms; GREEN_EXISTING_CONTROL.
- catalog-json-int: exit 130; interrupt-to-exit=148.61 ms, socket-close=8.15 ms; GREEN_READ_ABORT.
- catalog-human-term: exit 143; interrupt-to-exit=127.32 ms, socket-close=34.18 ms; GREEN_READ_ABORT.
- store-control: exit 0; interrupt-to-exit=None ms, socket-close=None ms; GREEN_EXISTING_CONTROL.

Reproduce after the normal `qaRuntime` build on Linux with Node 26, Python 3, Git and qualified stock native dependencies:

```sh
python3 sessions-read-proof-v2.py "$CHECKOUT" "$OUTPUT" "$NODE26" red
python3 sessions-read-proof-v2.py "$CHECKOUT" "$OUTPUT" "$NODE26" green
```

Use the clean BASE and HEAD checkouts and different fresh private output directories. `NODE26` names the Node executable. Our no-network Ubuntu 24.04 environment was image `sha256:6b5f77cec2874613e85a77520f2f8f114ccdb76e2c858e552fff2def1e8f8f9e`, read-only container root, task-only writable directories and `seccomp=unconfined` for Docker 17 / clone3 compatibility. No production installation or network configuration was changed. The synthetic model endpoint is closed loopback port 9; no model/provider API or external service is called.

`base-receipt.json` and `head-receipt.json` retain the argv, build stamps, raw stream hashes, socket inode/PID/fd readback and session readback. `base-streams.txt`/`head-streams.txt` preserve actual terminal output and Gateway/setup logs. Collector bytes remain unchanged; private filesystem paths in public receipts are replaced with portable labels. State databases and credentials are not uploaded; `native-readback.json` verifies original hashes before path substitution.

Regression BASE: one intended unwanted-output failure, 26 controls pass. HEAD: 44 tests across session owner and registrar pass in 324.775 s, including model capacity, normal offline fallback, filters, store and registration behavior. Duration includes canonical worker compilation (133.686 s) and real SQLite/session fixtures. Types, typed lint and formatting pass. Independent review and normal exact-HEAD build receipts accompany the artifact.

Production +9/-0 lines; tests +22/-0 lines. The existing command cancellation signal reaches the one cached Gateway catalog request, skips cancellation fallback, and stops result publication. No new config, protocol/schema, permission, dependency or migration requirement.

Not tested: holding a completed authenticated `models.list` reply, provider/model execution, production user data, other operating systems or production load. The native proof covers the actual pending connection; focused tests separately exercise cancellation rejection/fallback and output behavior.
