# Session-tail broken-pipe proof

Product head: `85ad3d9763ee5b9e81f844ba2db48760788cd068`. Acceptance-red base: `83872e599d5720c0bc97d313283a2bc245046699`.

The normal built `openclaw.mjs sessions tail --follow` reads canonical synthetic SQLite events. The collector closes the real OS output pipe after the first event, commits a second legal event, and observes process settlement. It never invokes a replacement tail implementation.

BASE kept both the launcher and CLI alive for 6000.22 ms after the committed second event. HEAD naturally exits 0 in 1067.28 ms, with zero live owned processes before cleanup and no cleanup signals needed. Exit 0 preserves the existing console-output owner policy. Both versions continue to show new events and exit 130 on SIGINT / 143 on SIGTERM. All finite second-event readbacks pass. Configuration bytes are unchanged.

Run the same frozen collector and fixture from one directory on each clean, normally built checkout:

```
python3 collect.py CHECKOUT NEW_OUTPUT NODE26 red
python3 collect.py CHECKOUT NEW_OUTPUT NODE26 green
```

Collector SHA-256: `d871e72bb3c5759a2180b940043f1afed5eb6e38bc1f38e059faa9f9055ed4f2`. Fixture SHA-256: `4e653197156364d2420f1a31c2779c9aee4faf13e335ad7805d59b5242abd128`. The `red` and `green` selectors change only the expected outcome; commands, fixtures, controls, and observation bounds are identical. JSON receipts use placeholders for private filesystem locations; observed streams and runtime outcomes are preserved. The manifest hashes these published bytes.

Focused owner suite: 30 passed, 75.954 seconds command wall time. Targeted types, lint, format and staged test-line ratchet pass; the +31 LF allocation is exactly this regression growth. Canonical native-parser inspection confirms both existing annotated module factories and the baseline ledger unchanged. The full-repository mock gate is deferred to PR CI; an overbroad local scan was cancelled, not passed. Fresh independent adversarial review found no P0–P3 findings.

Scope and cleanup: Linux / Node 26, actual subprocesses and SQLite storage, synthetic fixtures only. The fixture writer imports canonical source setup APIs; command behavior uses the built CLI. There is no remote Gateway, provider/channel, real-user session, Windows or macOS claim. Harness cleanup signals are recorded separately from natural command exit; no SIGKILL contributes to GREEN. Task-owned fixtures are retained for inspection.
