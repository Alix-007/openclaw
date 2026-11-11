# Exact-head native evidence

Product head: `72394c794052d0efe3783c61f3a287e971039fe4`. Acceptance-red base: `83872e599d5720c0bc97d313283a2bc245046699`.

- **Real Gateway / CLI / disk:** the normal built CLI calls `agents.files.get`, `agents.files.set` and `agents.update` against an isolated Gateway. On BASE, a CP1252 byte becomes U+FFFD during an ordinary read/edit/checked-save, a cached-hash save and an identity update. On HEAD, all three refuse invalid UTF-8; actual disk bytes remain identical and identity-update configuration remains unchanged.
- **Actionable recovery:** the actual CLI responses for all three refused operations are independently read back as `INVALID_REQUEST`, state that the original file was preserved, and instruct UTF-8 conversion before retry. No decoder error code, TypeError or cause is exposed.
- **Legal controls:** valid BOM/Unicode/literal U+FFFD checked edits read back exactly; intentional replacement without `expectedHash` still succeeds. **5/5 expected outcomes** pass on each version. Actual CLI stdout/stderr/status and file/config byte hashes are published.
- **Checks:** `node scripts/run-vitest.mjs src/gateway/server-methods/agents-files.test.ts --maxWorkers=1`: **33 passed, 1 preexisting skip**, **62.626 seconds** wall time. Targeted types, lint, format, staged exact test-line budget, normal CLI build and fresh independent adversarial review pass; findings: **None**. Existing handler/real shell-bridge fixture startup accounts for the command exceeding 30 seconds; no timeout was increased. No module mock factories were added or changed; full repository mock checking remains for CI.

Three files: production **+47/-11**, tests **+44/-2** (net **42 LF**) and an exact own-regression allocation. Coverage includes local and real shell-bridge reads/writes, stale-hash conflicts, matching-hash malformed edits, exact classified recovery, identity refusal and byte preservation, valid Unicode/BOM/U+FFFD and intentional blind replacement. The existing decoder and bridge semantics are reused; read-only skills preview and the already-strict session editor require no patch.

Replay using the frozen collector on tracked-clean normally built BASE/HEAD checkouts:

```sh
python3 collect.py --repo CHECKOUT --output NEW_OUTPUT --node NODE26 --expect-head FULL_SHA --expect EXPECTATION
```

The entry, fixtures and controls are identical; only checkout/version and red/green expectation change. Both normal build stamps bind the exact full commit and clean source inputs. See the receipts for raw outputs, statuses, events and independent readbacks. Private filesystem prefixes and task-only synthetic credentials in output are redacted; frozen collectors retain their unchanged, openly synthetic fixture constants.

The collector stops only its own Gateway process group and verifies its absence. Synthetic workspace/config fixtures are retained. Child environments are allowlisted with isolated HOME/XDG/config/state; no real provider, model, channel or user data is used.

**Not tested:** browser UI clicks, a real remote workspace bridge, Windows/macOS and the full repository CI matrix; remote bridge coverage is in the focused suite.
