# Final fresh-main ClawHub fixture verification

**PASS: the unchanged existing E2E completes in 393 ms on the final fixture-only working tree.**

- Base/HEAD: `d4ae77eae296fd8eb1f90f7a4ebb5d77fa2e6ad9`, which already contains the landed plugin-search cancellation repair.
- Candidate: the parent-owned uncommitted working tree in `clawhub-search-fixture`; only the two-line permanent-503 response header/comment and its exact two-line test allocation differ from that base. No production source changed.
- Actual command: Node `v26.12.1`, `scripts/run-vitest.mjs src/cli/plugins-search-command.clawhub.e2e.test.ts --maxWorkers=1`, official `OPENCLAW_E2E_USE_PREBUILT_DIST=1` and `OPENCLAW_VITEST_RUNTIME=node`.
- Result: one existing case passed, **393 ms**, exit **0**; whole invocation **139.826 s**, including **110.528 s** compiling the invocation-owned test worker graph (18,810 inputs, 23,950 outputs).
- No Bun staging or fallback occurred in this final run. No timeout, config, test selector, assertion or production retry policy was changed.

The E2E uses real loopback HTTP fixture traffic and its original straight-line success, JSON merge/deduplication, skills separation, empty lookup and terminal error assertions. All **10 original `expect` call sites** and the **30,000 ms** timeout remain byte-for-byte unchanged. Removing just the added comment/header makes the tested fixture equal the original main fixture. The original main fixture SHA-256 is `e37f5ebbf5fcb1b26c94f18200de06d70d813fd98161ecac7197ace56063e43e`, identical to the prior actual baseline timeout fixture.

## Artifact and source custody

Normal product `dist`, `dist-runtime`, `dist-windows`, package `dist` and extension `dist` outputs were absent before the run and remained absent afterward. No build stamp was created, copied or forged. The selected E2E consumes the source search/retry owners and compiles its own normal invocation worker artifacts; it does not require a product build. Existing Kysely types were ready. The source/fixture/retry-owner hashes match before and after the entire invocation.

The parent staged the same two files while the test ran: Git status changed from modified/untracked to staged, but **HEAD did not change** and staged bytes now match the tested working-tree bytes exactly. This lane did not stage, commit or write Git. This is therefore a verified working-tree/index candidate, **not a committed exact-head run**. Parent independent review, commit identity and final commit-to-tested-file binding remain with the publisher. No test rerun is needed merely to rename the identity; any actual subsequent source/test edit would invalidate this receipt.

This final candidate's delta from its own current-main base is fixture-only, clearing the earlier comparison's extra cancellation-production delta. The original 30-second RED was run on `5bd69e0`; do not claim a separate original-fixture E2E run on `d4ae77e` occurred here. Maintainer public CI reproduction independently covers the unchanged retry/fixture behavior on main. These are Node E2E results, not Bun-hosted CI equivalence or a new product acceptance proof.

## Evidence

- `clawhub-fixture-final-focused.json`: argv/environment, real base, source hashes before/after, original assertion/timeout checks, product-output absence snapshots, runtime/compiler timing, staged-byte binding and stdout/stderr hashes.
- `clawhub-fixture-final-focused.stdout.log` / `.stderr.log`: complete native official runner output and cleanup result.
- `clawhub-fixture-final-worktree.diff`: original tested unstaged fixture patch; `clawhub-fixture-final-candidate.diff`: final parent-staged full two-file delta.
- `clawhub-fixture-prebuilt-runs.json` and `clawhub-fixture-prebuilt-results.md`: actual original-fixture timeout and earlier repaired-fixture green, with source/build limitations retained.

No production/test edits, dependency installation, product build, Git mutation or remote write was performed by this lane. Normal test-owned compiler/cache/scratch outputs were prepared and joined by the official runner. No real credentials, external provider/channel sessions or sends were used. Token and monetary telemetry remain unknown.
