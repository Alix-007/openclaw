# PR #129481: real CLI subprocess and logger proof

This immutable proof was produced from product commit
`3167c4e6d9f3dc3aa7b0faf923f337a3c051803d`, the exact head of PR #129481.
The product branch was not changed.

## Result

- PASS: production `runCliAgent` executed the normal CLI process and exhausted-recovery path.
- PASS: a real temporary Node executable wrote an ephemeral synthetic
  `Authorization: Bearer ...` value to stderr, then exited with status 1.
- PASS: the unmocked OpenClaw logger wrote exactly one terminal warning to both its real console
  sink and configured JSONL file sink.
- PASS: the warning contains `provider`, `model`, numeric `durationMs`, and `runId`.
- PASS: the warning preserves the useful `Authorization: Bearer` label while replacing the value
  with `***`.
- PASS: the complete bearer value and the complete private `sessionKey` are absent from both
  published log artifacts.
- PASS: no diagnostic listener was installed before, during, or after the run.

Observed operator-visible warning:

```text
[agent/cli-backend] cli terminal failure: provider=fixture-cli model=fixture-model durationMs=11043 runId=proof-pr129481-terminal error=Authorization: Bearer ***
```

## Execution boundary

- Platform: Linux x64
- Node: `v22.22.3`, matching the repository engine floor
- Entry point: `src/agents/cli-runner.ts#runCliAgent`
- Terminal owner: `src/agents/cli-runner/cli-run-recovery.ts`
- Logger owner: `src/agents/cli-runner/log.ts` through the production logging subsystem
- Backend: the existing backend registry seam points `fixture-cli` to a real temporary Node
  executable; the runner, recovery path, subprocess supervisor, redaction, console sink, and file
  sink are production implementations
- Logger doubles: none; no spy, mock, logger override, console patch, or diagnostic listener

The included `proof-harness.mts` is the exact harness. Run it from the exact product checkout with
ephemeral values supplied through `PROOF_BEARER_SECRET` and `PROOF_SESSION_KEY`; the values are not
retained in these assets. The invocation shape was:

```text
PROOF_OUTPUT_DIR=<temp-output> \
PROOF_PRODUCT_HEAD=3167c4e6d9f3dc3aa7b0faf923f337a3c051803d \
PROOF_BEARER_SECRET=<ephemeral-synthetic-value> \
PROOF_SESSION_KEY=<ephemeral-private-marker> \
node --import tsx ./proof-harness.mts > <temp-output>/raw-console.log 2>&1
```

## Artifacts

- `operator-warning.log`: exact operator-visible console warning.
- `logger-record.jsonl`: exact matching record from the configured real file transport.
- `verdict.json`: machine-readable assertions, environment, input fingerprints, and result.
- `proof-harness.mts`: inspectable one-off production-path harness; no secret values embedded.
- `SHA256SUMS`: checksums for every proof asset except itself.

The input fingerprints in `verdict.json` identify the exact ephemeral values used without
publishing them. The harness asserts those complete values are absent before it emits a passing
verdict.
