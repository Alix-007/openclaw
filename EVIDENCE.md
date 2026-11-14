# Native CLI proof refresh for #171681

Product head: `50c1828fe4df64fb0f9e5e092bdd3c237f231075`. Main integrated with an ordinary two-parent merge: `08ae8c62b83ede02db3a8d2bc3ce36206008d253`; prior contributor head `c45e78b57d7bf1d6f326f3fd7a7e5f76b3bdc625` remains in ancestry.

The existing frozen collector was replayed against a normal QA build with an exact clean-head build stamp. HEAD.json retains commands, observations, controls and actual recorder readbacks. The earlier BASE RED remains historical evidence in the PR body; this refresh only claims exact-head GREEN.

Runtime: Ubuntu 24.04, GLIBC 2.39, Node 26.12.1; qualified native process owner. No external provider, production Gateway, channel or Mac was used. Loopback fixtures and private state are task-owned. Full native traces, when present, are gzip-compressed base64 text; decode using base64 --decode then gzip --decompress. The raw-hash-readback index binds original and sanitized full-stream digests. Static checks are supporting evidence, not the behavior proof. The independent review discloses the exact boundaries and limitations.
