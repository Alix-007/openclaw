# Memory deep-probe interruption proof

Product head `493066f11544c2c52c0ddb397912eb409331173b`; BASE `83872e599d5720c0bc97d313283a2bc245046699`.

The identical frozen V3 uses normal built `openclaw.mjs memory status --deep --agent main --json`, actual controlling PTY VINTR and owned-process-group SIGTERM, regular diagnostic files and a compatible loopback HTTP recorder. It checks a real product POST `/v1/embeddings` with synthetic `input:["ping"]`; responses/vectors/credentials are openly synthetic. No provider service is verified.

BASE acknowledges both signals but requires the normal launcher's emergency SIGKILL after 2091.20–2091.98 ms. HEAD naturally exits 130/143 within 256.07 ms and closes HTTP within 27.82 ms. Neither version uses the harness watchdog. HEAD emits zero JSON, fake unavailable result or generic CLI-error banner after ACK. HTTP 200 and 401 remain exit 0/readiness-success and exit 0/readiness-failure respectively: four expected cells per version.

The unchanged separate `status --index` custody collector proves admitted synthetic indexing still publishes one file/one chunk and final status JSON after INT; HEAD exits 130 in 836.14 ms. This control intentionally writes only its isolated synthetic index. Config/corpus bytes remain unchanged; no owned CLI survives before server cleanup.

Tests: final normal focused command passes 111 tests across five files in 154.192 seconds, exit0, with exact final source binding. Prior setup/type/lint/line-cap failures are preserved as history where supplied and never counted as final success. CLI tests were restored to BASE; no prior110/117 reuse claim remains. Final types/lint/format/budget/mock/build gates and independent exact-head review are verified from their recorded receipts, not rerun by this generator.

Diff: production +67/-27, tests +131/-63, net 68 test LF with exact 68 own allocation. No public interface/provider-default/watchdog/index-custody change.

Replay both clean normal qaRuntime builds, fresh output folders, BASE red/HEAD green.

```sh
python3 portable-memory-deep-probe-v3.py --repo CHECKOUT --output FRESH_OUTPUT --node NODE26 --expect-head SHA --expect EXPECTATION
python3 portable-memory-index-custody-control.py --repo CHECKOUT --output FRESH_INDEX_OUTPUT --node NODE26 --expect-head SHA --expect green
```

Frozen collector hashes: {"portable-memory-deep-probe-v3.py": "1298edc6862b2ce2f19b14ed0a8bf92ed8101c9d58ec032a4800677619c96fd8", "portable-memory-index-custody-control.py": "4e4731cf5a0994949bff596a54c43ab26cdc3b222670ef054d2ef7b111655862"}. V1's incorrect alive3s oracle and V2's insufficient output oracle are retained locally; V3 strengthens output silence and is frozen before product changes. Paired original stream hashes are verified before private prefixes are redacted; public MANIFEST binds redacted bytes.

Cleanup: task-owned allowlisted HOME/USERPROFILE/XDG/tmp/config/state/workspace; product dependency reads expected, not an OS sandbox. Real HTTP disconnect and process-group extinction precede recorder retirement. Fixtures remain for inspection.

Not tested: actual OpenAI/Ollama or other external provider availability, authentication or semantic quality; managed local service initialization cancellation; live user memory; Windows/macOS; full repository CI.
