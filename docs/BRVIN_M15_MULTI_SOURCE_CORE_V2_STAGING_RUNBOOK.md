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

## Prepare the second source

After the code PR is merged and the M14 staging workflow deploys the updated isolated Worker:

1. Open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/multi-source`.
2. Confirm the page identifies Core-only isolated M15 staging and the pinned second source. Do not use the production admin or any Teachers page.
3. Enter the existing `BRVIN_M14_ADMIN_TOKEN` into the local password field. Never send it in chat or add it to GitHub.
4. Click **Prepare second source from immutable manifests** once.
5. The action verifies the source SHA, generation, three physical pages, seven chunks and stable source/page keys; it then replays those chunks into the dedicated M15 Qdrant collection and indexes the three existing raw-OCR page texts into the separate M15 AI Search instance.
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

## Side-effect boundary

Expected staging-only changes: one `brvin_books` row for the second source, one `brvin_project_books` mapping, the M15 multi-source checkpoint/receipt tables, seven deterministic points in the dedicated M15 Qdrant collection, three page items in the separate M15 AI Search instance, and ten project quota reservations when evaluation is run.

Not expected: PDF upload, Google Vision OCR request, original M14 GCS/OCR/manifest modification, production D1 access, production indexes, production provider selector/bindings/traffic, Teachers D1/runtime/bindings/UI, direct provider access from the consumer, Gemini answer generation, Qdrant point deletion or AI Search item deletion.

## Continuation after this gate

A green multi-source receipt advances only this staging subtest. M15 still requires independent or explicitly owner-waived claim-to-passage grounding, broader corpus/query coverage, retry/recovery/throttling, HNSW-aware representative load, repeatable Worker-side latency/throughput/cost, and rollback rehearsal. M16 separately verifies UI/consumer parity through the same v2 contract. M17 remains a controlled production canary and must retain AI Search as rollback provider through the required 14-day production soak. No production provider cutover is authorized by this runbook.
