# Native CLI proof refresh for #197502

Product head: `9fde0dee56b5e5de702a299c108872dbdf1154c3`. Main integrated with an ordinary two-parent merge: `08ae8c62b83ede02db3a8d2bc3ce36206008d253`; prior contributor head `fd429b3827b65ede726fcb8c2c93e2e58cff0a3d` remains in ancestry.

The existing frozen collector was replayed against a normal QA build with an exact clean-head build stamp. HEAD.json retains commands, observations, controls and actual recorder readbacks. The earlier BASE RED remains historical evidence in the PR body; this refresh only claims exact-head GREEN.

Runtime: Ubuntu 24.04, GLIBC 2.39, Node 26.12.1; qualified native process owner. No external provider, production Gateway, channel or Mac was used. Loopback fixtures and private state are task-owned. Full native traces, when present, are gzip-compressed base64 text; decode using base64 --decode then gzip --decompress. The raw-hash-readback index binds original and sanitized full-stream digests. Static checks are supporting evidence, not the behavior proof. The independent review discloses the exact boundaries and limitations.
