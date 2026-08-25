# PR #129567 exact-head compaction proof

This proof runs the production `generateSummary` entry point on product commit
`a0658c572070eb98f18f117ec255e05765881ea0`. The input is synthetic and includes a private
thinking sentinel, visible assistant text, and a tool call. A deterministic completion sink
captures the exact model-visible summary prompt and returns a valid summary.

Run with Node 24 from the repository root:

```sh
node --import tsx .github/proof/pr-129567/proof-harness.ts
```

`observation.json` and `proof.log` record that summary generation succeeded, private thinking
was absent from the provider prompt, and the visible answer and tool call remained present. No
provider credential, user session, transcript, or private data is used.
