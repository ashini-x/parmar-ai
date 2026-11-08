# BRVIN M14 isolated staging setup and Physics backfill

**Status:** Operator PR #152 is merged and the isolated Worker is deployed. The real GCS backfill is waiting only on the Google Cloud setup and secrets below. This document is for the non-production pilot only.

## What is already provisioned

- Cloudflare D1 database: `parmar-ai-m14-staging`
- D1 ID: `a8ca999e-4107-4f2f-800e-a1abce3a4cac`
- Primary location: APAC; read replicas disabled
- Only one row is seeded in `m14_source_registry`: the existing three-page Physics pilot
- Reproducible seed: `scripts/m14-staging-registry.sql`
- Staging Worker config: `wrangler.m14-staging.jsonc`
- Production D1, Workers, provider selector and corpus flag are not used by this isolated operator

The Worker is deployed by `.github/workflows/m14-staging-deploy.yml`: `https://parmar-ai-m14-staging.thenewtongs.workers.dev` (version `74ab2c8a-b2e4-443d-ba57-d7ef68e98d53`, 100% traffic). It exposes only `GET /health` and the authenticated `POST /admin/m14/backfill` action. The backfill is pinned to the registered Physics source and requires both `ENVIRONMENT=staging` and `BRVIN_M14_PILOT_ENABLED=true`. At last check, the Worker secret list was empty and the corpus bucket was not yet created.

## One-time Google Cloud setup required

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

1. Open the staging health page:
   ` + "`" + `https://parmar-ai-m14-staging.thenewtongs.workers.dev/health` + "`" + `
2. Confirm ` + "`" + `environment: "staging"` + "`" + `, ` + "`" + `pilotEnabled: true` + "`" + `, ` + "`" + `sourceRegistryBound: true` + "`" + `, and all required secret-presence checks are true.
3. Open the browser operator:
   ` + "`" + `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14` + "`" + `
4. Enter the ` + "`" + `BRVIN_M14_ADMIN_TOKEN` + "`" + ` in the password field.
5. Tick the separate confirmation stating that a new Google Vision OCR request will be submitted. It can incur Google Cloud usage charges.
6. Click **Recreate OCR output from retained PDF (one time)**. The Worker verifies the exact retained source PDF object and size, reserves a one-time recovery record in the isolated staging D1 database, then submits one Vision PDF OCR request. The source PDF is read from the original bucket; the new OCR JSON is written only to the M14 destination bucket under ` + "`" + `brvin/m14-staging/vision-output/<source-id>/attempt-001/` + "`" + `. The page does not upload the PDF.
7. Re-enter the operator token and click **Check OCR recovery status (read only)** periodically. Wait until the response says ` + "`" + `status: "completed"` + "`" + ` and shows all three files: ` + "`" + `output-1-to-1.json` + "`" + `, ` + "`" + `output-2-to-2.json` + "`" + `, and ` + "`" + `output-3-to-3.json` + "`" + `.
8. Tick the separate manifest confirmation, re-enter the operator token, and click **Run Physics backfill**. The Worker will read the verified recovered OCR files and create immutable source/page manifests and chunks in the M14 destination bucket.
9. A successful backfill receipt contains ` + "`" + `ok: true` + "`" + `, ` + "`" + `pageCount: 3` + "`" + `, a generation ID, and results for physical pages 1, 2 and 3. It does not include OCR text or credentials; the receipt can be shared for verification.

The one-time recovery table reserves the source ID before calling Google Vision. Repeated clicks return the existing operation rather than submitting duplicate OCR jobs. If the network connection ends after submission but before an operation ID is saved, the record enters ` + "`" + `submission_uncertain` + "`" + ` and automatic resubmission is blocked so a duplicate OCR job is not accidentally billed. A failed API response is retained in the staging record for diagnosis rather than silently retried.

The page also provides **Inspect original OCR folder (read only)** for the deleted original prefix. It returns only filenames and sizes, never OCR text. The recovery-status endpoint similarly returns only operation state and filenames; it does not return OCR content.

The service account already has the required bucket permissions: source bucket **Storage Object Viewer** and M14 destination bucket **Storage Object Creator** plus **Storage Object Viewer**. Google documents PDF/TIFF async OCR output as JSON files in the configured GCS destination; ` + "`" + `batchSize: 1` + "`" + ` requests one response proto per output JSON file. References: [Vision PDF/TIFF OCR](https://docs.cloud.google.com/vision/docs/pdf), [Vision async file annotation](https://docs.cloud.google.com/vision/docs/reference/rest/v1/files/asyncBatchAnnotate), [Vision authentication](https://docs.cloud.google.com/vision/docs/authentication).

## What happens after the backfill

I can handle the remaining code, tests, PRs, merges and staging integration. The next infrastructure step is a non-production Qdrant cluster and live Vertex embedding verification. I will guide you again only when a resource/credential choice is required. Production remains on Cloudflare AI Search throughout M14.
