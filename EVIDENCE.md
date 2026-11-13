# Real built CLI evidence

Product HEAD: `66ca45e8885a2d7a7d2b2bc498ee8f4720ceece8`
Acceptance BASE: `eb1a592fc06233963cb8b70ad998f271b8e2da81`
Canonical owner: `loadSkillsStatusReport`, `runSkillsAction` and the info missing-skill exit; existing Gateway abort owner. Install/update refresh and verification keep their existing paths.

## Reproduce

Use Node26.12.1 with frozen lockfile dependencies on a compatible Linux runtime. The captured run used the existing Ubuntu24.04/GLIBC2.39 image `sha256:6b5f77cec2874613e85a77520f2f8f114ccdb76e2c858e552fff2def1e8f8f9e`, with network disabled, isolated task directories, a read-only container root and no production environment.

On each clean revision, run the normal QA build: `node --import ./scripts/tsx.mjs scripts/build-all.mts qaRuntime`. Then run the identical collector and its two adjacent fixture/proxy files:

`python3 skills-read-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 EXPECTATION skills`

CHECKOUT is the clean normally built revision, FRESH_OUTPUT a new writable directory, NODE26 the absolute node executable, and EXPECTATION red for BASE or green for HEAD. The collector validates the build stamp, HEAD and clean inputs, requires a PTY and permission to launch owned subprocess groups/local WebSockets, and captures raw terminal stdout, stderr and actual RPC events. Its three file hashes must match between BASE and HEAD.

## Actual entry and recorder

A normal workspace SKILL.md is discovered by the actual Gateway skills.status owner. No skill is executed. A transparent local proxy forwards the genuine handshake/request and withholds the successful real Gateway response only for interruption cases; the recorder correlates each held connection before the signal is delivered.

The normal built skills list --json, info proof-skill and check --json commands run in controlling PTYs. BASE fails quiet/prompt cancellation; list is terminated by SIGTERM after the first interrupt, while info/check eventually exit143/130 with late timeout diagnostics. Exact HEAD must naturally exit130/143, show only the normal interruption notice, and close the correlated held read socket within1500ms. No collector watchdog may fire. This is an acceptance bound, not a universal performance guarantee.

Five controls on both revisions: list JSON, named human info and check JSON read the actual discovered proof-skill and exit0; missing skill and wrong-token authentication exit1.

## BASE observations

| Scenario | Exit | Interrupt→exit ms | Held connection close ms | Quiet |
| --- | --- | --- | --- | --- |
| list-json-int | -15 | 1029.98 | 790.89 | False |
| info-human-term | 143 | 1846.43 | 1457.48 | False |
| check-json-int | 130 | 1801.37 | 1426.99 | False |
| list-control | 0 | None | None | False |
| info-control | 0 | None | None | False |
| check-control | 0 | None | None | False |
| missing-control | 1 | None | None | False |
| error-control | 1 | None | None | False |

## Exact HEAD observations

| Scenario | Exit | Interrupt→exit ms | Held connection close ms | Quiet |
| --- | --- | --- | --- | --- |
| list-json-int | 130 | 89.41 | 9.65 | True |
| info-human-term | 143 | 88.97 | 5.31 | True |
| check-json-int | 130 | 88.86 | 5.05 | True |
| list-control | 0 | None | None | False |
| info-control | 0 | None | None | False |
| check-control | 0 | None | None | False |
| missing-control | 1 | None | None | False |
| error-control | 1 | None | None | False |

## Readback and cleanup

Receipts include per-case stdout/stderr hashes, recorded actual RPC payloads and process ownership. Streams contain the actual terminal/stderr readbacks and Gateway/fixture/proxy logs. Original raw bytes are hash-checked before replacing private absolute directory labels in published artifacts; collector files are unchanged. Synthetic fixture credentials are not production credentials; auth handshake payloads, keys, SQLite databases and configuration files are not published. Configuration bytes stay unchanged. No collector watchdog fires or owned CLI/Gateway/proxy process survives natural cleanup. No existing user channel/model/configuration is accessed.

Independent review uses the explicitly authorized GPT-6.1 Sol adversarial fallback, not the unavailable official autoreview CLI.

## Limits

No skill execution, ClawHub request, installation/update/verification cancellation, external Gateway, Windows/macOS or production-load claim. The real response is deliberately held to exercise the in-flight read boundary.
