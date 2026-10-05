# Parmar AI — Production SSC Telegram Bot

Parmar AI is a Telegram-first, SSC-focused General Awareness / General Studies doubt-solving bot.

## What this release does

- Cloudflare Worker receives Telegram webhooks.
- Cloudflare Queue durably buffers questions during traffic spikes.
- A SQLite-backed Durable Object gives each student a private, strongly consistent job/profile store.
- Google service-account OAuth is created inside the Worker using Web Crypto RS256; no Node crypto dependency and no Google JSON key in GitHub.
- Gemini 3.8 Flash on Vertex AI answers the question.
- Thinking effort is adaptive: short direct facts use LOW, normal doubts use MEDIUM, and reasoning/comparison/trap-heavy questions can use HIGH, capped by `GEMINI_THINKING_LEVEL`.
- Structured model output lets the Worker track topic, subject, exam relevance and learning signals consistently.
- A small persistent study profile remembers recent topics, attention areas and revision priorities per private Telegram chat.
- `/profile`, `/exam`, `/reset` and `/help` provide deterministic profile controls without spending Gemini tokens.
- The bot sends an immediate acknowledgement and maintains Telegram's typing action with a 4-second heartbeat until the job is completed or the 20-minute safety TTL is reached.
- Failed AI/Telegram work is retried with exponential delays and a dead-letter queue is configured.
- A completed Gemini answer is stored before final delivery, reducing the chance that a Telegram delivery retry causes another Gemini generation.

## Scope

This release intentionally positions Parmar AI as an SSC GA/GS study companion, not a generic AI assistant. It is optimized for factual and exam-relevant questions with short supporting explanations. Quant, Reasoning, programming and unrelated requests are redirected.

## Cloudflare bindings

- `QUESTION_QUEUE` → `parmar-ai-questions-prod`
- `JOB_DEDUPE` → SQLite-backed Durable Object `JobDedupe`
- DLQ → `parmar-ai-questions-dlq`

## Cloudflare variables

Keep non-secret configuration in `wrangler.jsonc`. The current production values are synchronized with the dashboard configuration:

`APP_VERSION`, `ENVIRONMENT`, `GCP_PROJECT_ID`, `GEMINI_LOCATION`, `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `MAX_OUTPUT_TOKENS`, `MAX_QUESTION_LENGTH`, `VERTEX_TIMEOUT_MS`, `DAILY_QUESTION_LIMIT`, `BURST_QUESTION_LIMIT`, `BURST_WINDOW_SECONDS`.

## Cloudflare secrets

Add these only under Worker Secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SETUP_SECRET`
- `GCP_CLIENT_EMAIL`
- `GCP_PRIVATE_KEY`
- `GCP_PRIVATE_KEY_ID`

Never commit the Google service-account JSON or `.dev.vars`.

## Deployment

Use `DEPLOY_DASHBOARD.md` for the browser-only GitHub + Cloudflare deployment procedure. No terminal is required for the production setup described there.

## Operational note

Telegram's `sendChatAction` is ephemeral and the official Bot API says the status lasts 5 seconds or less, so this release refreshes it. It is a best-effort UX signal: if Telegram throttles chat actions during a very large spike, the durable acknowledgement/Queue/answer path continues independently.
