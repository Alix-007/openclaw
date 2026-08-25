# Google response model proof

This proof runs the exact product implementation at
`3adc4c0f7d92b4f2f358f69bfadf3e8fe3f67663` through the pinned
`@google/genai` 2.17.1 SDK and a real loopback HTTP SSE server.

It verifies that a request for `gemini-2.5-pro` retains the SDK response's
concrete `gemini-2.5-pro-002` model together with its response ID and terminal
status. No provider credentials, external services, transcripts, or user data
are used.

Run from the repository root with Node 24:

```sh
node --import tsx .github/proof/google-response-model/harness.mts
```

The expected machine-readable verdict is committed as `observation.json`.
