# Template local authoring: physical path identity

Product HEAD `2aa417588232321d79b4c10e481907b445e1a55d`; BASE `08ae8c62b83ede02db3a8d2bc3ce36206008d253`.
Isolated Ubuntu24.04 / GLIBC2.39 / Node26.12.1, private HOME/config/state,
network disabled; no model/channel/agent activation or production state.

On each clean checkout use the normal QA build:
`node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`.
Then run `python3 collector.py CHECKOUT FRESH_OUTPUT NODE26/bin/node MODE`,
with `red` on BASE and `green` on HEAD. The byte-identical collector SHA256 is
`42c5cebf7757f395944161011354a5981efdd5c4d17f33fa6d0339e86a961479`.
It verifies the normal build stamp matches the clean committed product HEAD.

The same fixture uses selected -> physical/nested and distinct valid physical
and decoy Templates. BASE validate/inspect/build select the wrong valid decoy;
create and build --out write to the wrong directory. HEAD fixes all five
observations. Seven controls remain: two real CLI-created seeds, ordinary
validate/inspect/build, final create-directory symlink refusal, and final
artifact dangling-symlink refusal. All twelve HEAD operations pass. Read-only
source bytes are unchanged, and refusal controls retain the links without
writing their targets.

Readbacks include actual CLI JSON, created package.json/CLAW.md hashes and
independently unpacked tar package.json, actual destination, and archive SHA256.
The BASE/HEAD selected source archives are attached as base64 text: decode
with `base64 --decode base-selected-archive.tgz.base64.txt > base.tgz`
(or the corresponding head file) and inspect `package/package.json`.
The BASE archive names decoy-template; HEAD names physical-template. Byte
hashes bind each attachment to its receipt's archiveReadback.sha256.
`BASE.json`, `HEAD.json`, complete output streams and the unchanged collector
are included. Paths are sanitized to task/tool placeholders; the hash index
binds original local bytes and public sanitized bytes.

One initial new golden-digest regression incorrectly targeted a nonexistent
fixture child. Independent review caught it before commit/publication. It now
uses the existing references/ directory; the corrected row fails on BASE for
the intended project-selection reason, and the complete focused HEAD suite
passes. Earlier failure receipts/logs remain in the local task record. Assertions,
timeouts and existing golden digests were not weakened. The expected exit1 of
corrected-source-parent-red is a BASE regression demonstration, not a failing
HEAD check. Scoped checks and fresh independent exact-head review are included.

The complete local authoring I/O boundary is fixed together through the existing
fs-safe physical-prefix owner. Missing suffix components remain uncollapsed,
logical default identities are retained, existing create/output final-symlink
refusal and exclusive writes remain. No new option/default/configuration,
dependency, permission, protocol/schema, artifact format or migration.
No native Windows/macOS, external package installation, real Template activation,
full repository test suite or hosted-CI result is claimed. Synthetic fixtures
remain for inspection; command child processes have exited.
