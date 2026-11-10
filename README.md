# Incomplete snapshot reconciliation: native proof

Product BASE: `d290127ec6750ac3b3504d44ab50b7cee5f92ec7`. Product HEAD: `b1f20dd846dba7a0923c5f1b4566660793b1f081`.

Entry: the shipped `extensions/knowledge/skills/knowledge-source-ingest/scripts/source-manifest.mjs` executable, invoked as `snapshot` and then `plan`; no mocked product functions or wrapper implementation. The frozen collector creates synthetic records, reads the gzip manifests and the final plan JSON, and checks scratch cleanup. No network or real source data is used.

Run the same collector against clean BASE and HEAD checkouts using Node26:

```sh
python3 collect-manifest-scope.py --checkout /path/to/base --node /path/to/node --out /tmp/manifest-base-new
python3 collect-manifest-scope.py --checkout /path/to/head --node /path/to/node --out /tmp/manifest-head-new
```

Read each `receipt.json`; its `comparisons` and `pass` fields determine the result. The collector can exit0 while reporting the expected BASE failure; its process exit alone is not a product pass signal.

BASE partial and unknown plans wrongly contain `before-window`, `at-end`, and `after-window` in `unresolved_missing`. HEAD excludes those known out-of-window IDs. Both keep `at-start`, `inside-window`, and `undated` unresolved. Both preserve added/unchanged results, emit no partial/unknown deletions, and retain the complete-snapshot control: exactly two in-window deletions and only the undated unresolved item. The lower boundary is inclusive; the upper boundary and its following nanosecond are excluded. Both runs leave scratch empty.

The receipts include command argv, exit status, stdout/stderr, product/source/collector/Node hashes, and full expected/actual readbacks. Only local checkout/output/Node paths are normalized to `$CHECKOUT`, `$BASE_OUT`, `$HEAD_OUT`, and `$NODE`; the source data and observations are unchanged. All `.jsonl` files are synthetic inputs; `*-plan.json` and `*-receipt.json` are actual readbacks. Gzip snapshots can be regenerated from the inputs with the recorded commands.

Scope: standalone manifest snapshot/planner behavior only. Provider acquisition, Knowledge publishing, a running Gateway, large-archive performance, Windows and macOS are not exercised. No config, protocol, schema, credential, permission, migration or default changes. Nothing is deployed; remove the newly created proof directories to clean up.
