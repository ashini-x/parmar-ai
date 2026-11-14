# BRVIN M15 expanded two-source Core v2 evaluation

**Version:** expanded suite v1  
**Status:** expanded run completed; operational/page-target subgate passed; comparative quality follow-up open  
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

## Expanded two-source Core v2 receipt — 14 November 2026

**Persisted staging receipt:** `0f5f9769-452a-466e-b5ae-735ddba6378a`  
**Benchmark:** `brvin-m15-core-v2-multisource-expanded-v1`  
**Environment/project:** isolated staging / `890f6317-69f4-4391-aae6-556155ed0d12`  
**Pinned sources:** Class IX Force and Laws of Motion (3 pages) and M15 Physics Benchmark (8 pages); both fingerprints matched and both sources were READY.  
**Suite:** 12 queries (10 positive/source-correction cases and 2 expected no-match controls), executed through both providers using the existing private Core v2 resolver.

### Execution and page-target results

Both providers completed all 12 queries with zero failures, searched both READY sources for every query, returned evidence from both source IDs, and recorded zero provenance violations. All structural, source-pinning, provider-completion, provenance and quota-accounting checks passed.

| Measure | Cloudflare AI Search | Qdrant + Vertex |
|---|---:|---:|
| Expected query/page-target instances found | 11/11 | 11/11 |
| Distinct expected source/page locations found | 7/7 | 7/7 |
| Positive queries with all expected pages | 10/10 | 10/10 |
| Expected no-match queries with candidates | 0/2 | 2/2 |
| Total returned candidates across no-match queries | 0 | 5 |

The 11 target instances represent query-specific targets across seven distinct physical source/page pairs. This is page-target coverage in the returned candidate lists; it is not passage/span relevance precision, rank-sensitive nDCG/MRR, claim entailment or generated-answer correctness. EX10 remains a source-correction near-miss with relevant evidence on M15 page 8, not a no-evidence abstention case.

### No-match review and latency

The two expected no-match questions were manually inspected at passage-text level:

- **EX11 — Planck constant / photon energy:** AI Search returned no candidates. Qdrant returned three unrelated passages from the Class IX handout p. 1 and M15 Physics pp. 8 and 6.
- **EX12 — Boyle's law / pressure-volume relation:** AI Search returned no candidates. Qdrant returned two unrelated passages from M15 Physics p. 1 and the Class IX handout p. 2.

The five Qdrant passages do not answer either question. Treat this as a confirmed no-match retrieval-precision/abstention problem for this small test set, not proof of answer-generation behavior.

| Provider | p50 | p95 | Samples |
|---|---:|---:|---:|
| Cloudflare AI Search | 3,333 ms | 6,762 ms | 12 |
| Qdrant + Vertex | 1,162 ms | 1,216 ms | 12 |

These are 12 sequential staging observations only. They are not concurrent load measurements, production percentiles, a throughput benchmark or an SLO.

**Quota:** 21 before, 45 after; exactly 24 staging reservations (12 queries × two providers). No PDF upload, Vision OCR, source/OCR mutation, GCS regeneration, provider index writes, production D1 access, production selector change, private v2 contract change or Teachers runtime change was part of this run.

### Subgate decision and next gate

The expanded two-source Physics page-target execution subgate **PASSED**. Comparative provider acceptance remains **OPEN**: page-target coverage is tied, while Qdrant fails both no-match controls and AI Search abstains cleanly. The sequential latency difference is insufficient to choose a provider. Do not declare a provider winner, choose a cutoff, add a runtime evidence gate/reranker or authorize production cutover from this receipt.

M15 remains **IN PROGRESS**. Next evidence must include independently adjudicated passage/span qrels, query-family and source-group holdouts, additional subject/source families beyond this two-source Physics-only corpus, near-miss and true no-match controls, and representative concurrency/throughput/recovery/cost tests. Reuse immutable READY source/OCR artifacts where available; do not re-upload or rerun Vision OCR merely to change retrieval providers. Keep production on Cloudflare AI Search and preserve it as rollback provider.
