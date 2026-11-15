## What Problem This Solves

`worktrees create` fails with `ENOENT` when a repository's separate Git metadata directory ends in a literal space, although native Git accepts that repository. The generic text reader trims part of the actual filesystem path.

## User Impact

Managed checkout creation and listing work for this existing native repository layout. Worktree discovery, ref admission, configuration, snapshots, hydration, maintenance and recovery all preserve path-valued Git output. Ordinary metadata paths keep their behavior; no new option or migration is introduced.

## Why This Change Was Made

Use an explicit path reader that removes exactly the command's final LF and applies existing Windows path normalization. Generic ref/hash/config text keeps its existing text contract. Fix the full worktree responsibility module together, including the hydration and orphan-deletion path reads added on main since the original contribution.

This normal two-parent merge preserves the original contributor history and main `2c4413a6abbfeb4ac23cd07b775a105586548af1`, including its session-source authority composition and allocation/live lease guards. The checkout import conflict is resolved without dropping either side. No config/default, protocol/schema, security policy, persistent format or upgrade changes. No proof assets or CHANGELOG changes in the product branch.

## Evidence

**Product head:** `0daf08e1a895730f4f264f571bbed8ea2903c2da`. [Frozen collector, paired CLI streams/readbacks, exact-head checks, independent review and baseline attribution](./MANIFEST.json).

| Same normal CLI scenario | Historical BASE `5fe1403b94d7` | This merged head |
| --- | --- | --- |
| Ordinary separate Git metadata directory | Create succeeds; marker and actual list record read back | Same |
| Metadata directory ending in one space | Create fails at the trimmed neighbouring path | Create succeeds; marker and actual list record read back |

- **Production entry + exact command:** `python3 worktree-metadata-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, `base` for the retained historical BASE and `head` for this freshly built merge commit. Frozen collector SHA256 `7a9448d2e684c3559cff1f1e028ae9b22e83cea1c83a0c4a90662579be6c844e` is unchanged. It runs normal `openclaw.mjs worktrees create <checkout> --name proof --base-ref refs/heads/main --json` and `worktrees list --json`.
- **Canonical owner / boundary:** actual worktree create/list owners and native Git operate on disposable separate metadata directories. Native common-directory output retains the literal space before its single LF. Independent checkout marker bytes and actual list JSON establish the created checkout identity. No Git or filesystem owner is replaced with a mock.
- **Red / green / control:** the original BASE receipt records the literal-space ENOENT and an ordinary successful control. It is retained with its original SHA and date, not relabelled as a newly executed current-main proof. This merged head replays the identical collector; both cases succeed with marker/list readbacks. A clean normal `cliStartup` build and matching `dist/.buildstamp` bind this proof to the exact product head.
- **New main siblings:** four real-Git hydration and orphan-deletion regressions cover both ordinary and trailing-space metadata directories. The same added tests on clean BASE record two trailing-space failures and two ordinary passes; corresponding source/test blobs match integrated main. All four pass after the repair. Hydration reads back the previously missing blob, while orphan cleanup reads back the absent managed ref and unchanged source HEAD/content. No authority or allocation guard was weakened.
- **Focused validation:** original three-file Git/config/maintenance selection passes; final post-namespace maintenance plus new-sibling selection is8/8 PASS (203.433s). Current format, genuine typed lint, semantic types and staged test/file line ratchets pass. The independent source/evidence/body review uses the user-authorized GPT6.1Sol fallback; official autoreview execution is not claimed.
- **Existing validation limits:** expanded HEAD capacity/orphan/new-sibling selection is12 PASS /18 FAIL. A fresh clean BASE run reproduces the same18 failed case names:17 partial-clone fixtures expect removed objects to be absent but native Git2.39.3 reports code0; one unchanged orphan-lock fixture expects an unlocked ref deletion to fail, while Git deletes that ref on both revisions. Paired logs and source/test blob bindings are included. No assertion, timeout, skip or policy was relaxed, and this expanded selection is not reported as green. Earlier broad sibling limitations remain in the [original evidence](https://github.com/Alix-007/openclaw/tree/21e07c973fd4cc1fa212403f2adf2a50ed2af13b).
- **Cleanup / limitations:** qualified offline Ubuntu24.04 / GLIBC2.39 / Git2.43.0 / Node26.12.1 CLI proof; isolated HOME/config/state and local fixture repositories only. Child processes waited; fixture disks retained outside the product branch. No remote Git service, credentials, model, channel or production state used. **Not tested:** native macOS/Windows, reftable, every modern-Git variant, full repository suite or hosted CI.

<details><summary>Complete main-relative production/test LOC</summary>

```text
2	5	src/agents/worktrees/base-ref.ts
2	4	src/agents/worktrees/checkout-git-config.ts
1	0	src/agents/worktrees/checkout-git-config.windows.test.ts
6	11	src/agents/worktrees/checkout.ts
3	3	src/agents/worktrees/eviction.test-support.ts
12	12	src/agents/worktrees/git-maintenance.ts
70	0	src/agents/worktrees/git-metadata-siblings.test.ts
25	6	src/agents/worktrees/git.test.ts
20	10	src/agents/worktrees/git.ts
8	2	src/agents/worktrees/object-hydration.ts
2	2	src/agents/worktrees/orphan-branches.ts
2	7	src/agents/worktrees/removal-git.ts
10	3	src/agents/worktrees/removal-recovery.ts
10	8	src/agents/worktrees/snapshot-exact-state.ts
2	5	src/agents/worktrees/snapshot-inventory.ts
```

</details>
