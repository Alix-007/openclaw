Independent adversarial fallback review (not official autoreview)

Verdict: PASS. No actionable P0–P3 findings.

Exact clean HEAD: 145768c9eb2eafe882f5377d8c0ef8bd1f4e3828
Base: c324818cbf86074f34578d07f381b0d2835955a1
Tree: a1ce7d84437cf42d8e734121c1c18485f549820a
Full-index diff SHA256: 58935a03e11567c54c31131830fda4aa0c4e6198d3b51f5117fc1693744c38d6

All four committed file hashes equal reviewed source pins, including83LFallocation. Audit-only root-signal/process-scope bridge and private formatter guards preserve configure/apply/reload/store defaults, writer receipts and global resolver policy. No source changes since independent owner/callers/test-audit/simplification review.

Normal qaRuntime build passes exact clean HEAD in263.278s. Unchanged frozen5-cell native proof and separate checker pass: SIGINT exits130 in0.580s; SIGTERM exits143 in0.547s. One provider request then recorded SIGTERM; direct provider absent at CLI exit, no watchdog or collector cleanup needed. Controls retain success0, provider-error2 and skipped-exec0 with no provider request. All raw terminal/config/provider hashes and observed event arrays independently checked.

Actual merged PTY interrupt output contains root cleanup notice, optional^C and terminal reset sequences, with no audit result/failure payload. Frozen checker excludes selected late document strings; it does not enforce arbitrary-byte silence. Direct-provider cleanup does not prove arbitrary descendants.

Final existing checks verified without rerun:75tests/3files246.273s, targeted typecheck135.2s, typed lint-v2 final56.553s, format/mocks/test-line-ratchet/linecap/diff all pass. Earlier lint setup failure remains separate and is not counted as passing. Source inputs match committed blobs.

Limits: JSON/Linux/synthetic local provider native coverage; human late output and admitted apply reporting use source/unit coverage. No real credential/external-provider/network, Windows, broad CI or full release build claim. Early scan/preparation awaits are not all cancellation-aware; added units were not separately replayed against BASE production, while native BASE reproduces the defect.
