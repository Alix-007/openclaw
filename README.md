# Skill library IME — exact built-head evidence

Product head: `07d55fc2edb8afbcd7055cbc8408bc223188dd6d`. Base: `5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78`. Real entry: normally built Control UI → Skills → Skill settings → Create skill → SKILL.md native textarea. Frozen collector SHA256 `6e0dadcdd7a01ae60d1e78bee1995c10e8d8d970bf01dacce1bb746d7e2f600a`.

| Actual scenario | BASE | HEAD |
| --- | --- | --- |
| Normal Ctrl+Enter | 1 correct save + visible published receipt | 1 correct save + visible published receipt |
| Trusted Ctrl+Enter while native composition is active | **1 premature save** | **0 saves**, exact draft retained |
| Finish composition, then ordinary Ctrl+Enter | Not reached after RED | Trusted non-composing key → **1 save**, exact final text and visible receipt |

The collector uses Chromium CDP to start actual browser composition; the observed compositionstart, input and Enter shortcut are trusted, with actual `isComposing=true`. CDP Input.insertText commits the text; Chromium marks that compositionend event `isTrusted=false`, which is recorded without overriding flags or dispatching page events. The final observed shortcut is trusted and `isComposing=false`. This is Chromium proof, not a claim about OS-native IME or WebKit.

Normal clean-head UI build passed120.738s; official own plugin asset phases17.906/1.777/3.903s. Same collector BASE10.966s and HEAD10.179s. Index buildidentity is commit-matching and clean; served HTML and JS-entry hashes match owned built bytes. HEAD served entry `./assets/index-BkNGDhTO.js` SHA256 `e5336d50fb64bd3fab56ebbe363a2150342532140ae21407adb23898f0d948d2`.

Recorder boundary is the official isolated mock Gateway. It records real production UI requests and returns synthetic receipts; no actual skill file/backend persistence, live model, channel or production Gateway is contacted. Contexts and owned server closed. BASE erroneous write deferred/rejected; HEAD legitimate controls settle and show their receipt.

49 owner/sibling tests, scoped strict types, ordinary typedlint, formatting and canonical testbudget pass. Test LF985→981, no new grant. Normal UI wrapper carries an inherited chatbootgzip advisory1266.9>1266.4 also seen on BASE; no hosted/performance green claim.

BASE.json and HEAD.json retain the observed events, request recorders, exact clean build identity and final text. before.png, after.png, saved.png and control images show only synthetic fixture data. Absolute private workspace/tool roots are replaced by $PROOF_ROOT and $NODE26; the collector is unchanged. Prior v2/diagnostic failures remain retained and are not relabeled passing evidence.

The editor is a lazy UI chunk: BASE `library-dialog-content-BhyWjTc3.js` SHA256 `10d7bbc01925eddbc6019b01f447412d918654b33d842b6bbb6a5bf48678f954`, HEAD `library-dialog-content-dnym_NQ-.js` SHA256 `99ea7ad309d4303112fe4b654044e5979aef6eaadcb5ce6aa93116017cf93dd1`. These are supplemental owned-build file hashes; the frozen collector separately verified served HTML/entry and actual changed behavior, rather than claiming an eager entry chunk necessarily changed.

Replay with a normal clean `node scripts/ui.js build` and the current checkout plugin-asset prerequisites, then `node --import "$CHECKOUT/scripts/tsx.mjs" collector.mjs "$CHECKOUT" "$NEW_OUTPUT" "$EXPECTED_HEAD"`. Requires Chromium at /usr/bin/google-chrome and the checkout's frozen dependencies. The same collector is run on both listed revisions.
