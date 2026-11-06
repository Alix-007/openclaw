Closes #186908

## What Problem This Solves

QA Lab reports missing evidence or displays a different artifact when a valid filename has meaningful leading or trailing whitespace.

## User Impact

QA operators can open those evidence bundles and read the exact declared artifact through the existing URL, form, preview and download workflows. Existing blank-path, allowed-root and declared-file restrictions remain effective.

## Why This Change Was Made

Validate path strings as nonblank while preserving their original spelling across the existing evidence schema, gallery resolver, HTTP selectors and browser submission. Semantic metadata still uses its existing normalization. No schema fields, allowed roots, config/defaults, dependencies or migration steps are added.

The existing large-file hook required coherent extraction of both evidence HTTP routes with their private parsing/content-type helpers and the browser evidence-loading action. Their complete callers move together, errors still use the outer server renderer, and the original HTTP fixture writer moves unchanged into existing test support. This is included in the reported scope below.

## Evidence

### CI attribution and earlier regression-red receipt (2026-10-30)

Product head remains `a4d2f2426c03a08bfec3646bebde4baf9d6fc54f`; this is a body-only evidence update. No source, test, assertion, timeout or runtime proof changed, and no new execution is claimed.

The failed [selected QA shard](https://github.com/openclaw/openclaw/actions/runs/40732321492/job/122972788271) reports46 passed files/1 failed file and584 passing tests/1 failing test. Its sole failure is the existing scenario-name alignment guard in `extensions/qa-lab/src/test-file-scenario-runner.native.test.ts`: scenario `control-ui-browser-screenshot-body-cancel` requests `keeps the status error visible and cancels the unread media body`, while its target file has only `authenticates screenshot media and presents its HTTP failure`. The aggregate CI gate reports this selected failure.

The actual checkout in that primary job is merge `222c23ed04b6beb413e4e2480c7239f6b3e14113`, whose main parent is `5ff57b8e742f05b9e6e73b2bfe95866f394c15fd` and PR parent is the product head above. Each complete participating source below has the same Git blob in that hosted merge, its main parent, this PR head and this PR's original base `61bfde18d87b76db71070e3a715fd34b3b32f53e`:

| Unchanged source input | Git blob on all four refs |
|---|---|
| `extensions/qa-lab/src/test-file-scenario-runner.native.test.ts` | `df3679390d68a3ebb56131c4d42d50510a4ea1eb` |
| `extensions/qa-lab/src/scenario-catalog.ts` | `0fed18f63da7ff53c5351d49e2aa7c8aa1b49c66` |
| `qa/scenarios/ui/control-ui-browser-screenshot-body-cancel.yaml` | `60bf85149ff7605901631e2067491cf929a38856` |
| `ui/src/e2e/browser-screenshot-body-cancel.e2e.test.ts` | `25c147dc6c4a2c5847f6bef707d9f0b85f281345` |

The files are outside this PR's ten-file delta. Attribution uses the actual hosted failure, exact complete source-input equality and the deterministic pattern/title mismatch. I did not rerun the main-parent test or demonstrate a green hosted run; the failed gate remains failed, and the source comparison is not relabeled as an executed main test. No unrelated scenario-catalog correction is included.

There is also an actual saved early regression-red run, now made explicit:

```sh
node scripts/run-vitest.mjs \
  extensions/qa-lab/src/evidence-summary.test.ts \
  extensions/qa-lab/src/lab-server.test.ts \
  extensions/qa-lab/web/src/app.browser.test.ts \
  --maxWorkers=1 \
  --testNamePattern 'preserves literal evidence|literal evidence|preserves evidence paths'
```

At base `61bfde18d87b76db71070e3a715fd34b3b32f53e` plus dirty regression snapshot `fef585883e0ca8d69e07f36e61f3832139d3adf27626f26fe15bba3bc8cb01dd`, that command exited1 in208.920s:5 intended failures,102 unselected. This was the actual pre-extraction test form; it is not a fresh run of the final committed test files after helper extraction. The existing paired shipped-entry-point BASE/HEAD proof below remains the actual runtime proof.

| Earlier failing regression | Actual base observation |
|---|---|
| Evidence schema preserves literal paths | Expected edge spaces in source/ref/artifact paths; actual schema trims them |
| Artifact HTTP with literal evidence filename | Expected200; actual404 |
| Artifact HTTP with literal evidence directory | Expected200; actual404 |
| Browser path-query input preserves literal path | Expected`/api/evidence?path=%20evidence.json%20`; actual`/api/evidence?path=evidence.json` |
| Browser evidencePath-query input preserves literal path | Same trimmed request, so the literal path is not forwarded |

The saved early command receipt SHA256 is `36b3f9cd966db937a16603492c651f625eea9f6368b4f25f578415d87f12d1a9`; its full raw log SHA256 is `9f7a73092dfcaf36fd6ede4b577a2f2f0405d5b0560b04195c8687f0f06a5647`. The primary hosted failed-job log SHA256 is `917392522cd01faaf1438c75fa5ba061a78f2b596f39ef39620f60174ace82f8`. These identifiers preserve the actual older observations and do not substitute for the inspectable readbacks above or the full shipped-entry-point proof below.

- Scenario: QA evidence file/directory and declared artifact selectors retain meaningful filename whitespace through the existing gallery UI and HTTP API; Ordinary reads and existing blank, containment and declared-artifact guards remain effective.
- Entry: node openclaw.mjs qa ui --repo-root "$FIXTURE_REPO" --host 127.0.0.1 --embedded-gateway disabled --ui-dist-dir "$CHECKOUT/extensions/qa-lab/web/dist"; disputed owner ran unmocked: extensions/qa-lab evidence summary schema, gallery resolver, evidence HTTP handler and browser URL/form loading action, reached through the real built QA CLI/page.
- Same command on base `61bfde1` and head `a4d2f24`: `node gallery-path-proof.mjs "$CHECKOUT" "$LABEL" "$EXPECTED" built browser`
  - Before (base): RED all8 path-identity checks fail on base: literal evidence filename/directory404, source/artifact path bytes lost, indexed/direct reads return the22-byte trimmed-name decoy and HEAD22. Real initial URL aliases and form submission send trimmed paths and404; rendered preview/download show the decoy.
  - After (head): GREEN exact committed head passes all8 checks: literal file/directory200, original source/artifact paths, literal25-byte indexed/direct GET and HEAD25. Real URL aliases/form retain the space and200. Trailing filename strictly retains existing mediaKind:file/preview:null with exact DOM path and literal25-byte anchor download; leading-space .log visibly previews and downloads literal25-byte content.
- Readback (disk,subprocess,http,browser-dom,network-recorder): Real temporary files with distinct literal and trimmed-name bytes; actual HTTP JSON/status/GET/HEAD length; real Chrome URL/form request paths, rendered preview, and in-page fetch of the generated artifact anchor.
- Proof harness: gallery-path-proof.mjs SHA256 94cd2b65237d415d6a1641e9f91eb8b9b524b6847ac330a5120538e7ca84ea0e; complete portable collector and redacted actual readbacks embedded in the PR body. It requires clean Git status and build-info commit matching HEAD, with actual HOME/config/state isolated; same frozen file on both versions.
- Control: Both versions ordinary evidence/preview/GET/HEAD/browser return200 and exact25-byte visible control preview; blank required selector400, undeclared artifact403 and outside evidence403. Chrome page-error count0; actual form loads lead to2 successful generated-anchor readbacks, one for each literal artifact fixture.
- Other callers checked: Complete cutover includes both evidence HTTP routes and all4 browser loading callers, canonical evidence/artifact resolution and all3 schema path fields including inherited v3 receipt artifacts. Existing metadata normalization, relative/token/realpath/regular-file and declared-artifact checks remain in their original owners; gallery/presentation/invocation/containment siblings pass.
- Tests: node scripts/run-vitest.mjs extensions/qa-lab/src/lab-server.test.ts --maxWorkers=1 =>36 passed,exit0; node scripts/run-vitest.mjs extensions/qa-lab/src/evidence-summary.test.ts extensions/qa-lab/src/evidence-gallery.test.ts extensions/qa-lab/src/evidence-gallery.presentation.test.ts extensions/qa-lab/src/evidence-invocation.test.ts extensions/qa-lab/src/evidence-containment.test.ts extensions/qa-lab/web/src/app.browser.test.ts --maxWorkers=1 =>113 passed across6 files,exit0; types/typed lint/format/max-lines/test-line gates PASS. (measured cost: 176.094 s measured HTTP-file command wall, including cold native worker/compiler preparation; remaining schema49+sibling42+app22 measured together22.496 s. Earlier schema49-only14.586 s and app22-only16.879 s receipts retain their original pre-extraction scope; final113 command is the actual final consumer rerun. No test retry settings, timeouts, assertion coverage or baselines were relaxed.)
- Not tested: Native Windows/macOS filesystems or browsers, live providers/models, hosted services, or published-package upgrade. Trailing-space filenames are a POSIX fixture; existing unknown-extension preview policy is retained, so captured.log[space] with kind:text intentionally has a generic download link and null preview. Eligible leading-space .log preview is separately proven. No dependency/config/default/persistent-format migration or new schema field is introduced.


Linux / Node26.12.1 / Chrome152.0.7977.64 / 2026-10-28 UTC. The real built executable serves the real built QA page; no owner or HTTP response is mocked. Both normal private-QA runtime builds and normal QA Vite builds passed. The collector requires a clean checkout and matching `dist/build-info.json.commit`, and isolates actual HOME, config and state with the embedded Gateway disabled.

| Readback | BASE `61bfde18d87b` | HEAD `a4d2f2426c03` |
| --- | --- | --- |
| Literal evidence filename / directory | 404 / 404 | 200 / 200 |
| Serialized artifact / source path | Trailing space lost | Original bytes retained |
| Indexed / direct artifact GET | `TRIMMED DECOY CONTENT\n` (22 bytes) | `LITERAL ARTIFACT CONTENT\n` (25 bytes) |
| Indexed artifact HEAD | Content-Length22 | Content-Length25 |
| Artifact HEAD using literal evidence filename | 404 | 200 |
| Real page URL `path` and `evidencePath` aliases | Sent `evidence.json`,404 | Sent `evidence.json `,200 |
| Real form submission | Sent `submitted.json`,404 | Sent `submitted.json `,200 |
| Trailing-name artifact DOM + actual generated anchor | Trimmed path/text preview; decoy download | Exact path, existing file/null-preview policy; literal download |
| Leading-space ` captured.log` visible preview + anchor | Decoy22 bytes | Literal25 bytes |
| Ordinary evidence/GET/HEAD/browser | 200; exact25-byte control | Same |
| Blank / undeclared / outside-root selectors | 400 / 403 / 403 | Same |

There are zero Chrome page errors on either version. Browser evidence is page navigation, actual form fill/click, captured network responses, rendered preview text and an in-page fetch of the generated anchor. The app's jsdom suite is separate test coverage; no screenshot or visual appearance claim is made.

Focused tests: **149 passed**. Actual commands and measured walls:

```sh
# 36 HTTP tests; 176.094 s including cold native worker/compiler preparation.
node scripts/run-vitest.mjs extensions/qa-lab/src/lab-server.test.ts --maxWorkers=1
# 113 tests (schema49 + gallery/presentation/invocation/containment42 + app22); 22.496 s.
node scripts/run-vitest.mjs extensions/qa-lab/src/evidence-summary.test.ts extensions/qa-lab/src/evidence-gallery.test.ts extensions/qa-lab/src/evidence-gallery.presentation.test.ts extensions/qa-lab/src/evidence-invocation.test.ts extensions/qa-lab/src/evidence-containment.test.ts extensions/qa-lab/web/src/app.browser.test.ts --maxWorkers=1
```

Focused source/test types PASS56.302 s, type-aware lint PASS143.780 s, formatter PASS1.009 s, max-lines ratchet PASS19.480 s and test-line ratchet PASS3.031 s (6,302,450/6,310,000). Tests and static checks bind the complete reviewed frozen input; normal hooks preserved all ten file hashes. Clean committed-head private-QA runtime build PASS299.916 s and normal QA Vite build PASS2.602 s. Same frozen collector: BASE24.167 s, HEAD17.763 s, including startup and cleanup. Complete-candidate independent P0–P3 source review found no actionable issue; the authorized independent route was used after the official local helper returned401. Hosted PR CI has not run before initial publication.

The original browser collector failed once on HEAD (exit1,15.111 s): it incorrectly expected an inline text preview for `captured.log ` with free-form `kind:text`. Existing extension/kind classification correctly treats that literal unknown suffix as `file` and returns `preview:null`; this policy is unchanged. The corrected collector retains the original path/download and URL/form cases, strictly asserts the generic DOM/download behavior, and adds ` captured.log` with its known `.log` suffix for a real visible-preview comparison. The same corrected frozen collector was then replayed completely on both versions. This is a collector-contract correction, not another product fix or a relabeled passing result.

Scope: **10 files**, production **+188/-150** and tests/support **+201/-109**, including the complete existing route/action extraction and unchanged fixture relocation. This is a path-validation behavior repair; it adds no schema field or public option. **Not tested:** native Windows/macOS filesystems or browsers, live providers/models, hosted services, or a published-package upgrade. POSIX trailing-space behavior is demonstrated on Linux; focused HTTP tests also cover legal leading-space filenames. No upgrade or migration behavior is claimed.

<details>
<summary>Redacted actual HTTP and real-browser readbacks</summary>

Only local fixture/check-out paths are replaced with portable placeholders below; response bodies, request path spelling, statuses, lengths and artifact bytes come from the same recorded runs.

```json
{
  "before": {
    "at": "2026-10-28T16:48:41.535Z",
    "head": "61bfde18d87b76db71070e3a715fd34b3b32f53e",
    "buildCommit": "61bfde18d87b76db71070e3a715fd34b3b32f53e",
    "diffHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "outcome": "RED_CONFIRMED_WITH_CONTROLS",
    "home": "$FIXTURE/home",
    "failures": {
      "literalEvidenceFilename": true,
      "literalEvidenceDirectory": true,
      "serializedArtifactPath": true,
      "sourcePath": true,
      "indexedArtifactBytes": true,
      "indexedArtifactLength": true,
      "directArtifactBytes": true,
      "literalEvidenceHead": true
    },
    "http": [
      {
        "name": "ordinary evidence",
        "method": "GET",
        "route": "/api/evidence?path=control.json",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "control.json",
          "sourcePath": "fixture.test.ts",
          "artifact": {
            "path": "ordinary.log",
            "exists": true,
            "mediaKind": "text",
            "preview": "ORDINARY CONTROL CONTENT\n",
            "href": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "ordinary artifact GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": "ORDINARY CONTROL CONTENT\n"
      },
      {
        "name": "ordinary artifact HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": ""
      },
      {
        "name": "literal evidence filename",
        "method": "GET",
        "route": "/api/evidence?path=evidence.json+",
        "status": 404,
        "contentLength": "36",
        "readback": {
          "error": "Evidence path not found."
        }
      },
      {
        "name": "literal evidence directory",
        "method": "GET",
        "route": "/api/evidence?path=run+",
        "status": 404,
        "contentLength": "36",
        "readback": {
          "error": "Evidence path not found."
        }
      },
      {
        "name": "serialized literal artifact",
        "method": "GET",
        "route": "/api/evidence?path=artifact.json",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "artifact.json",
          "sourcePath": "fixture.test.ts",
          "artifact": {
            "path": "captured.log",
            "exists": true,
            "mediaKind": "text",
            "preview": "TRIMMED DECOY CONTENT\n",
            "href": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "literal artifact indexed GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "22",
        "readback": "TRIMMED DECOY CONTENT\n"
      },
      {
        "name": "literal artifact indexed HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "22",
        "readback": ""
      },
      {
        "name": "literal artifact direct GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&artifactPath=captured.log+",
        "status": 200,
        "contentLength": "22",
        "readback": "TRIMMED DECOY CONTENT\n"
      },
      {
        "name": "literal evidence direct HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=evidence.json+&artifactPath=ordinary.log",
        "status": 404,
        "contentLength": "36",
        "readback": ""
      },
      {
        "name": "blank evidence selector remains rejected",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=+&artifactPath=ordinary.log",
        "status": 400,
        "contentLength": "54",
        "readback": {
          "error": "Missing evidencePath and artifact selector"
        }
      },
      {
        "name": "undeclared artifact remains rejected",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=control.json&artifactPath=undeclared.log",
        "status": 403,
        "contentLength": "71",
        "readback": {
          "error": "Evidence artifact is not declared by this evidence summary."
        }
      },
      {
        "name": "outside evidence remains rejected",
        "method": "GET",
        "route": "/api/evidence?path=..%2Fopenclaw.json",
        "status": 403,
        "contentLength": "57",
        "readback": {
          "error": "Evidence path must stay inside the repo root."
        }
      }
    ],
    "browser": {
      "outcome": "BROWSER_RED_CONFIRMED_WITH_CONTROL",
      "executablePath": "/usr/bin/google-chrome",
      "version": "152.0.7977.64",
      "artifactHref": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
      "artifactReadback": {
        "status": 200,
        "body": "TRIMMED DECOY CONTENT\n"
      },
      "trailingArtifact": {
        "path": "captured.log",
        "mediaKind": "text",
        "preview": "TRIMMED DECOY CONTENT\n",
        "domPath": "captured.log",
        "domPreviewCount": 1
      },
      "leadingArtifact": {
        "path": "captured.log",
        "mediaKind": "text",
        "preview": "TRIMMED DECOY CONTENT\n",
        "previewVisible": true,
        "href": "/api/evidence/artifact?evidencePath=leading-artifact.json&entryIndex=0&artifactIndex=0",
        "readback": {
          "status": 200,
          "body": "TRIMMED DECOY CONTENT\n"
        }
      },
      "controlPreview": "ORDINARY CONTROL CONTENT\n",
      "pageErrors": [],
      "network": [
        {
          "name": "initial path",
          "requestedPath": "evidence.json",
          "status": 404,
          "readback": {
            "error": "Evidence path not found."
          }
        },
        {
          "name": "initial evidencePath",
          "requestedPath": "evidence.json",
          "status": 404,
          "readback": {
            "error": "Evidence path not found."
          }
        },
        {
          "name": "browser ordinary control",
          "requestedPath": "control.json",
          "status": 200,
          "readback": {
            "evidencePath": "control.json",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "ordinary.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "ORDINARY CONTROL CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "form literal evidence path",
          "requestedPath": "submitted.json",
          "status": 404,
          "readback": {
            "error": "Evidence path not found."
          }
        },
        {
          "name": "form serialized artifact read",
          "requestedPath": "artifact.json",
          "status": 200,
          "readback": {
            "evidencePath": "artifact.json",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "captured.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "TRIMMED DECOY CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "form preview-eligible leading artifact",
          "requestedPath": "leading-artifact.json",
          "status": 200,
          "readback": {
            "evidencePath": "leading-artifact.json",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "captured.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "TRIMMED DECOY CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=leading-artifact.json&entryIndex=0&artifactIndex=0"
            }
          }
        }
      ]
    }
  },
  "after": {
    "at": "2026-10-28T16:48:34.608Z",
    "head": "a4d2f2426c03a08bfec3646bebde4baf9d6fc54f",
    "buildCommit": "a4d2f2426c03a08bfec3646bebde4baf9d6fc54f",
    "diffHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "outcome": "GREEN",
    "home": "$FIXTURE/home",
    "failures": {
      "literalEvidenceFilename": false,
      "literalEvidenceDirectory": false,
      "serializedArtifactPath": false,
      "sourcePath": false,
      "indexedArtifactBytes": false,
      "indexedArtifactLength": false,
      "directArtifactBytes": false,
      "literalEvidenceHead": false
    },
    "http": [
      {
        "name": "ordinary evidence",
        "method": "GET",
        "route": "/api/evidence?path=control.json",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "control.json",
          "sourcePath": "fixture.test.ts",
          "artifact": {
            "path": "ordinary.log",
            "exists": true,
            "mediaKind": "text",
            "preview": "ORDINARY CONTROL CONTENT\n",
            "href": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "ordinary artifact GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": "ORDINARY CONTROL CONTENT\n"
      },
      {
        "name": "ordinary artifact HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": ""
      },
      {
        "name": "literal evidence filename",
        "method": "GET",
        "route": "/api/evidence?path=evidence.json+",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "evidence.json ",
          "sourcePath": "fixture.test.ts",
          "artifact": {
            "path": "ordinary.log",
            "exists": true,
            "mediaKind": "text",
            "preview": "ORDINARY CONTROL CONTENT\n",
            "href": "/api/evidence/artifact?evidencePath=evidence.json+&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "literal evidence directory",
        "method": "GET",
        "route": "/api/evidence?path=run+",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "run /qa-evidence.json",
          "sourcePath": "fixture.test.ts",
          "artifact": {
            "path": "ordinary.log",
            "exists": true,
            "mediaKind": "text",
            "preview": "ORDINARY CONTROL CONTENT\n",
            "href": "/api/evidence/artifact?evidencePath=run+%2Fqa-evidence.json&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "serialized literal artifact",
        "method": "GET",
        "route": "/api/evidence?path=artifact.json",
        "status": 200,
        "contentLength": null,
        "readback": {
          "evidencePath": "artifact.json",
          "sourcePath": "fixture.test.ts ",
          "artifact": {
            "path": "captured.log ",
            "exists": true,
            "mediaKind": "file",
            "preview": null,
            "href": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0"
          }
        }
      },
      {
        "name": "literal artifact indexed GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": "LITERAL ARTIFACT CONTENT\n"
      },
      {
        "name": "literal artifact indexed HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
        "status": 200,
        "contentLength": "25",
        "readback": ""
      },
      {
        "name": "literal artifact direct GET",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=artifact.json&artifactPath=captured.log+",
        "status": 200,
        "contentLength": "25",
        "readback": "LITERAL ARTIFACT CONTENT\n"
      },
      {
        "name": "literal evidence direct HEAD",
        "method": "HEAD",
        "route": "/api/evidence/artifact?evidencePath=evidence.json+&artifactPath=ordinary.log",
        "status": 200,
        "contentLength": "25",
        "readback": ""
      },
      {
        "name": "blank evidence selector remains rejected",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=+&artifactPath=ordinary.log",
        "status": 400,
        "contentLength": "54",
        "readback": {
          "error": "Missing evidencePath and artifact selector"
        }
      },
      {
        "name": "undeclared artifact remains rejected",
        "method": "GET",
        "route": "/api/evidence/artifact?evidencePath=control.json&artifactPath=undeclared.log",
        "status": 403,
        "contentLength": "71",
        "readback": {
          "error": "Evidence artifact is not declared by this evidence summary."
        }
      },
      {
        "name": "outside evidence remains rejected",
        "method": "GET",
        "route": "/api/evidence?path=..%2Fopenclaw.json",
        "status": 403,
        "contentLength": "57",
        "readback": {
          "error": "Evidence path must stay inside the repo root."
        }
      }
    ],
    "browser": {
      "outcome": "BROWSER_GREEN",
      "executablePath": "/usr/bin/google-chrome",
      "version": "152.0.7977.64",
      "artifactHref": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0",
      "artifactReadback": {
        "status": 200,
        "body": "LITERAL ARTIFACT CONTENT\n"
      },
      "trailingArtifact": {
        "path": "captured.log ",
        "mediaKind": "file",
        "preview": null,
        "domPath": "captured.log ",
        "domPreviewCount": 0
      },
      "leadingArtifact": {
        "path": " captured.log",
        "mediaKind": "text",
        "preview": "LITERAL ARTIFACT CONTENT\n",
        "previewVisible": true,
        "href": "/api/evidence/artifact?evidencePath=leading-artifact.json&entryIndex=0&artifactIndex=0",
        "readback": {
          "status": 200,
          "body": "LITERAL ARTIFACT CONTENT\n"
        }
      },
      "controlPreview": "ORDINARY CONTROL CONTENT\n",
      "pageErrors": [],
      "network": [
        {
          "name": "initial path",
          "requestedPath": "evidence.json ",
          "status": 200,
          "readback": {
            "evidencePath": "evidence.json ",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "ordinary.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "ORDINARY CONTROL CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=evidence.json+&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "initial evidencePath",
          "requestedPath": "evidence.json ",
          "status": 200,
          "readback": {
            "evidencePath": "evidence.json ",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "ordinary.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "ORDINARY CONTROL CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=evidence.json+&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "browser ordinary control",
          "requestedPath": "control.json",
          "status": 200,
          "readback": {
            "evidencePath": "control.json",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "ordinary.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "ORDINARY CONTROL CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=control.json&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "form literal evidence path",
          "requestedPath": "submitted.json ",
          "status": 200,
          "readback": {
            "evidencePath": "submitted.json ",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": "ordinary.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "ORDINARY CONTROL CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=submitted.json+&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "form serialized artifact read",
          "requestedPath": "artifact.json",
          "status": 200,
          "readback": {
            "evidencePath": "artifact.json",
            "sourcePath": "fixture.test.ts ",
            "artifact": {
              "path": "captured.log ",
              "exists": true,
              "mediaKind": "file",
              "preview": null,
              "href": "/api/evidence/artifact?evidencePath=artifact.json&entryIndex=0&artifactIndex=0"
            }
          }
        },
        {
          "name": "form preview-eligible leading artifact",
          "requestedPath": "leading-artifact.json",
          "status": 200,
          "readback": {
            "evidencePath": "leading-artifact.json",
            "sourcePath": "fixture.test.ts",
            "artifact": {
              "path": " captured.log",
              "exists": true,
              "mediaKind": "text",
              "preview": "LITERAL ARTIFACT CONTENT\n",
              "href": "/api/evidence/artifact?evidencePath=leading-artifact.json&entryIndex=0&artifactIndex=0"
            }
          }
        }
      ]
    }
  }
}
```

</details>

<details>
<summary>Complete reproducible collector (SHA256 94cd2b65237d415d6a1641e9f91eb8b9b524b6847ac330a5120538e7ca84ea0e)</summary>

Save as `gallery-path-proof.mjs` beside clean installed source checkouts. Use supported Node26.12.1+ and the checkout's existing Playwright dependency. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chromium is not at the tested Linux system path. In each checkout run the existing normal private-QA build and normal QA Vite build:

```sh
OPENCLAW_BUILD_PRIVATE_QA=1 node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup
node scripts/run-node-package-bin.mts vite build --config extensions/qa-lab/web/vite.config.ts
node gallery-path-proof.mjs "$CHECKOUT" "$LABEL" "$EXPECTED" built browser
```

`CHECKOUT` is absolute; `LABEL` identifies output files; `EXPECTED` is `base` or `head`. The collector asserts the known RED on base and GREEN on head, retaining ordinary and rejection controls. It uses temporary real files and its own loopback server process, then closes its browser and server. It does not contact a live provider or place a model request.

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const [checkout, label = 'gallery-base', expected = 'base', entry = 'built', browserMode = 'none'] = process.argv.slice(2);
assert.ok(path.isAbsolute(checkout));
const git = values => execFileSync('git', values, {cwd: checkout, encoding: 'utf8'}).trim();
const head = git(['rev-parse', 'HEAD']);
assert.equal(git(['status', '--porcelain']), '', 'Proof requires a clean checkout');
const buildInfo = JSON.parse(await fs.readFile(path.join(checkout, 'dist/build-info.json'), 'utf8'));
assert.equal(buildInfo.commit, head, 'Runtime build commit must match the checkout HEAD');
const task = path.dirname(new URL(import.meta.url).pathname);
const fixture = await fs.mkdtemp(path.join(task, `${label}-fixture-`));
const repo = path.join(fixture, 'repo');
await fs.mkdir(repo, {recursive: true});
const exact = 'LITERAL ARTIFACT CONTENT\n';
const decoy = 'TRIMMED DECOY CONTENT\n';
const ordinary = 'ORDINARY CONTROL CONTENT\n';
const evidence = (artifact, source = 'fixture.test.ts') => ({
  kind: 'openclaw.qa.evidence-summary', schemaVersion: 2,
  generatedAt: '2026-10-28T15:00:00.000Z', evidenceMode: 'full',
  entries: [{
    test: {kind: 'vitest-test', id: 'literal-path-fixture', title: 'Synthetic path fixture', source: {path: source}},
    coverage: [{id: 'qa.artifact', role: 'primary'}],
    execution: {runner: 'vitest', environment: {ref: 'gallery-path-fixture', os: 'linux', nodeVersion: process.version},
      provider: {id: 'mock-openai', live: false, model: {name: 'mock-openai/gpt-5.6-luna', ref: 'mock-openai/gpt-5.6-luna'}},
      packageSource: {kind: 'source-checkout'}, artifacts: [{kind: 'text', path: artifact, source: 'fixture'}]},
    result: {status: 'pass'},
  }],
});
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
await fs.writeFile(path.join(repo, 'ordinary.log'), ordinary);
await fs.writeFile(path.join(repo, 'captured.log '), exact);
await fs.writeFile(path.join(repo, ' captured.log'), exact);
await fs.writeFile(path.join(repo, 'captured.log'), decoy);
await fs.writeFile(path.join(repo, 'undeclared.log'), 'NOT DECLARED\n');
await writeJson(path.join(repo, 'control.json'), evidence('ordinary.log'));
await writeJson(path.join(repo, 'artifact.json'), evidence('captured.log ', 'fixture.test.ts '));
await writeJson(path.join(repo, 'leading-artifact.json'), evidence(' captured.log'));
await writeJson(path.join(repo, 'evidence.json '), evidence('ordinary.log'));
await writeJson(path.join(repo, 'submitted.json '), evidence('ordinary.log'));
await fs.mkdir(path.join(repo, 'run '));
await writeJson(path.join(repo, 'run ', 'qa-evidence.json'), evidence('../ordinary.log'));
const config = path.join(fixture, 'openclaw.json');
await writeJson(config, {plugins: {allow: []}});
const fixtureHome = path.join(fixture, 'home');
await fs.mkdir(fixtureHome, {recursive: true});
const env = {...process.env, HOME: fixtureHome, OPENCLAW_HOME: fixtureHome,
  OPENCLAW_STATE_DIR: path.join(fixture, 'state'), OPENCLAW_CONFIG_PATH: config,
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: '0', OPENCLAW_NO_RESPAWN: '1',
  OPENCLAW_DEV_SOURCE_ROOT: checkout,
  OPENCLAW_BUILD_PRIVATE_QA: '1', OPENCLAW_ENABLE_PRIVATE_QA_CLI: '1',
  OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_SKIP_GMAIL_WATCHER: '1',
  OPENCLAW_SERVICE_REPAIR_POLICY: 'external', OPENCLAW_DEBUG: '1',
  HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: ''};
const args = [entry === 'source' ? 'scripts/run-node.mjs' : 'openclaw.mjs', 'qa', 'ui', '--repo-root', repo,
  '--host', '127.0.0.1', '--embedded-gateway', 'disabled'];
if (browserMode === 'browser') {
  const uiDistDir = path.join(checkout, 'extensions/qa-lab/web/dist');
  await fs.access(path.join(uiDistDir, 'index.html'));
  args.push('--ui-dist-dir', uiDistDir);
}
const child = spawn(process.execPath, args, {cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe']});
let stdout = '', stderr = '';
const log = await fs.open(path.join(task, label + '-cli.log'), 'w');
child.stdout.on('data', chunk => {stdout += chunk; void log.write(chunk); process.stdout.write(chunk);});
child.stderr.on('data', chunk => {stderr += chunk; void log.write(chunk); process.stderr.write(chunk);});
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
let childDone = false;
void exited.then(() => {childDone = true;});
const start = Date.now();
let baseUrl;
while (!(baseUrl = stdout.match(/QA Lab UI: (http:\/\/[^\s]+)/)?.[1])) {
  assert.ok(!childDone, 'Official QA CLI exited before serving: ' + stderr.slice(-1800));
  assert.ok(Date.now() - start < 8 * 60 * 1000, 'QA preparation/startup exceeded eight minutes');
  await delay(100);
}
const observations = [];
const request = async (name, route, method = 'GET') => {
  const response = await fetch(new URL(route, baseUrl), {method});
  const body = await response.text();
  const result = {name, method, route, status: response.status,
    contentLength: response.headers.get('content-length'), body};
  observations.push(result);
  return result;
};
const endpoint = (name, values) => `/api/${name}?${new URLSearchParams(values)}`;
let result;
try {
  const control = await request('ordinary evidence', endpoint('evidence', {path: 'control.json'}));
  assert.equal(control.status, 200);
  const model = JSON.parse(control.body).evidence;
  assert.equal(model.entries[0].artifacts[0].exists, true);
  assert.equal(model.entries[0].artifacts[0].preview, ordinary);
  const controlGet = await request('ordinary artifact GET', model.entries[0].artifacts[0].href);
  assert.equal(controlGet.status, 200); assert.equal(controlGet.body, ordinary);
  const controlHead = await request('ordinary artifact HEAD', model.entries[0].artifacts[0].href, 'HEAD');
  assert.equal(controlHead.status, 200); assert.equal(Number(controlHead.contentLength), Buffer.byteLength(ordinary));
  assert.equal(controlHead.body, '');
  const file = await request('literal evidence filename', endpoint('evidence', {path: 'evidence.json '}));
  const directory = await request('literal evidence directory', endpoint('evidence', {path: 'run '}));
  const artifact = await request('serialized literal artifact', endpoint('evidence', {path: 'artifact.json'}));
  assert.equal(artifact.status, 200);
  const artifactModel = JSON.parse(artifact.body).evidence;
  const indexedGet = await request('literal artifact indexed GET', artifactModel.entries[0].artifacts[0].href);
  const indexedHead = await request('literal artifact indexed HEAD', artifactModel.entries[0].artifacts[0].href, 'HEAD');
  const directGet = await request('literal artifact direct GET', endpoint('evidence/artifact', {evidencePath: 'artifact.json', artifactPath: 'captured.log '}));
  const directHead = await request('literal evidence direct HEAD', endpoint('evidence/artifact', {evidencePath: 'evidence.json ', artifactPath: 'ordinary.log'}), 'HEAD');
  const blank = await request('blank evidence selector remains rejected', endpoint('evidence/artifact', {evidencePath: ' ', artifactPath: 'ordinary.log'}));
  assert.equal(blank.status, 400);
  const undeclared = await request('undeclared artifact remains rejected', endpoint('evidence/artifact', {evidencePath: 'control.json', artifactPath: 'undeclared.log'}));
  assert.equal(undeclared.status, 403);
  const outside = await request('outside evidence remains rejected', endpoint('evidence', {path: '../openclaw.json'}));
  assert.equal(outside.status, 403);
  const failures = {
    literalEvidenceFilename: file.status !== 200,
    literalEvidenceDirectory: directory.status !== 200,
    serializedArtifactPath: artifactModel.entries[0].artifacts[0].path !== 'captured.log ',
    sourcePath: artifactModel.entries[0].sourcePath !== 'fixture.test.ts ',
    indexedArtifactBytes: indexedGet.body !== exact,
    indexedArtifactLength: Number(indexedHead.contentLength) !== Buffer.byteLength(exact),
    directArtifactBytes: directGet.body !== exact,
    literalEvidenceHead: directHead.status !== 200,
  };
  assert.equal(indexedGet.status, 200); assert.equal(indexedHead.status, 200);
  if (expected === 'base') assert.ok(Object.values(failures).every(Boolean), 'Expected each literal-path regression on frozen base');
  else assert.ok(Object.values(failures).every(value => !value), 'Literal paths must all resolve without changing bytes');
  let browserProof;
  if (browserMode === 'browser') {
    const requireFromCheckout = createRequire(path.join(checkout, 'package.json'));
    const {chromium} = requireFromCheckout('playwright');
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome';
    const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox']});
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    const network = [];
    const isEvidenceResponse = response => new URL(response.url()).pathname === '/api/evidence';
    const record = async (name, response) => {
      const url = new URL(response.url());
      const body = await response.text();
      const observation = {name, url: response.url(), requestedPath: url.searchParams.get('path'), status: response.status(), body};
      network.push(observation);
      return observation;
    };
    try {
      for (const key of ['path', 'evidencePath']) {
        const pending = page.waitForResponse(isEvidenceResponse);
        await page.goto(new URL(`/evidence?${new URLSearchParams({[key]: 'evidence.json '})}`, baseUrl).href);
        const response = await record(`initial ${key}`, await pending);
        assert.equal(response.requestedPath, expected === 'base' ? 'evidence.json' : 'evidence.json ');
        assert.equal(response.status, expected === 'base' ? 404 : 200);
      }
      const controlPending = page.waitForResponse(isEvidenceResponse);
      await page.goto(new URL('/evidence?path=control.json', baseUrl).href);
      const controlResponse = await record('browser ordinary control', await controlPending);
      assert.equal(controlResponse.status, 200);
      assert.equal(JSON.parse(controlResponse.body).evidence.entries[0].artifacts[0].preview, ordinary);
      await page.locator('.evidence-inspector .evidence-artifact-preview-shell summary').click();
      const controlPreview = page.locator('.evidence-inspector .evidence-artifact-preview');
      const controlPreviewText = await controlPreview.textContent();
      assert.equal(controlPreviewText, ordinary);
      assert.equal(await controlPreview.isVisible(), true);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('submitted.json ');
      const formPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const formResponse = await record('form literal evidence path', await formPending);
      assert.equal(formResponse.requestedPath, expected === 'base' ? 'submitted.json' : 'submitted.json ');
      assert.equal(formResponse.status, expected === 'base' ? 404 : 200);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('artifact.json');
      const artifactPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const artifactResponse = await record('form serialized artifact read', await artifactPending);
      assert.equal(artifactResponse.status, 200);
      const wanted = expected === 'base' ? decoy : exact;
      const trailingArtifact = JSON.parse(artifactResponse.body).evidence.entries[0].artifacts[0];
      const trailingPath = expected === 'base' ? 'captured.log' : 'captured.log ';
      assert.equal(trailingArtifact.path, trailingPath);
      assert.equal(trailingArtifact.mediaKind, expected === 'base' ? 'text' : 'file');
      assert.equal(trailingArtifact.preview, expected === 'base' ? decoy : null);
      await page.waitForFunction(filePath => document.querySelector('.evidence-inspector .evidence-artifact-card footer')?.textContent === filePath, trailingPath);
      const trailingDomPath = await page.locator('.evidence-inspector .evidence-artifact-card footer').first().textContent();
      const trailingPreviewCount = await page.locator('.evidence-inspector .evidence-artifact-preview').count();
      assert.equal(trailingPreviewCount, expected === 'base' ? 1 : 0);
      if (expected === 'head') {
        assert.equal(await page.locator('.evidence-inspector').getByRole('link', {name: 'Open artifact', exact: true}).count(), 1);
      }
      const href = await page.locator('.evidence-inspector a[href^="/api/evidence/artifact"]').first().getAttribute('href');
      assert.ok(href);
      const browserBody = await page.evaluate(async href => {
        const response = await fetch(href);
        return {status: response.status, body: await response.text()};
      }, href);
      assert.equal(browserBody.status, 200); assert.equal(browserBody.body, wanted);
      await page.waitForFunction(() => !document.querySelector('[data-action="load-evidence"]')?.disabled);
      await page.locator('#evidence-path').fill('leading-artifact.json');
      const leadingPending = page.waitForResponse(isEvidenceResponse);
      await page.locator('[data-action="load-evidence"]').click();
      const leadingResponse = await record('form preview-eligible leading artifact', await leadingPending);
      assert.equal(leadingResponse.status, 200);
      const leadingArtifact = JSON.parse(leadingResponse.body).evidence.entries[0].artifacts[0];
      const leadingPath = expected === 'base' ? 'captured.log' : ' captured.log';
      assert.equal(leadingArtifact.path, leadingPath);
      assert.equal(leadingArtifact.mediaKind, 'text');
      assert.equal(leadingArtifact.preview, wanted);
      await page.waitForFunction(filePath => document.querySelector('.evidence-inspector .evidence-artifact-card footer')?.textContent === filePath, leadingPath);
      await page.locator('.evidence-inspector .evidence-artifact-preview-shell summary').click();
      const leadingPreview = page.locator('.evidence-inspector .evidence-artifact-preview');
      assert.equal(await leadingPreview.textContent(), wanted);
      assert.equal(await leadingPreview.isVisible(), true);
      const leadingHref = await page.locator('.evidence-inspector a[href^="/api/evidence/artifact"]').first().getAttribute('href');
      assert.ok(leadingHref);
      const leadingReadback = await page.evaluate(async href => {
        const response = await fetch(href);
        return {status: response.status, body: await response.text()};
      }, leadingHref);
      assert.equal(leadingReadback.status, 200); assert.equal(leadingReadback.body, wanted);
      assert.deepEqual(pageErrors, []);
      browserProof = {outcome: expected === 'base' ? 'BROWSER_RED_CONFIRMED_WITH_CONTROL' : 'BROWSER_GREEN',
        playwright: requireFromCheckout.resolve('playwright'), executablePath, version: browser.version(),
        network, artifactHref: href, artifactReadback: browserBody,
        trailingArtifact: {path: trailingArtifact.path, mediaKind: trailingArtifact.mediaKind,
          preview: trailingArtifact.preview, domPath: trailingDomPath, domPreviewCount: trailingPreviewCount},
        leadingArtifact: {path: leadingArtifact.path, mediaKind: leadingArtifact.mediaKind,
          preview: await leadingPreview.textContent(), previewVisible: await leadingPreview.isVisible(),
          href: leadingHref, readback: leadingReadback},
        controlPreview: controlPreviewText, pageErrors};
    } finally {
      await browser.close();
    }
  }
  result = {at: new Date().toISOString(), expected, outcome: expected === 'base' ? 'RED_CONFIRMED_WITH_CONTROLS' : 'GREEN',
    checkout, head, buildCommit: buildInfo.commit, home: fixtureHome,
    diffHash: createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex'),
    command: [process.execPath, ...args], fixture, baseUrl, startupMs: Date.now() - start,
    exact, decoy, ordinary, failures, observations, browserProof};
  await writeJson(path.join(task, label + '-result.json'), result);
  console.log(JSON.stringify({outcome: result.outcome, failures, fixture, receipt: path.join(task, label + '-result.json')}, null, 2));
} finally {
  child.kill('SIGINT');
  const stopped = await Promise.race([exited, delay(5000).then(() => null)]);
  if (!stopped) {child.kill('SIGKILL'); await exited;}
  await log.close();
}
```

</details>
