## What Problem This Solves

`skills library create`, `update` and local `import` can save the wrong bundle. With `selected -> physical/nested`, the supplied `selected/../bundle` names `physical/bundle`; lexical normalization instead reads a different, valid neighbouring bundle. This can publish unwanted instructions and supporting files while reporting success.

## User Impact

The library receives the directory or single file the operator selected. The shared local-input owner covers all three write commands together. Final-entry symlinks remain refused; permitted ancestor links, hardlinks, executable metadata, strict UTF-8, binary encoding and size/count limits retain their existing checks. ZIP uploads retain their existing path.

## Why This Change Was Made

Resolve the input parent through native filesystem traversal, retain the final entry for `lstat` and regular-file admission, and append that entry without collapsing final `.`/`..`. Resolving the whole input would incorrectly follow final symlinks; retaining the existing reader keeps that policy intact.

No new option, default, dependency, privilege, config, protocol, schema or stored-library format. No activation or migration behavior changes. Full source preflight found no viable overlapping implementation; the local-source installer and library Gateway input owner are separate operations.

## Evidence

**Product head:** `6482e869dc2ce6372cc048c387ba89634ce72b78`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Paired actual output, collector, independent readbacks and review](./MANIFEST.json).

| Actual scenario through normal CLI and real Gateway | BASE | HEAD |
| --- | --- | --- |
| Create selected directory | Saves decoy instructions and binary companion | Saves intended physical instructions and bytes |
| Create selected single file | Saves decoy instructions | Saves intended file; no companion files |
| Import selected directory / update existing revision | Both save decoy bundle | Both save intended bundle |
| Ordinary create followed by independent read | Intended bundle | Same intended bundle |

- **Production entry + exact command:** `python3 skill-library-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, using `red` on BASE and `green` on HEAD with the same frozen collector SHA256 `235a9f39e01a11753750b4894e420b1cd15148e4ae1395246bd1deb8d0dfba09`. It executes normally built `openclaw.mjs skills library create`, `import`, `update` and a separate `read` after each save. Clean matching-head `cliStartup` build exits 0 in285.116s.
- **Canonical owner and real readback:** actual shared `readLibraryInput` -> real Gateway RPC -> library store/revision -> independent `skills library read`. Ten real commands cover five save/read pairs. Exact instruction text, revision identity and decoded binary companion bytes are independently checked; source is never replaced with a mock. BASE's four selected saves contain the wrong valid bundle; all five HEAD readbacks pass.
- **Legal controls:** ordinary create/read succeeds on both revisions. Selected single-file readback has no extra file set. Focused regressions retain final-symlink refusal, actual `file/.` and `file/..` refusal before any RPC, hardlinks, file modes, content limits, encoding checks and the existing ZIP branch. No live activation is performed.
- **Focused tests:** `pnpm test src/cli/skills-library-input.test.ts src/cli/skills-library-cli.test.ts --maxWorkers=1`:24 PASS in13.642s wall. The only later test edit removes an unused destructured binding; no assertion, fixture or runtime behavior changed. Final semantic types, typed lint, format and staged test/file line ratchets pass. Final independent source review passes through the authorized GPT6.1Sol route; official autoreview execution is not claimed.
- **Cleanup:** isolated Ubuntu24.04/Node26.12.1, private HOME/config/workspace/state and a real loopback Gateway in a network-disabled container. Gateway exits0; no external provider, production channel/config or live user's data is touched. Evidence and fixtures stay outside the product branch.
- **Not tested:** native macOS/Windows, hosted CI, full repository suite, remote paired-node workspaces, activation and external services. The local loopback store proof does not claim those behaviors.

<details><summary>Production / test LOC</summary>

```text
2	1	src/cli/skills-library-cli.ts
30	2	src/cli/skills-library-input.test.ts
```

</details>
