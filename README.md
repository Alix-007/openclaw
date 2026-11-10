# Pending health-read interruption proof

Product head `f5066a64003f67489e862003d647fbf7dc41bf9c`; baseline `baccc7e152916c7f4a48596b5cb544c12264ac54`.

The frozen collector launches normal `openclaw.mjs health --json` and `openclaw.mjs gateway health --json`, with stdin/stdout attached to a real controlling PTY and stderr redirected to a regular diagnostic file. It sends actual terminal VINTR (Ctrl-C); it does not inject a signal into an imported owner or disable the normal launcher. The source checkout was built with its normal cliStartup profile on the clean commit.

An explicit compatible synthetic loopback WebSocket Gateway peer records the production client's challenge/connect/health messages. It can hold the connect or health response until six seconds, or immediately answer the uninterrupted controls. This is a real production CLI/client/socket boundary; it is not a claim to have run a real Gateway service or hosted channel/provider.

| Scenes | BASE | Product head |
|---|---|---|
| Root health: interrupt while connect or health RPC held | accepted Ctrl-C, proxy SIGKILL -9 after about2.03s | exit130 promptly, peer connection closes before fixture cleanup |
| Gateway health: same two held phases | same delayed forced termination | exit130 promptly, peer closes before cleanup |
| Root and gateway uninterrupted controls | exit0, health JSON marker | exit0, health JSON marker |

See complete `base-receipt.json`, `head-receipt.json`, `base-streams.txt`, `head-streams.txt`, and `checks-summary.json`. Each of the four product-head cancellation cells must exit130 within1.5s, acknowledge SIGINT, close the recorded peer within1.5s before harness cleanup, emit no successful health JSON after cancellation, avoid the collector watchdog, and preserve the isolated config. The two positive controls must return actual successful health JSON. BASE must reproduce delayed -9 termination with no held response released.

## Replay

Use Python3 and Node26.12.1, install the checkout's frozen pnpm lockfile, and run `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup` normally on the clean target commit. Keep both collector and peer beside each other. Set CHECKOUT to the target checkout, NEW_OUTPUT to a fresh isolated directory, NODE26 to the Node executable, and EXPECT to red for baseline or green for the product head:

```sh
python3 health-cancel-proof.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26" "$EXPECT"
```

The peer token is a fixed synthetic fixture string with no real account authority. Public capture text replaces only private filesystem prefixes with $CHECKOUT/$PROOF_ROOT/$NODE26; embedded raw hashes retain their original-capture meaning. MANIFEST.json independently hashes all public bytes.

The full focused run covers222 tests in8 existing suites, including four CLI registrations, readiness/auth cancellation, late successful output and nonhealth mutation receipts; after mechanical fixture/type corrections the two changed suites pass81 tests. Test wall times and SDK/compiled-worker setup costs are retained, including the failed cold attempt and one bounded replay; no case timeout was increased.

Limits: native scenarios are route-first JSON. Full Commander text presentation and auth-secondary live-peer cancellation are covered by focused owner tests, not claimed as native replay. Existing plugin/local-summary operations with no abort seam are not made newly interruptible; their late success presentation is suppressed. No real service lifecycle, provider/channel, upgrade migration, Windows/macOS, perceptual UI behavior or hosted CI verification is claimed.

Cleanup: all owned CLI/peer processes and threads exited, peer sockets settled, isolated synthetic config unchanged. No production service/configuration/session/channel was read or changed; test artifacts remain here.

Final allocation is206 own test LF, without duplicate inherited-main credit. [CI context](CI-CONTEXT.md) records the canonical integration check; [source equivalence](SOURCE-EQUIVALENCE.json) binds retained code checks. All final HEAD PTY/socket captures and the normal build are fresh.
