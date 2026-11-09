# Plugin settings: canonically equivalent searches

Product head: `290a653c200e91627a7abe6b81138e63642a962a`. BASE: `be82aeb77bbc08661080049650679dc602d8d197`. OpenClaw version in both clean normal UI build stamps: `2026.11.1`.

A plugin can supply a legal Unicode group title or parent label. Searching for visually identical NFC/NFD text currently hides those settings. The plugin editor also searches localized permission labels through a second fallback that has the same problem. This complete-owner fix normalizes only the comparison copies in both fallbacks; the existing generic leaf matcher remains unchanged.

## Real entry, recorder and readback

The byte-identical [collector](scout-plugin-unicode-proof.mjs) starts the official built-UI server at `dist/control-ui`, launches real Linux Chrome, opens `/settings/plugins/unicode-settings-proof?view=settings`, fills the actual search input and reads the visible production DOM row identities. The official synthetic Gateway supplies plugin metadata/config.schema responses and records read/write requests. Authored groups pass the canonical normalizer; the response passes the public config.schema validator. Product filtering and DOM rendering are not mocked.

| Same 29-cell matrix | BASE | HEAD |
| --- | --- | --- |
| Canonically equivalent authored group / ancestor searches, NFC↔NFD | 6 hidden-result failures | 6 pass |
| Real German permission label, NFC→NFD query | 1 hidden-result failure | 1 pass |
| Same-form, existing leaf matcher, ASCII trim/case, section, different-accent and fullwidth controls | 22 pass | 22 pass |
| Config/plugin write requests; browser errors | 0; 0 | 0; 0 |

Three scenes are NFD/en-US, NFC/en-US and NFC/de. Clearing the query restores all original labels/row identities; query text and source metadata remain byte-identical. The German control uses the actual built-in label `Gesprächskontext lesen`. Different accents and compatibility-only fullwidth text remain nonmatches: this is NFC, not accent folding or NFKC.

- [Complete BASE receipt](base-receipt.json), collected 2026-11-09 13:28:58–13:29:12 UTC.
- [Complete HEAD receipt](head-receipt.json), collected 2026-11-09 14:05:56–14:06:06 UTC; wrapper wall time 12.140s.
- [Checks, commands, source hashes and independent review](checks-summary.json).
- [Before](before.png) / [after](after.png): the exact same NFD authored group and NFC query; original screenshots, not mockups or edited images. Both images were opened and visually inspected during packet preparation.

## Reproduce

Use two separate clean checkouts at the refs above, each with its own frozen physical dependencies. The actual environment used Node 26.12.1, pnpm 12.15.0 and `/usr/bin/google-chrome`. Set `NODE26`, `PNPM_JS`, `CHECKOUT`, `PROOF_ROOT` and the corresponding `EXPECTED_HEAD`; `PROOF_ROOT` contains the unchanged collector. Use a fresh output directory per run. Prepare each checkout using the normal supported commands:

```sh
cd "$CHECKOUT"
export PATH="${NODE26%/*}:$TOOLBIN:/usr/local/bin:/usr/bin:/bin"
"$NODE26" "$PNPM_JS" install --frozen-lockfile --package-import-method=copy
"$NODE26" --import ./scripts/tsx.mjs scripts/bundled-plugin-assets.mts --phase build --plugin clawrouter --plugin knowledge --plugin mcp-relay --plugin workboard --plugin x
"$NODE26" --import ./scripts/tsx.mjs scripts/bundled-plugin-assets.mts --phase copy --plugin clawrouter --plugin knowledge --plugin mcp-relay --plugin workboard --plugin x
"$NODE26" --import ./scripts/tsx.mjs scripts/copy-bundled-plugin-metadata.mts
"$NODE26" scripts/ui.js build
"$NODE26" --import "$CHECKOUT/scripts/tsx.mjs" "$PROOF_ROOT/scout-plugin-unicode-proof.mjs" "$CHECKOUT" "$PROOF_ROOT/replay-$EXPECTED_HEAD" "$EXPECTED_HEAD"
```

`TOOLBIN` is the directory providing the qualified pnpm executable for the official UI wrapper. There is no artifact copy between checkouts, fake build stamp, Vite-source proof, source bypass or live service change. The collector asserts a clean tracked checkout, exact commit/build stamp and served index/entry hashes, then retains all cell observations. It exits 0 for either a valid all-RED baseline or all-GREEN candidate; the receipt status and actual cells determine the verdict.

The unchanged collector SHA256 is `a923f8ba4e06b7fff62b12fc899aee67742280b79c0af4199206f73199921de4`. HEAD normal UI build passed in 116.509s; BASE in 119.814s. Normal build emitted CSS/boot-JS budget advisories, retained in checks-summary; build success does not mean aggregate performance budgets or PR CI passed. No advisory attribution is claimed.

## Scope, checks and limits

Production +4/-2 in one editor; existing browser tests +66/-1, net 65 LF, with an exact own 65-LF allocation. Focused owner+handler tests:22/22 in 32.981s (official browser setup plus both complete files); ordinary typed lint 63.923s, scoped semantic UI types 131.518s, formatting and staged test-line ratchet passed. The review was an independent user-authorized agent fallback with matching source hashes, not an official autoreview-helper run. These existing checks were reused, not rerun to assemble this packet.

This proves normal built UI filtering with a real browser and schema-valid synthetic metadata. It does not prove a real plugin installation, live Gateway/provider, channel, model call, macOS/Windows/WebKit, upgrade, full repository suite or upstream CI. There is no config/protocol/schema/security/default or migration change, no metadata rewrite and no new settings capability.

Every owned browser context and built-UI server was closed. Test locale/storage are isolated per browser context; only local synthetic fixtures were used. There were no config/plugin write RPCs and no changes to real services, channels, models or plugin installations. The evidence files remain available for inspection.

## Public bytes and hashes

Receipts retain every original field/value; neither contained private filesystem paths or credentials. Only a publication annotation identifying the original receipt hash was appended. Existing `sourceJsonSha256`, source/build/index/entry/collector hashes identify the original measured bytes, not the annotated JSON file. The public upload manifest independently hashes the actual public files. Check-command paths alone use `$CHECKOUT`, `$NODE26`, `$PNPM_JS` and `$PROOF_ROOT` role placeholders. The collector and both PNGs preserve their original bytes. The local uploader spec is excluded from the public inventory.
