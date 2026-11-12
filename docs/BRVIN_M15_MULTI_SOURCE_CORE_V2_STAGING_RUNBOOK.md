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

## Side-effect boundary

Expected staging-only changes: one `brvin_books` row for the second source, one `brvin_project_books` mapping, the M15 multi-source checkpoint/receipt tables, seven deterministic points in the dedicated M15 Qdrant collection, three page items in the separate M15 AI Search instance, and ten project quota reservations when evaluation is run.

Not expected: PDF upload, Google Vision OCR request, original M14 GCS/OCR/manifest modification, production D1 access, production indexes, production provider selector/bindings/traffic, Teachers D1/runtime/bindings/UI, direct provider access from the consumer, Gemini answer generation, Qdrant point deletion or AI Search item deletion.

## Continuation after this gate

A green multi-source receipt advances only this staging subtest. M15 still requires independent or explicitly owner-waived claim-to-passage grounding, broader corpus/query coverage, retry/recovery/throttling, HNSW-aware representative load, repeatable Worker-side latency/throughput/cost, and rollback rehearsal. M16 separately verifies UI/consumer parity through the same v2 contract. M17 remains a controlled production canary and must retain AI Search as rollback provider through the required 14-day production soak. No production provider cutover is authorized by this runbook.
