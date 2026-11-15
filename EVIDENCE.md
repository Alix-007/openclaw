## What Problem This Solves

`openclaw security audit --deep` keeps its Gateway probe running after an accepted interrupt. With a pending handshake, the command's shutdown watchdog kills it instead of the probe releasing its connection and the CLI exiting normally with 130/143.

## User Impact

Ctrl-C and SIGTERM stop the read-only audit's owned probe promptly and leave no late audit report. An audit with `--fix` keeps its existing mutation and repair receipt behavior. Uninterrupted findings, failed-probe warnings and ordinary errors remain unchanged.

## Why This Change Was Made

Pass the existing command lifetime signal through the audit context to the existing signal-aware `probeGateway` owner. Check cancellation before publishing probe findings and before printing a report. Move the complete audit options type to the existing audit type module to respect the file-line ratchet; this move is type-only.

The repair is limited to the core audit's deep Gateway probe. It adds no public CLI option, config/default, permission, protocol/schema, provider dependency or state migration. It does not change the earlier SecretRef-resolution owner or promise cancellation of arbitrary plugin collectors.

## Evidence

**Product head:** `0ab1567b5c6b7a6f76ce93abde9b1af470407132`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Immutable paired receipts, complete output, frozen collector and independent review](./MANIFEST.json).

| Same actual CLI scenario | BASE | HEAD |
| --- | --- | --- |
| Pending successful Gateway handshake, JSON audit + Ctrl-C | Root watchdog kills CLI with -9, approximately 2052 ms after interrupt | Natural exit 130 in 141 ms; connection closes in 12.51 ms |
| Pending successful Gateway handshake, human audit + SIGTERM | Root watchdog kills CLI with -9, approximately 2052 ms after interrupt | Natural exit 143 in 108.05 ms; connection closes in 9.53 ms |
| Ordinary JSON audit, ordinary human audit, wrong-token diagnostic | Three controls pass | Same three controls pass |

- **Production entry and owner:** normally built `openclaw.mjs security audit --deep [--json]` under a controlling PTY -> actual CLI/audit core -> `probeSecurityAuditGateway` -> real `probeGateway` and real Gateway WebSocket. A transparent proxy holds the actual successful handshake reply; it does not replace the probe or Gateway.
- **Exact command:** `python3 security-probe-proof-v2.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, with `red` on BASE and `green` on HEAD, same frozen collector and `read-proxy.mjs`. Both require a clean normal `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup` build stamp for their exact commit. HEAD build exits 0 in 248.706 s.
- **Recorder/readback:** actual PTY exit/stdout/stderr, held successful backend replies and front-connection close events, post-interrupt bytes, process-group inventory before harness cleanup and config SHA256. Both interrupted HEAD cases have zero surviving command processes and no late report; three normal controls produce the expected audit/failed-auth reports. Gateway and proxy stop with exit 0, no owned survivors, config unchanged. The test driver does not kill the command to obtain GREEN.
- **Focused checks:** `pnpm test src/cli/security-cli.test.ts src/security/audit-probe-failure.test.ts src/security/audit-node-runtime.test.ts --maxWorkers=1`: 23 PASS, exit 0, 211.268 s wall. Most time was cold compilation/worker preparation (the two shards report 192.87 s and 6.12 s), not added sleeps. The tests cover signal forwarding, interruption without a failed finding, ordinary-error propagation and `--fix` receipt retention. Typed lint, semantic types, format, staged test-line and file-line ratchets pass. Final independent source/raw-evidence review: PASS, no findings, through the user-authorized GPT6.1Sol fallback; official autoreview execution is not claimed.
- **Existing solutions/siblings:** reuse `probeGateway` cancellation and settlement; both machine/human output share the CLI boundary. Prior cancellation fixes in other read commands are precedent, not substitutes for this missing signal handoff. Search and current Alix/Leon file footprints found no competing core deep-probe repair. Earlier SecretRef cancellation work is a different stage and is left intact.
- **Cleanup/limitations:** isolated Ubuntu 24.04/GLIBC2.39/Node26.12.1, private HOME/config/SQLite state, loopback-only real Gateway, no external credentials, model requests or production channels. Controls retain this unpaired probe client's existing read-scope warning; successful authenticated health-detail access is not claimed. No full repository suite, native macOS/Windows or hosted-CI result is claimed. No configuration/protocol/schema/security-policy or upgrade behavior changes.

<details><summary>Production / test LOC</summary>

```text
53	0	src/cli/security-cli.test.ts
32	14	src/cli/security-cli.ts
4	0	src/security/audit-gateway-probe.ts
40	1	src/security/audit-probe-failure.test.ts
6	42	src/security/audit.ts
48	0	src/security/audit.types.ts
```

No proof assets or CHANGELOG changes on the product branch.

</details>
