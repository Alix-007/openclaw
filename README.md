# PR #129488 exact-head mounted Chromium proof

This credential-free proof records the mounted OpenClaw Control UI scenario from exact PR head `568619d7d831a4aaa352096ece33c27cc448b9a2`.

## Result

| Scenario | Gateway observation | Visible outcome | Result |
| --- | --- | --- | --- |
| Same-URL credentials replace client A with client B while deletion confirmation is open | `secrets.store.delete` requests: `0` | The `SERVICE_URL` row remains and the page shows `The secret was not deleted. Reload the list and try again.` | PASS |
| The original Gateway client reconnects while deletion confirmation is open | `secrets.store.delete` requests: `1` | The `SERVICE_URL` row disappears | PASS |

The full focused file completed `5/5` tests in mounted Chromium. The exact command was:

```text
node scripts/run-vitest.mjs run --config test/vitest/vitest.ui-e2e.config.ts --configLoader runner ui/src/pages/secrets/secrets.e2e.test.ts
```

The scenario and assertions are inspectable in `ui/src/pages/secrets/secrets.e2e.test.ts` at the exact product head above.

## Artifacts

- `client-replacement-delete-rejected.png`: mounted Chromium screenshot after the replacement-client confirmation is rejected. It visibly shows both the retained row and the reload-and-retry non-outcome.
- `verdict.json`: structured exact-head command, browser boundary, request counts, user-visible outcomes, and verdict.
- `vitest-results.json`: Vitest's saved exact-file result (`failed: false`) and duration.
- `SHA256SUMS`: artifact integrity hashes.

## Boundary and redaction

The browser runs the production Control UI and real Gateway client/store lifecycle against the repository's deterministic mocked Gateway WebSocket boundary. It does not claim a live external Gateway service. The run uses no credentials, user data, private identifiers, external network service, or agent transcript. The visible `SERVICE_URL` and `https://service.test` values are fixed test fixtures.
