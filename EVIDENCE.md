# Plugin Control UI JSON5: actual CLI evidence

Product HEAD `769d226cc6dc5304c92f12850077660f0fa042d2`;
BASE `08ae8c62b83ede02db3a8d2bc3ce36206008d253`.
Ubuntu24.04 / GLIBC2.39 / Node26.12.1; isolated HOME/config/state, network disabled.

On each clean checkout run the normal QA build:
`node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`.
Then run `python3 collector.py CHECKOUT FRESH_OUTPUT NODE26/bin/node MODE`, with
`red` on BASE and `green` on HEAD. The collector requires the matching clean
normal build stamp and is byte-identical across both runs.

BASE: four UI-bearing JSON5 operations fail: built CLI `plugins build --check`,
`plugins validate --json`, `plugins build`, and the direct
`node --import scripts/tsx.mjs scripts/build-plugin-control-ui.mts PACKAGE`.
The same tool-only JSON5 operations and ordinary strict-JSON seeds pass: five controls.
HEAD: all nine operations pass. Check/validate/direct-browser-build preserve both
authored metadata files byte-for-byte. Normal build retains `proofMetadata`.
The actual generated JavaScript contains the fixture marker; its bytes, digest
and immutable manifest entry are attached. OpenClaw compilation and tests are
supporting checks; actual CLI output and artifact bytes are the behavior proof.

`BASE.json` and `HEAD.json` retain commands, stdout/stderr, exit status, input
hashes and readbacks. Complete streams are also separate text files. Local paths
become `$TASK`, `$NODE26`, `$CAMPAIGN`, or `$LOCAL`; the hash index binds original
local bytes to public sanitized bytes.

All 32 current owner tests and scoped checks pass. The broader 69-test suite
passed before removal of an unused settings-only hunk; core/test bytes are
unchanged. Earlier existing-install-test cold-compiler timeouts remain in the
local task records; no assertion or timeout was relaxed.

External native-plugin authoring and the direct browser asset command are
covered together. The collector's `bundled-script` label names that direct
command. It does not run monorepo inventory/copy or `--prepare-settings`; those
repository-owned paths retain strict JSON. No rendered UI, installation/activation,
model/channel, live external service, native Windows/macOS or full-suite claim.
No options, defaults, dependencies, schema/protocol, permissions or persisted
format changes. Fixtures are synthetic and retained; production state was untouched.
