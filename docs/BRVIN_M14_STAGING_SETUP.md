# BRVIN M14 isolated staging setup and Physics backfill

**Status (9 November 2026):** The dedicated M14 Worker and corpus recovery/backfill are deployed and verified. The live Worker configuration now contains the required Vertex and Qdrant settings and secret binding names. This runbook's provisioning steps are retained for audit/recovery and for a future clean environment; **do not create a second Qdrant cluster, duplicate bucket, service account or API key for the current pilot**. Core PR [#166](https://github.com/ashini-x/parmar-ai/pull/166) is merged as `44c3ae136a4747850f2d58e7f869b25076b497f`. Core release validation [#42527682681](https://github.com/ashini-x/parmar-ai/actions/runs/42527682681) and M14 staging workflow [#42527682664](https://github.com/ashini-x/parmar-ai/actions/runs/42527682664) are currently running. **Do not run the live index action until the staging workflow succeeds and the new M14 Worker version is confirmed live.** Production remains on Cloudflare AI Search.

**Current verified staging snapshot**
- Previously verified staging Worker before PR #166: `parmar-ai-m14-staging`, version `92a84e1e-ae17-4e8e-988f-d5e599aa1118`, 100% traffic; staging workflow run [#20](https://github.com/ashini-x/parmar-ai/actions/runs/42525594684) passed validation, dry-run and deployment. This version predates point-write read-back hardening; do not run Qdrant indexing against it.
- Isolated staging D1: `parmar-ai-m14-staging` (`a8ca999e-4107-4f2f-800e-a1abce3a4cac`). Its registered Physics source and OCR recovery rows both report `completed`, with 3 expected/finished physical pages. This is OCR-recovery state, not a Qdrant index status.
- Corpus generation `57129957231e548064e5594d8fb9f501` was independently read back and verified: 3 pages, 7 chunks (2/2/3).
- Worker text settings are present: Vertex `asia-south1` / `gemini-embedding-001` / 768 dimensions; Qdrant collection `brvin_m14_physics_pilot_v1`; Qdrant endpoint region `australia-southeast1`; staging pilot flag enabled.
- Secret binding names are present for `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, `GCP_PRIVATE_KEY_ID`, `BRVIN_M14_ADMIN_TOKEN` and `BRVIN_M14_QDRANT_API_KEY`. Secret values were not read; binding presence does not prove validity or provider connectivity.
- No successful live Vertex embedding, Qdrant collection operation, point upsert or hybrid retrieval query has yet been evidenced. The first Vertex call must verify API enablement, IAM, quota and region/model access. Record cross-region latency and cost; do not silently re-provision the pilot cluster.
## Google Cloud setup — historical checklist; base GCS/Vision path exercised

**For the current pilot, do not create duplicate resources.** The retained source PDF was read, one new Vision OCR recovery was submitted, and the private destination output was verified. This demonstrates the GCS/Vision path used by this recovery. It does not yet prove Vertex AI model access, IAM, quota or successful embedding; the first live embedding operation must verify those.

The numbered steps below are retained as a reproducible checklist for a future clean environment.

This is the only part that needs your Google Cloud account. Do not paste a service-account JSON key or private key into this chat or commit it to GitHub.

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

## Provision the non-production Qdrant cluster

**Current pilot status:** A dedicated staging cluster is already configured on the M14 Worker. Its endpoint identifies region `australia-southeast1`. Skip cluster creation and key generation below for this pilot; these instructions remain for reproducibility or a future deliberate replacement. Do not connect a production Qdrant cluster or reuse a production API key.

1. Open [Qdrant Cloud](https://cloud.qdrant.io/) and sign in.
2. Open **Clusters** and select **Create** or **Create a Free Cluster**.
3. Select the **Free** plan for this small pilot. Current Qdrant Free clusters have one node, 1 GB RAM, 0.5 vCPU and 4 GB disk; they are intended for prototyping. They do not require a credit card. Free clusters can be suspended after one week of inactivity and deleted after four weeks of inactivity, so reactivate the cluster if the pilot is paused for a long period. See [Qdrant Free cluster details](https://qdrant.tech/documentation/cloud/create-cluster/).
4. For the cluster name, enter `brvin-m14-physics-pilot`.
5. For cloud provider and region, choose the nearest Asia region offered by the Free plan. Prefer Mumbai/India if it is listed; otherwise choose the closest available Asia region, such as Singapore. The Free plan's region list is limited.
6. Keep the Free plan's default resource settings and one node. Do not choose Standard, high availability, multiple nodes or paid add-ons for this experiment.
7. Review the price summary and confirm it says Free before selecting **Create**.
8. Wait for the cluster status to become ready. Open its details page and copy the **Cluster endpoint**. Use the HTTPS REST endpoint, with port `6333` (or `443` if that is the endpoint Qdrant shows). Keep only the endpoint origin: no extra path, username, password, query string or trailing API route. Qdrant documents REST access on ports 6333 and 443: [Connect to a cluster](https://qdrant.tech/documentation/cloud/cluster-access/).

## Create the Qdrant database API key

**Current pilot status:** The `BRVIN_M14_QDRANT_API_KEY` Worker secret binding name is present. Do not create a second key unless an explicit rotation/replacement is planned. Secret values are intentionally not read back.

On the new cluster's details page:

1. Open **API Keys** and click **Create**.
2. Name the key `brvin-m14-staging-write`.
3. Choose the **Write** or **Manage/Write** permission, not Read-only. The staging Worker must create one collection and upsert points. If the screen offers collection scoping, leave it cluster-wide initially because the code creates the collection automatically.
4. Choose a 90-day expiry if the UI asks for one. This is only a staging credential and can be rotated later.
5. Click **Create** and copy the database API key once. Qdrant displays a new key only once; store it temporarily in your password manager. Do not share it in chat or paste it into GitHub. It is a database API key, not a Qdrant Cloud Management Key. See [Qdrant database authentication](https://qdrant.tech/documentation/cloud/authentication/).

## Configure the M14 staging Worker for Vertex and Qdrant

**Current pilot status:** All five required text settings and the Qdrant API-key secret binding name are present in the live staging Worker settings. Vertex is configured for `asia-south1`; the Qdrant endpoint maps to `australia-southeast1`. This cross-region configuration must be measured for latency/cost before acceptance. Do not redeploy or duplicate settings unless a required binding is found missing.

Open Cloudflare Dashboard → **Workers & Pages** → **parmar-ai-m14-staging** → **Settings** → **Variables and Secrets**. Do not select the production `parmar-ai` Worker or `brvin-service`.

Add these as **Text** variables:

| Variable name | Exact value |
|---|---|
| `BRVIN_M14_VERTEX_LOCATION` | `asia-south1` |
| `BRVIN_M14_VERTEX_MODEL` | `gemini-embedding-001` |
| `BRVIN_M14_EMBEDDING_DIMENSIONS` | `768` |
| `BRVIN_M14_QDRANT_COLLECTION` | `brvin_m14_physics_pilot_v1` |
| `BRVIN_M14_QDRANT_URL` | Existing HTTPS endpoint for the dedicated staging cluster (see the staging Worker setting; do not put endpoint credentials in docs) |

Add this as a **Secret**:

| Secret name | Value |
|---|---|
| `BRVIN_M14_QDRANT_API_KEY` | Paste the database API key you just created |

Do not change the existing GCP credentials, admin token, D1 binding, environment or pilot-enabled flag. Click **Save** and **Deploy** after adding all five text variables and the one secret.

Why these Vertex settings: `gemini-embedding-001` supports output dimensions up to 3072, and Google documents that smaller dimensions save storage and processing cost with little loss in quality. The M14 starter uses 768 dimensions to fit a small pilot/free Qdrant cluster. Vertex AI's Mumbai region is `asia-south1`. See [Google embedding dimensions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings) and [Google regional endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations). The service account already has the Vertex AI User project role from the earlier setup; no new Google key or role is required.

## Index and test the Physics pilot

1. Open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/health` and confirm `m14ProviderConfigured.ready: true` and `secretsConfigured.qdrantApiKey: true`. These fields confirm configuration presence only, not a successful API connection.
2. After PR #166 is merged and the updated staging Worker is confirmed deployed, open `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14`, enter the `BRVIN_M14_ADMIN_TOKEN` and click **Embed and index the 7 Physics chunks in Qdrant**. Keep the token in your password manager; do not paste it into chat.
3. This creates or validates the collection `brvin_m14_physics_pilot_v1` with a 768-dimensional cosine dense vector and an IDF sparse vector, then embeds and upserts seven deterministic points. With the PR #166 guard deployed, Qdrant must confirm the `wait=true` operation completed and a retrieve-by-ID read-back must verify every stored point's exact project/source/item/page/generation/chunk/hash provenance before the operator reports success. A repeat index is idempotent because point IDs are deterministic. Google Vertex embedding requests may incur usage charges.
4. After indexing succeeds, re-enter the operator token and click **Run 3 known-evidence Physics retrieval checks**. This runs only the three cases whose expected source pages have prior evidence: Newton's second law (page 2), the 4 kg worked example (page 3), and bus braking (pages 3 and 1). It returns page numbers and scores, not OCR text.
5. These are initial live smoke checks, not final M14 acceptance. Formula/symbol-sensitive, mixed theory+math, friction, numerical and no-answer cases remain pending exact OCR-ground-truth review. We will expand the evaluation suite after inspecting the verified OCR corpus.

Production continues to use Cloudflare AI Search. The Qdrant/Vertex settings and routes are only on the dedicated staging Worker.
