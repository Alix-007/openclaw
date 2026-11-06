# Favorites local versus hosted performance attribution

The CSS correction reduced **37 gzip /450 raw bytes** in the available matched local normal builds. It does not make the current local artifact budget pass. The new local head still exceeds CSS gzip by118B, CSS raw by187B and chat boot JS gzip by459B.

| Measured normal artifact | Node | CSS gzip | CSS raw | Chat JS gzip |
|---|---|---:|---:|---:|
| Local old head `5ce2ade…` |26.12.1|324,840|1,677,465|1,288,657|
| Local correction `d98c890…` |26.12.1|324,803|1,677,015|1,288,657|
| **Matched correction delta** ||**-37**|**-450**|**0**|
| Old hosted merge `0065d38…` |24.22.1|324,854|1,678,773|1,288,044|
| Old hosted main `4dc4518…` |24.22.1|324,781|1,678,048|1,288,237|

The exact correction commit changes only composer CSS. It therefore introduces no source-JS change, and measured chat JS is strictly unchanged in the local pair. This does not attribute the original whole feature against current main.

The hosted merge included main25 commits newer than local reviewed main `5bd69e0…`. One exact intervening change, #194012 (`1e8a1ab…`), splits UI selectors and changes `totalCssRawBytes` from1,676,828 to1,678,428 (+1,600B). Nineteen existing stylesheet files also changed across the exact main comparison. The local script still uses the earlier cap. The canonical budget gzip cap and chat JS cap remain the same. Node differs as well; its individual byte effect is unknown. Vite8.3.5 is the same in both logs.

Do not attribute old-hosted → new-local -1,758 raw bytes entirely to this correction: -1,308 bytes already separated old local and hosted snapshots. Do not subtract the earlier standalone CSS proxy or declare remaining118/187 bytes inherited. A matched new-candidate/actual-main artifact pair is needed for that conclusion.

All source comparison and existing receipts are retained in `favorites-local-performance-attribution.json` and `favorites-local-vs-ci-base-source.json`. This lane ran no new build, fetched no Git objects, polled no CI and edited no source. Root should retain known local failure disclosure and obtain exact new-head ordinary hosted attribution, not raise caps or expand into unrelated cleanup.
