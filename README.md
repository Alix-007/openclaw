# Updated exact-head native proof

Product HEAD `43de61602252038fc6b40a16cb4ec859dd9083ca`. Production script SHA remains `e130f320a40d8e2faee6315bb34d6395da4fdc3c7cb67decbaba86db0284b406`; the only follow-up change organizes test imports to satisfy Ruff0.17.4. No production or test assertions changed.

Fresh native run of the same frozen collector `299afe5852ea4a6a3bf01c9d5a154942530640fe430f31e570d68461c52b10ff` with official CodexBar0.84.0 again reports `MATCHES_EXPORT_CONTROL`: live60-day total $0.009 equals the real direct60-day export. No-days and1-day controls remain $0.0045. File/stdin no-executable controls pass, and synthetic fixture bytes are unchanged. These are synthetic API-price estimates, not actual spending.

Full unchanged BASE receipt, collector, fixture, release hashes, reproduction instructions and limitations: https://github.com/Alix-007/openclaw/tree/1478d3c69f22c845559c2a77d3951e06edcc8966.

The new receipt retains complete stdout/stderr, exit codes, argv and all control readbacks. The host-binding record verifies source bytes and product commit before/after the isolated container command. Only host task/Python installation paths are normalized; observations are unchanged. Ubuntu24/Linux native Claude scanner only; Codex native scanning and macOS remain untested. No real data, credentials or provider requests were used. Container removed; evidence files retained.
