## What Problem This Solves

Local plugin authoring lexically normalizes a path before consulting the filesystem. For `selected -> physical/nested`, `selected/../source` names `physical/source`, but build, validation and packaging can successfully operate on a different valid neighbouring project. Init and explicit archive output can likewise write to the wrong directory.

## User Impact

Build/check, validate, pack and runtime-lint use the project the supplied path actually names. Init and `pack --out` use the physical parent destination. Wrong-project metadata and wrong archive contents are prevented together. Existing no-force refusal, exclusive archive creation and publication cleanup remain enforced.

## Why This Change Was Made

Resolve existing project roots through native filesystem traversal while preserving package entry declarations. Reuse fs-safe prefix traversal for an init destination that does not exist yet; reject an unresolved `..` rather than collapse it into an existing project. Resolve only the archive parent, keeping final-name `wx` protection. Include the browser build/settings script and runtime-lint root consumer in this authoring repair.

This completes existing path selection, without new options, defaults, dependencies, permission or config/schema/protocol/upgrade changes. It does not activate, publish or install a plugin. Source confinement, final overwrite refusal and ordinary paths remain covered.

## Evidence

**Product head:** `a483ef8b3959f9b69db238350dee69ca9b4aa958`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
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
- **Current-head focused checks:** `pnpm test src/cli/plugins-authoring-command.test.ts src/cli/plugins-authoring-validation.test.ts src/cli/plugins-control-ui-build.test.ts --maxWorkers=1 -t '^(?!.*builds and installs selected entries without changing sibling runtime pairs)'`:75 PASS, one explicitly filtered known BASE-timeout case, in41.234s. The file/directory alias declarations, sibling runtime mapping, physical project roots, browser build and expected entry errors are covered. The previously run complete selection recorded one120s install-test timeout independently reproduced on clean BASE; that unrelated case is not claimed passing or rerun. No BASE test assertion, source skip or timeout is changed. Current genuine typed lint, semantic types, format and staged line checks pass.
- **First-review fixes / independent review:** the retained original declared-entry resolver preserves package/manifest diagnostics before the existing missing-entry guard. The new init refusal explains how to recover. The authorized independent GPT6.1Sol source/evidence/body review is linked; official autoreview execution is not claimed. This complete authoring repair covers project roots, init, archive output, browser build/settings and runtime-lint together; backend entry declarations keep their existing slot identity.
- **Additional real diagnostic regression proof:** `python3 plugin-diagnostics-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (frozen SHA256 `bf91372e3d9ebae93a4f3dc7a7740b4cd2b3e4941de804c834febd0b9ccc576b`) compares the first published revision `a83b8ad928070201c48afc12c67f51bf0ddc28fb` to this repaired head, separately from the original current-main BASE above. The first revision masked three metadata errors with missing-entry errors. On the repaired head, malformed JSON with and without debug retains parser-detail policy, a missing manifest is reported before the absent default entry, and unreachable init shows the recovery step. Five actual normal-CLI checks pass; the no-force control preserves its sentinel, malformed source bytes remain unchanged, and the unreachable parent is not created. No old receipt is relabelled as this head.
- **Missing-root diagnostic regression:** `python3 plugin-missing-root-proof-v2.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, frozen SHA256 `2762205d5d63b14a6392bb8e544472b4682d0cae91684c30ecfa97217472ba9c`, compares first repair `f9aa12f0ac37b9f51740ed4abbbc4df09cc1ec76` to this exact head. Four actual commands (`build`, human and JSON `validate`, and `pack`) previously lost the operator-facing root-not-found message. A shared expected-error helper now reports the missing root and an actionable `--root` recovery step for ENOENT/ENOTDIR; other native errors propagate. Packaging uses its existing validation entry before resolving the physical root. `plugins lint` retains its existing actionable scan-incomplete warning as the must-not-turn-fatal control. Missing roots remain absent and the fixture sentinel is unchanged. This is a separate diagnostic pair; the original BASE is unchanged.
- **Non-directory entry regression:** `python3 plugin-entry-enotdir-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, frozen SHA256 `875e3cee4dd2e77dea5b65121bc2954a627e0053b9c9c2bf1b071fa512decf49`, compares previous repair `a5ea84b0e91db727c56c7cbcb2678d24b18e3c11` to this head. With an existing project and `--entry package.json/index.js`, build plus human/JSON validation previously lost the expected entry-not-found diagnostic. Backend entry selection retains the original declaration resolver, so both nonexistent entries and entries beneath a regular file reach the existing expected-error owner. Three actual failures regain their precise entry message; valid build, ordinary missing-entry and valid JSON validation controls retain behavior. Independent package/source/manifest hashes are unchanged after the failing requests, and package.json remains a regular file. No metadata guard or entry-confinement rule is bypassed. This third diagnostic pair retains its own BASE revision.
- **Existing declaration compatibility / narrowed scope:** `python3 plugin-entry-alias-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, frozen SHA256 `a7cfcb615b1bdd71f5733cfbfe04e39614375679338ab5585ef6943646a618e8`, compares prior repair `050f9f63f297c83d287024ea5e67b712bf75b548` to this head. It starts with already-valid package declarations containing a file alias or directory alias plus a second extension and two runtime mappings. The prior revision rejects those existing declarations and appends the same physical plugin as a duplicate on build. This head validates the original stored package, builds and validates it again without changing either declared slot, runtime mappings, setup entry or source bytes; ordinary entries remain the control. Twelve actual CLI operations are recorded. Physical project-root selection and declared backend entry identity are separate: this PR does not introduce native traversal rules for package entry strings. The BASE lexical handling of entry `missing/../...` is retained. An absolute entry spelled under the supplied root maps to the same relative declaration under the physical project root; unrelated paths still use the existing confinement guard. The browser core's pre-existing native-entry confinement is unchanged. The browser-copy script reads from the physical root but retains the original logical bundled slot for destination selection; `--copy` remains source-reviewed only.
- **Cleanup/limitations:** isolated Ubuntu24.04/GLIBC2.39/Node26.12.1 and synthetic local projects; proof containers have network disabled and private HOME/config/state. No live plugin activation, external install/publish, real model/channel or production state. **Not tested:** the --prepare-settings repository-discovery and --copy bundled-destination branches (source-reviewed only), full repository suite, native macOS/Windows, hosted CI, live plugin activation, external install/publish or production services. The baseline install-test timeout remains an unresolved local validation limitation. Fixture archives and logs are retained outside the product branch.

<details><summary>Production / test LOC</summary>

```text
3	3	scripts/build-plugin-control-ui.mts
111	38	src/cli/plugins-authoring-command.test.ts
21	27	src/cli/plugins-authoring-command.ts
51	0	src/cli/plugins-authoring-root.ts
47	1	src/cli/plugins-authoring-validation.test.ts
11	1	src/cli/plugins-control-ui-build.test.ts
13	1	src/cli/plugins-feature-artifact.native.test-support.ts
7	4	src/cli/plugins-feature-artifact.ts
5	1	src/cli/plugins-runtime-lint-command.test.ts
3	1	src/cli/plugins-runtime-lint-command.ts
```

No proof assets or CHANGELOG changes on the product branch.

</details>
