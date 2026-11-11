# Exact-head native evidence

Product head: `55a85add8f781458f054a661a52043616cef8d69`. Acceptance-red base: `83872e599d5720c0bc97d313283a2bc245046699`.

- **Actual CLI / PTY / WebSocket:** the frozen collector runs the normally built CLI with its normal launcher/respawn policy. A compatible synthetic loopback peer holds connect or `device.pair.list`; Ctrl-C is sent through the controlling PTY, and SIGTERM to the owned process group. All **11/11 expected outcomes** pass on each version.
- **Acceptance red → green:** six held read/preview cases acknowledge interruption on BASE, then require the CLI's own emergency SIGKILL after **2047.09–2054.92 ms**; the harness watchdog never fires. HEAD naturally exits **130/143**, at most **158.87 ms** after interruption, with peer closure at most **49.05 ms**, no late successful list/preview JSON, and no surviving owned process before cleanup. HEAD emits the normal cancellation JSON, rather than a success payload.
- **Legal controls:** ordinary lists exit 0 with exact empty-list JSON; approval preview exits its documented 1 with the selected request and sends no approval RPC. An ordinary remove returns its receipt; an already-admitted remove interrupted before the peer releases its delayed response still prints that receipt exactly once and exits 130. No real Gateway state mutation is claimed.
- **Checks:** `node scripts/run-vitest.mjs src/cli/devices-cli.test.ts src/cli/devices-cli.gateway.test.ts --maxWorkers=1`: **69 passed**, **54.286 seconds** command wall time. Targeted types, lint, format, staged test-line budget, changed-source mock inspection, normal CLI build and fresh independent adversarial review pass; findings: **None**. The 69 tests include the existing Gateway integration surface and cancellation/fallback/mutation-custody controls. Canonical worker preparation and CLI fixture startup account for the command exceeding 30 seconds; no test timeout was increased.

Four files: production **+36/-19**, tests **+51/-0** (net **51 LF**) and an exact own-regression allocation. The existing private device RPC wrapper moves to a small sibling to keep the oversized runtime within its line-count growth ratchet; its existing timeout/scope/transport policy is preserved. The complete device CLI decision surface was inspected: list, implicit/latest preview, local fallback, explicit approval/admin retry, clear, token rotation/revocation, remove, reject and rename. Only read-only public list/preview acquires cancellation; mutation receipt custody stays unchanged. Existing mock factories and their ledger are unchanged; full repository mock checking is left to CI.

Replay using the frozen collector on tracked-clean normally built BASE/HEAD checkouts:

```sh
python3 devices-read-cancel-proof-v3.py CHECKOUT NEW_OUTPUT NODE26 EXPECTATION
```

The entry, fixtures and controls are identical; only checkout/version and red/green expectation change. Both normal build stamps bind the exact full commit and clean source inputs. See the receipts for raw outputs, statuses, events and independent readbacks. Private filesystem prefixes and task-only synthetic credentials in output are redacted; frozen collectors retain their unchanged, openly synthetic fixture constants.

The collector waits for the owned CLI process group to be empty and observes peer disconnect before stopping its task-owned protocol peer. Config bytes are checked unchanged. It uses allowlisted child environments and isolated HOME/config/state/workspace; no real provider, model, channel, device or user data is used. Fixtures remain inspectable.

**Not tested:** real Gateway device storage/authentication/mutation effects, real devices, Windows/macOS, external channels/providers, and the full repository CI matrix.
