# ClawHub fixture: actual existing-E2E before/after

**Original E2E reproduced its 30-second failure; the two-line fixture repair passes the original complete case.**

| Source / build | Existing E2E case | Runner exit | Whole invocation | Task worker compilation |
| --- | --- | --- | --- | --- |
| source `5bd69e0a3365a3095df1d34576a6885de6fdf5d3`, matching normal built runtime | **FAIL — 30,101 ms**, `Test timed out in 30000ms` | 1 | 181.991 s | 119.401 s |
| source `6df5b5d59df83a6de070919b7810f7e0b0f134a9`, explicitly reused built runtime `d6dd353d0b500658bb9fbf565314096d3b0039a9` | **PASS — 573 ms** | 0 | 173.065 s | 136.417 s |

Both commands used the official `scripts/run-vitest.mjs src/cli/plugins-search-command.clawhub.e2e.test.ts --maxWorkers=1`, adding only `OPENCLAW_E2E_USE_PREBUILT_DIST=1`. Each ran in its own worktree, sequentially. Both default wrappers attempted their pinned Bun staging, logged its failure and explicitly fell back to the installed Node **v26.12.1**; these are Node results, not Bun proofs. No test-runtime override was added during either already-running invocation. The later explicit-Node authorization was not applied mid-flight.

The prebuilt flag passed the existing official reader gate; neither invocation hit the managed-Gateway preparation refusal. The test runner did build its own complete compiled-subprocess graph under an invocation-owned artifact directory (18,808 inputs/23,945 outputs) and verified it before cleanup/cache retention. This is the dominant elapsed cost, not a product rebuild. The ordinary `dist/.buildstamp`, `.runtime-postbuildstamp` and `build-info.json` hashes were identical before and after each invocation, as were every recorded source/fixture hash and clean Git status. No shared dist writer ran.

## Assertions and contract

Deleting exactly the added explanatory comment and `retry-after: 61` response header from the candidate fixture makes it byte-identical to the original fixture. Both retain all **10 `expect` call sites**, the single original test, original success/JSON deduplication/skills/empty/error flow, all assertion bodies and `30_000` timeout. The candidate's passing straight-line case reaches the last terminal-error assertions. The baseline times out before completing its terminal-error flow; do not claim all baseline assertions ran.

The retry owner is byte-identical across the runs: `src/infra/clawhub-retry.ts` SHA-256 `47153605320382ad19d488da6306b3ec6ccd71dc7680be88326f4f520ab7398d`. Its default retry delays are 1+3+10+30 seconds; its existing policy declines retry when a server requests more than the bounded 60-second recovery horizon. A faithful permanent-unavailable fixture can therefore use `Retry-After: 61` to exercise the terminal-error renderer without sleeping through that recovery schedule. The real retry policy, response status/body, original test limit and assertions remain unchanged.

`src/infra/clawhub-client.ts` SHA-256 is also identical: `4a23c5daf9b9f9231d59e2c8465d480794ce151020ecaea5e608a7e6d7182b95`.

## Limits and final publishing check

The two source heads also differ by the previously merged cancellation repair in CLI search, catalog and package readers. This E2E creates no invocation AsyncWorkScope and passes no cancellation signal, but the two runs must **not** be described as source trees differing only by the fixture. The candidate's own build-to-source diff contains only this test plus its allocation; no new product bytes need rebuilding for that test-only commit. Report that reuse explicitly rather than claiming a build of `6df5b5d`.

The parent is preparing a fresh current-main fixture-only branch and owns its final exact-head focused run. That remaining result is required before publication. This report establishes the inherited failure and the actual repaired existing test, not fresh Bun CI equivalence, a built-CLI product acceptance, or an automatic guarantee of hosted CI.

## Inspectable receipts

- `clawhub-fixture-prebuilt-runs.json`: exact argv, worktree, environment delta/key values, source/build heads, elapsed times, all owner hashes, metadata snapshots, test duration, runtime fallback evidence and stdout/stderr SHA-256.
- `clawhub-fixture-prebuilt-base.stdout.log` / `.stderr.log`: raw native original run.
- `clawhub-fixture-prebuilt-candidate.stdout.log` / `.stderr.log`: raw native passing run.
- `clawhub-fixture-e2e-route.md` / `.json`: prior source-based reader-admission justification.

No product/test source edits, Git mutations, manual dependency edits or remote writes were performed by this lane. Normal runner-owned scratch/compiler-cache writes and its unsuccessful official Bun staging attempt are retained in the logs; do not claim no process ever attempted preparation. No real credential, provider/channel session or send was used. Token and monetary telemetry remain unknown.
