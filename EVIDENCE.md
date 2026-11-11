# Terminal Find fractional-preview maintenance evidence

Product HEAD `241f3bb34cb578685c75cdc78a1836ed1f1026a2`, tree `38e1854e7d70ffa53441562bb602dd81541d4819`, previous published source `f7b0ceafae9e8d47dbae306a378bf57a16d10dd4`. Normal commit hooks completed. Source/test/allocation SHA pins match the independent reviewed snapshot. That review predates commit; it is an independent fallback review, not official helper or hosted CI approval.

At font-size12.1px and panel width320.25px, the old selected mark ends at303.296875 while its preview ends at303.25. After outward rounding and one pixel of trailing scroll room, the mark ends at302.296875 inside the same edge. No strict assertion was relaxed. Six existing browser flows remain; the one changed regression adds a fractional-font line and changes its existing resize width. Near-start controls remain visible, and both stages send zero terminal input and record no page errors.

The unchanged frozen collector ran after commit on clean `241f3bb34cb578685c75cdc78a1836ed1f1026a2`, exit0,9.698s. BEFORE loads the two repaired production files from `f7b0ceafae9e8d47dbae306a378bf57a16d10dd4`; AFTER loads exact committed checkout bytes. Both records correctly report the runner's final HEAD, while `sourceCommit` and source hashes identify the actual old/new inputs. Four raw PNGs and measured geometry are preserved; image hashes match the earlier independently visually inspected frames.

```sh
node --import ./scripts/tsx.mjs PATH_TO/terminal-render-proof.mts CHECKOUT f7b0ceafae9e8d47dbae306a378bf57a16d10dd4
```

Precommit source-equivalent checks pass:6 browser tests,13 scroll-owner controls, production types, canonical browser types, scoped typed lint, stylelint, format, controller check, keyless i18n baseline, line cap and changed-mock check. `checks.json/log` retain original heads/diff/log hashes; they are not relabeled as post-commit reruns. The historical old scalar checker is included as historical only.

Modern test allocation passes separately in10.777s on private local CI merge view `efc5efe38886fe347a1ecef8ef86064d3a6a5b8b` / tree `015831c2bd42a41f0f6fa6859dffa1fd92d52210`, main `aab88e31bf5a64012a699139e19af193fa9a69c7` and exact product repair. Its recorded command is canonical `check-test-lines-ratchet.mts --base aab88e31bf5a64012a699139e19af193fa9a69c7 --no-merge-base`, exit0,slack1. `local-ci-view.json` records that the product branch is unchanged and this view is not public. The complete219LF feature test has an exact219LF own grant; no shared scalar raise is used. This is not a claim of a product-branch main merge or hosted CI result.

Maintenance diff from previous published head: component+2/-2, CSS+2/-0, existing test+2/-1 (net1LF), allocation+1/-0. No new test flow/matrix, abstraction, observer or product/search policy. Literal case-sensitive retained-visual-row semantics and explicit refresh/navigation remain.

This final maintenance replay covers the actual production component, canonical Solid/Vite transform and real Ghostty WASM in Chromium. It is not a new full UI build, live Gateway/Bash PTY, provider, Safari or WebKit verification. Earlier maintainer recordings retain their original historical scope and credit. Hosted CI remains separate.

The old nine-file draft evidence package and prior failure/setup history remain intact. This fresh package is bound to the actual final committed replay. Original private prefixes are redacted only after verifying their raw hashes; collector and PNG bytes are unchanged.
