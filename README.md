# Secrets audit cancellation evidence

Product HEAD `145768c9eb2eafe882f5377d8c0ef8bd1f4e3828`; BASE `c324818cbf86074f34578d07f381b0d2835955a1`. Normal qaRuntime build: 263.278s. This is actual normal CLI execution with a synthetic local exec SecretRef provider; it does not verify real credentials, external providers or network services.

BASE: successful resolution, provider exit 7/unresolved diagnostic and omitted `--allow-exec`/zero launches pass. Pending SIGINT/SIGTERM audit acknowledges interruption but exits by launcher SIGKILL around 2.05s; direct provider remains alive and needs recorded collector cleanup. HEAD: all 5 cells pass. Pending audit exits naturally with 130/143 in 0.547–0.580s, provider PID is gone at CLI exit, and config bytes are unchanged. Actual per-cell values are in METRICS.json.

## Replay

Use Node 26 and a clean checkout of BASE or HEAD. Build normally with `node --import ./scripts/tsx.mjs scripts/build-all.mts qaRuntime`, then run the unchanged frozen collector:

```sh
python3 scout-secrets-audit-native.py --worktree "$CHECKOUT" --node "$NODE26" --out "$FRESH_OUTPUT"
python3 check-secrets-audit-native.py "$FRESH_OUTPUT/receipt.json" --expect "$EXPECT"
```

`EXPECT=red` for BASE, `EXPECT=green` for HEAD. Output directory must be fresh. Collector validates clean HEAD/build-stamp binding and creates isolated HOME/XDG/tmp/state/config fixtures with allowlisted environment. Both original frozen scripts are byte-identical to the BASE versions; hashes are in MANIFEST.json.

## Readbacks and limits

Each run retains actual combined PTY stdout/stderr, synthetic provider request/response/signal events, config fixtures and original hashes. PTY combines the streams; no separate stdout/stderr recording is claimed. Provider events/PID observations establish direct-provider custody; they do not independently record provider waitpid exit status or arbitrary grandchildren. BASE post-observation provider SIGTERM is collector cleanup, not product cancellation. Fixture directories are retained and can be removed manually after inspection; processes are cleaned by their recorded owner.

The strict quiet oracle excludes status/ok/audit-summary/failure payloads after ACK; it does not demand arbitrary-byte silence. Linux JSON/exec-provider path is native; human late output and admitted apply reporting have unit coverage. Other file/database scan awaits, Windows and real provider integrations were not verified. No configure/apply/reload/store mutation was exercised by the native diagnostic probe.

Focused 75 tests / 3 files PASS in 246.273s, including 114.718s normal worker preparation; all seven source gates pass. Existing precommit gate input files match HEAD via SOURCE-EQUIVALENCE.json. Independent fallback review of this exact HEAD, source, final gates and paired native evidence is PASS with no findings; this is not official autoreview. Final reports are `review__final-independent-review.json` and `review__final-independent-review.md`.

Private machine paths alone are replaced by named placeholders. Original hashes remain original; MANIFEST.json records both original-source and public-byte hashes so redaction is explicit. No real credential values are present; fixture value is openly synthetic.

For the flat publisher, nested file paths use `__` separators without changing file bytes. `PUBLICATION-PATH-MAP.json` maps the original paths to publication names. Raw terminals remain binary PTY captures; no decoded or separately attributed stream is invented.
