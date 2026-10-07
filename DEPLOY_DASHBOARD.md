# Production Deployment Guide — Cloudflare

Deploy only the exact reviewed source revision.

## Worker
Name: `parmar-ai`\nEntrypoint: `src/index.ts`
## D1
Production database: `parmar-ai-admin-prod`. Keep real private deployment identifiers and credentials outside public source where appropriate.
## Durable Object
Verify `JOB_DEDUPE` points to `JobDedupe` with the intended SQLite-backed storage.
## Queue
Verify production producer/consumer, retry, concurrency, and dead-letter configuration.
## Secrets
Store Telegram, Google, admin-session, encryption, and Cloudflare credentials securely. Never commit them.
## Privileged access
Configure `BOT_OWNER_TELEGRAM_USER_ID`, `ADMIN_TELEGRAM_USER_IDS`, and any static test IDs outside public source.
## Telegram
Routine connection management should use the protected Telegram tab: connect, switch, test, or disconnect.
## Admin
Apply Cloudflare Access in front of `/admin*` for defense in depth and verify administrative sessions separately from Telegram Owner/Admin identity.
## Post-deploy
Run [docs/TEST_PLAN.md](docs/TEST_PLAN.md), record the Cloudflare version ID, and preserve the approved artifact.
## Release integrity
Do not silently modify a deployed artifact and retain the same release identity.