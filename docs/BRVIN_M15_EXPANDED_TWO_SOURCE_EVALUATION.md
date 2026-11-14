# BRVIN M15 expanded two-source Core v2 evaluation

**Version:** expanded suite v1  
**Status:** implementation staged for validation; not yet executed  
**Environment:** isolated parmar-ai-m14-staging Worker + D1 only  
**Operator page:** /admin/m15/benchmark/multi-source  
**Endpoint:** POST /admin/m15/benchmark/multi-source/evaluate-expanded

## Purpose and boundary

This adds a separate 12-query page-target evaluation against the two immutable Physics sources already READY in the dedicated M15 staging project. It does not change or replace the original five-query evaluation, its receipt, the Qdrant dense/sparse diagnostic, production selectors, private v2 contract or Teachers integration.

The source inventory is already present and verified from staging D1:

| Source | Source ID | Pages | Indexed state |
|---|---|---:|---|
| Force and Laws of Motion - Class IX pilot handout | 01238b3a-9902-4a42-90b4-574048ee4f00 | 3 | READY, 3/3 pages; 7 existing Qdrant chunks |
| Physics Benchmark - M15 v1 | 3b4d116d-4c18-450f-9cba-cb2bec3da7ca | 8 | READY, 8/8 pages; existing M15 provider items/points |

Both documents and their physical pages were inspected as immutable PDFs. No new PDF, OCR operation, corpus generation or indexing step is needed.

## Query suite and source-page targets

The suite has 10 positive/near-miss questions and two out-of-corpus controls. The 11 expected page-target instances cover seven distinct source/page pairs.

| ID | Query family | Expected source/page |
|---|---|---|
| EX01 | Bus braking, inertia and seat belt | Class IX handout p. 1 |
| EX02 | Balanced forces and constant velocity | Class IX handout pp. 1-2 |
| EX03 | Newton's third law / swimmer action-reaction | Class IX handout p. 2 |
| EX04 | Constant velocity misconception / first law | Class IX handout p. 2 |
| EX05 | 20 N pull, 8 N friction, 4 kg box | Class IX handout p. 3 |
| EX06 | 15 N right versus 9 N left | Class IX handout p. 3 |
| EX07 | Work-energy theorem and final speed | M15 Physics p. 6 |
| EX08 | Inclined-plane components | M15 Physics p. 5 |
| EX09 | Momentum change and impulse | M15 Physics p. 7 |
| EX10 | Positive-sign near-miss; source's negative spring restoring force | M15 Physics p. 8 |
| EX11 | Planck constant / photon energy | No expected location |
| EX12 | Boyle's law / pressure-volume relation | No expected location |

These are source-checked page-target labels for reproducible retrieval testing. They are **not independent human passage/span qrels**, not an answer-quality audit and not evidence across multiple subject families. EX10 is a source-correction near-miss: the source contains the relevant correction on page 8, so it is not a no-evidence abstention control.

## Running the suite

1. Open the dedicated staging page and verify its environment label. Do not use the production admin or Teachers console.
2. Enter the existing staging operator token locally in the password field. Never send it in chat, logs or GitHub.
3. Click Prepare only if the page requires a READY re-check. Preparation reuses the immutable manifests and existing indexes; it does not upload a PDF or rerun OCR.
4. Click the separate expanded 12-query Core v2 evaluation button once. The endpoint validates both fingerprints, the exact project grant, page counts, READY states and the completed second-source provider checkpoint.
5. Read the returned receipt. It is persisted in m15_v2_multisource_runs; distinguish it by benchmark tag brvin-m15-core-v2-multisource-expanded-v1.

The run calls both provider paths through the real retrieveBrvinForApplicationV2 resolver for each query: 12 queries x 2 providers = **24 staging query reservations**. It records provider completion, both-source search counts, provenance violations, distinct page coverage, query-specific expected page-target coverage, per-query misses and the passages returned for EX11/EX12.

No-match candidate presence is diagnostic only. Passage text must be reviewed before calling a result a false positive. The report's operational ok flag covers source/authorization/provider/provenance/quota checks; retrieval quality is reported separately and does not automatically become a gate pass.

## Side effects

Allowed: provider reads/Vertex query embeddings, the normal staging quota reservations, and a staging D1 run receipt.

Not performed: PDF upload, Vision OCR, source or OCR mutation, GCS corpus regeneration, Qdrant upsert/delete, AI Search upload/delete, production D1 access, production selector changes, private v2 response changes, or Teachers changes.

## Interpretation limits and next gate

This expands document and query coverage within Physics, but it does not establish cross-subject generalization or independent human passage relevance. Keep it separate from the owner-waived 109-candidate passage assessment and from the original five-case paired receipt.

After the run, review every missing expected page and both negative-control candidate texts. Then add independent passage/span review or explicitly record a further owner waiver before any multi-feature evidence-sufficiency gate or reranker is considered. Keep production on Cloudflare AI Search.
