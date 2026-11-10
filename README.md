# Sherpa runtime/model directory path proof

Product head: `b7b0870632bff32b6577d8c5c214a1a40b81341b`

Baseline: `baccc7e152916c7f4a48596b5cb544c12264ac54`

The documented bundled Node wrapper invokes the actual official Linux x64 offline Sherpa v1.13.8 binary with its Piper lessac-high model, and generated WAV bytes are independently read back as PCM. These are real native synthesis results; the small product regression uses a separate shell argument recorder and is not the audio proof.

| Scene | BASE | Product head |
|---|---|---|
| Literal runtime directory, CLI flag | specific missing-binary failure, exit 1 | valid PCM WAV, exit 0 |
| Literal runtime directory, environment | specific missing-binary failure, exit 1 | valid PCM WAV, exit 0 |
| Literal model directory, CLI flag | specific missing-resource failure, exit 1 | valid PCM WAV, exit 0 |
| Literal model directory, environment | specific missing-resource failure, exit 1 | valid PCM WAV, exit 0 |
| Ordinary flags, ordinary environment, output filename with a space | 3 valid PCM WAV controls | 3 valid PCM WAV controls |

[Baseline receipt](base-receipt.json), [product-head receipt](head-receipt.json), [baseline stdout/stderr](base-streams.txt), [head stdout/stderr](head-streams.txt), [measured checks](checks-summary.json), [replay and resources](REPLAY.md), [frozen collector](sherpa-native-path-proof.py). All seven product-head WAVs plus one baseline control are included here. Every original captured stream and WAV hash was read back before publication.

Public text replaces only private filesystem prefixes with `$CHECKOUT`, `$NODE26`, and `$PROOF_ROOT`. Embedded raw capture hashes refer to the original local bytes; [MANIFEST.json](MANIFEST.json) records independent public-file hashes. WAV bytes are unchanged. No tokens, personal text or production configuration are used.

Scope: only the wrapper-owned runtime/model directory selectors. Explicit model/token/data filename selectors are passed to Sherpa, whose native parser independently trims those parameter values; their existing behavior is preserved and support for trailing-whitespace native filename selectors is not claimed. No perception/audio-quality, Windows/macOS, cloud-provider or channel-delivery validation is claimed. The earlier wider candidate failed six native-selector scenes and was narrowed before publication; REPLAY.md explains that boundary.

Cleanup: owned resource entries restored; resource lock released; synthetic proof files retained here. No production service/configuration/session was used or changed.

Accounting update: the final allocation grants only49 own test LF; no old main debt is credited. [CI context](CI-CONTEXT.md) explains the canonical integration check and [source equivalence](SOURCE-EQUIVALENCE.json) binds reused static checks to unchanged production/test blobs. The native receipt and every HEAD WAV were freshly collected after this allocation-only commit.
