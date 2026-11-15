## What Problem This Solves

Interrupting `openclaw secrets audit --allow-exec` while a local exec provider is pending forces the CLI to be killed and leaves its provider running.

## User Impact

Ctrl-C/SIGTERM ends the pending audit and its owned provider before natural CLI exit130/143, without a late audit report or failure. Exec providers still require `--allow-exec`. The configure/apply/reload/store commands keep their existing receipt behavior.

## Why This Change Was Made

Pass the diagnostic command's existing lifetime signal to its existing process owner, then stop its private output helper from publishing after interruption. No shared-resolver cancellation, new lifecycle helper, public config/default, permission policy, protocol/schema or upgrade change.

This normal merge preserves original contributor head `145768c9eb2eafe882f5377d8c0ef8bd1f4e3828` and main `f24c2097d581cc93bd15a0340c6f5fbd69db16b6`. The only textual conflict is in test imports: both the cancellation/process-scope helpers and main's `afterEach`/temporary-directory tracker are preserved. Production files and the existing83-line test allocation are byte-identical to the original contribution; main's cleanup changes remain. No proof assets or CHANGELOG files in the product branch.

## Evidence

**Product head:** `2208306319fe19a6764a28a10a5601abe061f694`. [Current clean-build receipts, PTY/provider records, regression results and independent review](./MANIFEST.json). Historical BASE `c324818cbf86074f34578d07f381b0d2835955a1` and original green remain in the [original immutable evidence](https://github.com/Alix-007/openclaw/tree/00495bd0c7ac084d544cd7bc155261a755e1dc13).

- **Production entry + exact commands:** `python3 scout-secrets-audit-native.py --worktree CHECKOUT --node NODE26 --out FRESH_OUTPUT`, followed by `python3 check-secrets-audit-native.py FRESH_OUTPUT/receipt.json --expect green`. The scout executes normally built `openclaw.mjs secrets audit --json [--allow-exec]`, with a real controlling PTY and synthetic task-local Python exec provider. Frozen scout SHA256 `939ba49b8ed68addbeda7ce3996f75dd25bcb593ddf491f47c912f141c3575b8`; checker SHA256 `02360d4737b67e8dd2f836a27232a899d0bdb555964421359ef927f72bafd329` matches the historical pair.
- **Canonical owner / boundary / readback:** actual secrets audit -> existing command process scope -> exec provider -> provider event JSONL, actual PID existence at CLI exit, natural exit status and merged PTY bytes. No provider/process/audit owner is replaced by a test double. Config bytes are independently hashed before/after.
- **Acceptance red / green:** the unchanged historical BASE receipt records acknowledged INT/TERM followed by CLI force-kill and a provider still alive at observed exit; cleanup is recorded separately after observation. This exact merged head replays the original collector and requires natural130/143, the observed provider already absent, no late audit result/failure payload, no launcher watchdog and no post-observation provider cleanup. Historical BASE retains its actual revision/date and is not presented as a fresh current-main run.
- **Legal / must-not-fire controls:** successful audit exits0 and returns the same complete one-reference resolution. Provider failure stays unresolved/exit2. Without `--allow-exec`, zero providers launch, refsChecked remains0 and skippedExecRefs remains1. All five cases preserve config bytes. The retained oracle checks raw terminal bytes and independent provider observations; it does not claim arbitrary-byte silence or arbitrary descendant coverage.
- **Current checks:** three focused suites (`src/cli/secrets-cli.test.ts`, `src/cli/secrets-store-cli.test.ts`, `src/secrets/audit.test.ts`)75/75 PASS in277.022s. Current format, genuine typed lint, semantic types and staged test/file line gates PASS. Normal clean `cliStartup` build and matching `dist/.buildstamp` bind the replay to this head. Independent user-authorized GPT6.1Sol source/evidence/body review PASS; official autoreview execution is not claimed.
- **Cleanup / limitations:** isolated offline Ubuntu24.04 / GLIBC2.39 / Node26.12.1, synthetic provider/config/HOME/state. All child processes waited. No production credentials, providers, channels, model or network service used. Only synthetic evidence fixtures remain. **Not tested:** native Windows/macOS, arbitrary descendant trees, other file/database scan awaits, real providers or full repository suite; hosted CI is separate.

<details><summary>Main-relative production/test LOC</summary>

```text
2	0	config/test-lines-allocations/secrets-audit-cancellation.txt
4	0	src/cli/secrets-cli-output.ts
83	0	src/cli/secrets-cli.test.ts
49	37	src/cli/secrets-cli.ts
```

</details>
