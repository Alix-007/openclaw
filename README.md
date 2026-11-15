# Identity source selection: actual CLI proof

Read EVIDENCE.md for the behavior summary. BASE/HEAD.json contain real stdout/stderr and native CLI exits; BASE/HEAD-readbacks.json contain exact persisted config texts and identity-source bytes. Both sides ran the same frozen20case collector through normal built openclaw.mjs, without product mocks.

Run `python3 check-identity-source-evidence.py .` to independently verify both20case outputs/config/source readbacks. Reproduce with `python3 identity-source-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 base` or `head` after a clean normal cliStartup build. Use task-owned empty output directories and Linux Node26. The collector needs only Python3, Node and the prepared checkout, not external services or credentials. The recorded runner uses a network-disabled Ubuntu24.04 container; Mac/Windows are not claimed.

Private local prefixes are rendered as <TASK>, <NODE26>, <CAMPAIGN> or <HOME>. Original recorder SHA256 fields remain original raw-byte hashes; publicStdoutSHA256/publicStderrSHA256 bind the inspectable rendered streams. raw-hash-readback.json identifies original raw files; MANIFEST.json hashes all published bytes. The negative config claims check equal original hashes and equal actual config text. No source/name/config values or outcomes were otherwise changed.

Focused29PASS preceded a syntax-only consistent-return correction. The unchanged test file and exact source equivalence are independently reviewed in identity-source-focused-equivalence.json and source-review; corrected typed lint/types and the clean committed-head normal build/20case behavior run cover the final225a74cf head. Official autoreview did not run; the explicitly authorized independent model fallback reviewed source, evidence and body.
