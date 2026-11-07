# Actual paired performance: main1de vs Favorites faa

Both normal builds and canonical absolute gates completed. Both gates exited1. Reusing their saved measurements in the unchanged canonical base-aware evaluator leaves **five material violations**. No thresholds/source/sidecars were edited; no proxy compression or extra optimizer/build loop was used.

| Metric (bytes) | Main1de | Candidatefaa | Delta | Paired limit | Paired result |
|---|---:|---:|---:|---:|---|
| document gzip | 15,982 | 16,002 | +20 | 16,046 | within inherited64B variance |
| largest JS gzip | 564,216 | 564,549 | +333 | 564,484 | FAIL +65 |
| total CSS gzip | 325,566 | 325,634 | +68 | 325,630 | FAIL +4 |
| total CSS raw | 1,676,608 | 1,676,883 | +275 | 1,676,672 | FAIL +211 |
| chat boot JS gzip | 1,294,705 | 1,295,038 | +333 | 1,294,769 | FAIL +269 |
| new boot JS gzip | 802,982 | 803,315 | +333 | 803,250 | FAIL +65 |

Main build116.375s; candidate build120.328s. Main metric CLI42.388s; candidate42.506s. Normal metadata (branch/timestamp/buildID) differs: do not attribute the document20B increase solely to the feature. The shared-asset333B increase appears in largest JS and both route totals; these rows overlap and must not be added as separate payload. Both have identical package/lock/performance/compression source hashes.

Native functional proof is a separate bounded PASS; it does not change these performance results or the human personal-versus-shared product HOLD. Hosted exact-head CI remains separate.
