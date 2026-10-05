# Parmar AI — SSC Production Release

This release combines the production backend resilience and the Parmar SSC intelligence layer discussed in the project conversation.

## Included
- Cloudflare Worker webhook
- Cloudflare Queue with retries and DLQ
- SQLite-backed Durable Object for idempotency, per-student state, and typing heartbeat
- Google service-account JWT authentication using Web Crypto / RS256
- Vertex AI Gemini 3.8 Flash
- Adaptive thinking: LOW/MEDIUM/HIGH based on question complexity, capped by GEMINI_THINKING_LEVEL
- SSC-only exam specialization
- Exam-aware factual/concept/comparison/trap/revision modes
- Per-private-chat student profile and learning signals
- /start, /help, /exam, /profile, /reset commands
- Durable answer storage before Telegram delivery to avoid unnecessary Gemini regeneration on delivery retries
- Continuous Telegram typing heartbeat while a job is active, with a safety ceiling
- Duplicate webhook protection and per-student burst/daily limits

## Deployment
Use the dashboard-only instructions in `DEPLOY_DASHBOARD.md`.

Do not commit Google credentials, Telegram tokens, or `.dev.vars` files.
