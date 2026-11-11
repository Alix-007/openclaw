# Diffs PNG fitting proof

Product head: `b9e9171c69e6bcae81183c3607a37b8380b7a200`. Acceptance-red base: `83872e599d5720c0bc97d313283a2bc245046699`.

One normal built Gateway per version executes the public HTTP `/tools/invoke` diffs tool with real Google Chrome152.0.7977.64. Four fixed scenarios use the same collector, requests and observation bounds. No browser, viewport, rendering, or tool implementation is substituted.

| Scenario | BASE | HEAD |
| --- | --- | --- |
| Two-line diff, scale4 | PNG4000x1280, scale4 | Identical decoded pixels and scale |
| Forty-line diff, scale1 | PNG1000x2246, scale1 | Identical decoded pixels and scale |
| Same forty-line diff, requested scale4 | HTTP500; owned Gateway log: image-size limit | HTTP200; actual PNG1880x4222,7,937,360pixels; reported DPR1.8799999952316284 |
| Two-hundred-line diff, scale1 | Refused at hard pixel limit | Still refused at hard pixel limit |

All four expected outcomes pass: BASE31.695s, HEAD36.572s. Every successful file is read from the tool-returned artifact path, byte-count/hash checked, copied, and fully PNG decoded with standard-library CRC/decompression/scanline reconstruction. This verifies actual pixels and metadata rather than a mocked viewport or a file's extension. Root visually inspected the original40-line scale1 control and final40-line auto-fitted PNG; all40 deletions and40 additions remain visible and legible.

`base-same-input-scale1.png` is explicitly the legal lower-scale control, not a successful BASE scale4 image: that request fails and creates no image. `head-same-input-auto-scale4.png` is the repaired result for the exact failing request. Raw public HTTP response data and corresponding Gateway failure log deltas are in the paired receipts/logs.

Replay on clean, normally built checkouts using the unchanged collector (SHA-256 `0c07886b31ef3fcd934ac1619dacf5dded48657776b5680d4fede424e93c1660`):

```
python3 collect.py --repo CHECKOUT --output NEW_OUTPUT --node NODE26 --expect-head FULL_SHA --expect EXPECTATION
```

Use BASE SHA and `red`, then HEAD SHA and `green`. Existing `/usr/bin/google-chrome` is required; no browser/package installation occurs. A short owned TMP path is used for Chromium Unix sockets. Child environment is explicitly allowlisted with isolated HOME/XDG/config/state; this is not an OS sandbox.

Focused owner suite:17 passed,69.998s command wall time. Targeted types, lint, format, exact+2LF staged test-line allocation, changed-source mock inspection, normal cliStartup build and independent review pass. Existing module factory/ledger unchanged; full repository mock gate is deferred to CI. Original format-wrapper invocation incorrectly targeted a shell shim with Node; retained diagnostic is corrected by the canonical package-bin wrapper, with no source changes.

Cleanup: only the collector-owned Gateway process group is stopped and verified absent. Only exact returned task-generated artifact directories are retired after preserved copies match hashes. Fixtures and receipts are retained; unrelated artifacts remain untouched. No real sessions, provider/model calls or external channels are used. Not tested: Windows/macOS, other Chromium versions, native PDF rendering or the full repository CI matrix. PDF regression controls pass in the focused suite; no PDF policy is changed.
