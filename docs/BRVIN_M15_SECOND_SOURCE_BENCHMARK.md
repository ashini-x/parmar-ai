# BRVIN M15 second-source Physics benchmark

**State — 11 November 2026:** the isolated eight-page source is uploaded and OCR-complete. Its immutable corpus is verified (generation `2dc9d4fae3afe7df16927fbf2510afd3`, 8 pages, 14 chunks), and the dedicated Qdrant collection is fully populated (8/8 pages, 14/14 points) using the two-page resumable Worker path. The first AI Search upload attempt returned `invalid_metadata_format`. A read-only check of the dedicated `brvin-m15-physics-staging-v1` instance confirmed zero items and `custom_metadata: null`, so no source-page items were created by that attempt. The fix defines the four-field custom metadata schema before upload, sends string values as required by the Workers binding, and batches AI Search indexing in two-page invocations. The 17-query receipt has not been run. Production remains selected on Cloudflare AI Search. Teachers has no runtime change.

## Purpose and isolation

The first paired M15 receipt used one fixed three-page Physics pilot. The second benchmark uses a newly created eight-page synthetic Physics source to broaden the evidence and exercise out-of-corpus rejection and exact-symbol near-miss cases.

The source is registered in the dedicated M15 staging registry/table and stored in the private M14 staging GCS bucket. The OCR output and immutable derived corpus are source-scoped. The same verified page text is indexed separately into:
- Cloudflare AI Search instance: `brvin-m15-physics-staging-v1`
- Qdrant collection: `brvin_m15_physics_benchmark_v1`
- Vertex embedding model: `gemini-embedding-001`, 768 dimensions, `asia-south1`

The existing `BRVIN_M15_AI_SEARCH` binding remains the query-only AI Search baseline to the existing instance `fatman-2026-8b183803`. The new AI Search binding has upload capability only within the staging Worker. The original three-page M14 source and `brvin_m14_physics_pilot_v1` collection remain separate.

No production D1, Worker, AI Search index, Qdrant collection, provider selector, consumer answer path or Teachers binding is used by the new source pipeline.

## Approved source file

Use exactly:
- Filename: `BRVIN_M15_Physics_Benchmark_Source_v1.pdf`
- Size: `62,012` bytes
- Page count: 8
- SHA-256: `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`

The separate `BRVIN_M15_Physics_Benchmark_Test_Card_v1.pdf` is for evaluation only. **Never upload the test card** into either provider.

| Physical PDF page | Main topic |
|---:|---|
| 1 | Net force and Newton's second law; east/west worked example |
| 2 | Newton's second-law numerical rearrangements |
| 3 | Mass and weight |
| 4 | Static and kinetic friction |
| 5 | Components of weight on an inclined plane |
| 6 | Work and kinetic energy |
| 7 | Momentum and impulse |
| 8 | Spring restoring force and elastic potential energy |

The query suite's expected physical pages are source-grounded page labels. They are not independent passage-level human qrels.

## Operator URL

Open the dedicated M15 staging operator:

https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark

Health status is shown on the page. A ready page should report the separate AI Search binding, dedicated Qdrant collection, staging database, GCP/Vertex and admin-token bindings as configured.

The old operator at `/admin/m14` remains the fixed three-page pilot operator. Do not use its fixed-source OCR, backfill or Qdrant buttons for this new source.

## Beginner upload and evaluation runbook

The operator is intentionally one-use-token-per-action. After each request, it clears the password field. Re-enter the same `BRVIN_M14_ADMIN_TOKEN` before the next action; the token is not saved to browser storage.

**Recovering after a browser restart:** If this source has already been registered and the source ID field is blank, do not upload the PDF again. Enter the staging operator token and click **Restore existing registered source (read only)**. The authenticated recovery action looks up only the fingerprint-pinned M15 source in the staging D1 registry and restores its existing source ID and status. It does not upload, run OCR, or write to AI Search/Qdrant. The action clears the token; re-enter it and click Step 3 to refresh the live operation/page inventory before continuing. The page also remembers the non-secret source ID in browser `localStorage` (with `sessionStorage` as a fallback); the operator token is never persisted.

1. Open the URL above. Confirm that the banner identifies the isolated Core staging environment and the status says the M15 staging resources are ready.
2. Paste the `BRVIN_M14_ADMIN_TOKEN` into **Staging operator token**.
3. Under **Approved source PDF**, choose exactly `BRVIN_M15_Physics_Benchmark_Source_v1.pdf`. Do not choose the Test Card.
4. Click **1 · Upload and register benchmark source**. The Worker validates the exact filename, byte length, PDF signature and SHA-256 before writing to private staging storage. A source UUID and project UUID are generated server-side. The response should show `status: uploaded`. The page remembers the non-secret source ID in browser `localStorage` and `sessionStorage`; the operator token is never saved. If the field is blank after a restart, use the recovery action described above rather than uploading the PDF again.
5. Re-enter the admin token. Tick the Vision OCR cost acknowledgement, then click **2 · Start OCR once (billable)**. This submits one Google Cloud Vision PDF OCR request. Do not click it again. The one-time D1 lock prevents an ambiguous or duplicate submission.
6. Re-enter the token and click **3 · Check OCR operation and eight-page output inventory (read only)**. Repeat this status check as needed until the operation is completed and the exact eight OCR output files (one for each physical page) are confirmed. The status check does not submit another OCR job.
7. Re-enter the token and click **4 · Build and verify immutable page manifests**. The response must report the approved SHA-256, 8/8 physical pages, a generation ID, a chunk count and `verified: true`. Every page's OCR and deterministic chunk hashes are checked during read-back.
8. Re-enter the token and click **5 · Embed and index into isolated Qdrant collection**. Qdrant indexing is deliberately split into **two physical pages per Worker invocation** to stay below Cloudflare subrequest limits. The first response may report `status: qdrant_indexing`, `indexedPages: 2`, `nextPage: 3`, and `continuationRequired: true`; re-enter the token and click Step 5 again until the response reports `status: qdrant_ready`, all 8 pages, and matching point/chunk counts. After every page, the source registry checkpoints the page and cumulative point count. Each point ID is deterministic, so replaying a page after an ambiguous response safely upserts the same IDs instead of creating duplicates.
9. Re-enter the token and click **6 · Index eight OCR pages into isolated AI Search**. Before the first upload, the Worker reads the dedicated instance configuration and defines the exact custom metadata schema if it is currently empty: `source_id` (text), `project_id` (text), `pdf_page` (number), and `benchmark` (text). It refuses to replace an unexpected non-empty schema. The Workers binding requires metadata values as strings, so the physical page number is sent as a decimal string. Indexing is split into **two pages per invocation**. Repeat Step 6 with a freshly entered token until the result reports eight completed items and the source status becomes `ready`. The Worker reuses exact deterministic source/page keys and checks existing items before uploading, so an ambiguous completed upload is resumed rather than duplicated. It submits an item without blocking the Worker invocation on `uploadAndPoll`; when Cloudflare returns `queued` or `running`, Step 6 returns that state and the next invocation checks the same item until it reaches `completed`. A terminal `error` or other unexpected state is reported instead of counted as indexed. The same eight verified OCR page texts are sent only to the separate M15 AI Search instance; the existing production AI Search instance is untouched.
10. Re-enter the token and click **7 · Run 17-query paired benchmark (read only)**. Save the complete JSON response. Attach that JSON receipt and the separate Test Card PDF in the chat for analysis. Do not upload the Test Card to BRVIN.

If a request fails, read the returned `error`/stage detail first. For a read-only source check, re-enter the token and click Step 3; it returns `qdrantIndexedPages` and the checkpointed Qdrant point count. If the earlier whole-corpus Qdrant invocation failed with a subrequest-limit error, do not delete the collection or source: use the batched operator and continue Step 5. A page whose Qdrant upsert succeeded but whose checkpoint response was lost may be replayed; deterministic point IDs make that replay idempotent. AI Search uses its own two-page checkpoint and checks the exact existing item key before upload. If an upload request times out after acceptance, inspect the Items API or repeat Step 6 only after the asynchronous-submit operator is deployed; it detects the same item key and reports an in-progress item instead of uploading a duplicate. Repeat Step 6 until that item completes. The operator no longer waits for indexing inside one Worker request. An unexpected non-empty custom metadata schema is a hard stop and must be reviewed rather than overwritten because schema changes trigger a full re-index. Do not retry OCR if the state is `submission_uncertain` or an operation ID is already recorded.

## The 17 query cases

- 12 positive cases: Newton's law concepts and numericals, mass/weight, friction, inclined plane, work/energy, momentum/impulse, and spring force.
- 4 out-of-corpus cases: capacitor, Ohm's-law circuit, Lorentz force, and ideal gas law.
- 1 exact-symbol near-miss: asks for `F_s = +k × x`, while the source's restoring-force expression is `F_s = −k × x`.

Candidate presence on an out-of-corpus query or the near-miss is **not automatically a false positive**. Review the returned passage text against the source and grade relevance. The benchmark deliberately keeps page-label coverage separate from passage relevance. Its page-label P@5 values are page-level proxies, not independent human passage judgments.

A provider result with `ok: false` is a failed/unevaluated query, **not** a successful empty retrieval. The summary's out-of-corpus and exact-symbol candidate-presence rates use only completed queries; the response also reports completed/failed counts and `allNegativeControlsCompleted`. A null presence rate means no query in that group completed. Do not report a negative-control pass unless every negative and near-miss query completed successfully. Provider failures include a short redacted error message to support staging diagnosis.

The paired runner sends searches to both staging indexes. It does not write/delete index points/items, change the provider selector or invoke Gemini answer generation. It does not prove answer abstention. Qdrant RRF scores are ranking values, not calibrated probabilities; do not set a rejection threshold from this receipt alone.

## Deployment checkpoint

- Core PR #213: multi-source staging pipeline, operator route, separate AI Search binding, Qdrant collection setting, 17-query read-only runner.
- Core PR #214: added the second-source module, test and staging config verifier to the explicit production-scope allowlist after the first merge unnecessarily triggered a production redeploy.
- Core PR #215: made source-stage progress monotonic, allowed resumption of partial AI Search indexing, and removed automatic follow-up requests after the one-use token is cleared.
- Follow-up fix: Step 5 processes at most two pages per invocation, persists a Qdrant page/point checkpoint after each verified upsert, and exposes the progress through the read-only source status action.
- Follow-up fix: Step 6 ensures the dedicated instance has the exact four-field custom metadata schema before uploads, sends string metadata values in accordance with the Workers binding contract, and indexes at most two pages per invocation with a resumable D1 checkpoint.
- Follow-up fix: Step 6 submits each page asynchronously with `items.upload` rather than `uploadAndPoll`, returns immediately for `queued`/`running` items, and inspects the same deterministic item key on subsequent invocations until it reaches `completed`.
- Follow-up fix: the operator can recover the already-registered source by its pinned SHA-256 after browser storage is cleared; it also persists only the non-secret source ID in local storage, never the one-use admin token.
- M14 staging Worker v82: `5784e06d-33a8-4feb-b75b-09c9a5565d47`, deployment `184ad701-884e-4a96-b101-2c8ccab7de74`, 100% traffic.

Latest Cloudflare read-back confirms production `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Production currently reads `parmar-ai` v714 and `brvin-service` v135 at 100%; the release acceptance passed. The first merge did trigger the normal release workflow because the staging-only allowlist was incomplete. PR #214 corrected that classifier; subsequent staging-only merges now skip the production deploy path.

**M15 is not complete.** The next gates remain passage-level human relevance judgments, review of all 17-case evidence, authorization isolation/revocation, retry/recovery, controlled latency/cost and representative load. Do not cut over production based only on this second-source page benchmark.
