## What Problem This Solves

`skills install "<local-directory> "` can report success after installing a different valid neighbouring skill: the local source path is trimmed and lexically resolved before native traversal. A directory alias followed by `..` can select another source in the same way. The resulting instructions and companion files differ from the operator's selection.

## User Impact

Local skill installation validates, scans and copies the source the supplied path actually names. Quoted significant spaces and directory-symlink traversal are retained. Unreachable input does not fall back to a neighbouring skill. Ordinary paths, Git source parsing, slug validation, install policy, staging, no-force protection and discovery refresh retain their existing owners.

## Why This Change Was Made

Resolve the raw local source once through native `realpath`, after existing home-prefix expansion and before directory validation, security policy and copying. The Git branch continues using its normalized spec. Retain the original local source in the existing origin metadata so the receipt reflects what was requested; the installed destination remains the canonical workspace slug directory.

This is the complete source-selection owner for the local installer. The library-upload command is a separate Gateway operation. No new options, dependency, permission, config/default, schema, protocol, migration or linked-plugin identity changes. No modified release-owned CHANGELOG or proof assets in the product branch.

## Evidence

**Product head:** `13609e43e2bb2f89a249a3767f6f30eaff050e7d`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Paired CLI output, installed content/origin readback, frozen collector and independent review](./MANIFEST.json).

| Same actual local install | BASE | HEAD |
| --- | --- | --- |
| Quoted source directory ending in a space | Exit0; installed instructions/asset are from valid trimmed neighbour | Exit0; intended literal instructions/asset installed |
| Directory alias + parent traversal | Exit0; installed instructions/asset are from valid lexical neighbour | Exit0; intended physical instructions/asset installed |
| Ordinary local source | Intended instructions and asset | Same intended instructions and asset |

- **Production entry + exact command:** `python3 skill-source-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` with `red` on BASE and `green` on HEAD; frozen collector SHA256 `dd30dee3aa61f2f66bb4d87db7fa6c53c78f56fa225d0a6c197a1c9630475c7b` matches both. It executes normally built `openclaw.mjs skills install <path> --agent main --as <slug>`. Clean exact-head normal `cliStartup` build exits0 in315.641s.
- **Canonical owner / boundary:** actual `installSkillFromSource` -> existing skill loader, install policy and extracted-root installer -> independently opened installed `SKILL.md`, supporting file and `.openclaw/source-origin.json`. No copy, filesystem, policy or install owner is replaced by a test double. All three real commands exit0 on both revisions; BASE's two selected installations demonstrably contain decoy source bytes. HEAD's three readbacks match the intended sources.
- **Default-name compatibility repair:** Physical source selection and the displayed/default install name have separate owners. The original selected path supplies the fallback label; realpath supplies validation, scan and copy. Explicit `--as`, valid frontmatter names and existing slug validation retain precedence. `python3 skill-source-alias-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` (frozen SHA256 `e200b345672fc7a8bf5f1a018a281c08e7abed31e05233795e89b0782fd43f3f`) separately compares first-published head `053bbca1b99ed32cda882362ce00fa82c3465e44` with this repair. Without `--as`, an alias `my-guide` to `release.1` previously rejected a legal alias and an alias to `different-name` installed under the wrong name; the repaired commands both install `my-guide`. The ordinary no-override control also succeeds. Three actual CLI commands use installed instruction/asset/origin readback; source bytes remain unchanged. This repair baseline is distinct from original current-main BASE above.
- **Controls:** ordinary installation succeeds with the same expected bytes. All 10 source-file hashes remain unchanged. Final metadata identifies the requested source and installed slug. Focused tests include missing/.. input refusal with no installation, physical/trimmed decoys and unchanged source files; the existing suite retains Git behavior, invalid-source diagnostics, hardlinks, metadata, no-force and policy controls. Wrong installed-source count changes2 to0 while successful ordinary installation remains1.
- **Focused tests:** `pnpm test src/skills/lifecycle/source-install.test.ts src/skills/lifecycle/source-install-paths.test.ts --maxWorkers=1`:31 PASS in250.104s wall, including compiler-worker preparation and existing installer/Git fixtures. Final semantic types, typed lint, format and staged test/file line ratchets pass. The original426-line suite stays unchanged; the new focused file is bounded and serves the independent source-selection defect. Independent full source review passes through the authorized GPT6.1Sol fallback, with final exact-head evidence/body assessment linked above; official autoreview execution is not claimed.
- **Existing-solutions/sibling preflight:** full exact symbol/title/path and open-account footprint scans found no viable local-source-selection competitor. Native filesystem traversal and existing installer absorb the repair. Git transport, ClawHub, dependency installation, remote workspace lifecycle and plugin install-record parsing are unchanged; no withdrawn proposal is claimed as an accepted merge precedent.
- **Cleanup:** isolated Ubuntu24.04/Node26.12.1 container with network disabled, private HOME/config/state/workspace and synthetic local skill files. Installed fixtures are retained for inspection outside the product branch. No real provider, channel, registry account or production configuration is used.
- **Not tested:** external Git/ClawHub availability, production skill activation, native macOS/Windows, hosted CI or full repository suite. This proves local selection and actual installed files, without claiming a live remote service or broader linked-plugin cutover.

<details><summary>Production / test LOC</summary>

```text
86	0	src/skills/lifecycle/source-install-paths.test.ts
7	5	src/skills/lifecycle/source-install.ts
```

</details>
