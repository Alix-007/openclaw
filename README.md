# Managed worktree native Git metadata paths

Product BASE 5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78; committed clean HEAD 007ba2893badc4f534b679a1a391f6ceb40ed156. Same frozen collector SHA256 7a9448d2e684c3559cff1f1e028ae9b22e83cea1c83a0c4a90662579be6c844e.

A repository created with native `git init --separate-git-dir` is tested in two layouts. The ordinary metadata directory is a legal control. The second differs only by one literal trailing space. Native `git rev-parse --git-common-dir` returns that real character before its one final LF.

The actual normally built `openclaw.mjs worktrees create <checkout> --name proof --base-ref refs/heads/main --json` fails at the trimmed neighboring directory on BASE; HEAD succeeds. Both HEAD cells also independently read the checked-out marker file and run actual `worktrees list --json` against isolated disk state. Ordinary control succeeds on both revisions.

Normal build: `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`.
Replay: `python3 collector.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26/bin/node" base` for the base, `head` for the candidate. Receipt mode in BASE.json is authoritative; the collector accepts its existing baseline selector as shown in its source.

Owner tests:28 passed/3 explicit platform or reftable skips. Eight sibling suites:167 passed/17 failed on this Git2.39.3 host. Sixteen exact failed recovery/prompt names were replayed on clean BASE and have the same substantive failures; the remaining unchanged native fixture rejects unsupported `git worktree add --orphan` before product code. See case-by-case attribution and full logs. These suites are NOT labeled green. Native --attr-source/reftable/Windows are not claimed supported by this host; no assertion or policy was weakened.

The candidate integrated main74e1ecf132fb79cfe4e6f0cdbf41a03dc51eaa88 for the existing test-budget gate. Every touched original file and policy contract is byte-identical there to5fe; this does not relabel the original5fe native receipt.

All fixtures use disposable HOME/config/state/temp directories, native localGit and actual filesystem reads. No remote Git/model/provider/channel, production data or credentials. Child processes waited; fixture disks retained for inspection. Private workspace/tool roots replaced with $PROOF_ROOT/$NODE26; collector unchanged. Windows/reftable/remote execution and full modern-Git suite compatibility remain outside this proof.
