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
APP_VERSION=2.4.2
DAILY_QUESTION_LIMIT=20
BURST_QUESTION_LIMIT=5
BURST_WINDOW_SECONDS=10
GEMINI_THINKING_LEVEL=HIGH
VERTEX_TIMEOUT_MS=25000
ANALYTICS_RAW_RETENTION_DAYS=90
```

## 6. Privileged Telegram access

Configure these non-secret Worker variables outside the public repository with your real values:

```text
BOT_OWNER_TELEGRAM_USER_ID=<creator/operator Telegram numeric ID>
ADMIN_TELEGRAM_USER_IDS=<optional comma-separated admin IDs>
UNLIMITED_AI_TELEGRAM_USER_IDS=<optional comma-separated static test IDs>
```

The owner/admin is **not discovered automatically from BotFather**; Telegram webhook updates do not expose bot-creator ownership. The owner ID is an explicit server-side trust anchor. Use `/id` in the bot to display the requesting account's Telegram ID.

After the owner is configured, admins can manage runtime test access with `/grant <telegram_user_id>`, `/revoke <telegram_user_id>`, and `/unlimited <telegram_user_id>`. Runtime grants are stored in D1.

Unlimited access bypasses only the daily 20-question quota. The 5-question/10-second burst guard remains enabled.

## 7. Worker secrets

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

## 8. Google/Vertex

Verify the configured service account has the minimum required permissions for the Vertex AI API path used by the Worker.

## 9. Telegram webhook

After deployment, call the protected setup endpoint using the deployment's setup secret. Confirm the webhook result is successful before beginning user testing.

## 10. Admin

Open `/admin`, authenticate, and verify that the central D1 projection is receiving users, questions, and events.

Add a Cloudflare Access policy in front of `/admin*` before exposing the production domain publicly.

## 11. Post-deploy smoke test

Use `docs/TEST_PLAN.md` and record the exact Cloudflare Worker version ID used for production.
