# Parmar AI — production Telegram doubt solver — Queue + Durable Object

Production-oriented Telegram → Cloudflare Worker → Cloudflare Queue → Vertex AI → Gemini 3.8 Flash backend.

## Core properties

- Telegram webhook protected by `secret_token`.
- Durable Cloudflare Queue for burst absorption and retry.
- SQLite-backed Durable Object for update idempotency, job state, and basic per-chat rate controls.
- Google service-account JWT authentication implemented with Web Crypto; no Node `crypto` dependency and no Google auth SDK.
- Cached Google OAuth access tokens to avoid a token exchange on every question.
- Vertex AI global endpoint using `gemini-3.8-flash` by default.
- Retries with bounded exponential backoff for temporary failures.
- Final answers are stored before Telegram delivery retries so transient Telegram failures do not force another Gemini generation.
- User sees an immediate acknowledgement message, then that message is edited into the final answer.
- 4,096-character Telegram limit is respected.
- No credentials committed to GitHub.
- Cloudflare observability enabled.

## Production architecture

```text
Telegram
   ↓ webhook
Cloudflare Worker
   ↓
Durable Object (dedupe/state/rate control)
   ↓
Cloudflare Queue
   ↓
Queue consumer
   ↓
Google OAuth JWT (Web Crypto)
   ↓
Vertex AI
   ↓
Gemini 3.8 Flash
   ↓
Telegram editMessageText / sendMessage
```

See `DEPLOY_DASHBOARD.md` for the complete dashboard-only setup. No terminal commands are required for deployment.
