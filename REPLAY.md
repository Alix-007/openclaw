# Sherpa native directory-path proof (v3)

This collector exercises the bundled direct Node wrapper, the official offline
Sherpa engine and an actual Piper model, then independently reads generated WAV
PCM. It uses synthetic text and isolated output, not a cloud provider or channel.
No OpenClaw compilation or product configuration is required for this direct
skill entry. The final contract covers only the two directory selectors the
wrapper itself uses: `--runtime-dir` and `--model-dir`, and their environment
equivalents. Both are tested as one complete wrapper-owned directory fix.

## Explicit downstream limitation and preserved failed attempt

The earlier v2 collector tested all five resource selectors. BASE had ten path
failures and three successful controls. After the first attempted five-selector
fix at `94aec113ef5cc2d8afa26d69c11c3a038fd96f51`, the actual native HEAD replay
returned **MISMATCH / FAIL**: runtime/model directory scenes succeeded, while all
six explicit model-file/tokens-file/data-dir scenes still failed. Their command
records preserve the trailing space in the native argument, but the actual
engine's missing-path diagnostic names the trimmed value. Sherpa's own native
option parsing therefore remains a second, independent limit for those fields.

That failed experiment is retained in full under
`native-sherpa/head-committed/receipt.json`; its original thirteen-scene collector
is preserved as `historic-74731.py` (SHA-256
`74731f3974ec8c43df5c5865e85f742cb79413a71e8456602e561e53b16ce7a7`). The initial
v2 BASE receipt and source/logs also remain unchanged. None of those six failed
scenes is relabeled PASS or described as fixed.

The final product scope restores the existing behavior for the three native
forwarded overrides. It changes only the wrapper's own runtime/model directory
lookup; generated model child paths keep the directory's literal space inside
the complete path and are accepted by the real engine. No temporary alias,
model edit, upstream native change or new path-normalization contract is added.
The final v3 proof below checks only those two independently fixable selectors;
it does not claim that all filesystem override parameters support a trailing
space. Ordinary explicit overrides remain a focused product regression control,
not an added native v3 acceptance claim.

## Resources

Use a local, non-production directory. These Linux x64 resources are the versions
documented by the current bundled skill. Download with normal TLS verification;
do not disable certificate verification.

```sh
RESOURCE_ROOT="$TASK_ROOT/native-sherpa"
mkdir -p "$RESOURCE_ROOT/runtime" "$RESOURCE_ROOT/model"
curl --fail --location \
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2' \
  --output "$RESOURCE_ROOT/sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2"
curl --fail --location \
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-high.tar.bz2' \
  --output "$RESOURCE_ROOT/vits-piper-en_US-lessac-high.tar.bz2"
```

Verify both complete SHA-256 digests before extraction:

| Archive | Bytes | SHA-256 |
|---|---:|---|
| `sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2` | 28,156,791 | `c0bdb7907d3a74bba1d55d22bf4d9fa75586cf1530614ebe88a27b9118e015c4` |
| `vits-piper-en_US-lessac-high.tar.bz2` | 115,545,841 | `8619d204c7005866fe4f420181dfa79622af6a6222389f0b0818d2af31e0db0e` |

```sh
tar -xjf "$RESOURCE_ROOT/sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2" \
  -C "$RESOURCE_ROOT/runtime"
tar -xjf "$RESOURCE_ROOT/vits-piper-en_US-lessac-high.tar.bz2" \
  -C "$RESOURCE_ROOT/model"
```

The collector rechecks both archive digests before executing anything. Keep
archives and extracted resources for the matched BASE/HEAD runs. Do not run two
collectors against the same resource directory: the scenes temporarily rename
real resource entries. An exclusive local lock also rejects concurrent use.

## Run from an actual clean worktree

Set `CHECKOUT` to the actual Git worktree, `NODE26` to the Node executable and
`TASK_ROOT` to the directory containing this collector and its resources. Node
26.12.1 and Python 3 were used for the recorded Linux run. There are no Python
package dependencies.

```sh
python3 "$TASK_ROOT/sherpa-native-path-proof.py" \
  --checkout "$CHECKOUT" --node "$NODE26" --expect red \
  --resources "$TASK_ROOT/native-sherpa" \
  --output "$TASK_ROOT/fresh-base-proof"
```

For the committed fix, use the identical frozen collector and resources with
`--expect green` and a fresh output directory. `--checkout`, `--node`, `--expect`
and `--output` are required; there is no private machine-path fallback.

The collector records actual HEAD/tree and checks all tracked files are clean.
It independently compares the wrapper, skill guidance and root package bytes
with their HEAD blobs. It checks the same binding again after execution. It
does not label arbitrary dirty source as an exact committed head. Untracked
files are explicitly outside the tracked-clean assertion.

The normal product entry is:

```sh
"$NODE26" "$CHECKOUT/skills/sherpa-onnx-tts/bin/sherpa-onnx-tts" \
  --runtime-dir "$RUNTIME" --model-dir "$MODEL" \
  --output "$PROOF_ROOT/output.wav" 'OpenClaw path proof.'
```

## Strict verdict

Seven scenes are required: ordinary flag and environment controls, an output
filename with a space, and two trailing-space directory selectors each through
flags and environment. Every padded input must exist, and its trimmed neighbor
must be absent.

- Expected RED requires all three controls to generate valid nonzero PCM WAVs
  and all four directory scenes to exit 1, generate no WAV and show the specific
  wrapper/native missing-path diagnostic. A generic exception, unsupported
  runtime, timeout or failed ordinary control is not accepted as the bug.
- Expected GREEN requires all seven scenes to exit 0 and generate valid
  nonzero PCM WAVs.
- The command exits 0 only when the full observed matrix matches `--expect`.
  `verdict: PASS` on an expected RED means the failing baseline was reproduced;
  it does not mean the product is fixed.

Receipts preserve commands, selected synthetic resource environment fields,
exit codes, timings, raw stdout/stderr hashes and WAV/PCM readback. Setup errors
and incomplete matrices remain failures. Logs and WAVs remain in the requested
output directory. Temporary resource renames are restored and the lock removed
in `finally` blocks; no product or production state is edited.

## Limits

This checks offline synthesis and wrapper-owned directory-path preservation on Linux x64. It does
not assess perceived voice quality, macOS/Windows, cloud providers, channel
delivery or a live operator's configuration. The initial Git-blob-materialized
scouting run is historical; the portable collector requires a real worktree and
binds the actual run head. Published redacted receipts must disclose path
substitution; hashes inside raw receipts refer to their original captured bytes.
