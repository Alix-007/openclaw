Closes #180755. Related: #157466.

## What Problem This Solves

Operators with large model catalogues need a personal shortlist they can curate directly while choosing a model.

## User Impact

User impact: click the inline heart beside a model to add or remove a favourite without selecting the model or closing the picker. Favourites appear first and remain available in their provider groups. The Favourites heading uses the same heart icon; there is no separate Manage favourites editor.

Favourites retain this PR's personal, per-signed-in-profile and per-agent scope, persist across reloads and browsers through existing user preferences, and do not change model availability or selection policy. Shared-agent curation and hiding models remain outside this PR.

## Why This Change Was Made

This updates the existing contribution rather than adding a competing implementation. It retains conditional user-preference writes and canonical model/runtime identities, while separating presentation keys so a favourite can safely appear in multiple groups. Inline hearts have accessible pressed state and do not trigger model selection. Keyboard navigation, large-catalogue virtualization and provider settings remain owned by the picker.

Original implementation by @Alix-007. Inline-heart interaction, duplicate provider listing and consistent heart icons requested by @jacobtomlinson; follow-up implementation by @roboclaw-bot. Original contributor commits and history are preserved.

## Work sessions

- [Original discussion with @jacobtomlinson](https://team.openclaw.ai/chat/roboclaw/~key/dashboard/d25d2e48-8d2b-4c59-96cd-ba9f135d9e58)
- [Implementation and verification](https://team.openclaw.ai/chat/roboclaw/~key/subagent/f197af7f-1348-433b-80d3-640268f0bd3d)

## Evidence

### Inline-heart follow-up — 2026-11-04

Verified source commit: e16cdf230cd9bef98f398d297f563c9b2d289e0b, directly extending original PR head 15d51f72b3ff6a9e814a34ab94a462e9f0d229ec.

- 27 focused favourites/picker/search tests passed, including the heart-heading regression (red with the previous star, green with the heart).
- 18 existing Chromium picker tests passed.
- Eight new real-Chromium focus regressions passed: provider/search hearts, Enter/Space activation, and rejected/CAS-conflict writes. The old implementation demonstrably dropped focus to BODY. The fix moves focus to search before a focused heart becomes disabled during saving, not only for a Favourites-group copy.
- Semantic UI types, Oxlint, stylesheet lint, formatting, diff checks and normal pre-commit hooks passed in secretless isolation. Source/blob integrity was checked when the verified commit was imported into the preserved worktree.
- Independent source review found the keyboard-focus issue above; it was reproduced in Chromium and corrected before publication. Hosted review/CI for this new head are separate from these local results; historical CI below is not current-head evidence.

The images are actual Chromium Control UI captures with a synthetic 300-model, three-provider catalogue, not live user data. Isolated browser fixtures exercise the production picker; authenticated transport and preference responses are controlled test seams. The earlier PR's real preference-worker storage proof is retained below as historical evidence, not claimed as a fresh current-head run. No production-provider, Safari/macOS or live-user-account proof is claimed.

| Before: separate editor | After: inline hearts and matching heading |
| --- | --- |
| ![Before: original PR with Manage favourites](https://github.com/user-attachments/assets/9d3a54a0-7a77-48f5-a0fd-3bfa79e778e7) | ![After: inline model hearts and heart Favourites heading](https://github.com/user-attachments/assets/341472db-2b45-47e6-b970-b4041418b4c4) |

<details>
<summary>Historical original PR description and evidence — original implementation at 15d51f72</summary>

The following description and receipts are preserved verbatim for contributor provenance. References to the separate editor, old test counts, old CI, or the original head describe that earlier implementation, not the current inline-heart follow-up.

Closes #180755. Related: #157466.

## What Problem This Solves

Operators repeatedly searching a large Web model catalog cannot save a personal shortlist for each agent.

## User Impact

Users can save models under **Manage favorites** and select them from a **Favorites** group, with the same shortlist available after reload and in another browser for their authenticated profile. Favoriting does not change the session model or model policy.

## Why This Change Was Made

Reuse the existing picker rows, runtime identity, permission checks and conditional `users.prefs` writes. Membership is personal to the signed-in profile and scoped by agent; unavailable models stay unavailable, and failed writes show an error. Hidden models and shared-agent curation are outside this change.

The original demand is #157466. #180755 records this narrower implementation and was automatically closed as its duplicate; this PR does not close the original request's remaining hidden-model scope.

Ownership for maintainer review: this proposal uses personal profile-and-agent favorites, consistent with the existing `users.prefs` owner. Shared agent curation is a separate outcome under the original request; human acceptance of this bounded ownership remains pending.

## Evidence

### Current head and validation (2026-10-29)

Head: `15d51f72b3ff6a9e814a34ab94a462e9f0d229ec`; clean tree: `2dd11ff8341809094e94d3a9500984b94e038196`; integrated main: `a4e20a8b24440efd9b8a1792ce400be85a697080`. Original contributor commits are retained through an ordinary merge and normal push. The complete feature delta is six files. The merge preserves main's lazy search view and narrowed model-fact projections. The favorites editor is a focused presentation component so the picker stays within the existing 700-line lint limit; no limit or budget is raised. Unit fixtures load the now-lazy panel before exercising its behavior; cold loading is covered through real browser navigation.

- Focused favorites, picker, and search tests: **24/24 passed** through the repository runner, one worker; 22.53 seconds command wall time. UI production typecheck, changed-file type-aware lint/format, canonical i18n verification, and controller guard against the exact pinned main all passed.
- Fresh native UI build, precompressed-asset check, and the repository performance gate against a same-machine, same-environment pinned-main build passed. The standard CI metadata values were identical on both builds. Current-head hosted CI is complete as of 2026-10-29T03:35:00.426Z: all applicable latest checks have completed without failure and the aggregate CI, dependency-review, and security-sensitive-review gates are successful.
- Independent source review of the complete six-file candidate plus preference/cache/search/window owners found no actionable P0–P3 findings. This was a separate reviewer's manual source assessment. The local autoreview helper attempted a full branch review through P2 but its model service returned **401 Unauthorized**; it produced no review report and is not claimed as clean. A fresh hosted review is requested only after evidence and CI are current.
- Source-browser proof passed in Chromium and Linux WebKit 27.2: real picker controls write through the actual production preference worker, and a separate canonical SQLite read verifies persistence. Another browser context and a page reload restore the favorite; unfavoriting removes the key. Gateway transport/authentication remains a controlled fixture.
- With 1,000 authenticated models, closed favorites render zero checkboxes, opening keeps mounted controls bounded, and searching reaches an offscreen model. Moving all models of a provider into Favorites retains its auth/settings heading in virtualized layout. Collapsing/reopening does not write preferences. Favoriting never sends a session-model selection RPC.
- Released-state compatibility uses unmodified published `openclaw@2026.10.6` modules to seed two profiles and existing preferences before the candidate's existing startup migration. All released user preference values and the other profile remain exact. Current main's new-session owner adds exactly `new-session.migration.v1: true` on first authenticated UI use; this named metadata addition is explicitly required by the collector rather than ignoring extra data. The initial strict receipt failed on that addition and was retained locally before source attribution.
- Linux WebKit reports the static viewport capability diagnostic `Viewport argument key "interactive-widget" not recognized and ignored.` on both clean pinned main and this candidate. It is retained separately in browser diagnostics. Runtime errors and all behavior assertions remain strict. No Safari/macOS, production authentication, live provider, installer upgrade, or shared administrator-managed favorites claim is made.

The personal-profile-versus-shared-agent ownership decision remains for maintainers. A positive bot review or green checks do not establish product acceptance.

| Before: clean pinned main, no Favorites operation | After: current clean head |
| --- | --- |
| ![Before: model picker without favorites](https://github.com/user-attachments/assets/18d01ee0-7104-4338-aad9-152d7cca0965) | ![After: saved favorites in the model picker](https://github.com/user-attachments/assets/d7049181-6345-4a33-b05e-fddeaa4cdfbc) |

<details>
<summary>Current browser receipts and independent storage readback</summary>

```json
{
  "baseline": {
    "at": "2026-10-29T02:49:10.005Z",
    "head": "a4e20a8b24440efd9b8a1792ce400be85a697080",
    "result": "PASS",
    "acceptance": "RED: the real chat model picker has models but no favorite operation"
  },
  "chromium": {
    "at": "2026-10-29T03:09:57.975Z",
    "head": "15d51f72b3ff6a9e814a34ab94a462e9f0d229ec",
    "tree": "2dd11ff8341809094e94d3a9500984b94e038196",
    "worktreeStatus": "",
    "result": "PASS",
    "browser": {
      "engine": "Chromium",
      "version": "152.0.7977.64"
    },
    "acceptance": "GREEN: UI favorite committed through the real preference worker, second browser/reload read it back, and unfavorite removed it without selecting a model",
    "controls": {
      "storageSeam": "Real production preference worker write and separate canonical read succeeded",
      "authenticatedCatalogSize": 1000,
      "closedEditorControls": 0,
      "openEditorControls": 8,
      "offscreenModelSearch": true,
      "lastProviderSettingsVisible": true,
      "virtualProviderHeading": {
        "rowIndex": "1",
        "headingBottom": 773.6875,
        "firstModelTop": 775.6875
      },
      "virtualDisclosureNoWrite": true,
      "noModelSelection": true,
      "secondContextReadback": true,
      "reloadAndRemoval": true
    },
    "upgrade": {
      "baseline": "openclaw@2026.10.6",
      "seededBy": "unmodified published npm preference/profile modules in a separate process",
      "entriesBefore": {
        "ui.theme": "claw",
        "ui.themeMode": "light",
        "ui.railShortcuts": [
          "route:usage"
        ],
        "proof.existingPreference": {
          "enabled": true,
          "marker": "created-by-published-stable"
        }
      },
      "otherProfileBefore": {
        "ui.theme": "claw",
        "proof.otherProfile": "untouched"
      },
      "migration": "Existing production prepareStartupClientCredentials owner completed backed-up Doctor maintenance on the private released database before candidate reads",
      "sameProfileAndExistingPreferencesLoaded": true,
      "appliedTheme": {
        "id": "claw",
        "mode": "light"
      },
      "expectedAddedMetadata": {
        "key": "new-session.migration.v1",
        "value": true,
        "owner": "ui/src/pages/new-session/draft-preference-state.ts"
      },
      "entriesAfterFavoriteAndRemoval": {
        "new-session.migration.v1": true,
        "proof.existingPreference": {
          "enabled": true,
          "marker": "created-by-published-stable"
        },
        "ui.railShortcuts": [
          "route:usage"
        ],
        "ui.theme": "claw",
        "ui.themeMode": "light"
      },
      "otherProfileAfter": {
        "proof.otherProfile": "untouched",
        "ui.theme": "claw"
      },
      "result": "PASS: stable-created data retained across candidate UI save, second browser, reload and removal"
    },
    "observations": [
      {
        "write": {
          "entries": {
            "new-session.migration.v1": true
          },
          "expectedEntries": {
            "new-session.migration.v1": null
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": null
          }
        },
        "result": "ok"
      },
      {
        "favoriteKey": "[\"openai/gpt-5-mini\",null]",
        "preferenceKey": "ui.modelFavorites:main",
        "committed": [
          "[\"openai/gpt-5-mini\",null]"
        ]
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]",
              "[\"anthropic/claude-sonnet-4-6\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]",
              "[\"anthropic/claude-sonnet-4-6\",null]"
            ]
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": null
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          }
        },
        "result": "ok"
      }
    ],
    "errors": [],
    "cleanup": "Browser contexts and source server closed; isolated PTY stopped or private preference state removed. No production services, channels, or real user sessions touched.",
    "elapsedMs": 148530
  },
  "webkit": {
    "at": "2026-10-29T03:19:42.894Z",
    "head": "15d51f72b3ff6a9e814a34ab94a462e9f0d229ec",
    "tree": "2dd11ff8341809094e94d3a9500984b94e038196",
    "worktreeStatus": "",
    "result": "PASS",
    "browser": {
      "engine": "Linux WebKit in Ubuntu 24.04 container",
      "version": "27.2"
    },
    "acceptance": "GREEN: UI favorite committed through the real preference worker, second browser/reload read it back, and unfavorite removed it without selecting a model",
    "controls": {
      "storageSeam": "Real production preference worker write and separate canonical read succeeded",
      "authenticatedCatalogSize": 1000,
      "closedEditorControls": 0,
      "openEditorControls": 8,
      "offscreenModelSearch": true,
      "lastProviderSettingsVisible": true,
      "virtualProviderHeading": {
        "rowIndex": "1",
        "headingBottom": 773.6875,
        "firstModelTop": 775.6875
      },
      "virtualDisclosureNoWrite": true,
      "noModelSelection": true,
      "secondContextReadback": true,
      "reloadAndRemoval": true
    },
    "upgrade": {
      "baseline": "openclaw@2026.10.6",
      "seededBy": "unmodified published npm preference/profile modules in a separate process",
      "entriesBefore": {
        "ui.theme": "claw",
        "ui.themeMode": "light",
        "ui.railShortcuts": [
          "route:usage"
        ],
        "proof.existingPreference": {
          "enabled": true,
          "marker": "created-by-published-stable"
        }
      },
      "otherProfileBefore": {
        "ui.theme": "claw",
        "proof.otherProfile": "untouched"
      },
      "migration": "Existing production prepareStartupClientCredentials owner completed backed-up Doctor maintenance on the private released database before candidate reads",
      "sameProfileAndExistingPreferencesLoaded": true,
      "appliedTheme": {
        "id": "claw",
        "mode": "light"
      },
      "expectedAddedMetadata": {
        "key": "new-session.migration.v1",
        "value": true,
        "owner": "ui/src/pages/new-session/draft-preference-state.ts"
      },
      "entriesAfterFavoriteAndRemoval": {
        "new-session.migration.v1": true,
        "proof.existingPreference": {
          "enabled": true,
          "marker": "created-by-published-stable"
        },
        "ui.railShortcuts": [
          "route:usage"
        ],
        "ui.theme": "claw",
        "ui.themeMode": "light"
      },
      "otherProfileAfter": {
        "proof.otherProfile": "untouched",
        "ui.theme": "claw"
      },
      "result": "PASS: stable-created data retained across candidate UI save, second browser, reload and removal"
    },
    "observations": [
      {
        "write": {
          "entries": {
            "new-session.migration.v1": true
          },
          "expectedEntries": {
            "new-session.migration.v1": null
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": null
          }
        },
        "result": "ok"
      },
      {
        "favoriteKey": "[\"openai/gpt-5-mini\",null]",
        "preferenceKey": "ui.modelFavorites:main",
        "committed": [
          "[\"openai/gpt-5-mini\",null]"
        ]
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]",
              "[\"anthropic/claude-sonnet-4-6\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]",
              "[\"anthropic/claude-sonnet-4-6\",null]"
            ]
          }
        },
        "result": "ok"
      },
      {
        "write": {
          "entries": {
            "ui.modelFavorites:main": null
          },
          "expectedEntries": {
            "ui.modelFavorites:main": [
              "[\"openai/gpt-5-mini\",null]"
            ]
          }
        },
        "result": "ok"
      }
    ],
    "browserDiagnostics": [
      {
        "text": "Viewport argument key \"interactive-widget\" not recognized and ignored.",
        "classification": "Static viewport capability warning also reproduced on clean pinned main a4e20a8; no runtime error or behavior assertion waived"
      }
    ],
    "errors": [],
    "cleanup": "Browser contexts and source server closed; isolated PTY stopped or private preference state removed. No production services, channels, or real user sessions touched.",
    "elapsedMs": 86806
  }
}
```

</details>

<details>
<summary>Native performance gate output</summary>

```text
Control UI performance:
  measurement: shipped sidecars with identity fallback; Node v26.12.1
  startup JS: 3 requests, 88.4 KiB gzip (90516 B), 79.9 KiB br, 281931 B raw (limits: 7 requests, 88.6 KiB gzip / 90771 B)
  startup JS gzip vs baseline: 90516 B (baseline 90195 B + growth allowance 512 B = growth limit 90707 B; build-variance allowance 64 B; enforcement limit 90771 B; max committed baseline 325131 B)
  startup CSS: 1 request, 31.8 KiB gzip (32609 B), 28.5 KiB br, 186183 B raw (limits: 1 request, advisory target 46080 B, hard ceiling 51200 B; headroom 18591 B)
  largest ordinary JS: assets/control-ui-boot-shared-DK2-KjdY.js, 532.8 KiB gzip (limit: 557.9 KiB)
  largest CSS: assets/control-ui-boot-shared-styles-DU95FlyG.css, 52072 B gzip (hard ceiling 58315 B; headroom 6243 B)
  all JS: 2488 requests, 12275.6 KiB gzip (12570241 B), 11252.7 KiB br, 37133320 B raw
  all CSS: 115 requests, 301.2 KiB gzip (308444 B), 266.9 KiB br, 1593668 B raw (fixed ceilings: 308526 B gzip, 1597676 B raw)
  route boot accounting: initial-entry assets plus measured immediate dynamic imports; existing initial-entry limits unchanged
  chat boot JS: 20 requests, 1245.2 KiB gzip (1275117 B), 1077.5 KiB br, 4074054 B raw (1184601 B beyond initial-entry JS; limits: 20 requests, 1276669 B gzip)
  chat boot CSS: 3 requests, 123.1 KiB gzip (126018 B), 106.8 KiB br, 773556 B raw (2 beyond initial-entry CSS; limit: 3 requests)
  chat boot JS gzip vs base: 1275239 B -> 1275117 B (-122 B); requests 20 -> 20
  chat boot CSS gzip vs base: 126018 B -> 126018 B (+0 B); requests 3 -> 3
  new boot JS: 15 requests, 760.3 KiB gzip (778568 B), 660.1 KiB br, 2507968 B raw (688052 B beyond initial-entry JS; limits: 17 requests, 797395 B gzip)
  new boot CSS: 3 requests, 88.2 KiB gzip (90280 B), 77.1 KiB br, 548425 B raw (2 beyond initial-entry CSS; limit: 3 requests)
  new boot JS gzip vs base: 778690 B -> 778568 B (-122 B); requests 15 -> 15
  new boot CSS gzip vs base: 90280 B -> 90280 B (+0 B); requests 3 -> 3
  startup JS gzip vs base: 90528 B -> 90516 B (-12 B); requests 3 -> 3
  startup CSS gzip vs base: 32609 B -> 32609 B (+0 B; growth up to 1535 B allowed)
  total CSS gzip vs base: 308444 B -> 308444 B (+0 B; fixed ceiling 308526 B)
  total CSS raw vs base: 1593668 B -> 1593668 B (+0 B; fixed ceiling 1597676 B)
  isolated Mermaid JS: 1 request, 222.5 KiB gzip (227823 B), 186.7 KiB br, 658001 B raw (limits: 1 deferred asset, 256.0 KiB gzip; forbidden at startup)
  locale catalog JS: 42 requests, 2584.4 KiB gzip (2646385 B), 2235.9 KiB br, 10607431 B raw (largest pair: ru, 141.1 KiB gzip; limits: 1 base + 1 config-hint asset per locale, 300.0 KiB combined; forbidden at startup)
    ar: 130827 B gzip (base 17839 B + config hints 112988 B; cap 307200 B; headroom 176373 B)
    de: 127750 B gzip (base 17514 B + config hints 110236 B; cap 307200 B; headroom 179450 B)
    es: 121417 B gzip (base 16779 B + config hints 104638 B; cap 307200 B; headroom 185783 B)
    fa: 131528 B gzip (base 17851 B + config hints 113677 B; cap 307200 B; headroom 175672 B)
    fr: 124967 B gzip (base 17401 B + config hints 107566 B; cap 307200 B; headroom 182233 B)
    hi: 139909 B gzip (base 19327 B + config hints 120582 B; cap 307200 B; headroom 167291 B)
    id: 112207 B gzip (base 15707 B + config hints 96500 B; cap 307200 B; headroom 194993 B)
    it: 120798 B gzip (base 16596 B + config hints 104202 B; cap 307200 B; headroom 186402 B)
    ja-JP: 128319 B gzip (base 17870 B + config hints 110449 B; cap 307200 B; headroom 178881 B)
    ko: 119400 B gzip (base 17171 B + config hints 102229 B; cap 307200 B; headroom 187800 B)
    nl: 120823 B gzip (base 16659 B + config hints 104164 B; cap 307200 B; headroom 186377 B)
    pl: 128170 B gzip (base 17545 B + config hints 110625 B; cap 307200 B; headroom 179030 B)
    pt-BR: 118782 B gzip (base 16531 B + config hints 102251 B; cap 307200 B; headroom 188418 B)
    ru: 144484 B gzip (base 19613 B + config hints 124871 B; cap 307200 B; headroom 162716 B)
    sv: 118269 B gzip (base 16473 B + config hints 101796 B; cap 307200 B; headroom 188931 B)
    th: 139820 B gzip (base 18953 B + config hints 120867 B; cap 307200 B; headroom 167380 B)
    tr: 122316 B gzip (base 16797 B + config hints 105519 B; cap 307200 B; headroom 184884 B)
    uk: 142668 B gzip (base 19421 B + config hints 123247 B; cap 307200 B; headroom 164532 B)
    vi: 120613 B gzip (base 17114 B + config hints 103499 B; cap 307200 B; headroom 186587 B)
    zh-CN: 116026 B gzip (base 16532 B + config hints 99494 B; cap 307200 B; headroom 191174 B)
    zh-TW: 117292 B gzip (base 16696 B + config hints 100596 B; cap 307200 B; headroom 189908 B)
```

</details>

### Reproduce the real UI and storage boundary

Use an isolated checkout with dependencies from the frozen lockfile. The collector below lives outside the checkout. Set `OPENCLAW_PROOF_STABLE_PACKAGE` to an unpacked unmodified `openclaw@2026.10.6` npm package, keep `stable-preference-seed.mjs` beside the collector, then run from the candidate checkout:

```sh
OPENCLAW_PROOF_STABLE_PACKAGE="$STABLE_PACKAGE" node --import ./scripts/tsx.mjs "$COLLECTOR" favorites exact-head
```

Chromium uses the system Chrome binary. Linux WebKit uses the same Playwright version on both sides of a task-owned browser-server connection, with `OPENCLAW_PROOF_WEBKIT_WS` pointing to that temporary local server. That connection changes only browser launch; the UI, assertions, preference worker, and independent readback are identical. `favorites baseline` on the pinned main captures the RED absence of the operation. Private state, browser contexts, and the source server are removed in cleanup. No production service is restarted.

<details>
<summary>Complete collector (both existing feature scopes; this PR uses favorites)</summary>

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const scope = process.argv[2];
const stage = process.argv[3] ?? "smoke";
assert.ok(["favorites", "terminal"].includes(scope));
const output = fs.mkdtempSync(path.join(path.dirname(root), `${scope}-${stage}-`));
const require = createRequire(path.join(root, "package.json"));
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { chromium, webkit } = require("playwright");
const { startControlUiE2eServer, installMockGateway, defaultControlUiFeatureMethods } = await load("ui/src/test-helpers/control-ui-e2e.ts");
const { waitForControlUiGatewayReady } = await load("ui/src/test-helpers/control-ui-e2e-readiness.ts");
const { observeTerminalControllers } = await load("ui/src/e2e/terminal-controller.test-support.ts");
const receipt = { at: new Date().toISOString(), stage, scope, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), output, controls: {}, errors: [], observations: [] };
receipt.tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
const started = Date.now();
receipt.worktreeStatus = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (stage === "exact-head") assert.equal(receipt.worktreeStatus, "", "Exact-head proof requires a clean worktree");
let state, profileId, readPrefs, writePrefs, upgrade;
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error("Proof observation did not settle");
}
async function revealFavorites(page) {
  const group = page.locator('[data-chat-model-provider-group="$favorites"]');
  await group.waitFor();
  const toggle = group.locator('[data-chat-model-provider-toggle]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return group;
}
let pty, ptyOutput = "", ptyInput = [], gateway;
let server, browser, page;
try {
if (scope === "favorites") {
  const { createOpenClawTestState } = await load("src/test-utils/openclaw-test-state.ts");
  state = await createOpenClawTestState({ layout: "state-only", prefix: "alix-model-favorites-proof-" });
  if (process.env.OPENCLAW_PROOF_STABLE_PACKAGE) {
    const packageRoot = path.resolve(process.env.OPENCLAW_PROOF_STABLE_PACKAGE);
    const seed = execFileSync(process.execPath, [path.join(path.dirname(root), "stable-preference-seed.mjs"), packageRoot], {
      encoding: "utf8", timeout: 60000,
      env: { PATH: process.env.PATH, HOME: state.home, OPENCLAW_STATE_DIR: state.stateDir, OPENCLAW_CONFIG_PATH: state.configPath, NODE_ENV: "test" },
    });
    upgrade = JSON.parse(seed.trim());
    receipt.upgrade = { baseline: `openclaw@${upgrade.version}`, seededBy: "unmodified published npm preference/profile modules in a separate process", entriesBefore: upgrade.entries, otherProfileBefore: upgrade.otherEntries };
    const { prepareStartupClientCredentials } = await load("src/commands/startup-client-credentials.ts");
    await prepareStartupClientCredentials({ env: state.env });
    receipt.upgrade.migration = "Existing production prepareStartupClientCredentials owner completed backed-up Doctor maintenance on the private released database before candidate reads";
  }
  const { ensureProfileForEmail } = await load("src/state/user-profiles.ts");
  ({ getCanonicalUserPreferences: readPrefs, setCanonicalUserPreferences: writePrefs } = await load("src/state/user-preferences.ts"));
  profileId = ensureProfileForEmail("operator@example.test").id;
  if (upgrade) {
    assert.equal(profileId, upgrade.profileId);
    assert.deepEqual((await readPrefs(profileId)).entries, upgrade.entries);
    assert.deepEqual((await readPrefs(upgrade.otherProfileId)).entries, upgrade.otherEntries);
    receipt.upgrade.sameProfileAndExistingPreferencesLoaded = true;
  }
  const seam = await writePrefs(profileId, { "proof.smoke": "canonical-storage" });
  assert.equal(seam.ok, true);
  assert.equal((await readPrefs(profileId, ["proof.smoke"])).entries["proof.smoke"], "canonical-storage");
  await writePrefs(profileId, { "proof.smoke": null });
  receipt.controls.storageSeam = "Real production preference worker write and separate canonical read succeeded";
  receipt.storagePath = state.stateDir;
} else {
  const nodePty = require("@lydell/node-pty");
  pty = nodePty.spawn("/bin/bash", ["--noprofile", "--norc"], { name: "xterm-256color", cols: 96, rows: 24, cwd: output, env: { PATH: "/usr/bin:/bin", HOME: output, LANG: "C.UTF-8", TERM: "xterm-256color", PS1: "$ " } });
  pty.onData((data) => {
    ptyOutput += data;
    if (gateway) void gateway.emitGatewayEvent("terminal.data", { sessionId: "proof-terminal", seq: ptyOutput.length, data });
  });
  pty.write("stty -echo; printf '\\nPTY-READY\\n'\r");
  await until(() => ptyOutput.includes("\r\nPTY-READY\r\n"));
  pty.write("printf '\\nSCROLLBACK-ANCHOR alpha\\nwide 界🚀 marker\\ncafé 👩‍💻 a  \\n'; for i in {1..70}; do printf 'ordinary line %s\\n' \"$i\"; done; printf 'TAIL-READY\\n'\r");
  await until(() => ptyOutput.includes("\r\nTAIL-READY\r\n"));
}
  server = await startControlUiE2eServer(undefined, { source: true });
  browser = process.env.OPENCLAW_PROOF_WEBKIT_WS
    ? await webkit.connect(process.env.OPENCLAW_PROOF_WEBKIT_WS)
    : await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-gpu-rasterization", "--disable-partial-raster"] });
  receipt.browser = { engine: process.env.OPENCLAW_PROOF_WEBKIT_WS ? "Linux WebKit in Ubuntu 24.04 container" : "Chromium", version: browser.version() };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
  page = await context.newPage();
  page.on("pageerror", (error) => receipt.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text().slice(0, 1000);
    if (process.env.OPENCLAW_PROOF_WEBKIT_WS && text === 'Viewport argument key "interactive-widget" not recognized and ignored.') {
      (receipt.browserDiagnostics ??= []).push({ text, classification: "Static viewport capability warning also reproduced on clean pinned main a4e20a8; no runtime error or behavior assertion waived" });
    } else receipt.errors.push(text);
  });
  if (scope === "terminal") await observeTerminalControllers(page);
  const terminal = { sessionId: "proof-terminal", agentId: "main", shell: "/bin/bash", cwd: "/proof", confined: false, owner: "agent:main:main" };
  const setup = (page) => installMockGateway(page, {
    communityInvite: false,
    terminalEnabled: scope === "terminal",
    operatorScopes: ["operator.admin", "operator.read", "operator.write"],
    ...(profileId ? { presenceUsers: [{ id: profileId, name: "Demo Operator", self: true }] } : {}),
    models: [{ id: "gpt-5.5", name: "GPT 5.5", provider: "openai" }, { id: "gpt-5-mini", name: "GPT 5 mini", provider: "openai" }, ...(scope === "favorites" ? [{ id: "claude-sonnet-4-6", name: "Claude Sonnet", provider: "anthropic" }, ...Array.from({length:997},(_,i)=>({id:`window-proof-${i}`,name:`Window Model ${String(i).padStart(4,'0')}`,provider:'openai'}))] : [])],
    featureMethods: [...defaultControlUiFeatureMethods, "terminal.open", "users.prefs.get", "users.prefs.set"],
    methodResponses: scope === "terminal" ? {
      "terminal.list": { sessions: [{ ...terminal, attached: true, createdAtMs: 1 }] },
      "terminal.open": terminal,
      "terminal.attach": { ...terminal, buffer: ptyOutput, seq: ptyOutput.length },
      "terminal.resize": { ok: true },
      "terminal.input": { ok: true },
    } : {},
  }, { requestHandlers: scope === "favorites" ? {
    "users.prefs.get": async (params) => {
      const result = await readPrefs(profileId, params?.keys);
      receipt.observations.push({ read: params, entries: result.entries });
      return { status: "ok", entries: result.entries };
    },
    "users.prefs.set": async (params) => {
      const result = await writePrefs(profileId, params.entries, { expectedEntries: params.expectedEntries });
      receipt.observations.push({ write: params, result: result.ok ? "ok" : result.error.code });
      return { status: result.ok ? "ok" : "conflict" };
    },
  } : {
    "terminal.open": async () => {
      await gateway.emitGatewayEvent("terminal.data", { sessionId: terminal.sessionId, seq: ptyOutput.length, data: ptyOutput });
      return terminal;
    },
    "terminal.attach": () => ({ ...terminal, buffer: ptyOutput, seq: ptyOutput.length }),
    "terminal.input": (params) => { ptyInput.push(params.data); pty.write(params.data); return { ok: true }; },
    "terminal.resize": (params) => { pty.resize(params.cols ?? params.columns, params.rows); return { ok: true }; },
  } });
  gateway = await setup(page);
  await page.goto(server.baseUrl + "chat");
  await waitForControlUiGatewayReady(page);
  await page.locator(".agent-chat__composer-combobox textarea").waitFor({ timeout: 60000 });
  if (scope === "favorites") {
    await page.locator("[data-chat-model-select]").first().click();
    await page.locator(".chat-controls__model-menu").waitFor();
    await until(async () => (await page.locator("[data-chat-model-option]").count()) >= 2);
    if (stage !== "baseline") await page.getByText("Manage favorites", { exact: true }).waitFor({ state: "attached", timeout: 15000 });
    receipt.observations.push({ models: await page.locator("[data-chat-model-option]").count(), favoriteActions: await page.locator("[data-chat-model-favorite]").count() });
    assert.ok(await page.locator("[data-chat-model-option]").count() > 0);
    if (await page.getByText("Manage favorites", { exact: true }).count() === 0) {
      await page.screenshot({ path: path.join(output, "before.png") });
      receipt.acceptance = "RED: the real chat model picker has models but no favorite operation";
    } else {
      assert.equal(await page.locator("[data-chat-model-favorite]").count(), 0);
      receipt.controls.authenticatedCatalogSize = 1000;
      receipt.controls.closedEditorControls = 0;
      await page.getByText("Manage favorites", { exact: true }).click();
      const checkbox = page.locator("[data-chat-model-favorite]").first();
      await checkbox.waitFor();
      const mountedControls = await page.locator("[data-chat-model-favorite]").count();
      assert.ok(mountedControls > 0 && mountedControls < 40);
      receipt.controls.openEditorControls = mountedControls;
      const search = page.locator('[data-chat-model-search]');
      await search.fill('Window Model 0996');
      await until(async () => await page.locator('[data-chat-model-favorite]').count() === 1);
      assert.equal(await page.locator('[data-chat-model-favorite]').getAttribute('data-chat-model-favorite'), '["openai/window-proof-996",null]');
      receipt.controls.offscreenModelSearch = true;
      await search.fill('');
      await until(async () => await page.locator('[data-chat-model-favorite]').count() > 1);
      const key = await checkbox.getAttribute("data-chat-model-favorite");
      const writesBefore = (await gateway.getRequests("sessions.patch")).length;
      await checkbox.click();
      await until(async () => Object.values((await readPrefs(profileId)).entries).some((value) => Array.isArray(value) && value.includes(key)));
      const group = await revealFavorites(page);
      await page.waitForFunction((key) => document.querySelector(`[data-chat-model-favorite=${CSS.escape(key)}]`)?.checked, key);
      const saved = (await readPrefs(profileId)).entries;
      const preferenceKey = Object.keys(saved).find((name) => name.startsWith("ui.modelFavorites:"));
      assert.ok(preferenceKey);
      receipt.observations.push({ favoriteKey: key, preferenceKey, committed: saved[preferenceKey] });
      await page.getByText("Manage favorites", { exact: true }).click();
      await revealFavorites(page);
      await group.locator("[data-chat-model-option]:visible").waitFor();
      const anthropicKey = '["anthropic/claude-sonnet-4-6",null]';
      await page.getByText("Manage favorites", { exact: true }).click();
      await search.fill('Claude Sonnet');
      const anthropicFavorite = page.locator(`[data-chat-model-favorite=${JSON.stringify(anthropicKey)}]`);
      await anthropicFavorite.click();
      await until(async () => (await readPrefs(profileId)).entries[preferenceKey]?.includes(anthropicKey));
      await search.fill('');
      const providerHeading = page.locator('[data-chat-model-provider-group="$favorites"] [data-chat-model-provider="anthropic"]');
      await providerHeading.locator("[data-chat-model-provider-settings]").waitFor();
      receipt.controls.lastProviderSettingsVisible = true;
      await until(() => providerHeading.evaluate(heading => {
        const group = heading.closest('[data-chat-model-provider-group]');
        const option = group.querySelector('[data-chat-model-option]');
        const viewport = heading.closest('[data-chat-model-window]');
        const row = heading.closest('.chat-controls__model-virtual-row');
        if (!row || !option || !viewport) return false;
        const h = heading.getBoundingClientRect(), o = option.getBoundingClientRect(), v = viewport.getBoundingClientRect();
        return h.height > 0 && h.top >= v.top && h.bottom <= v.bottom && h.bottom <= o.top;
      }));
      receipt.controls.virtualProviderHeading = await providerHeading.evaluate(heading => ({
        rowIndex: heading.closest('.chat-controls__model-virtual-row').dataset.index,
        headingBottom: heading.getBoundingClientRect().bottom,
        firstModelTop: heading.closest('[data-chat-model-provider-group]').querySelector('[data-chat-model-option]').getBoundingClientRect().top,
      }));
      const preferenceWrites = (await gateway.getRequests("users.prefs.set")).length;
      await group.locator("[data-chat-model-provider-toggle]").click();
      await until(async () => await providerHeading.count() === 0);
      await group.locator("[data-chat-model-provider-toggle]").click();
      await providerHeading.locator("[data-chat-model-provider-settings]").waitFor();
      assert.equal((await gateway.getRequests("users.prefs.set")).length, preferenceWrites);
      receipt.controls.virtualDisclosureNoWrite = true;
      await anthropicFavorite.click();
      await until(async () => !(await readPrefs(profileId)).entries[preferenceKey]?.includes(anthropicKey));
      await page.getByText("Manage favorites", { exact: true }).click();
      if (upgrade) {
        await page.waitForFunction(() => document.documentElement.dataset.themeId === "claw" && document.documentElement.dataset.themeMode === "light");
        receipt.upgrade.appliedTheme = await page.locator("html").evaluate(root => ({ id: root.dataset.themeId, mode: root.dataset.themeMode }));
      }
      await page.screenshot({ path: path.join(output, "after.png") });
      assert.equal((await gateway.getRequests("sessions.patch")).length, writesBefore);
      receipt.controls.noModelSelection = true;
      const second = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
      const secondPage = await second.newPage();
      await setup(secondPage);
      await secondPage.goto(server.baseUrl + "chat");
      await waitForControlUiGatewayReady(secondPage);
      await secondPage.locator("[data-chat-model-select]").first().click();
      await secondPage.locator('[data-chat-model-provider-group="$favorites"]').waitFor();
      await revealFavorites(secondPage);
      await secondPage.getByText("Manage favorites", { exact: true }).click();
      assert.equal(await secondPage.locator(`[data-chat-model-favorite=${JSON.stringify(key)}]`).isChecked(), true);
      receipt.controls.secondContextReadback = true;
      await secondPage.reload();
      await waitForControlUiGatewayReady(secondPage);
      await secondPage.locator("[data-chat-model-select]").first().click();
      await revealFavorites(secondPage);
      await secondPage.getByText("Manage favorites", { exact: true }).click();
      const remove = secondPage.locator("[data-chat-model-favorite]").first();
      assert.equal(await remove.isChecked(), true);
      await remove.click();
      await until(async () => !Object.hasOwn((await readPrefs(profileId)).entries, preferenceKey));
      receipt.controls.reloadAndRemoval = true;
      await second.close();
      if (upgrade) {
        const remaining = (await readPrefs(profileId)).entries;
        // Current main's new-session preference owner records its completed empty
        // browser-preference migration on first authenticated UI use. Require this
        // exact metadata key/value; all released user preference data stays exact.
        assert.deepEqual(remaining, { ...upgrade.entries, "new-session.migration.v1": true });
        receipt.upgrade.expectedAddedMetadata = { key: "new-session.migration.v1", value: true, owner: "ui/src/pages/new-session/draft-preference-state.ts" };
        assert.deepEqual((await readPrefs(upgrade.otherProfileId)).entries, upgrade.otherEntries);
        receipt.upgrade.entriesAfterFavoriteAndRemoval = remaining;
        receipt.upgrade.otherProfileAfter = (await readPrefs(upgrade.otherProfileId)).entries;
        receipt.upgrade.result = "PASS: stable-created data retained across candidate UI save, second browser, reload and removal";
      }
      receipt.acceptance = "GREEN: UI favorite committed through the real preference worker, second browser/reload read it back, and unfavorite removed it without selecting a model";
    }
  } else {
    await page.keyboard.press("Control+Backquote");
    const panel = page.locator("openclaw-terminal-panel").filter({ has: page.locator(".tp-host") });
    await page.locator(".tp-session.is-current").click();
    await panel.locator("canvas:visible").waitFor({ timeout: 60000 });
    await until(async () => await panel.locator(".tp-host:visible").evaluate((host) => {
      const buffer = window.terminalControllersForTest.get(host).terminal.buffer.active;
      return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true)).some((line) => line === "TAIL-READY");
    }));
    const facts = await panel.locator(".tp-host:visible").evaluate((host) => {
      const terminal = window.terminalControllersForTest.get(host).terminal;
      return { length: terminal.buffer.active.length, rows: terminal.rows, scrollback: terminal.buffer.active.getLine(0)?.translateToString(true), selection: terminal.getSelection() };
    });
    receipt.observations.push(facts);
    assert.ok(facts.length > facts.rows);
    assert.ok(ptyOutput.includes("TAIL-READY"));
    const find = panel.getByRole("button", { name: "Find in terminal", exact: true });
    if (await find.count() === 0) {
      await page.screenshot({ path: path.join(output, "before.png") });
      receipt.acceptance = "RED: actual PTY output reaches Ghostty scrollback, but the panel has no find operation";
    } else {
      const inputsBefore = ptyInput.length;
      await panel.locator(".tp-host:visible").evaluate((host) => {
        const term = window.terminalControllersForTest.get(host).terminal;
        window.terminalScrollTrace = [];
        for (const key of ["scrollToLine", "scrollToBottom", "write"]) {
          const original = term[key];
          term[key] = function (...args) {
            const before = this.getViewportY();
            const result = original.apply(this, args);
            window.terminalScrollTrace.push({ method: key, before, after: this.getViewportY(), argument: key === "write" ? String(args[0]).slice(-200) : args[0] });
            return result;
          };
        }
      });
      await find.click();
      const query = panel.getByRole("searchbox", { name: "Find in terminal", exact: true });
      await query.fill("SCROLLBACK-ANCHOR alpha");
      await panel.locator(".tp-find__preview mark").waitFor();
      assert.equal(await panel.locator(".tp-find__preview mark").textContent(), "SCROLLBACK-ANCHOR alpha");
      await until(async () => await panel.locator(".tp-host:visible").evaluate((host) => window.terminalControllersForTest.get(host).terminal.getViewportY() > 0));
      const scrolled = await panel.locator(".tp-host:visible").evaluate((host) => window.terminalControllersForTest.get(host).terminal.getViewportY());
      receipt.observations.push(await panel.locator(".tp-host:visible").evaluate((host) => { const term = window.terminalControllersForTest.get(host).terminal; return { offset: term.getViewportY(), rows: term.rows, length: term.buffer.active.length, scrollback: term.wasmTerm.getScrollbackLength() }; }));
      assert.ok(scrolled > 0);
      receipt.observations.push({ query: "SCROLLBACK-ANCHOR alpha", actualScrollbackOffset: scrolled, preview: await panel.locator(".tp-find__preview").textContent() });
      receipt.controls.previewFont = await panel.locator(".tp-find__preview").evaluate(node => getComputedStyle(node).fontFamily);
      assert.match(receipt.controls.previewFont, /mono/i);
      await page.screenshot({ path: path.join(output, "after.png") });
      await query.fill("界🚀");
      assert.equal(await panel.locator(".tp-find__preview mark").textContent(), "界🚀");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "1 of 1");
      receipt.controls.wideAndAstral = true;
      for (const grapheme of ["café", "👩‍💻", "a  "]) {
        await query.fill(grapheme);
        assert.equal(await panel.locator(".tp-find__count").textContent(), "1 of 1");
        assert.equal(await panel.locator(".tp-find__preview mark").textContent(), grapheme);
      }
      receipt.controls.graphemesAndPrintedSpaces = true;
      await query.fill("ordinary line 1");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "1 of 11");
      await panel.getByRole("button", { name: "Previous match", exact: true }).press("Enter");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "11 of 11");
      await query.press("Enter");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "1 of 11");
      await query.fill("unmatched-proof-marker");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "0 of 0");
      assert.equal(await panel.locator(".tp-find__preview").count(), 0);
      assert.equal(ptyInput.length, inputsBefore);
      receipt.controls.navigationAndNoMatch = true;
      receipt.controls.noQueryPtyInput = true;
      const resizeCount = (await gateway.getRequests("terminal.resize")).length;
      await page.setViewportSize({ width: 1120, height: 760 });
      await gateway.waitForRequest("terminal.resize", { after: resizeCount });
      await query.fill("SCROLLBACK-ANCHOR alpha");
      await until(async () => await panel.locator(".tp-host:visible").evaluate((host) => window.terminalControllersForTest.get(host).terminal.getViewportY() > 0));
      receipt.controls.resizeAndRefind = true;
      await query.fill("STREAM-PROOF");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "0 of 0");
      pty.write("printf '\\nSTREAM-PROOF\\n'\r");
      await until(async () => await panel.locator(".tp-host:visible").evaluate((host) => { const buffer = window.terminalControllersForTest.get(host).terminal.buffer.active; return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true)).some((line) => line === "STREAM-PROOF"); }));
      await panel.getByRole("button", { name: "Refresh terminal matches", exact: true }).press("Enter");
      assert.equal(await panel.locator(".tp-find__count").textContent(), "1 of 1");
      receipt.controls.streamReadback = true;
      assert.equal(ptyInput.length, inputsBefore);
      await panel.getByRole("button", { name: "Close terminal find", exact: true }).press("Enter");
      assert.equal(await panel.locator(".tp-find__controls").count(), 0);
      receipt.controls.nativeButtonKeyboard = true;
      const command = "printf '\\nUI-CONTROL\\n'";
      await panel.locator(".tp-composer").getByRole("textbox", { name: "Terminal input", exact: true }).fill(command);
      await panel.getByRole("button", { name: "Send terminal input", exact: true }).click();
      await until(() => ptyInput.some((input) => input.includes(command)) && ptyOutput.includes("\r\nUI-CONTROL\r\n"));
      receipt.controls.liveInputControl = true;
      receipt.acceptance = "GREEN: visible Find read actual retained PTY output, scrolled Ghostty to the early marker, navigated/wrapped matches, and sent zero search bytes to the PTY";
    }
    receipt.controls.ptyInput = ptyInput;
  }
  assert.deepEqual(receipt.errors, []);
  receipt.result = "PASS";
} catch (error) {
  receipt.result = "BLOCKED";
  receipt.failure = error.stack;
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    receipt.diagnostic = { text: (await page.locator("body").innerText()).slice(-6000), requests: await gateway?.getRequests(), scrollTrace: await page.evaluate(() => window.terminalScrollTrace) };
  }
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  pty?.kill();
  if (state) await state.cleanup();
  receipt.cleanup = "Browser contexts and source server closed; isolated PTY stopped or private preference state removed. No production services, channels, or real user sessions touched.";
  receipt.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ result: receipt.result, output, acceptance: receipt.acceptance, failure: receipt.failure, errors: receipt.errors }));
}
```

</details>

<details>
<summary>Complete released-state seed</summary>

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve(process.argv[2]);
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "openclaw");
assert.equal(pkg.version, "2026.10.6");
const { n: ensureProfileForEmail } = await import(pathToFileURL(path.join(packageRoot, "dist/user-profiles-FrYa7YTi.mjs")));
const { r: write, t: read } = await import(pathToFileURL(path.join(packageRoot, "dist/user-preferences-9JKSYgKc.mjs")));
const profile = ensureProfileForEmail("operator@example.test");
const other = ensureProfileForEmail("other-operator@example.test");
const entries = {
  "ui.theme": "claw",
  "ui.themeMode": "light",
  "ui.railShortcuts": ["route:usage"],
  "proof.existingPreference": { enabled: true, marker: "created-by-published-stable" },
};
const otherEntries = { "ui.theme": "claw", "proof.otherProfile": "untouched" };
assert.equal((await write(profile.id, entries)).ok, true);
assert.equal((await write(other.id, otherEntries)).ok, true);
assert.deepEqual((await read(profile.id)).entries, entries);
assert.deepEqual((await read(other.id)).entries, otherEntries);
console.log(JSON.stringify({ version: pkg.version, profileId: profile.id, otherProfileId: other.id, entries, otherEntries }));
// All durable writes and the independent reads above settled. Ending this
// isolated released-runtime process also retires its private worker pool.
process.exit(0);
```

</details>

Earlier review and CI discussions remain in the PR conversation with their original SHAs. They are historical evidence; only the receipts above cover the current head.


</details>
