## What Problem This Solves

Local plugin authoring lexically normalizes a path before consulting the filesystem. For `selected -> physical/nested`, `selected/../source` names `physical/source`, but build, validation and packaging can successfully operate on a different valid neighbouring project. Init and explicit archive output can likewise write to the wrong directory.

## User Impact

Build/check, validate, pack and runtime-lint use the project the supplied path actually names. Init and `pack --out` use the physical parent destination. Wrong-project metadata and wrong archive contents are prevented together. Existing no-force refusal, exclusive archive creation and publication cleanup remain enforced.

## Why This Change Was Made

Resolve existing roots/entries through native filesystem traversal. Reuse fs-safe prefix traversal for an init destination that does not exist yet; reject an unresolved `..` rather than collapse it into an existing project. Resolve only the archive parent, keeping final-name `wx` protection. Include the browser build/settings script and runtime-lint root consumer in this authoring repair.

This completes existing path selection, without new options, defaults, dependencies, permission or config/schema/protocol/upgrade changes. It does not activate, publish or install a plugin. Source confinement, final overwrite refusal and ordinary paths remain covered.

## Evidence

**Product head:** `a83b8ad928070201c48afc12c67f51bf0ddc28fb`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Immutable paired receipts, actual archives, full output, frozen collectors and independent review](./MANIFEST.json).

| Same actual CLI scenario | BASE | HEAD |
| --- | --- | --- |
| `plugins build --check` / `validate --json` on stale selected physical project | Two commands report the valid decoy as current | Both detect the selected physical project's stale metadata |
| `build` / `pack` through the same root | Metadata remains stale in the intended project; tar contains decoy plugin | Intended metadata updated; independently read tar contains physical plugin |
| `init --directory` / `pack --out` through a directory alias and parent | New project/archive appears in neighbouring lexical directory | Both appear in physical destination, wrong destination absent |
| Ordinary build/validate and unchanged decoy/source controls | Five controls pass | Same five pass |

- **Production entry and owner:** normally built `openclaw.mjs plugins build`, `validate`, `pack`, `init` -> actual authoring/artifact owners -> filesystem metadata, scaffold files and independent tar readback. Browser builder (including a settings-only UI fixture) and runtime-lint sibling behavior also run in their existing focused tests. The --prepare-settings repository-discovery branch is source-reviewed only.
- **Exact paired commands:** `python3 plugin-root-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (10 scenarios) and `python3 plugin-output-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (build control plus explicit archive output), with `red` on BASE and `green` on HEAD. Each collector is byte-identical across its pair and requires a clean matching-head normal `cliStartup` build. HEAD build exits 0 in 262.449 s.
- **Recorder/readback:** real exit/stdout/stderr; physical/decoy package and manifest hashes; scaffold package identity; actual tar SHA256 and independently unpacked `package/openclaw.plugin.json`. All 12 HEAD operations pass, including the explicit archive destination sibling. Both archive byte sets are inspectable outside the product branch. No path library or authoring owner is replaced by a test double.
- **Focused checks:** the Vitest run recorded 77 PASS and **one unchanged 120 s install-test timeout**, exit 1, 203.15 s wall. The same named test also times out on clean BASE (187.93 s wall); this failure is disclosed, not relabelled as PASS. Final changed authoring cases pass in a targeted run; existing native artifact tests pass 17/17 in 12.886 s, including raw output-parent readback. A separate actual source install diagnostic succeeds; it is supporting evidence and does not replace the timed-out suite. No assertion or timeout was relaxed. Semantic types, typed lint, format, script erasability and staged test/file line ratchets pass.
- **Independent review/siblings:** source review caught a missing-parent overwrite regression before commit; the corrected no-force and missing-entry regressions pass. Final independent source/raw-evidence review passes with no findings through the user-authorized GPT6.1Sol fallback; official autoreview execution is not claimed. One complete PR covers root/entry selection, init, archive output, browser authoring and runtime-lint rather than separate output-spot patches.
- **Cleanup/limitations:** isolated Ubuntu24.04/GLIBC2.39/Node26.12.1 and synthetic local projects; proof containers have network disabled and private HOME/config/state. No live plugin activation, external install/publish, real model/channel or production state. The baseline install-test timeout remains an unresolved local validation limitation; no full suite, native macOS/Windows or hosted CI success is claimed. Fixture archives and logs are retained outside the product branch.

<details><summary>Production / test LOC</summary>

```text
2	2	scripts/build-plugin-control-ui.mts
76	39	src/cli/plugins-authoring-command.test.ts
34	14	src/cli/plugins-authoring-command.ts
11	1	src/cli/plugins-control-ui-build.test.ts
13	1	src/cli/plugins-feature-artifact.native.test-support.ts
6	3	src/cli/plugins-feature-artifact.ts
5	1	src/cli/plugins-runtime-lint-command.test.ts
3	1	src/cli/plugins-runtime-lint-command.ts
```

No proof assets or CHANGELOG changes on the product branch.

</details>
