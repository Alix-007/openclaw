# Test-line accounting context

The original product baseline is an older clean main commit with70 inherited test LF of debt. Current upstream main has already reconciled that debt. Each final patch grants only its own new test LF; it must not credit the same old debt a second time in the PR merge tree. The old first-probe CI log rejected exactly that duplicate credit:119 vs allowed49.

The canonical CI run uses the two-parent PR merge snapshot and its exact frozen first parent, not an isolated old branch snapshot. The failed run's actual merge commit was `c6ff3fcf0da3cb6632a9d81ca0bd4ef92b6f3077`, first parent `437b1993291d43620fd3fb1b073312141e983d79`. The local accounting check executes the unchanged upstream checker against a normal Git merge tree of that frozen main parent and each final candidate. It uses a separate temporary index, leaving the candidate's worktree/index untouched. No production source is substituted for behavior proof.

Reproduction (set PRODUCT_HEAD to the exact final product SHA; fetch the two required commits first):

```sh
CI_BASE=437b1993291d43620fd3fb1b073312141e983d79
INTEGRATION_TREE=$(git merge-tree --write-tree "$CI_BASE" "$PRODUCT_HEAD")
CI_INDEX="$PROOF_ROOT/ci-context.index"
GIT_INDEX_FILE="$CI_INDEX" git read-tree "$INTEGRATION_TREE"
GIT_INDEX_FILE="$CI_INDEX" node --import ./scripts/tsx.mjs \
  scripts/check-test-lines-ratchet.mts --base "$CI_BASE" --no-merge-base --staged
```

`checks-summary.json` records the exact candidate HEAD, integration tree, checker blob, frozen parent, command, stdout and exit. This proves the accounting gate for that integration snapshot. Hosted CI and later moving-main outcomes remain separate observations. Native behavior proof still runs the actual clean product commit through its normal entry.
