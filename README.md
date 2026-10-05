# Parmar AI — SSC Production 2.2.0

Parmar AI is an SSC-focused Telegram study companion running on Cloudflare Workers, Cloudflare Queues, SQLite-backed Durable Objects, and Vertex AI Gemini 3.8 Flash.

## Product behavior
- SSC GA/GS-first answers.
- Concise factual answers with exam-focused distinctions.
- Adaptive LOW/MEDIUM/HIGH thinking.
- Google Search grounding only for time-sensitive/current questions when enabled.
- Persistent private-chat study profile and revision signals.
- 20 AI questions per student per India Standard Time calendar day.
- Duplicate protection, Queue retries/DLQ, durable answer storage, and continuous typing heartbeat.

## Deployment
Follow `DEPLOY_DASHBOARD.md` and `PRODUCTION_CHECKLIST.md`.

Never commit credentials or secret files.


## Central admin analytics

This release adds a D1-backed operations layer without replacing the Durable Object or Queue. The Durable Object remains the per-student real-time state store; D1 stores the centralized admin projection (students, questions, events) for dashboards and reporting.

Open `/admin` after setting the admin secrets. Protect the `/admin*` path with Cloudflare Access as an additional production layer.
