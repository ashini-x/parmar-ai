# Production Deployment Guide — Cloudflare Dashboard

This guide assumes the source has already been uploaded to the GitHub repository.

## 1. Worker

Create or select the Worker named `parmar-ai` and connect the repository/build configuration as appropriate for your Cloudflare setup.

The entrypoint is:

```text
src/index.ts
```

## 2. D1

Create/select the production database:

```text
parmar-ai-admin-prod
```

Insert the real D1 database ID into the deployment configuration used by Cloudflare. The public repository intentionally keeps a placeholder instead of the live ID.

## 3. Durable Object

Verify the `JOB_DEDUPE` binding points to `JobDedupe` with SQLite-backed Durable Object storage.

## 4. Queue

Verify:

```text
Producer: parmar-ai-questions-prod
Consumer: parmar-ai-questions-prod
DLQ: parmar-ai-questions-dlq
Max batch size: 1
Max retries: 10
Retry delay: 15 seconds
Max concurrency: 50
```

## 5. Worker variables

The public `wrangler.jsonc` contains non-secret configuration and placeholders only.

Important defaults:

```text
APP_VERSION=2.4.1
DAILY_QUESTION_LIMIT=20
BURST_QUESTION_LIMIT=5
BURST_WINDOW_SECONDS=10
GEMINI_THINKING_LEVEL=HIGH
VERTEX_TIMEOUT_MS=25000
ANALYTICS_RAW_RETENTION_DAYS=90
```

## 6. Worker secrets

Set these through Cloudflare's secret store:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_SETUP_SECRET
GCP_CLIENT_EMAIL
GCP_PRIVATE_KEY
GCP_PRIVATE_KEY_ID
ADMIN_DASHBOARD_PASSWORD
ADMIN_SESSION_SECRET
```

## 7. Google/Vertex

Verify the configured service account has the minimum required permissions for the Vertex AI API path used by the Worker.

## 8. Telegram webhook

After deployment, call the protected setup endpoint using the deployment's setup secret. Confirm the webhook result is successful before beginning user testing.

## 9. Admin

Open `/admin`, authenticate, and verify that the central D1 projection is receiving users, questions, and events.

Add a Cloudflare Access policy in front of `/admin*` before exposing the production domain publicly.

## 10. Post-deploy smoke test

Use `docs/TEST_PLAN.md` and record the exact Cloudflare Worker version ID used for production.
