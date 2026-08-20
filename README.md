# PR #121191 exact-head proof

- Exact code head: `90e14acae4af8ee515a6527e4a403ce44912be22`
- Captured at: `2026-08-20T20:47:14Z`
- Harness: repository Control UI Playwright/Vitest E2E with the mock Gateway
- Browser: Chromium, `1280x900`
- Result: `1/1` E2E passed

The mounted Control UI staged a browser annotation before each raw command.

- `/new`: `sessions.create=1`, `chat.abort=0`, `chat.send=0`
- `/stop`: `chat.abort=1`, `sessions.create=0`, `chat.send=0`; visible result `Run status: Interrupted`

The parent-head reproduction ran the same focused unit scenario and failed three command-routing cases (`12/15` passed). The exact head passed all `15/15` cases. Production changed by `+10/-10` versus the parent (`net 0`).

Evidence:

- `new-annotation-staged.png` and `new-command-result.png`
- `new-command.webm`
- `stop-annotation-staged.png` and `stop-command-result.png`
- `stop-command.webm`
- `verdict.json`
- `SHA256SUMS`

Focused E2E command:

```text
node scripts/run-vitest.mjs run --config test/vitest/vitest.ui-e2e.config.ts --configLoader runner ui/src/e2e/annotated-command-routing.proof.e2e.test.ts
```

The proof-only E2E source was removed after capture and is not part of the PR branch.
