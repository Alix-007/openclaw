# Local image physical-path identity: shipped CLI

BASE 5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78; clean normally built HEAD 24a6dc57e42146d6e3adc8d4d58d1754f6722bef. Unchanged collector SHA256 a82934ade6162533194359649678c15ccd183db40f0d61ca4786a13641de88f6.

The filesystem fixture has a directory symlink followed by literal /../ traversal. The OS resolves the intended image; lexical path.resolve reaches a different existing decoy. All native commands exit0 on both revisions, so the recorder compares the actual bytes consumed, not merely successful exit.

The same seven real CLI cases run on both revisions: model run, image describe and image edit ordinary physical-path controls, then symlink-parent paths for model run, image describe, image describe-many and image edit. BASE four symlink cases consume the decoy bytes; HEAD all four consume the intended bytes. Three ordinary controls retain correct bytes. All receipts include real CLI stdout/stderr and recorder boundaries.

image describe/describe-many use the actual local executable image backend and disk-read byte recording. image edit uses the bundled OpenAI adapter's real HTTP multipart upload and independently reads its generated PNG output. model run uses the bundled completion provider with real loopback HTTP/SSE and decodes recorded image content. These are synthetic local model endpoints, not a live external AI compatibility claim. The existing QA-only local-image-provider opt-in is used for loopback; no product policy or default is changed.

Normal build: `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`.
Replay: `python3 collector.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26/bin/node" base` and `head` respectively. Receipts verify clean tracked source and matching normal build stamps. No test/import runner substitutes for the CLI entry.

All fixture config/HOME/state/temp paths are isolated; local server and direct CLI children joined. No external channel, credentials, model account or production state used. Private workspace/tool roots are replaced by $PROOF_ROOT/$NODE26; collector unchanged. Native Windows/macOS, network URL image behavior and real external providers are not proven here.
