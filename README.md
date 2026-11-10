# Live model-usage window: native proof

BASE `d290127ec6750ac3b3504d44ab50b7cee5f92ec7` → product HEAD `ca4fcefac2d0e2aeebbd15f94e5583a8da192144`. This proof runs the shipped `skills/model-usage/scripts/model_usage.py` through its actual subprocess boundary into an unmodified official CodexBar 0.84.0 executable, then reads real JSON output. No fake CodexBar, mocked product function, provider call, account config or real user sessions are used.

Two synthetic Claude assistant records are stored as compact JSONL, matching native session serialization, at current UTC day and 45 days earlier. Each contains 1000 input and 100 output tokens for `claude-sonnet-4-20250514`; these are synthetic API-price estimates, not actual spend or a subscription bill.

Observed results:

| Scenario | BASE | HEAD |
| --- | --- | --- |
| Skill live `--days 60` | $0.0045, old record missing | $0.009, matches real 60-day export |
| Direct CodexBar 60-day export | both dates, $0.009 | both dates, $0.009 |
| Skill file/stdin import 60 | $0.009 | $0.009 |
| Skill without `--days` | $0.0045 default | $0.0045 default |
| Skill `--days 1` | $0.0045 | $0.0045 |

The file/stdin controls temporarily remove the only CodexBar executable from the isolated PATH; both succeed without live acquisition. Fixture bytes remain unchanged. Floating-point receipts preserve their original representations. The `base_head` receipt key records the subject commit on each run, including HEAD for the green run.

Executable: official release `https://github.com/steipete/CodexBar/releases/tag/v0.84.0`, Linux x86_64 tarball SHA256 `724b0beb0d2769cfc6fc1558f2782b5b812eb73a140582b9716faf662adbaea0`; executable SHA256 `c1723f529badf182e0d87328aa2f9204f9c635c94948308a868ccf8fa5e6b180`. Upstream tag source commit `5bebf9a05e68059eae11d5031c7239f1aa1d49ef`. Collector SHA256 `299afe5852ea4a6a3bf01c9d5a154942530640fe430f31e570d68461c52b10ff`.

## Reproduce

Use Python3.11+ and the extracted official binary/bundle on a compatible Linux environment (validated Ubuntu24, glibc2.39, libcurl4t64). Obtain the subject file from each clean product checkout and use a fresh output directory for each run:

```sh
python3 collect-container.py \
  --binary /path/to/codexbar \
  --expected-binary-sha256 c1723f529badf182e0d87328aa2f9204f9c635c94948308a868ccf8fa5e6b180 \
  --subject-script /path/to/checkout/skills/model-usage/scripts/model_usage.py \
  --subject-head "$(git -C /path/to/checkout rev-parse HEAD)" \
  --expected-subject-sha256 "$(sha256sum /path/to/checkout/skills/model-usage/scripts/model_usage.py | cut -d ' ' -f1)" \
  --out /tmp/model-usage-new
```

The collector constructs a fresh whitelisted environment. This run additionally used a task-owned container with network disabled, read-only root/input mounts, 1 GB/1 CPU, all capabilities dropped, and no-new-privileges; only the synthetic output directory was writable. Docker17 required `seccomp=unconfined` for modern glibc compatibility. No production environment was modified. Per-run receipts include full argv, stdout/stderr, exit codes, fixture/source/binary hashes and controls. `BASE_RED` is the expected pre-fix result; `MATCHES_EXPORT_CONTROL` is the green result; the process exit alone does not establish the outcome.

Limits: real native records were exercised for Claude on Linux only. Codex forwarding and absent-days transport have focused regression coverage, but Codex native scanning and macOS were not run. This does not validate upstream pricing accuracy, actual account billing, performance at scale or unsupported CodexBar versions. Local file/stdin behavior is preserved; live date ranges remain subject to CodexBar's own supported bounds. No config/default, protocol/schema, credential, permission or migration changes. The container is removed automatically; synthetic proof files are retained and can be deleted after inspection.
