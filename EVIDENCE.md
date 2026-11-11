# Nodes inventory read cancellation evidence

Product HEAD `3a52fcc1cc1e07b96986b9224922f202250a3174`; acceptance-red BASE `83872e599d5720c0bc97d313283a2bc245046699`. Both use clean normal builds; HEAD cliStartup build passes in 268.128 seconds.

Normal built `openclaw.mjs nodes status/list/pending/describe --timeout 30000 --json` runs with a controlling PTY, actual VINTR Ctrl-C or owned-process-group SIGTERM, regular-file diagnostics, isolated HOME/config/state/workspace/tmp and a standard-protocol-compatible loopback WebSocket recorder. The recorder proves native CLI request/result/connection lifecycle; it is not a real Gateway or paired node and does not prove storage/provider effects.

The unchanged frozen V3 covers nine read stages: status connect and RPC; list pairing, optional live enrichment and filtered live read; pending pairing; describe lookup, final RPC and exact older-method resolver fallback. Each has one normal control plus SIGINT/SIGTERM. BASE acknowledges all 18 signals but needs the normal launcher's emergency SIGKILL after 2054.90–2078.74ms. HEAD naturally exits 130/143 in 98.79–159.68ms; the actual held connection closes in 28.99–41.96ms. Both remain quiet after ACK except for PTY echo, terminal restoration, and the existing cleanup notice: no result/error/cancellation JSON or failure banner. The quiet policy follows https://github.com/openclaw/openclaw/pull/197110#issuecomment-6790934424.

Ten ordinary controls retain their JSON and exit 0. Two interrupted remove controls retain the exact admitted receipt, including interruption during preparatory node.list, and HEAD exits 130 in 697.10/672.68ms. Thus 30/30 expected outcomes pass on each side. All raw terminal/diagnostic hashes, decoded content, peer event JSON, held connection IDs, request sequences, config bytes and empty peer stderr are checked before packaging. No watchdog fires; EOF drains and owned CLI groups/connections settle before recorder cleanup. Fixtures remain inspectable. No real service/account or provider is used.

Focused normal command: 133 tests across nine files, exit 0, 19.876s. Types/lint/format/test-line ratchet/line-cap/changed-source mock audit/build receipts pass and actual log hashes match. Earlier focused/types/lint/format receipts retain their original pre-allocation source digest; all six reviewed source/test files match final HEAD, and the later staged diff adds only the exact 109 LF allocation. Independent final adversarial fallback review PASS has no verified P0–P3 findings; it is not an official helper review. Existing mock factories/ledger stay unchanged; the full repository mock guard is CI scope.

Actual diff: production +91/-40, tests +109/-0(net 109 LF), dedicated allocation 109. Four existing production owners implement explicit read signals and quiet settlement. Mutation/preparatory reads, approval scope discovery, node.invoke/media/push, SDK/Canvas and exec-approvals defaults retain response custody. There is no lightweight nodes route bypassing registration. No new flags/config/protocol/default policy.

```sh
python3 nodes-read-cancel-proof-v3.py CHECKOUT FRESH_OUTPUT NODE26 EXPECTATION
```

Use fresh outputs, clean normal cliStartup BASE/HEAD builds and red/green expectations respectively. Collector `4b8c1597ef9e12bab3cce820e325781e03097b168ad483d169a3b08eaef96ea9`; peer `14f3c888cb8f5bbb19246e532ec5192c29d6788fd531023eed09d1f3d9bfc0b3`. Collector bytes remain exact, including their openly synthetic fixture token. Other evidence redacts task paths and that token after validating original bytes; MANIFEST binds the published redacted bytes, not the original raw hashes. V1/V2 remain locally retained; V3 tightens the quiet-output oracle before production edits while preserving all 30 scenario inputs, transport, held-connection correlation and custody assertions.

Not tested: real Gateway storage effects, real paired nodes or provider behavior, external services, Windows/macOS and broad repository CI.
