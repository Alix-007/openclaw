# PR #121144 exact-head Discord proof

This credential-free proof exercises the production Discord send and permission-diagnostic path against a synthetic Discord REST boundary, while a repository mock OpenAI provider and a real ephemeral loopback Gateway are running.

## Revisions

- Fixed head: `c78f63969737e009570edc7b281df09a4f0e5969`
- Pre-fix parent: `e4e558df215a009fb24faa4471c4ee8dc7730151`
- Harness SHA-256: `796b887daa2180efc045b440d85ce19407702ef3a39e93abf4a04972b93cb643`
- Fixed-head artifact time: `2026-08-20T22:10:17.756Z`
- Parent artifact time: `2026-08-20T22:18:38.888Z`

## Same-scenario result

| Revision | Result | Production observation |
| --- | --- | --- |
| Pre-fix parent | Expected FAIL | Gateway health passed, the 403/50013 diagnostic did not fetch the parent channel, reported `SendMessages`, and retained the stale thread-send claim. |
| Fixed head | PASS | Gateway health passed, the diagnostic fetched the parent channel, reported only `ViewChannel`, retained `SendMessagesInThreads`, and made no stale `SendMessages` claim. |

Both runs used the same harness bytes. The synthetic Discord REST boundary observed the production `sendMessageDiscord` and `RequestClient` routes. The fixed-head run also passed the committed focused regression test:

`node scripts/run-vitest.mjs extensions/discord/src/send.sends-basic-channel-messages.test.ts -t "reports thread send permission hints"`

Result: 1 passed, 75 skipped.

## Artifacts

- `verdict.json`, `observation.json`, `trace.jsonl`: fixed-head result.
- `parent-red-verdict.json`, `parent-red-observation.json`, `parent-red-trace.jsonl`: pre-fix result.
- `pr121144-discord-thread-permission-proof.e2e.test.ts`: exact harness source.
- `SHA256SUMS`: integrity hashes.

## Boundary and limitation

No real Discord credentials, real Discord IDs, user message contents, local ports, or local runtime paths are present. The token string in the harness is a fixed synthetic non-secret accepted only by the local synthetic REST client. This proves the production code path at a controlled Discord-compatible REST boundary; it does not claim a live send to Discord's service.
