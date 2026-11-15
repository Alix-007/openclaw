## What Problem This Solves

Local plugin authoring lexically normalizes a path before consulting the filesystem. For `selected -> physical/nested`, `selected/../source` names `physical/source`, but build, validation and packaging can successfully operate on a different valid neighbouring project. Init and explicit archive output can likewise write to the wrong directory.

## User Impact

Build/check, validate, pack and runtime-lint use the project the supplied path actually names. Init and `pack --out` use the physical parent destination. Wrong-project metadata and wrong archive contents are prevented together. Existing no-force refusal, exclusive archive creation and publication cleanup remain enforced.

## Why This Change Was Made

Resolve existing roots/entries through native filesystem traversal. Reuse fs-safe prefix traversal for an init destination that does not exist yet; reject an unresolved `..` rather than collapse it into an existing project. Resolve only the archive parent, keeping final-name `wx` protection. Include the browser build/settings script and runtime-lint root consumer in this authoring repair.

This completes existing path selection, without new options, defaults, dependencies, permission or config/schema/protocol/upgrade changes. It does not activate, publish or install a plugin. Source confinement, final overwrite refusal and ordinary paths remain covered.

## Evidence

**Product head:** `a5ea84b0e91db727c56c7cbcb2678d24b18e3c11`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Immutable paired receipts, actual archives, full output, frozen collectors and independent review](./MANIFEST.json).

| Same actual CLI scenario | BASE | HEAD |
| --- | --- | --- |
| `plugins build --check` / `validate --json` on stale selected physical project | Two commands report the valid decoy as current | Both detect the selected physical project's stale metadata |
| `build` / `pack` through the same root | Metadata remains stale in the intended project; tar contains decoy plugin | Intended metadata updated; independently read tar contains physical plugin |
| `init --directory` / `pack --out` through a directory alias and parent | New project/archive appears in neighbouring lexical directory | Both appear in physical destination, wrong destination absent |
| Ordinary build/validate and unchanged decoy/source controls | Five controls pass | Same five pass |

- **Production entry and owner:** normally built `openclaw.mjs plugins build`, `validate`, `pack`, `init` -> actual authoring/artifact owners -> filesystem metadata, scaffold files and independent tar readback. Browser builder (including a settings-only UI fixture) and runtime-lint sibling behavior also run in their existing focused tests. The --prepare-settings repository-discovery branch is source-reviewed only.
- **Exact paired commands:** `python3 plugin-root-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (10 scenarios) and `python3 plugin-output-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (build control plus explicit archive output), with `red` on BASE and `green` on HEAD. Each collector is byte-identical across its pair and requires a clean matching-head normal `cliStartup` build. HEAD normal clean CLI build result is recorded with this exact product head in checks.json.
- **Recorder/readback:** real exit/stdout/stderr; physical/decoy package and manifest hashes; scaffold package identity; actual tar SHA256 and independently unpacked `package/openclaw.plugin.json`. All 12 HEAD operations pass, including the explicit archive destination sibling. Both archive byte sets are inspectable outside the product branch. No path library or authoring owner is replaced by a test double.
- **Current-head focused checks:** `pnpm test src/cli/plugins-authoring-command.test.ts src/cli/plugins-authoring-validation.test.ts --maxWorkers=1`:40 PASS, plus a final post-extraction9/9 validation run (14.925s), and **one unchanged120s install-test timeout**, exit1 in210.312s wall. The same named install case timed out on clean BASE in the retained earlier receipt; it is not reported as passing and no assertion or timeout is relaxed. The earlier complete four-suite run recorded77 PASS/one same timeout; unchanged native-artifact tests passed17/17. Current repair typed lint, semantic types, format and staged test/file line ratchets pass; the original script-erasability check remains applicable to the unchanged script.
- **First-review fixes / independent review:** preserve package/manifest diagnostics before the existing missing-entry guard; the ENOENT fallback returns the original candidate, without lexical redirection. The new init refusal explains how to recover. The authorized independent GPT6.1Sol source/evidence/body review is linked; official autoreview execution is not claimed. This complete authoring repair covers roots/entries, init, archive output, browser build/settings and runtime-lint together.
- **Additional real diagnostic regression proof:** `python3 plugin-diagnostics-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (frozen SHA256 `bf91372e3d9ebae93a4f3dc7a7740b4cd2b3e4941de804c834febd0b9ccc576b`) compares the first published revision `a83b8ad928070201c48afc12c67f51bf0ddc28fb` to this repaired head, separately from the original current-main BASE above. The first revision masked three metadata errors with missing-entry errors. On the repaired head, malformed JSON with and without debug retains parser-detail policy, a missing manifest is reported before the absent default entry, and unreachable init shows the recovery step. Five actual normal-CLI checks pass; the no-force control preserves its sentinel, malformed source bytes remain unchanged, and the unreachable parent is not created. No old receipt is relabelled as this head.
- **Missing-root diagnostic regression:** `python3 plugin-missing-root-proof-v2.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, frozen SHA256 `2762205d5d63b14a6392bb8e544472b4682d0cae91684c30ecfa97217472ba9c`, compares first repair `f9aa12f0ac37b9f51740ed4abbbc4df09cc1ec76` to this exact head. Four actual commands (`build`, human and JSON `validate`, and `pack`) previously lost the operator-facing root-not-found message. A shared expected-error helper now reports the missing root and an actionable `--root` recovery step for ENOENT/ENOTDIR; other native errors propagate. Packaging uses its existing validation entry before resolving the physical root. `plugins lint` retains its existing actionable scan-incomplete warning as the must-not-turn-fatal control. Missing roots remain absent and the fixture sentinel is unchanged. This is a separate diagnostic pair; the original BASE is unchanged.
- **Cleanup/limitations:** isolated Ubuntu24.04/GLIBC2.39/Node26.12.1 and synthetic local projects; proof containers have network disabled and private HOME/config/state. No live plugin activation, external install/publish, real model/channel or production state. **Not tested:** the --prepare-settings repository-discovery branch (source-reviewed only), full repository suite, native macOS/Windows, hosted CI, live plugin activation, external install/publish or production services. The baseline install-test timeout remains an unresolved local validation limitation. Fixture archives and logs are retained outside the product branch.

<details><summary>Production / test LOC</summary>

```text
2	2	scripts/build-plugin-control-ui.mts
78	39	src/cli/plugins-authoring-command.test.ts
35	14	src/cli/plugins-authoring-command.ts
20	0	src/cli/plugins-authoring-root.ts
21	1	src/cli/plugins-authoring-validation.test.ts
11	1	src/cli/plugins-control-ui-build.test.ts
13	1	src/cli/plugins-feature-artifact.native.test-support.ts
7	4	src/cli/plugins-feature-artifact.ts
5	1	src/cli/plugins-runtime-lint-command.test.ts
3	1	src/cli/plugins-runtime-lint-command.ts
```

No proof assets or CHANGELOG changes on the product branch.

</details>
