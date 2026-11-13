# Real built CLI evidence

Product HEAD: `ea5b3cd85995b5f8edc2840db023f611715860ff`
Acceptance BASE: `eb1a592fc06233963cb8b70ad998f271b8e2da81`
Canonical owner: `formatGatewayChannelsStatusLines`: both partial warnings and structured diagnostic channel/account/message/fix values. Account row formatting already has its own terminal sanitizer. JSON serialization bypasses this human formatter.

## Reproduce

Use Node26.12.1 with frozen lockfile dependencies on a compatible Linux runtime. The captured run used the existing Ubuntu24.04/GLIBC2.39 image `sha256:6b5f77cec2874613e85a77520f2f8f114ccdb76e2c858e552fff2def1e8f8f9e`, with network disabled, isolated task directories, a read-only container root and no production environment.

On each clean revision, run the normal QA build: `node --import ./scripts/tsx.mjs scripts/build-all.mts qaRuntime`. Then run the identical collector and its two adjacent fixture/proxy files:

`python3 channel-report-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 EXPECTATION channels`

CHECKOUT is the clean normally built revision, FRESH_OUTPUT a new writable directory, NODE26 the absolute node executable, and EXPECTATION red for BASE or green for HEAD. The collector validates the build stamp, HEAD and clean inputs, requires a PTY and permission to launch owned subprocess groups/local WebSockets, and captures raw terminal stdout, stderr and actual RPC events. Its three file hashes must match between BASE and HEAD.

## Actual entry and recorder

A normal local public-API plugin registers two synthetic channels using registerChannel/config/status hooks. The diagnostic channel throws an ordinary Error from buildChannelSummary and returns real status issues from collectStatusIssues. The control channel returns ordinary valid status. The actual Gateway invokes these hooks and serves channels.status; the transparent proxy forwards and records the genuine response without replacing or holding it. No outbound adapter is registered.

The normal built channels status --probe --channel COMMAND commands run in controlling PTYs, in human and JSON modes. BASE human diagnostics contain actual clear-screen/color/OSC control sequences, line breaks, tabs and bidi control. Exact HEAD removes terminal/format controls and renders data newlines, carriage returns and tabs as visible literals, while preserving renderer-owned layout. JSON on both revisions must decode to exactly the recorded actual Gateway payload and retain original diagnostic values.

Four cases per revision: hostile human report, hostile JSON report, and ordinary human/JSON reports. Every command exits0. Ordinary reports remain non-partial with no diagnostic issues. JSON is compared with the real recorded Gateway response, not a hand-written expected substitute.

## BASE observations

| Scenario | Exit | Raw terminal controls present |
| --- | --- | --- |
| unsafe-human | 0 | True |
| unsafe-json | 0 | JSON preserved / normal control |
| normal-human | 0 | JSON preserved / normal control |
| normal-json | 0 | JSON preserved / normal control |

## Exact HEAD observations

| Scenario | Exit | Raw terminal controls present |
| --- | --- | --- |
| unsafe-human | 0 | False |
| unsafe-json | 0 | JSON preserved / normal control |
| normal-human | 0 | JSON preserved / normal control |
| normal-json | 0 | JSON preserved / normal control |

## Readback and cleanup

Receipts include per-case stdout/stderr hashes, recorded actual RPC payloads and process ownership. Streams contain the actual terminal/stderr readbacks and Gateway/fixture/proxy logs. Original raw bytes are hash-checked before replacing private absolute directory labels in published artifacts; collector files are unchanged. Synthetic fixture credentials are not production credentials; auth handshake payloads, keys, SQLite databases and configuration files are not published. Configuration bytes stay unchanged. No collector watchdog fires or owned CLI/Gateway/proxy process survives natural cleanup. No existing user channel/model/configuration is accessed.

Independent review uses the explicitly authorized GPT-6.1 Sol adversarial fallback, not the unavailable official autoreview CLI.

## Limits

Local synthetic plugin diagnostics only; no real channel message, provider request, GUI/browser or remote-service claim. Config-only fallback errors and arbitrary event-loop payloads are outside this bounded diagnostic owner. Separate PR193575 owns UTF-16 truncation; this patch does not copy or claim that repair.
