# Agent-document lossless editing proof

Product head: `d2c9c83acf11bb1258d1958adb12a606229cfd44`. Acceptance-red base: `83872e599d5720c0bc97d313283a2bc245046699`.

The normal built CLI calls a real isolated Gateway via `gateway call agents.files.get`, `agents.files.set` and `agents.update`. The frozen collector reads actual file bytes and config bytes after every operation. It never replaces a production handler. Both source trees are tracked-clean, and their normal build stamps match their full commits.

Five same-scenario cases on each version:

1. A CP1252 AGENTS.md read followed by an unrelated edit and checked save loses the original byte on BASE. HEAD refuses the malformed read and preserves exact bytes.
2. A cached original-byte CAS hash allows the same corruption on BASE. HEAD refuses the matching-hash edit before writing and preserves exact bytes.
3. Valid UTF-8 with BOM, Unicode, and a literal U+FFFD edits successfully and reads back exactly on both versions.
4. Intentional full replacement without expectedHash remains successful on both versions.
5. A malformed IDENTITY.md preread is lossy during agents.update on BASE. HEAD refuses it before file or config mutation; both remain byte-identical.

All five expected outcomes pass on BASE in39.561s and HEAD in32.077s. Individual CLI stdout, stderr, exit status, arguments and timings are in the receipts, together with byte hex and SHA-256 readbacks. Synthetic loopback authentication values and private filesystem prefixes are replaced in published receipts/logs. The collector itself is unchanged and contains only a publicly visible task-local synthetic credential.

Replay on clean, normally built checkouts using the same collector (SHA-256 `defc653fcb34afc7ba09b144b4e332e5fb3629900f4657143d596e922aabb795`):

```
python3 collect.py --repo CHECKOUT --output NEW_OUTPUT --node NODE26 --expect-head FULL_SHA --expect EXPECTATION
```

Use BASE SHA and `red`, then HEAD SHA and `green`. Only version and expected result change; scenarios and controls stay the same. Output must be fresh. The process environment is explicitly allowlisted with isolated HOME/XDG/config/state; this is not an OS sandbox.

Focused owner suite:33 passed,1 preexisting unsupported-create case skipped,117.697s command wall time. Targeted types, lint, format, staged exact+19LF test-line allocation, changed-source mock inspection, normal cliStartup build and fresh independent adversarial review pass. The test file has no module mock factories; ledger unchanged. Full repository mock checking is deferred to CI, not claimed passed locally.

Cleanup: only the owned Gateway process group is stopped; its absence is verified. Synthetic workspace/config/receipt fixtures remain for inspection. No external provider, model, channel or real user data is used. Not tested: UI clicks, real remote workspace bridges, Windows/macOS and full repository CI. Unit coverage includes the existing real local shell bridge adapter; no remote production environment claim.
