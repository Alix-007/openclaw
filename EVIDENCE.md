# ClawHub terminal fixture maintenance

Final source head `25884b584b384e233dea1336dc5d0007bd26981f`, tree `6be6a1aa3e46bcca7bb6b1d48ee8c584a0d0bd21`, integrated main `aab88e31bf5a64012a699139e19af193fa9a69c7`. Production files are byte-identical to main; only the existing E2E fixture and its exact7LF test allocation differ.

Main already sends `Retry-After:0`, which independently avoids the historical long wait. This maintenance does not claim that current main still times out. Its purpose is explicit terminal single-attempt coverage: a permanent503 response advertises61 seconds, beyond the client's existing60-second server-delay budget. The fixture records exactly two unavailable requests, one `bundle-plugin` and one `code-plugin`, regardless of concurrency order. Original503 body, diagnostic, exit1, all10 prior assertions and unchanged30-second deadline remain.

The actual boundary is existing source E2E -> canonical CLI command handler -> real catalog/package HTTP clients -> synthetic loopback HTTP listener -> captured runtime log/error/exit sinks. Success text/JSON package deduplication, separation from skills, empty lookup and terminal error controls execute in the same existing test. No production retry policy, runner override, new test, skip, or timeout extension is added.

```sh
OPENCLAW_E2E_USE_PREBUILT_DIST=1 OPENCLAW_VITEST_RUNTIME=node node scripts/run-vitest.mjs run src/cli/plugins-search-command.clawhub.e2e.test.ts --maxWorkers=1
```

Recorded execution passed1/1:624ms case, 196.897s total wall dominated95% worker transformation. Scoped types55.864s, typed lint116.879s, format0.605s, exact test-line budget and line cap pass. All gate logs and original private SHA values are checked before publication path redaction. Executed file hashes match the normal final commit exactly; no post-commit test rerun or current-head built product proof is claimed. The prior equivalent sorted-membership draft passed E2E but failed comparator lint; final unordered membership correction reran all affected checks. Those historical local receipts remain preserved.

Source/test surface: production+0/-0; existing test+10/-3 (net7LF); allocation metadata+2/-0. The exact own7LF allocation preserves shared scalar and inherited debt. Independent root review PASS, findings=[], exact committed tree. Listener/claim cleanup is awaited and fixture temp state is owned by the existing automatic cleanup helper. Missing config and unset task-token variables avoid registry credentials; all requests are synthetic loopback.

Historical shipped-CLI evidence remains [separately pinned to d928e377](https://github.com/Alix-007/openclaw/tree/d8744f7c0d84bac4bde079e18f44e6db50ea0d03/OC/proof/2026-11-06-final-followups). Its no-hint/61/200 observations are historical, not current-main or final-head behavior. No binary, runtime build or borrowed artifacts were created for this maintenance proof.

Not tested: Actual public ClawHub availability/authentication, physical Windows/macOS, a fresh built-CLI replay at this head, or the full repository suite. The source E2E substitutes runtime output/exit sinks; it does not assert real subprocess stdout or process exit.
