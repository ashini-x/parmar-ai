# Standalone VRAIN Worker

This directory contains the independently deployable VRAIN Engine and API. It is part of the parmar-ai GitHub repository but is a separate Cloudflare Worker from the existing Parmar AI Worker.

## Current state

**Source created; not deployed.** The Wrangler config intentionally contains a placeholder D1 database UUID and GCS bucket name. Do not deploy until those resources and secrets are configured.

The Worker includes:
- a single-owner control-plane API;
- project and collection records;
- project-scoped, hashed, revocable read API keys;
- private resumable Google Cloud Storage upload relay;
- server-side PDF signature and SHA-256 verification;
- Google Cloud Vision asynchronous PDF DOCUMENT_TEXT_DETECTION;
- private page-normalized OCR objects;
- a dedicated AI Search namespace and per-page source keys;
- a Cloudflare Workflow for OCR, indexing, QA, publication and checkpoint recovery;
- a scheduled recovery sweeper;
- project-grant-filtered consumer retrieval with original PDF page citations.

## Commands

Run these commands from repository root:

~~~sh
npm run dev:vrain
npm run check:vrain
npm run test:vrain
npm run dry-run:vrain
npm run migrate:vrain:local
npm run migrate:vrain:remote
npm run deploy:vrain
~~~

## Required configuration

1. Create a dedicated D1 database and replace the placeholder database_id in wrangler.jsonc.
2. Create a dedicated private GCS bucket and set VRAIN_GCS_BUCKET.
3. Enable Google Cloud Vision API.
4. Grant the VRAIN service account bucket-scoped GCS object permissions and Vision API use.
5. Add Cloudflare secrets VRAIN_ADMIN_TOKEN, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, and optional GCP_PRIVATE_KEY_ID.
6. Apply the migration and deploy.
7. Call /health, then run a small PDF end-to-end test before granting access to a production consumer.

See:
- [VRAIN Platform Specification](../../docs/VRAIN_PLATFORM_SPEC.md)
- [VRAIN Owner Operations Runbook](../../docs/VRAIN_OPERATIONS_RUNBOOK.md)

## Authentication

Owner/control-plane requests use Authorization: Bearer <VRAIN_ADMIN_TOKEN>. Only the owner should possess it.

Consumer requests use an individual project key in the form vrn_live_.... Consumer keys have only the knowledge:read scope and can retrieve only sources explicitly granted to their project.

Never expose either the owner token or a project key in a client-side bundle. Consumer authentication belongs on the consumer application's server.

## Compatibility boundary

The old src/vrain and src/fatman code remains the current in-process compatibility implementation used by the deployed Parmar AI Worker. It is not automatically migrated or cut over by this directory. Follow the staged migration and rollback plan in the platform specification.
