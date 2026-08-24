# PR #128477 exact-head hook reload proof

This credential-free harness runs the production `buildImportUrl` owner from exact PR head `d5fdcb76fb00cb38210699c4915f8e835aa396ca`, then uses native dynamic imports to execute a mutable workspace hook before and after an equal-byte-length edit whose modification time is restored.

## Result

| Observation | Before | After |
| --- | --- | --- |
| Handler result | `before` | `after!` |
| Source bytes | 31 | 31 |
| Modification time | `1767225600000` | `1767225600000` |
| Change time | `1787545403340.9922` | `1787545403364.9937` |
| Import URL | redacted path with `t`, `c`, and `s` query | different redacted URL because `c` changed |

The run passed all five recorded invariants: equal size, equal mtime, changed ctime, changed import URL, and changed executed behavior. It used Node v22.22.0.

## Artifacts

- `hook-import-ctime-proof.ts`: inspectable harness source. Run it from an exact-head OpenClaw checkout with the artifact output directory as its only argument.
- `observation.json`: structured head, Node, source hashes, stat metadata, redacted URLs, handler results, and verdict.
- `proof.log`: compact terminal output from the same run.
- `SHA256SUMS`: artifact integrity hashes.

Example from an exact-head OpenClaw checkout with this proof branch in an adjacent `proof` directory:

```text
./node_modules/.bin/tsx ../proof/hook-import-ctime-proof.ts ../proof
```

## Boundary and redaction

The harness imports the production owner from the current checkout and exercises real Node ESM cache identity against a temporary `.mjs` handler. Temporary paths are replaced with `<redacted>` in every saved artifact. No credentials, user data, private identifiers, network services, or agent transcript are used or recorded.
