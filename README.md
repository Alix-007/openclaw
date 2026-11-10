# Update installation ownership: literal Git root proof

Product head `1229a520832151fc75bb564282eee55b49ad0d47`; baseline `baccc7e152916c7f4a48596b5cb544c12264ac54`.

The same frozen Python collector runs the normally built `openclaw.mjs --profile update-git-root-proof update status --json --timeout 3`, with isolated HOME/config/state and an unused local Gateway port. No source-mode entry, fake Git, copied distribution, update/install or service mutation is used.

| Physical checkout path | BASE | Product head |
|---|---|---|
| Ordinary directory (control) | git; actual BASE SHA | git; actual product SHA |
| Directory ending in one literal SPACE | package; Git identity absent | git; actual product SHA |

The baseline classification failure also changed default registry lookup from dev to latest; the fix restores Git-derived classification/channel selection. External registry availability is not the acceptance claim. The native raw Git top-level bytes equal the physical pathname plus exactly one LF, including the legal final space.

Inspect the four `*-receipt.json` files and complete `*-stdout.txt` / `*-stderr.txt`. The product-space readback settles in9.866s; BASE-space in8.803s. The ordinary controls also run through the real CLI. `checks-summary.json` records 27 existing-suite checks, scoped types, canonical typed lint, format, exact staged test-line ratchet and normal head build. The focused wrapper took170.272s including133.272s canonical compiled-worker preparation; this is reported as measured, not hidden as a fast unit test.

## Replay

Use Node26.12.1 and the target checkout's frozen pnpm lockfile. Run its normal `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup` build on a clean commit. Set CHECKOUT to the actual physical directory (not a symlink alias), NODE26 to the Node executable, NEW_OUTPUT to a new isolated output directory, and EXPECT to red for a clean baseline whose physical directory ends in SPACE, green for the fixed commit under the same physical name, or control for an ordinary name.

```sh
python3 update-git-root-proof.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26" "$EXPECT"
```

Collector SHA256 `5e6f2aec86cef3f5d57f90ca77b7923b96811c1acc53753b10fadddd4c5852f9`. The collector checks clean tracked state, real HEAD/build stamp, five owner/caller source hashes, actual Git bytes, stdout/stderr hashes and unchanged synthetic configuration. Its output must match the requested expected red/green/control result. Ordinary control captures use the same task-owned worktree normally moved to an ordinary pathname; no product source or built distribution is borrowed from another checkout.

Public text replaces only private filesystem prefixes with $CHECKOUT_SPACE/$CHECKOUT_CONTROL/$PROOF_ROOT/$NODE26. Embedded raw hashes retain their original local-capture meaning; MANIFEST.json separately hashes every public file.

Limits: default public npm diagnostics and isolated closed Gateway probes are retained, including timeouts/ECONNREFUSED; they are not claimed to be successful real providers/channels. No actual update completion, upgrade migration, production Gateway, macOS/Windows execution or hosted CI is claimed. Git for Windows source uses binary stdout and puts LF; that is source evidence, not a Windows live run. The existing real-Git test table additionally covers TAB/LF/CR names on POSIX while preserving ordinary Windows coverage and alias/nested-package controls.

Cleanup: each owned CLI process exited; synthetic configuration remained unchanged. Only this task's worktree pathname moved; fixtures are retained, production configuration/channels/services untouched.
