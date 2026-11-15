Related: #186475

## What Problem This Solves

`agents set-identity` can import the identity from a neighboring directory, or update the wrong automatically selected agent, when a source path contains a directory symlink followed by `..`.

## User Impact

Explicit identity files and workspace sources follow filesystem traversal before importing. The configured workspace and unrelated agent identities stay unchanged. Successful source paths in JSON/human reports can now use the physical path actually read; configured workspace declarations keep their original values.

## Why This Change Was Made

Resolve source identity with the existing fs-safe prefix resolver before any lexical path normalization. Use the same physical identity when matching an implicit agent, without changing the configuration workspace resolver, identity reader, or guarded config writer. Ordinary missing leaves retain their existing diagnostics; parent traversal through a missing or non-directory component cannot silently select a neighboring file.

This is one complete command-owner repair covering both source flags and implicit selection. It does not change bootstrap/workspace-RPC symlink policy, add options/configuration/defaults, or change a protocol, schema, permission, dependency, or stored format.

## Evidence

**Product head:** `225a74cfcd502243c9d2b77ec27bf1756ca89b69`. **BASE:** `c0166c395cf81095f431808c9496cb6022ad4387`.
[Immutable paired receipts, actual output/config readbacks, frozen collector and independent review](./MANIFEST.json).

| Same normally built CLI scenario | BASE | HEAD |
| --- | --- | --- |
| File/workspace source through symlink + parent, absolute/relative/home forms (6) | Imports wrong neighboring identity | Imports selected physical identity |
| Workspace source with implicit agent (1) | Selects and changes neighboring agent | Changes intended agent only |
| Missing/non-directory intermediate followed by parent (4) | Imports wrong neighbor | Refuses before writing config |
| Ordinary and ordinary-symlink source controls (4) | Pass | Pass |
| Blank/missing source controls (4), explicit-name locator without import (1) | Pass | Pass |

- **Production entry:** `openclaw.mjs agents set-identity [--agent main] --identity-file <path>` or `--workspace <path> --from-identity --json`, through the real command/source resolver, bounded worker-backed identity reader and guarded config writer. No product owner is mocked.
- **Exact collector command:** `python3 identity-source-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, `base`/`head` respectively. Same frozen collector SHA256 `36a667ed31b2a387eb51fb51b9f16d3945a6c5332df847c229fb4e5a709acdfc`; both commits have clean normal `cliStartup` build stamps. Current build: exit 0, 231.973 s.
- **Recorder/readback:** real exit/stdout/stderr and an independent read of the actual config after every CLI invocation, plus unchanged selected/decoy identity files. Wrong-neighbor imports change **11 to 0**. The four invalid-traversal cases change config on BASE and leave it byte-identical on HEAD (**4 to 0** unwanted writes); seven valid regression cases and four ordinary/alias controls demonstrate real successful writes. All stored workspace values and unrelated agent identities remain unchanged. Nine controls pass on both commits.
- **Focused tests:** `pnpm test src/commands/agents.identity.test.ts src/commands/agents.identity.persistence.test.ts --maxWorkers=1`: **29 PASS**, exit 0, 171.137 s wall (existing worker compilation/import graph dominates; no added sleeps/timers). The five new command regressions fail for the intended reasons with BASE production. Existing persistence, UTF-8/size, blank/missing, no-import and report controls remain. These test results are retained across the independently verified syntax-only final lint correction; its source equivalence receipt is included in the artifact. Targeted semantic types, genuine typed lint, format, staged test-line and file-line gates pass.
- **Review/siblings:** author simplification/test-value audit and independent GPT6.1Sol source/proof/body review PASS; this is the explicitly authorized fallback, not an official autoreview-tool result. #186475 is accepted precedent for the same command's literal source selection, rather than a substitute for this different normalization defect. Current-main owner/contract blobs and all-state semantic/file-footprint scans were checked; no viable competing repair was found. The existing config resolution and shared identity-file policies remain authoritative.
- **Cleanup and limitations:** isolated Ubuntu 24.04/Node 26.12.1, task-owned HOME/config/state, network disabled, no production services, model calls or external channels. **Not tested:** native macOS/Windows, a release upgrade, the full repository suite or hosted CI. The test temp root is canonicalized for ordinary host temp aliases; symlink-dependent cases are POSIX scoped.

<details>
<summary>Change size</summary>

```text
26	6	src/commands/agents.commands.identity.ts
60	1	src/commands/agents.identity.test.ts
```

No new test-line allocation is needed. No generated changelog, proof assets or temporary fixtures are committed to the product branch.
</details>
