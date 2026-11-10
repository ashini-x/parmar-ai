# BRVIN M14 isolated staging setup and Physics backfill

> **Live staging checkpoint — 10 November 2026:** Core PR [#194](https://github.com/ashini-x/parmar-ai/pull/194) is merged as `ab3974bc7b0125498a6d0c2453018b3e75e61fca`; Core PR [#196](https://github.com/ashini-x/parmar-ai/pull/196) is merged as `e60710490ec0ac5068aaa43ddf882ad02df7721a`. M14 validation #61 and Core Release validation #1050 passed. The M14 staging Worker is version 74 (`330f46a7-6b69-4359-b7e0-ccb43fce0d2c`, deployment `274fdb7c-c405-4ae4-be61-e53d50f0d6f0`) at 100%. Cloudflare read-back confirms Vertex `gemini-embedding-001` in `asia-south1` / 768 dimensions, Qdrant collection `brvin_m14_physics_pilot_v1`, and secret separation (Qdrant API key, M14 operator token and GCP credentials remain secret bindings). Version 74 applies semantic 70/30 dense/sparse or symbolic 30/70 dense/sparse RRF and classifies worded formula/symbol prompts as symbolic intent. The source-grounded qrels v0.1 are in `docs/BRVIN_M14_CHUNK_QRELS.md`. Production remains on AI Search; Teachers remains on version 12. No OCR or re-index was required.

**Status:** The isolated non-production staging setup, retained-PDF OCR recovery, immutable manifest backfill and seven-point Qdrant indexing are complete; retain the original setup instructions for audit/recreation. The original ten-positive baseline passed 10/10 checks and covered 11/11 expected physical pages; page-label precision@5 `0.40` and first-expected-page MRR `0.7833333` are page metrics, not chunk relevance. Assistant-adjudicated source-grounded chunk qrels v0.1 for seven chunks and twelve query cases are now recorded in `docs/BRVIN_M14_CHUNK_QRELS.md`; they are reproducible model labels, not independent human annotations. The original authenticated negative/repeatability receipt has been reviewed: both expected-no-match prompts returned five candidates, the exact lowercase `f = ma` target was absent from all returned chunks, the Planck prompt returned unrelated Physics chunks, and the friction query had one stable top-five set but three result orders (page-3 worked-example chunk rank 1/1/3). Core PR [#191](https://github.com/ashini-x/parmar-ai/pull/191) added the read-only dense/sparse component-rank trace. Core PR [#194](https://github.com/ashini-x/parmar-ai/pull/194) added Core-side intent-weighted fusion, and PR [#196](https://github.com/ashini-x/parmar-ai/pull/196) corrected worded formula/symbol intent detection; both are deployed in version 74. Run the authenticated diagnostics on version 74 to capture fresh post-change rankings and compare them with the old equal-weight receipt. This action is retrieval-only, not answer abstention. Do not upload, OCR or re-index. Production remains on Cloudflare AI Search.

## What is already provisioned

- Cloudflare D1 database: `parmar-ai-m14-staging`
- D1 ID: `a8ca999e-4107-4f2f-800e-a1abce3a4cac`
- Primary location: APAC; read replicas disabled
- Only one row is seeded in `m14_source_registry`: the existing three-page Physics pilot
- Reproducible seed: `scripts/m14-staging-registry.sql`
- Staging Worker config: `wrangler.m14-staging.jsonc`
- Production D1, Workers, provider selector and corpus flag are not used by this isolated operator

The Worker is deployed by `.github/workflows/m14-staging-deploy.yml` (automatic main-branch deploy and guarded manual `workflow_dispatch`; pull requests cannot deploy): `https://parmar-ai-m14-staging.thenewtongs.workers.dev`. The latest deployment is M14 version 74 (`330f46a7-6b69-4359-b7e0-ccb43fce0d2c`, deployment `274fdb7c-c405-4ae4-be61-e53d50f0d6f0`) at 100%. Cloudflare read-back confirms the Vertex/Qdrant settings from the tracked Wrangler config; the Qdrant API key, M14 admin token and GCP credentials remain Worker secret bindings. The authenticated browser operator supports health/diagnostics, one-time retained-PDF OCR recovery and status, immutable manifest backfill/read-back verification, seven-point Qdrant indexing, positive evaluation and the non-gating negative/repeatability diagnostic. Every mutation is staging-only, source-pinned and protected by `BRVIN_M14_ADMIN_TOKEN`; the isolated Worker binds only the dedicated M14 D1 and private GCS/Vertex/Qdrant settings. No credential values belong in this document.

## Completed one-time Google Cloud setup (reproducibility reference)

The steps below document the completed one-time setup and are retained for audit/recreation only; do not repeat them for the current staging pilot. Never paste a service-account JSON key or private key into chat or commit it to GitHub.

Project: `project-90db7be4-619f-4ed7-89b`

1. In Google Cloud Console, open **Cloud Storage → Buckets** and check the location of the existing source bucket `parmar-fatman-ocr-90db7be4`.
2. Create a new bucket named exactly `brvin-m14-physics-90db7be4-a8ca999e` in the **same location**. Use **Uniform** access control and enforce **Public access prevention**. Do not make it public. This bucket will contain only the derived manifests/chunks for the pilot.
3. Create a dedicated service account named `brvin-m14-staging` in the same project.
4. Ensure **Cloud Vision API** (`vision.googleapis.com`) and **Vertex AI API** (`aiplatform.googleapis.com`) are enabled in this project. Vision was already used for this source, but confirm it remains enabled; Vertex is needed for the later embedding stage.
5. Grant the dedicated service account these bucket-scoped roles:
   - On `parmar-fatman-ocr-90db7be4`: **Storage Object Viewer** (`roles/storage.objectViewer`) so it can list/read the original Vision output objects.
   - On `brvin-m14-physics-90db7be4-a8ca999e`: grant both **Storage Object Creator** (`roles/storage.objectCreator`) and **Storage Object Viewer** (`roles/storage.objectViewer`). Creator allows new manifest objects; Viewer allows immutable retry verification and later manifest replay. This combination avoids granting object update/delete permissions.
6. Grant **Vertex AI User** (`roles/aiplatform.user`) at the project level for the later M14 embedding/indexing stage. The first OCR backfill itself does not call Vertex.
7. Create a JSON key for this dedicated service account and store it securely on your device. The code uses the service-account email and private key to mint short-lived Google OAuth tokens. It requests the `cloud-platform` OAuth scope for the Vision operation read and GCS object calls. If your organization blocks service-account key creation, do not weaken the organization policy; stop and tell me, and I’ll adapt the authentication plan.

This uses narrower GCS permissions: Google's IAM reference lists Object Creator as object creation only (no viewing/deleting/overwriting), and Object Viewer as object get/list. Together, when bound only to the separate M14 bucket, they support create-only manifests plus read-back verification without giving the service account delete/update privileges. The source bucket remains read-only. References: [Cloud Storage IAM roles](https://docs.cloud.google.com/storage/docs/access-control/iam-roles), [Vertex AI access control](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/general/access-control), [Vision operations.get](https://docs.cloud.google.com/vision/docs/reference/rest/v1/operations/get).

## Add the secrets to the staging Worker

The staging Worker is already deployed. Open:

1. Open **Cloudflare Dashboard → Workers & Pages → parmar-ai-m14-staging → Settings → Variables and Secrets**.
2. Add these as **Secrets**, not plain-text variables:
   - `GCP_CLIENT_EMAIL`: the JSON key's `client_email`
   - `GCP_PRIVATE_KEY`: the JSON key's `private_key` (include the PEM header/footer and line breaks)
   - `GCP_PRIVATE_KEY_ID`: the JSON key's `private_key_id` (optional to the token signer, but set it)
   - `BRVIN_M14_ADMIN_TOKEN`: generate a separate strong random value, for example with `openssl rand -hex 32`
3. Save the secrets. Never reuse the M14 admin token as the Google key or any GitHub/Cloudflare API token.

The non-secret settings, including the source bucket, separate M14 bucket, staging flag and D1 binding, are already in `wrangler.m14-staging.jsonc`.

## Recover OCR and run the M14 backfill (no terminal needed)

The original BRVIN ingest completed successfully, passed page-grounded retrieval QA, and marked the Physics source ready. As part of the existing retention policy, the original PDF and searchable AI Search page text were retained while the three temporary Google Vision JSON files were deliberately removed. M14 therefore starts one new Google Vision OCR operation from the retained original PDF; it does not ask the operator to upload the PDF again.

1. Open the staging health page: `https://parmar-ai-m14-staging.thenewtongs.workers.dev/health`.
2. Confirm `environment: "staging"`, `pilotEnabled: true`, `sourceRegistryBound: true`, and all required secret-presence checks are true.
3. Open the browser operator: `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14`.
4. Enter the `BRVIN_M14_ADMIN_TOKEN` in the password field.
5. Tick the separate confirmation stating that a new Google Vision OCR request will be submitted. It can incur Google Cloud usage charges.
6. Click **Recreate OCR output from retained PDF (one time)**. The Worker verifies the exact retained source PDF object and size, reserves a one-time recovery record in the isolated staging D1 database, then submits one Vision PDF OCR request. The source PDF is read from the original bucket; the new OCR JSON is written only to the M14 destination bucket under `brvin/m14-staging/vision-output/<source-id>/attempt-001/`. The page does not upload the PDF.
7. Re-enter the operator token and click **Check OCR recovery status (read only)** periodically. Wait until the response says `status: "completed"` and shows all three files: `output-1-to-1.json`, `output-2-to-2.json`, and `output-3-to-3.json`.
8. Tick the separate manifest confirmation, re-enter the operator token, and click **Run Physics backfill**. The Worker will read the verified recovered OCR files and create immutable source/page manifests and chunks in the M14 destination bucket.
9. A successful backfill receipt contains `ok: true`, `pageCount: 3`, a generation ID, and results for physical pages 1, 2 and 3. It does not include OCR text or credentials.

After the backfill succeeds, use **Verify stored M14 manifests (read only)**. It recomputes the source generation ID, raw OCR hashes, normalized-text hashes, deterministic chunks and formula metadata. The Physics pilot must return `verified: true`, 3 pages and 7 chunks, with page chunk counts 2/2/3. The endpoint never returns OCR text.

The one-time recovery table prevents duplicate OCR submissions. If the connection ends after submission but before an operation ID is saved, the record enters `submission_uncertain` and automatic resubmission is blocked. Do not click the recovery button again in that state; inspect the record first.

The source bucket has **Storage Object Viewer**. The M14 destination bucket has **Storage Object Creator** and **Storage Object Viewer**. Google documents PDF/TIFF async OCR output as JSON files in the configured GCS destination; `batchSize: 1` requests one response proto per output JSON file. References: [Vision PDF/TIFF OCR](https://docs.cloud.google.com/vision/docs/pdf), [Vision async file annotation](https://docs.cloud.google.com/vision/docs/reference/rest/v1/files/asyncBatchAnnotate), [Vision authentication](https://docs.cloud.google.com/vision/docs/authentication).

## Completed non-production Qdrant provisioning (reproducibility reference)

The current staging-only Qdrant cluster and key have already been provisioned and configured. The steps below are retained only to reproduce or replace that isolated environment. Never connect a production cluster or reuse a production key.

1. Open [Qdrant Cloud](https://cloud.qdrant.io/) and sign in.
2. Open **Clusters** and select **Create** or **Create a Free Cluster**.
3. Select the **Free** plan for this small pilot. Current Qdrant Free clusters have one node, 1 GB RAM, 0.5 vCPU and 4 GB disk; they are intended for prototyping. They do not require a credit card. Free clusters can be suspended after one week of inactivity and deleted after four weeks of inactivity, so reactivate the cluster if the pilot is paused for a long period. See [Qdrant Free cluster details](https://qdrant.tech/documentation/cloud/create-cluster/).
4. For the cluster name, enter `brvin-m14-physics-pilot`.
5. For cloud provider and region, choose the nearest Asia region offered by the Free plan. Prefer Mumbai/India if it is listed; otherwise choose the closest available Asia region, such as Singapore. The Free plan's region list is limited.
6. Keep the Free plan's default resource settings and one node. Do not choose Standard, high availability, multiple nodes or paid add-ons for this experiment.
7. Review the price summary and confirm it says Free before selecting **Create**.
8. Wait for the cluster status to become ready. Open its details page and copy the **Cluster endpoint**. Use the HTTPS REST endpoint, with port `6333` (or `443` if that is the endpoint Qdrant shows). Keep only the endpoint origin: no extra path, username, password, query string or trailing API route. Qdrant documents REST access on ports 6333 and 443: [Connect to a cluster](https://qdrant.tech/documentation/cloud/cluster-access/).

## Create the Qdrant database API key

On the new cluster's details page:

1. Open **API Keys** and click **Create**.
2. Name the key `brvin-m14-staging-write`.
3. Choose the **Write** or **Manage/Write** permission, not Read-only. The staging Worker must create one collection and upsert points. If the screen offers collection scoping, leave it cluster-wide initially because the code creates the collection automatically.
4. Choose a 90-day expiry if the UI asks for one. This is only a staging credential and can be rotated later.
5. Click **Create** and copy the database API key once. Qdrant displays a new key only once; store it temporarily in your password manager. Do not share it in chat or paste it into GitHub. It is a database API key, not a Qdrant Cloud Management Key. See [Qdrant database authentication](https://qdrant.tech/documentation/cloud/authentication/).

## Configure the M14 staging Worker for Vertex and Qdrant

Open Cloudflare Dashboard → **Workers & Pages** → **parmar-ai-m14-staging** → **Settings** → **Variables and Secrets**. Do not select the production `parmar-ai` Worker or `brvin-service`.

Add these as **Text** variables:

| Variable name | Exact value |
|---|---|
| `BRVIN_M14_VERTEX_LOCATION` | `asia-south1` |
| `BRVIN_M14_VERTEX_MODEL` | `gemini-embedding-001` |
| `BRVIN_M14_EMBEDDING_DIMENSIONS` | `768` |
| `BRVIN_M14_QDRANT_COLLECTION` | `brvin_m14_physics_pilot_v1` |
| `BRVIN_M14_QDRANT_URL` | Paste your new cluster's HTTPS REST endpoint, including port `6333` (or `443`) |

Add this as a **Secret**:

| Secret name | Value |
|---|---|
| `BRVIN_M14_QDRANT_API_KEY` | Paste the database API key you just created |

Do not change the existing GCP credentials, admin token, D1 binding, environment or pilot-enabled flag. Click **Save** and **Deploy** after adding all five text variables and the one secret.

Why these Vertex settings: `gemini-embedding-001` supports output dimensions up to 3072, and Google documents that smaller dimensions save storage and processing cost with little loss in quality. The M14 starter uses 768 dimensions to fit a small pilot/free Qdrant cluster. Vertex AI's Mumbai region is `asia-south1`. See [Google embedding dimensions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings) and [Google regional endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations). The service account already has the Vertex AI User project role from the earlier setup; no new Google key or role is required.

## Index and test the Physics pilot

1. Open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/health` and confirm `m14ProviderConfigured.ready: true` and `secretsConfigured.qdrantApiKey: true`. These fields confirm configuration presence only, not a successful API connection.
2. Open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14`, enter the `BRVIN_M14_ADMIN_TOKEN` and click **Embed and index the 7 Physics chunks in Qdrant**.
3. This creates or validates the collection `brvin_m14_physics_pilot_v1` with a 768-dimensional cosine dense vector and an IDF sparse vector, then embeds and upserts seven deterministic points. A repeat index is idempotent because point IDs are deterministic. Google Vertex embedding requests may incur usage charges.
4. After indexing succeeds, re-enter the operator token and click **Run 3 known-evidence Physics retrieval checks**. This runs only the three cases whose expected source pages have prior evidence: Newton's second law (page 2), the 4 kg worked example (page 3), and bus braking (pages 3 and 1). It returns page numbers and scores, not OCR text.
5. These are initial live smoke checks, not final M14 acceptance. Formula/symbol-sensitive, mixed theory+math, friction, numerical and no-answer cases remain pending exact OCR-ground-truth review. We will expand the evaluation suite after inspecting the verified OCR corpus.

Production continues to use Cloudflare AI Search. The Qdrant/Vertex settings and routes are only on the dedicated staging Worker.

## Run the non-gating negative and repeatability diagnostic

After the positive ten-query evaluation, reopen the authenticated M14 staging operator at `/admin/m14` and click **Run non-gating negative + rank-stability diagnostics**. This runs the two reviewed expected-no-match retrieval prompts and repeats the friction/net-force query three times. On the component-rank diagnostic build, it also runs one read-only dense-only and sparse-only query for the same friction prompt, using the same server-authorized project/source filter, and returns those separate candidate ranks and component scores. Inspect source/page/chunk IDs, full chunk text, content types, RRF scores, ordered point IDs and component ranks. This extra trace explains how the two candidate lists contribute to RRF; it does not change the hybrid query or apply a client-side tie-break. The endpoint exposes retrieval evidence only: it does not test Teachers Gemini answer/abstention, and RRF scores are not confidence probabilities. The three-call repeatability sample is not a formal stability acceptance threshold. Do not upload the PDF, rerun Vision OCR or re-index the seven deterministic points for these query-only checks.
## Full-text candidate evidence for human review

The authenticated `POST /admin/m14/qdrant/diagnostics` action includes complete text for each unique returned Qdrant point in the top-level `candidateEvidence` array, with its point/chunk ID, physical page, content types, full source chunk text and the query/repeat/rank that returned it. Candidate text is deduplicated across the two negative cases and three friction repeats; the per-query previews and ranking metrics remain available. This is source text from the exact authorized M14 pilot only, not a generated answer. Keep this endpoint staging-only and bearer-authenticated. The candidateEvidence full-text response was first deployed in version 71, the component-rank trace was added in version 72, and both remain available in version 74. The version-72 friction receipt is the equal-weight baseline; use version 74 to collect the new weighted-fusion output. All these calls are query-only and do not require OCR or vector re-indexing.

## Diagnostic receipt review — 10 November 2026

The authenticated version-71 POST /admin/m14/qdrant/diagnostics action completed with ok: true. Its returned evidence belongs to project 448249b4-fed9-45f5-9137-6014f242ddbe, source 01238b3a-9902-4a42-90b4-574048ee4f00, collection brvin_m14_physics_pilot_v1, using gemini-embedding-001 at 768 dimensions.

**Expected-no-match cases:** both returned five candidates. The lowercase-symbol query had a top RRF score of 0.75; none of the full candidate texts contained exact lowercase f = ma. The closest material uses uppercase F or Fnet; the source's canonical equation is Fnet = m × a. The out-of-corpus Planck-constant query returned five unrelated chunks with a top RRF score of 1.0. This is retrieval-only evidence; neither case is an answer-abstention pass/fail, and RRF is not calibrated confidence.

**Friction repeatability:** all three calls returned the same five point IDs, but each call had a different ordering. The direct page-3 4 kg / 20 N / 8 N worked-example point (be24fe40-ee0d-5324-8f77-3baab3322c69) ranked 1, 1 and 3. The leading candidates tied at RRF 0.6666667. This is a three-call diagnostic sample, not a formal rank-stability threshold.

**Review status:** source-grounded assistant-adjudicated qrels v0.1 now exist in `docs/BRVIN_M14_CHUNK_QRELS.md`, based on the immutable PDF and seven full stored chunk texts. They are explicit model labels, not independent human annotation. Do not infer relevance from page labels or RRF scores. The diagnostic did not invoke BRVIN Teachers answer generation. The deployed Teachers repository currently has no live student/channel/model Gemini answer route; its protected retrieval-test page only returns evidence through the private v2 binding. Answer-abstention testing therefore remains blocked until a consumer generation path or separately approved operator-only harness exists.

**Next:** open the authenticated M14 staging operator and click **Run non-gating negative + rank-stability diagnostics** once on version 74. Compare the weighted scores and ordering against the three version-72 baseline samples; inspect full candidate text and formula/symbol cases. This is query-only; do not upload, re-OCR or re-index. Use `docs/BRVIN_M14_CHUNK_QRELS.md` as the source-grounded grade matrix for the ten positive and two no-match cases; then complete fresh version-74 diagnostics, authorization/isolation, retry/recovery, HNSW-aware performance, concurrency and two-query latency/cost gates. Production remains on AI Search.


## Dense/sparse component-rank trace — staging diagnostic update

The M14 component-rank diagnostic introduced by Core PR #191 remains available in Worker version 74 through the authenticated **Run non-gating negative + rank-stability diagnostics** action. It performs the three repeated friction retrievals, then one additional read-only dense-only query and one sparse-only query with the same D1-pinned project and source allowlist. The receipt exposes each component's rank, point ID, chunk ID, source ID, physical PDF page and raw component score. The query response itself now uses Core-side intent-weighted RRF from PR #194; the component trace is observational and does not choose or modify the weights.

The version-72 component trace exposed a three-way equal-weight RRF tie. The M14 staging query path now uses Core-side intent-weighted RRF: semantic/natural-language questions use 70% dense / 30% sparse, while formula/symbol queries use 30% dense / 70% sparse. With (k=2), the direct page-3 worked example from the friction receipt now scores 0.4000000, ahead of the page-2 context (0.3333333) and broad page-1 overview (0.2666667). The code requests dense and sparse component results separately, applies the same D1-pinned project/source filter to both, validates provenance and fuses ranks in Core. It sorts ties within each component by that component's own score and point ID; it never compares raw dense and sparse scores. This is an M14 staging-only change; it does not re-OCR, re-index, change Teachers/v2 or route production traffic. The diagnostic component-rank trace remains read-only and does not set the weights. Scores are rank-fusion values, not calibrated answer-confidence values.



## Component-rank receipt review — 10 November 2026

The authenticated version-72 receipt returned `ok: true` for the same immutable seven-point Physics corpus. The dense-only and sparse-only traces both returned the same seven eligible point IDs under the pinned project/source filter. Their first five candidates are the same set, but dense and sparse reverse the positions of the direct page-3 worked example and broad page-1 overview:

| Chunk / source role | Dense rank (score) | Sparse rank (score) | Equal-weight RRF contribution |
|---|---:|---:|---:|
| `be24fe40-ee0d-5324-8f77-3baab3322c69`, page 3; exact 4 kg / 20 N pull / 8 N friction worked example | 1 (0.6746742) | 5 (3.2805996) | 1/2 + 1/6 = 0.6666667 |
| `057bcdfa-b2bb-535f-8dc4-f47f1c1229df`, page 2; second-law explanation and general friction context | 2 (0.64888996) | 2 (7.658746) | 1/3 + 1/3 = 0.6666667 |
| `6bb2552e-417c-5169-822f-93c91a8b752f`, page 1; broad force/net-force introduction | 5 (0.6418122) | 1 (8.145531) | 1/6 + 1/2 = 0.6666667 |
| `c601e70a-8570-5122-ab56-4d23b9f334c9`, page 1; inertia / zero-net-force context | 3 (0.648811) | 3 (3.6299407) | 1/4 + 1/4 = 0.5 |
| `020b9743-4a6f-5211-8836-b044137502f7`, page 2; formula / third-law context | 4 (0.6447945) | 4 (3.6138535) | 1/5 + 1/5 = 0.4 |

The other two points ranked 6 and 7 in both component lists: page-3 answer-key chunk `2971ad8d-59c4-5a97-8779-15a5c874b132` (dense 0.60316366; sparse 2.017408), followed by page-3 attribution chunk `0a2a4f69-be34-5482-b861-4cdf2c8c94f7` (dense 0.5972749; sparse 0.84754217).

**Interpretation:** dense retrieval puts the exact worked example first; the lexical/sparse leg puts the broad page-1 introduction first. The page-2 chunk ranks second in both legs. Under Qdrant's documented equal-weight RRF formula with \(k=2\) and zero-based component positions ([Qdrant hybrid-query reference](https://qdrant.tech/documentation/hybrid-queries/)), all three of those candidates receive the same score, 0.6666667. This exactly explains why the hybrid response retained the same top-five set but returned three different orders. The expected page-3 worked-example chunk ranked 3, 1 and 2 across the three new repeats; the three leading candidates were tied on score in each run. This is tie-order variation, not top-five candidate-set drift.

The raw dense scores (roughly 0.60–0.67) and raw sparse scores (roughly 0.85–8.15) are different scales. RRF fuses positions, not these raw score magnitudes. The component scores must not be compared directly or represented as calibrated confidence.

**Decision — updated M14 staging policy:** the current staging implementation uses Core-side intent-weighted RRF (semantic 70% dense / 30% sparse; symbolic 30% dense / 70% sparse; (k=2)). For the observed friction ranks, the direct page-3 worked-example chunk now wins the tie with score 0.4000000, followed by page-2 context at 0.3333333 and page-1 overview at 0.2666667. This is an evidence-informed initial policy, not a calibrated probability or a completed relevance benchmark. The updated Core unit tests replay all seven source candidates and check symbolic weighting in the reverse direction. Before treating the policy as accepted, run the authenticated positive/negative/repeatability diagnostics on the newly deployed staging Worker, inspect formula and paraphrase cases, and measure the extra latency/cost of two component queries. Use the source-grounded model-adjudicated qrels in `docs/BRVIN_M14_CHUNK_QRELS.md` for scoring, while keeping the distinction from independent human judgments explicit. The diagnostic does not test answer abstention; Teachers still has no deployed Gemini generation route. Production remains on Cloudflare AI Search.

The component-rank trace was collected only for the friction prompt. It does not provide dense/sparse rankings for either expected-no-match prompt and does not test answer abstention. The lowercase-symbol and Planck cases remain retrieval-only evidence, and the Teachers Gemini answer route remains unavailable as documented above.


## Positive-suite chunk evidence and qrels scoring — version 75+

The protected **Run 10 source-grounded Physics retrieval checks** action now returns, for each of its ten queries, the ranked top-five `retrievedCandidates`: Qdrant point ID, deterministic chunk ID, source item key, physical page, content types, RRF score and the query intent plus dense/sparse weights actually applied. A top-level `candidateEvidence` list contains full stored chunk text once per unique returned point and the query/rank/score positions where it appeared. The receipt remains behind the M14 operator bearer token and is restricted to the fixed staging project/source.

Use `pointId` / `chunkId` to join each query's ranked candidates to `docs/BRVIN_M14_CHUNK_QRELS.md`. Compute chunk-level nDCG@5, MRR@5 for relevance grade >=2, recall@5 of grade-2+ chunks, and per-query regressions. Keep these provisional, assistant-adjudicated qrels metrics distinct from the legacy physical-page coverage metrics. The qrels are not independent human annotations. The previous v74 positive receipt contained only page numbers, so its 100% expected-page coverage and 0.8333 mean reciprocal expected-page rank cannot be retroactively converted into chunk-level relevance metrics.

The receipt's `queryIntent`, `denseWeight` and `sparseWeight` fields are an important classifier check: conceptual/paraphrase/worked-example/friction prompts should usually show semantic 0.7/0.3, while formula/equation/symbol/notation prompts should show symbolic 0.3/0.7. Inspect worded formula requests explicitly. A correct weight label does not by itself prove correct formula retrieval; compare the ranked point/chunk IDs and source text to qrels.

The two expected-no-match cases remain excluded from the positive suite. Their earlier retrieval-only diagnostic returns candidates and does not test Gemini answer abstention. Do not infer an abstention pass/fail from this expanded receipt.


## Formula/symbol component-rank follow-up — version 76+

The authenticated **Run non-gating negative + rank-stability diagnostics** action now includes `componentRankDiagnostics` for two reviewed positive cases: `newtons-second-law-exact-formula` and `uppercase-force-symbol`. For each prompt, the receipt shows separate dense-only and sparse-only candidate ranks, point IDs, chunk IDs, source/page provenance and component-local raw scores. It retains the earlier friction dense/sparse trace, three-repeat fusion order, and the two expected-no-match candidate previews.

Compare the two new component lists with the v75 positive receipt's fused top-five ranks and the qrels matrix. Determine whether the page-1-overview first-place miss on exact formula and the page-3-worked-example first-place result on uppercase symbol originate in dense retrieval, sparse retrieval, or their weighted fusion. Compare ranks within each component; do not compare raw dense and sparse score magnitudes or interpret RRF as confidence. These traces are read-only, staging-only diagnostics: they do not change query fusion, the Qdrant corpus, the v2 contract, or production provider selection. They add one dense/sparse component query pair per reviewed prompt.
