# Actual built CLI cancellation evidence

Product HEAD: `3477ef2c5a7fd1fb1df3598c218733a17a0fbec0`
Acceptance BASE: `0633f256350b5580a5bdbcd8a6a5782750de03d4`
Owner: src/cli/hooks-cli.ts: private loadHooksReport covers default/list/check and info. Enable/disable keep direct withHooksReport and config mutation ownership. Real Gateway hooks.status resolves a normal workspace HOOK.md, alongside bundled hook metadata.

## Reproduce

Use Node26.12.1 and the repository's frozen lockfile dependencies on a compatible Linux runtime (the captured run used Ubuntu24.04/GLIBC2.39). On each revision, install frozen offline dependencies and run the normal QA build: `node --import ./scripts/tsx.mjs scripts/build-all.mts qaRuntime`. Then run:

`python3 cli-read-proof-v2.py CHECKOUT FRESH_OUTPUT NODE26 EXPECTATION hooks`

The three accompanying collector files must remain adjacent. CHECKOUT is a clean, normally built BASE or product HEAD; FRESH_OUTPUT is a new writable evidence directory; NODE26 is the absolute node executable; EXPECTATION is `red` for BASE or `green` for HEAD. The collector validates the build stamp/HEAD and identical source hashes. It requires a PTY and permissions to launch owned subprocess groups and local WebSockets. The captured task used an existing qualified isolated Docker image, no network, no production environment.

## Real boundary and readback

The normal launcher `node openclaw.mjs` runs in a controlling PTY. A normal real isolated Gateway serves the relevant RPC. A transparent proxy forwards the genuine challenge/connect handshake and request, then withholds the successful real Gateway response for the selected read. Only after the actual response has been observed and correlated does the collector deliver terminal Ctrl-C (SIGINT) or SIGTERM. It records the exact held connection's closure, natural CLI exit, terminal stdout, regular stderr and process-group ownership before harness cleanup. Auth handshake payloads are not published. Synthetic credentials are fixture-only, not production credentials.

Both revisions also run normal human/JSON and ordinary error controls. Tools reads a canonical persisted public tool score; hooks reads normal workspace hook metadata. No real user channel, external provider or model call is made. The fixture configuration bytes must remain unchanged. Collector watchdogs must never fire and all owned CLI/Gateway/proxy process groups must be empty after normal cleanup.

## BASE observations

| Scenario | Exit | Interrupt→exit ms | Interrupt→held socket close ms | Quiet after notice |
| --- | --- | --- | --- | --- |
| list-json-int | 130 | 1793.21 | 1386.81 | False |
| info-human-term | 143 | 1901.41 | 1436.77 | False |
| check-json-int | 130 | 1822.36 | 1432.01 | False |
| list-control | 0 | None | None | False |
| info-control | 0 | None | None | False |
| check-control | 0 | None | None | False |
| missing-control | 1 | None | None | False |
| error-control | 1 | None | None | False |

## Exact HEAD observations

| Scenario | Exit | Interrupt→exit ms | Interrupt→held socket close ms | Quiet after notice |
| --- | --- | --- | --- | --- |
| list-json-int | 130 | 85.95 | 9.0 | True |
| info-human-term | 143 | 91.82 | 5.5 | True |
| check-json-int | 130 | 78.19 | 4.88 | True |
| list-control | 0 | None | None | False |
| info-control | 0 | None | None | False |
| check-control | 0 | None | None | False |
| missing-control | 1 | None | None | False |
| error-control | 1 | None | None | False |

BASE tools reaching launcher emergency SIGKILL is a failure. BASE hooks exiting with130/143 after the RPC timeout and error banner is also a failure. HEAD must exit130/143 quietly and close the held read connection within1500ms. This threshold is an acceptance bound, not a timing promise for all environments.

## Artifacts and cleanup

The BASE/HEAD receipts contain full case observations and actual RPC recorder events. The streams files include terminal stdout, stderr, fixture and real Gateway/proxy logs. Native-readback records original hashes checked before replacing private absolute directory labels; collector bytes remain unchanged. The isolated synthetic state remains locally available for incident reproduction, but private keys, SQLite databases and auth configuration are not uploaded. There are no surviving owned processes and configuration is unchanged.

## Limits

This exercises an actual local Gateway and a successful RPC response deliberately held before CLI readback. It proves cancellation of an in-flight read, not a hung external hook, external tool implementation, remote service latency, mutation settlement, Windows/macOS behavior or production load. Normal/failure controls and the existing mutation-focused unit controls cover their stated paths only. Independent review is the explicitly authorized GPT-6.1 Sol fallback, not the unavailable official autoreview CLI.
