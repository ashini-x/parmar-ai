# BRVIN M15 Core v2 multi-source staging runbook

**Environment:** isolated `parmar-ai-m14-staging` Worker and D1 only  
**Operator page:** `/admin/m15/benchmark/multi-source`  
**Provider comparison:** dedicated M15 staging AI Search vs Vertex AI + Qdrant  
**Core contract:** unchanged private `retrieveBrvinForApplicationV2`  
**Production:** remains on Cloudflare AI Search; no cutover

## Purpose

This gate extends the existing eight-page M15 Physics benchmark project with a second, independent three-page Physics source. It verifies that the real Core v2 service resolves both D1-authorized READY sources for each query, preserves source/page provenance, and returns evidence from both source documents through both provider paths.

The action reuses the immutable M14 source/corpus generation. It does not re-upload the PDF or submit another Google Vision OCR request. It does not add provider access, credentials, SDKs or configuration to BRVIN Teachers.

## Prerequisites

The one-time Core v2 authorization/revocation action must have a persisted `passed` receipt in `m15_v2_authorization_runs`. That action seeds the fixed staging application, environment, project, grant and original eight-page source into the isolated D1.

The staging project must contain its original eight-page M15 source as READY (8/8). The authorization receipt confirms the current eight-page source, project identity and query-only Qdrant path. Do not manually create another project, application, source or grant.

Pinned source inventory:

| Source | Source ID | Physical pages | SHA-256 / generation |
|---|---|---:|---|
| M15 benchmark | `3b4d116d-4c18-450f-9cba-cb2bec3da7ca` | 8 | `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92` |
| Existing M14 Physics handout | `01238b3a-9902-4a42-90b4-574048ee4f00` | 3 | `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`; generation `57129957231e548064e5594d8fb9f501` |

The three-page source has seven deterministic chunks in its already verified private GCS corpus generation. The M15 eight-page source currently has 14 Qdrant points and eight READY page items in the separate M15 AI Search instance.

## First prepare attempt and corrected upload wire format — 13 November 2026

The first protected Prepare attempt (before the follow-up correction) returned `AiSearchError: invalid_metadata_format`; it did not establish READY state, and the paired evaluation was not run. The cause was a mismatch between the upload binding and the instance schema: the AI Search Items Workers binding accepts `Record<string, string>` metadata values, while the upload supplied `pdf_page` as a JavaScript number. The field's custom metadata schema remains correctly declared as `number`; the service casts the string wire value according to that schema.

Core PR [#241](https://github.com/ashini-x/parmar-ai/pull/241) merged as `d9313d822f63960d8baa22404c6f323c89415945`. It changes the upload to send `pdf_page: String(page)`, narrows the Core binding type to string values, and adds regression coverage. Post-merge validation passed full typecheck/tests/build; production deploy and live verification were skipped. M14 staging workflow [#43317133051](https://github.com/ashini-x/parmar-ai/actions/runs/43317133051) deployed staging Worker version `a1158a7c-4422-4768-93e0-140363e791c2` at 100% using deployment `b46a8d37-362c-4ac3-94f8-68f602d367a3`. Cloudflare version read-back confirms the dedicated M15 AI Search instance, Qdrant collection and isolated staging D1 remain bound. Production Core and Teachers versions did not change.

**Post-correction Prepare result — verified 13 November 2026:** the protected operator returned `ok: true`, `qdrantPointCount=7`, `qdrantStatus=ready`, `aiSearchItemCount=3`, `aiSearchStatus=ready`, `status=ready` and `authorizedReadySourceCount=2`. Its side-effect flags were all false, including PDF upload, Vision OCR, source/OCR mutation, production D1 access, production provider change, Qdrant upsert/delete and new staging point adds. Independent read-only staging D1 verification confirms exactly two mapped books, both READY (original M15 source 8/8, M14 handout 3/3); the second-source checkpoint is READY with seven Qdrant points and three AI Search pages. All three exact-key AI Search items are `completed` with numeric `pdf_page` 1–3.

**Paired evaluation result — verified 13 November 2026:** run completed and persisted as `passed` under receipt `18728f63-e13d-4e73-880f-a2b980844d04`. D1 contains one passed run and zero failed runs; project quota moved from 1 to 11, exactly ten reservations. See **Recorded paired result** below. Do not rerun the same evaluation merely to reproduce the receipt; continue with the separately planned M15 quality/recovery/load/cost/rollback gates.

## Prepare the second source

After the code PR is merged and the M14 staging workflow deploys the updated isolated Worker:

1. Open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/multi-source`.
2. Confirm the page identifies Core-only isolated M15 staging and the pinned second source. Do not use the production admin or any Teachers page.
3. Enter the existing `BRVIN_M14_ADMIN_TOKEN` into the local password field. Never send it in chat or add it to GitHub.
4. Click **Prepare second source from immutable manifests** once.
5. The action verifies the source SHA, generation, three physical pages, seven chunks and stable source/page keys; it then replays those chunks into the dedicated M15 Qdrant collection and indexes the three existing raw-OCR page texts into the separate M15 AI Search instance. The AI Search Items Workers binding accepts string-valued metadata pairs, so the upload sends `pdf_page` as `"1"`, `"2"` or `"3"`; the instance schema still declares `pdf_page` as `number` so AI Search stores it as a numeric filter field.
6. If AI Search reports `queued` or `running`, re-enter the token and repeat the same preparation action after the item has had time to finish. It inspects the existing deterministic item key and resumes; it does not upload the PDF or rerun OCR.
7. Proceed only when the result says `status: ready`, Qdrant has seven points for the second source, AI Search confirms all three exact page items completed, and D1 contains exactly the two intended READY sources in the existing M15 project.

Qdrant point IDs and AI Search page keys are deterministic. D1 checkpoints make preparation resumable. The source is not marked READY until both provider indexes are confirmed. If an AI Search item is in a terminal or unexpected state, stop and inspect it; do not delete or blindly overwrite it.

## Run the paired Core v2 evaluation

1. Re-enter the staging operator token.
2. Click **Run paired Core v2 multi-source evaluation** once, after preparation reports READY.
3. Review the JSON receipt on the page. The evaluation also persists its result in the staging-only `m15_v2_multisource_runs` table.
4. The five fixed queries run against both providers through the same Core `retrieveBrvinForApplicationV2` service path. The AI Search call uses the dedicated staging instance override; the Qdrant call uses the server-side staging provider override. Both resolve the same D1 application/environment, active project grant, READY source inventory and quota authority.

The suite contains four positive mixed/concept/formula queries and one Planck-constant no-match query. Its eight expected physical-page locations are:

- Mixed second-law and rough-floor worked example: M14 pages 2–3 plus M15 page 1.
- Static versus kinetic friction: M14 page 3 plus M15 page 4.
- Mass/weight and second-law context: M15 pages 2–3.
- Restoring-force formula/sign: M15 page 8.
- No-match control: Planck constant/photon-energy equation, absent from both pinned sources.

The evaluation makes ten staging query reservations (five queries × two provider paths). It does not generate Gemini answers and does not modify either index. It records provider completion, searched-source counts, returned source/page locators, provenance violations, expected-location coverage, no-match candidate presence and per-query timing.

## Interpretation and pass criteria

The saved receipt should report all named checks as true:

- Exactly the two approved source PDFs are READY in the project.
- Both providers complete every query.
- Both providers report both READY sources searched for every query.
- Neither provider returns a source ID or physical page outside the two D1-authorized source inventories.
- Evidence from both source IDs is represented in the paired results.
- Exactly ten staging quota reservations are recorded.

Read `expectedLocationCoverage` alongside each query's `expectedLocationHits`; a source appearing somewhere in the suite does not prove every expected page was retrieved for its own query. The single no-match query is diagnostic: a candidate is not automatically a false positive until its text is reviewed against the source. This five-query run is a source-discovery/provenance gate, not independent passage qrels, claim-to-passage adjudication, answer correctness, answer abstention, a representative load test, a production SLO or a full cost study.

## Receipt read-back

Use read-only D1 access to inspect the most recent run:

```sql
SELECT id, status, result_json, started_at, completed_at
FROM m15_v2_multisource_runs
ORDER BY started_at DESC
LIMIT 5;
```

The table is initialized lazily by the preparation/evaluation action. Its absence before the first action is expected. A `running` row is not a pass; inspect the final status and every named check.

The preparation checkpoint is recorded in `m15_v2_multisource_sources`. It records the pinned source/generation identity, Qdrant point count, AI Search progress and overall status.

## Recorded paired result — 13 November 2026

**Persisted receipt:** `18728f63-e13d-4e73-880f-a2b980844d04`  
**D1 status:** `passed` (one row, zero failed rows)  
**Environment/project:** isolated staging / `890f6317-69f4-4391-aae6-556155ed0d12`  
**Provider paths:** `cloudflare-ai-search` and `qdrant-vertex`  
**Quota:** 1 before, 11 after; exactly ten reservations (five queries × two provider paths).

All seven named structural checks passed: exactly two authorized READY sources; both providers completed all five queries; both searched both READY sources per query; no provenance violations for either provider; evidence from both sources appeared across results; and exactly one reservation per provider query. Both providers completed 5/5 with zero failures and zero provenance violations.

### Query-specific expected-page hits

There are **eight query-specific expected page-target instances** but only **seven distinct source/page pairs**, because M14 handout page 3 is expected by both MS01 and MS02. Use per-query hits rather than interpreting the unique-page summary as per-query recall.

| Case | AI Search expected hits | Qdrant/Vertex expected hits | Interpretation |
|---|---:|---:|---|
| MS01 — second law + rough-floor example | 3/3 | 3/3 | Both found the handout pages 2/3 and M15 page 1 |
| MS02 — static vs kinetic friction | 1/2 | 2/2 | AI Search found M15 page 4 but not the expected handout page 3; Qdrant found both |
| MS03 — mass/weight + second law | 2/2 | 1/2 | Qdrant found M15 page 3 but missed expected M15 page 2 |
| MS04 — spring restoring-force formula/sign | 1/1 | 1/1 | Both found M15 page 8 |
| MN01 — Planck constant / photon energy no-match | 0 expected | 0 expected | AI Search returned no candidates; Qdrant returned 3 candidates |

The receipt's distinct-page aggregate is AI Search **7/7 (100%)** and Qdrant/Vertex **6/7 (85.7%)**. Query-instance hits are **7/8 (87.5%) for each**, but the missed query target differs. Qdrant's missing distinct target is M15 source page 2 on MS03.

For MN01, Qdrant's three returned passages came from the handout page 1 and M15 pages 8 and 6. These passages do not contain the requested Planck/photon-energy evidence; this is a no-match candidate/precision warning, not an answer-generation test. AI Search returned zero candidates.

### Latency and limits

| Provider | p50 | p95 | Samples |
|---|---:|---:|---:|
| Cloudflare AI Search | 4,394 ms | 6,718 ms | 5 |
| Qdrant + Vertex | 1,441 ms | 1,611 ms | 5 |

Qdrant/Vertex was faster in this small sequential sample, but n=5 is not a representative load test, Worker p95/p99 baseline, production SLO, or end-to-end answer-latency comparison. The evaluation made no Gemini calls and assessed no generated-answer correctness, abstention, claim entailment, or independent passage qrels.

**Subgate decision:** two-source authorization, provider completion, source discovery, provenance and quota accounting **PASSED**. Comparative retrieval-quality evidence is mixed: AI Search has higher distinct-page coverage and clean no-match abstention; Qdrant is faster but misses M15 page 2 in MS03 and emits three unrelated candidates on MN01. Do not declare an overall provider winner or authorize production cutover based on this receipt alone.

## Completed M15 action — Qdrant component-rank diagnosis — 13 November 2026

The paired receipt shows a speed/quality trade-off, but it does not expose the separate dense and sparse ranks that produced Qdrant's final RRF list. Do **not** set a fixed RRF score cutoff: RRF values are ranking values, not calibrated relevance probabilities, and a cutoff chosen from one negative query could remove a relevant low-ranked passage.

The protected multi-source operator now includes **Diagnose Qdrant dense/sparse component ranks** at `POST /admin/m15/benchmark/multi-source/diagnose`. Use the same staging page and enter `BRVIN_M14_ADMIN_TOKEN` locally. It runs the five pinned cases (MS01–MS04 and MN01) against the exact two READY source IDs from the isolated M15 project. For each query it returns the top 15 dense and sparse component ranks separately, with physical page, source, point/chunk identity, component score and a short passage preview. It also reports expected-location hits for each component.

**Safety and accounting:** the handler validates the two D1 project-mapped READY sources and the READY second-source checkpoint; it applies the exact M15 project/source allowlist to both Qdrant component calls; it skips collection preparation/index checks; it does not call the normal Core v2 resolver or reserve application query quota; and it does not write D1, Qdrant points, AI Search items, source/OCR data or production state. It makes five Vertex query-embedding requests and ten Qdrant component reads (dense + sparse per query), so provider usage/cost still applies. November project query usage must remain unchanged.

**Diagnostic questions to answer from the JSON:**
- Is the expected M15 page 2 for MS03 present in either component's top 15, and at what rank?
- Do MS03's M15 page 3 / page 1 candidates dominate dense, sparse or both?
- For MN01, do the three unrelated candidates appear in dense, sparse or both, and at what component ranks?
- Which exact terms/chunks explain any sparse matches on the no-match case?
- Does MS02's handout page 3 remain present in component candidates even though AI Search missed it in the paired resolver run?

Use these results to design a bounded feature/weight/rerank change and add regression cases for MS01–MS04 plus the MN01 abstention control. Retest positives and negatives together. Do not introduce an uncalibrated score threshold or claim a quality fix until the receipt demonstrates that positive recall did not regress and no-match candidates are reduced. Keep production on AI Search.

## Post-fix paired evaluation receipt — 14 November 2026

**Persisted receipt:** `fa1b8076-9375-480b-bb4b-e22d1c13d9bb`  
**Baseline receipt:** `18728f63-e13d-4e73-880f-a2b980844d04`  
**D1 status:** `passed`; both providers completed all five cases  
**Quota:** 11 before, 21 after; exactly ten reservations

All seven structural checks passed: exactly two authorized READY sources; both providers completed every query; both searched both READY sources on every query; zero AI Search provenance violations; zero Qdrant provenance violations; both sources represented in retrieved evidence; and one query reservation per provider query.

| Case / metric | Cloudflare AI Search | Vertex + Qdrant |
|---|---:|---:|
| Expected distinct source/page targets | 7/7 | 7/7 |
| Query-specific target instances | 7/8 | 8/8 |
| MS03 M15 pages 2 and 3 | 2/2 | 2/2 |
| MN01 candidates | 0 | 3 |
| Provenance violations | 0 | 0 |
| Sequential p50 / p95 | 3,903 / 5,374 ms | 1,180 / 1,326 ms |

The query-specific denominator is eight because M14 handout page 3 is a target in both MS01 and MS02; the distinct source/page denominator is seven. AI Search finds the M14 page 3 during MS01 but misses it for MS02; Qdrant finds both query-specific instances.

The MS03 Qdrant result now includes M15 page 3 (rank 1) and M15 page 2 (returned at the configured score boundary as `0.19999999999999998`), confirming that PR #247 fixed the IEEE-754 comparison defect through the real Core v2 resolver. The score floor remains 0.2; weights, fusion policy, provider selector and private v2 contract did not change.

MN01 still returns three unrelated Qdrant passages: M14 handout page 1, M15 page 8 and M15 page 6. None contains Planck/photon-energy evidence. AI Search returns zero candidates. This is a remaining retrieval-noise issue, not an answer/abstention test. Five sequential samples are not load/SLO proof.

**Subgate decision:** post-score-floor paired Core v2 regression **PASSED**. The two-source positive retrieval/provenance subtest passes for this fixed suite. M15 overall remains **IN PROGRESS**.

## Initial relevance-gate feasibility check — 14 November 2026

The first offline ablation is complete and documented in [BRVIN_M15_RELEVANCE_GATE_ABLATION.md](BRVIN_M15_RELEVANCE_GATE_ABLATION.md). It uses the owner-waived 109-candidate fixture; it does not call a model or provider, change D1, or reserve quota.

- No gate preserves 12/12 positive queries, but Qdrant returns candidates for all 4/4 out-of-corpus questions (20 candidates: 15 grade 0 and 5 grade 1).
- A fixed RRF cutoff of 0.38 preserves 12/12 positives but clears only 3/4 negative controls; at 0.42 it clears 4/4 but loses P02.
- A leave-one-query-out lexical coverage proxy clears 4/4 negatives but loses held-out positive P06 (11/12 query-positive recall).
- The tested RRF cutoffs retain H01's grade-3 correction, but the lexical proxy removes it; this adds a second false-abstention case.

**Decision:** no RRF cutoff, lexical gate, evidence-sufficiency policy or reranker is selected. This is a single-subject owner-waived AI-labelled pool, not independent human qrels. Do not alter runtime behavior.

## Next M15 action — broaden independent passage/query evidence

Before calibrating a multi-feature gate, expand the evaluation beyond the one Physics source and obtain independent passage/span labels or record a new explicit owner waiver. Split by query/source family, not by candidate row. Include conceptual paraphrases, formula/symbol variants, numerical questions with changed operands/units, mixed theory+math and genuinely out-of-corpus questions. Retain the current positive and negative suites as frozen regression controls. Only after this evidence exists should Core compare a multi-feature evidence-sufficiency gate and a named reranker under the same candidate budget, reporting positive recall, false abstention, no-match false acceptance, formula/symbol recall, p50/p95 latency and per-query cost. Authorization and physical-page provenance remain hard checks outside all models. Keep production on AI Search.

## Side-effect boundary

Expected staging-only changes: one `brvin_books` row for the second source, one `brvin_project_books` mapping, the M15 multi-source checkpoint/receipt tables, seven deterministic points in the dedicated M15 Qdrant collection, three page items in the separate M15 AI Search instance, and ten project quota reservations when evaluation is run.

Not expected: PDF upload, Google Vision OCR request, original M14 GCS/OCR/manifest modification, production D1 access, production indexes, production provider selector/bindings/traffic, Teachers D1/runtime/bindings/UI, direct provider access from the consumer, Gemini answer generation, Qdrant point deletion or AI Search item deletion.

## Continuation after this gate

A green multi-source receipt advances only this staging subtest. M15 still requires independent or explicitly owner-waived claim-to-passage grounding, broader corpus/query coverage, retry/recovery/throttling, HNSW-aware representative load, repeatable Worker-side latency/throughput/cost, and rollback rehearsal. M16 separately verifies UI/consumer parity through the same v2 contract. M17 remains a controlled production canary and must retain AI Search as rollback provider through the required 14-day production soak. No production provider cutover is authorized by this runbook.

## Expanded two-source page-target evaluation v1 — implementation checkpoint 14 November 2026

A separate 12-query page-target suite is defined in [BRVIN_M15_EXPANDED_TWO_SOURCE_EVALUATION.md](BRVIN_M15_EXPANDED_TWO_SOURCE_EVALUATION.md). It reuses the two exact fingerprint-pinned READY sources and their completed provider indexes. It does not change the original five-case suite, re-run the paired receipt, Prepare the sources, upload a PDF or submit Vision OCR.

The new authenticated endpoint is POST /admin/m15/benchmark/multi-source/evaluate-expanded, exposed as a separate button on the same isolated staging operator page. It runs ten positive/near-miss queries and two out-of-corpus controls through both real Core v2 provider paths (24 quota reservations). It records query-specific page-target coverage as well as unique page coverage; those denominators must not be conflated. The operational receipt is stored in m15_v2_multisource_runs with benchmark tag brvin-m15-core-v2-multisource-expanded-v1.

**Not yet executed at this checkpoint.** The query-to-page targets are source-checked against the immutable original PDFs, not independent human passage/span qrels. The report is not cross-subject generalization, generated-answer quality, a load test or production authorization. Do not change a threshold, RRF weight, reranker or production selector based on this expanded page-level run alone. It must be reviewed together with the two no-match passage texts and the per-query expected-page misses.

## Expanded two-source execution result — 14 November 2026

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
