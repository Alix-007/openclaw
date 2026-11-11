# Channels status Ctrl+C proof

Product head `b19cbda9c01278b35058792153f160b028d2ea25`; BASE `13329595bed6e1f032f124620ca51b1ce13aa6c9`. Both use a normal clean `cliStartup` build and the same frozen collector.

The actual command is `node openclaw.mjs channels status --probe --timeout 30000 --json 2>diagnostics.log`. stdin/stdout use a controlling PTY; stderr is a regular file. The collector sends actual terminal VINTR (Ctrl+C), with the normal launcher enabled. A compatible synthetic loopback WebSocket peer records the production client's challenge/connect/channels.status messages and connection closure. This exercises the real CLI/client/socket boundary; it does not claim a real Gateway service or hosted channel.

| Scenario | BASE | Product head |
| --- | --- | --- |
| Ctrl+C while connect or channels.status response is held | SIGINT accepted, then startup proxy force-kills the command with -9 after about 2.03s | exit130, prompt peer closure before fixture cleanup, no late JSON |
| Two uninterrupted controls | exit0 and expected status marker | exit0 and same expected status marker |

Each HEAD interruption must acknowledge SIGINT, exit130 in under1.5s, close the peer in under1.5s before fixture cleanup, emit no late status or fallback JSON, preserve the exact canonical SIGINT error envelope, avoid the collector watchdog, and leave isolated configuration bytes unchanged. The two positive controls must publish successful status JSON. BASE must reproduce delayed forced termination before the held response is released.

Read `base-receipt.json`, `head-receipt.json`, and both `*-streams.txt` files for exact observed times, stdout, stderr and peer events. `checks-summary.json` records14 focused tests, types/lint, the passing canonical ratchet, normal build and cold compiler attempts. The original42LF allocation is removed: coherent owner-suite consolidation retains all original assertions plus unique late-fallback coverage, net minus5 testLF against BASE. The shared scalar is unchanged; the canonical non-pruning guard passes because this PR reduces test lines. Global inherited overage is still explicitly recorded, not claimed universally repaired.

## Replay

Use Python3, Node26.12.1 and frozen pnpm12.15.0 dependencies. On a clean checkout of each SHA run `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`. Keep both collector files together; use a fresh output directory:

```sh
python3 channels-cancel-proof-v2.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26" "$EXPECT"
```

EXPECT is `red` for BASE and `green` for HEAD. All credentials and configuration in this recipe are synthetic fixtures with no real account authority. The capture text replaces private filesystem prefixes with `$CHECKOUT`, `$PROOF_ROOT` and `$NODE26`; embedded raw hashes retain their original-capture meaning. `MANIFEST.json` independently hashes all public bytes.

Limits: native scenarios use the fast JSON CLI route on Linux. Commander text presentation, real services/channels/providers, Windows/macOS, upgrade behavior and full repository CI are not claimed. Local config/secret/plugin awaits with no abort seam retain their own execution; final status publication is guarded after they return. No write-RPC cancellation policy, config/default, protocol/schema, security permission or migration changes are introduced.

Cleanup: owned CLI/peer processes and threads exited, sockets settled, isolated synthetic config remained unchanged. No production service, configuration, channel or session was modified.
