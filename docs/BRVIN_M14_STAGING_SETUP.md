# BRVIN M14 isolated staging setup and Physics backfill

**Status:** Operator Worker code is under review. This document records the non-production setup only. It is not permission to change the production provider.

## What is already provisioned

- Cloudflare D1 database: `parmar-ai-m14-staging`
- D1 ID: `a8ca999e-4107-4f2f-800e-a1abce3a4cac`
- Primary location: APAC; read replicas disabled
- Only one row is seeded in `m14_source_registry`: the existing three-page Physics pilot
- Reproducible seed: `scripts/m14-staging-registry.sql`
- Staging Worker config: `wrangler.m14-staging.jsonc`
- Production D1, Workers, provider selector and corpus flag are not used by this isolated operator

The Worker is intended to be deployed automatically by `.github/workflows/m14-staging-deploy.yml` after its PR merges. It exposes only `GET /health` and the authenticated `POST /admin/m14/backfill` action. The backfill is pinned to the registered Physics source and requires both `ENVIRONMENT=staging` and `BRVIN_M14_PILOT_ENABLED=true`.

## One-time Google Cloud setup required

This is the only part that needs your Google Cloud account. Do not paste a service-account JSON key or private key into this chat or commit it to GitHub.

Project: `project-90db7be4-619f-4ed7-89b`

1. In Google Cloud Console, open **Cloud Storage → Buckets** and check the location of the existing source bucket `parmar-fatman-ocr-90db7be4`.
2. Create a new bucket named exactly `brvin-m14-physics-90db7be4-a8ca999e` in the **same location**. Use **Uniform** access control and enforce **Public access prevention**. Do not make it public. This bucket will contain only the derived manifests/chunks for the pilot.
3. Create a dedicated service account named `brvin-m14-staging` in the same project.
4. Grant that service account these bucket-scoped roles:
   - On `parmar-fatman-ocr-90db7be4`: **Storage Object Viewer** (`roles/storage.objectViewer`) so it can list and read the already-stored Vision output.
   - On `brvin-m14-physics-90db7be4-a8ca999e`: **Storage Object User** (`roles/storage.objectUser`) so it can create and verify immutable manifest objects. This is scoped to the pilot bucket only.
5. Also grant **Vertex AI User** (`roles/aiplatform.user`) at the project level for the next M14 embedding/indexing step. The first backfill itself does not call Vertex.
6. Create a JSON key for this dedicated service account and store it securely on your device. The code uses the service-account email and private key to mint short-lived Google OAuth tokens. It requests the `cloud-platform` scope for the Vision operation read and GCS object calls.

Google's IAM reference confirms Object Viewer includes object get/list and Object User provides create/read/update/delete object access; both should be granted at the individual bucket level rather than across the whole project. Vertex AI User is Google's predefined user role for calling Agent Platform/Vertex AI features. References: [Cloud Storage IAM roles](https://docs.cloud.google.com/storage/docs/access-control/iam-roles), [Vertex AI access control](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/access-control), [Vision operations.get](https://docs.cloud.google.com/vision/docs/reference/rest/v1/operations/get).

## Add the secrets to the staging Worker

After the staging Worker is deployed:

1. Open **Cloudflare Dashboard → Workers & Pages → parmar-ai-m14-staging → Settings → Variables and Secrets**.
2. Add these as **Secrets**, not plain-text variables:
   - `GCP_CLIENT_EMAIL`: the JSON key's `client_email`
   - `GCP_PRIVATE_KEY`: the JSON key's `private_key` (include the PEM header/footer and line breaks)
   - `GCP_PRIVATE_KEY_ID`: the JSON key's `private_key_id` (optional to the token signer, but set it)
   - `BRVIN_M14_ADMIN_TOKEN`: generate a separate strong random value, for example with `openssl rand -hex 32`
3. Save the secrets. Never reuse the M14 admin token as the Google key or any GitHub/Cloudflare API token.

The non-secret settings, including the source bucket, separate M14 bucket, staging flag and D1 binding, are already in `wrangler.m14-staging.jsonc`.

## Verify and run the one-time backfill

The Worker health endpoint reports only whether required secrets are present; it never returns credential values. Once deployed, open:

`https://parmar-ai-m14-staging.<your-workers-dev-subdomain>.workers.dev/health`

It should report `environment: staging`, `pilotEnabled: true`, and `true` for `gcpClientEmail`, `gcpPrivateKey`, and `m14AdminToken`.

Then run this command on your own terminal, replacing the URL and token with your staging values:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "https://parmar-ai-m14-staging.<your-workers-dev-subdomain>.workers.dev/admin/m14/backfill" \
  -H "Authorization: Bearer <YOUR_M14_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{"confirmSourceId":"01238b3a-9902-4a42-90b4-574048ee4f00"}'
```

Expected successful receipt: `ok: true`, `pageCount: 3`, a deterministic `generationId`, and page results for physical pages 1, 2 and 3. The bucket names and generation may appear in the receipt. Do not send any private key or admin token back here; the receipt itself is safe to share after checking it contains no OCR text.

The handler verifies the D1 source record, the exact saved Vision operation, its output prefix and exactly one `output-N-to-N.json` object per physical page before persisting any manifest. It does not upload the PDF or submit another OCR request. Create-only GCS writes make identical retries safe; a changed pre-existing manifest is rejected.

## What happens after the backfill

I can handle the remaining code, tests, PRs, merges and staging integration. The next infrastructure step is a non-production Qdrant cluster and live Vertex embedding verification. I will guide you again only when a resource/credential choice is required. Production remains on Cloudflare AI Search throughout M14.
