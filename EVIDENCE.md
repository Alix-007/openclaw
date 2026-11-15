## What Problem This Solves

`infer image generate --output selected/../render.jpg` can successfully write into the wrong directory when `selected` is a directory symlink. Buffered image/video/TTS output and streamed video output lexically collapse the path before filesystem traversal; the same problem also affects newly created output parents and numbered outputs.

## User Impact

Explicit media output follows the directory the operator selected. One shared resolver covers buffered image, video and speech assets and the separate streamed-video caller. MIME-based extensions, numbered filenames, atomic publication, existing-output replacement, temporary-file cleanup and implicit media-store behavior stay with their existing owners.

## Why This Change Was Made

Use the existing asynchronous fs-safe prefix traversal to resolve an existing physical parent and preserve ordinary missing parent components. Refuse an unreachable missing/.. suffix and a final . or .. rather than redirect publication; each new refusal explains the parent-directory or filename change needed before retrying. Resolve the parent before adding MIME/index suffixes; reuse the helper from streamed video as well.

No new flags, defaults, dependencies, config, protocol, schema, permission or upgrade requirements. Source preflight covers the shared output owner and every caller. This completes output destination selection separately from the existing input-reading repairs, without changing provider policy or the generic atomic publisher.

## Evidence

**Product head:** `61be73516244fc9e1d5669dd423edf16c2b2299a`; BASE: `c0166c395cf81095f431808c9496cb6022ad4387`.
[Actual paired output, HTTP request records, file readbacks, frozen collectors and review](./MANIFEST.json).

| Real built CLI scenario | BASE | HEAD |
| --- | --- | --- |
| Image output through selected parent | PNG written in neighbouring lexical directory | Intended physical PNG, wrong path absent |
| Two numbered PNGs / new nested output parent | Both numbered files / new parent created at wrong location | Intended physical destinations |
| Streamed video through selected parent / new nested parent | Download succeeds into wrong directory | Actual HTTP stream publishes at intended physical destinations |
| Ordinary image and streamed video controls | Correct bytes at ordinary path | Same bytes at ordinary path |

- **Exact commands:** `python3 media-output-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE` and `python3 media-stream-output-proof-v1.py CHECKOUT FRESH_OUTPUT NODE26 MODE`, with `red` on BASE and `green` on HEAD. Each collector is byte-identical within its pair; hashes `fa7985f5fc41114a467d00a354c47698d4ba0b698e225a6b63b30e29e488fe8c` and `bacd547be74f7b46e2770cb94af35bf4fe28eb1e60850c9884fe59043b77e42e`. Both require a clean matching-head normal `cliStartup` build; final build exits0 in240.279s.
- **Production entries / canonical owner:** real `openclaw.mjs infer image generate` -> bundled OpenAI adapter -> `writeOutputAsset`/physical output resolver; real `infer video generate` -> bundled DeepInfra adapter -> URL download stream -> the same resolver and existing atomic publisher. The two loopback HTTP servers record actual requests; no provider adapter, resolver, stream consumer or filesystem publisher is mocked.
- **Recorder/readback:** four image scenarios produce five independently read PNGs; three URL-video scenarios produce three independently read streamed files. HTTP paths/request bodies, stdout/stderr, exit statuses, output paths and byte hashes are retained. BASE produces three wrong image scenarios and two wrong streamed-video scenarios; all seven HEAD scenarios pass. Intended path presence changes0 to1 and wrong path presence1 to0. The ordinary image/video controls pass on both. Samples are inspectable outside the product branch.
- **Focused tests:** `pnpm test src/cli/media-output.test.ts src/cli/capability-cli.test.ts --maxWorkers=1`:123 PASS in193.792s wall on the repair; unchanged caller tests and new exact recovery-message checks are included. They cover both output counts, missing parents, final . and .. no-write refusal, streamed actual-file bytes, retained decoy mode/content and no temporary leftovers. The initial new streaming test used a directory expectation incompatible with its new fixture; that new assertion was corrected before the final full PASS, without relaxing existing assertions. Semantic types, typed lint, format and staged test/file line ratchets pass. This follow-up proactively adds recovery guidance for the two new refusal paths. Independent source review passes; final exact-head evidence review is recorded in the linked package through the authorized GPT6.1Sol route.
- **Cleanup:** private HOME/config/state and synthetic fixture providers inside network-disabled Ubuntu24.04/Node26.12.1 containers. HTTP servers close; no external provider charges, production config/channel or real user data is involved. No proof assets or CHANGELOG changes on the product branch.
- **Not tested:** real external OpenAI/DeepInfra service availability, video playback, native macOS/Windows, hosted CI or the full repository suite. The streamed-video fixture establishes transport and file publication identity; it does not claim a playable generation. Buffered speech/video share the exercised output owner and existing focused caller tests; their real remote services were not contacted.

<details><summary>Production / test LOC</summary>

```text
29	0	src/cli/capability-cli.video-output.test-support.ts
2	2	src/cli/capability-cli/video.ts
72	0	src/cli/media-output.test.ts
18	1	src/cli/media-output.ts
```

</details>
