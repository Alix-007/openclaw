# Git metadata repair — sibling failure attribution

Head `007ba2893badc4f534b679a1a391f6ceb40ed156`, baseline `5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78`, Git 2.39.3.

The exact owner tests pass (28 passed, three explicit platform/reftable skips). The eight direct sibling suites have 167 passing cases and 17 failures. Sixteen recovery/prompt failures are replayed on unchanged main using only the failed names; one native `--orphan` fixture setup fails before product code. This report does not call those suites green.

| Case | Attribution | HEAD / BASE evidence |
| --- | --- | --- |
| preserves lf prompt bytes and stat data after checkout | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:232 / git-metadata-remaining-baseline.log:75 |
| preserves crlf prompt bytes and stat data after checkout | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:417 / git-metadata-remaining-baseline.log:260 |
| selects raw/mixed-case prompts, not unrelated attributes | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:604 / git-metadata-remaining-baseline.log:447 |
| removes its partial checkout when the prompt consumer rejects preparation | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:616 / git-metadata-remaining-baseline.log:459 |
| reconstructs missing files without force, retires only its registration and retains the original capture | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:654 / git-metadata-recovery-baseline.log:109 |
| preserves changed residual writes before any repair | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:684 / git-metadata-recovery-baseline.log:139 |
| retains newer writes arriving during reconstruction | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:703 / git-metadata-recovery-baseline.log:158 |
| rejects a identity race before deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:729 / git-metadata-recovery-baseline.log:184 |
| rejects a registry race before deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:735 / git-metadata-recovery-baseline.log:190 |
| rejects a pending race before deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:741 / git-metadata-recovery-baseline.log:196 |
| never executes a repository clean filter while deleting reconstructed source | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:747 / git-metadata-remaining-baseline.log:497 |
| preserves a newer retained split-base before native deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:777 / git-metadata-remaining-baseline.log:527 |
| preserves a newer retained worktree-config before native deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:778 / git-metadata-remaining-baseline.log:528 |
| preserves a newer retained metadata-mode before native deletion | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:779 / git-metadata-remaining-baseline.log:529 |
| reconstructs clean symlink-file checkout representation | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:805 / git-metadata-remaining-baseline.log:555 |
| reconstructs native Unicode filename representation | INHERITED_REPRODUCED | git-metadata-remaining-siblings.log:835 / git-metadata-remaining-baseline.log:585 |
| Unborn-worktree fixture | Native Git rejects `--orphan`; setup before product, unchanged source | git-metadata-siblings.log / git-metadata-sibling-environment-failure.json |

Raw complete logs and all normalized comparison/source hashes are retained in the sibling-attribution JSON. SHA/PID and random fixture-root spelling alone are normalized; the failure type and substantive message must match. No passing cases were rerun, no assertion or skip was weakened, and no modern Git was installed.
