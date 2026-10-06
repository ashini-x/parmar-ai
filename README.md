# Parmar AI

**Production Release: v2.4.1**

Parmar AI is a Telegram-first, SSC-focused AI study companion built for fast doubt solving, conversation continuity, and evidence-based study personalization.

The production application runs on **Cloudflare Workers**, **Cloudflare Queues**, **SQLite-backed Durable Objects**, **Cloudflare D1**, **Telegram Bot API**, and **Google Vertex AI / Gemini**.

This repository intentionally contains the complete public application and engineering documentation for the v2.4.1 release. Production secrets, credentials, private user exports, and operational tokens are never committed.

> **Repository status:** Public production source for v2.4.1. Future Battle Arena, social, voice, marketplace, and payments concepts described in older strategy notes are not part of this release unless explicitly marked as shipped below.

## What v2.4.1 ships

### Student experience
- SSC GA/GS-first doubt solving.
- Concise, exam-oriented answers with an SSC takeaway.
- Adaptive Gemini thinking: LOW, MEDIUM, or HIGH within the configured ceiling.
- Conversation continuity across the most recent completed in-scope turns.
- Follow-up handling for phrases such as `iska`, `isko`, `isme`, `ye`, `same`, `phir se`, and `simple mein`.
- Explicit confusion-aware and simplification-aware responses.
- Persistent evidence-based learning signals for repeated, explicit confusion/weakness.
- Targeted revision suggestions anchored to the current topic.
- `/profile`, `/study plan`, `/exam`, `/reset`, and help commands.

### Reliability
- Queue-backed asynchronous AI processing.
- Durable per-chat job state and duplicate protection.
- Retry and dead-letter-queue handling.
- Structured Gemini answer validation.
- Retry of incomplete `MAX_TOKENS` output.
- Best-effort profile persistence so personalization failure does not strand a valid answer.
- Telegram typing lifecycle and terminal failure handling.

### Usage controls
- **20 accepted AI questions per India calendar day by default.**
- Daily reset at **00:00 IST**.
- **5 accepted AI questions per 10 seconds** by default for burst protection.
- Daily quota and burst protection are independent.
- Burst-limit and daily-limit messages are intentionally different.

### Operations and analytics
- Centralized D1 admin projection for users, questions, and events.
- Protected `/admin` dashboard and JSON endpoints.
- 90-day default raw analytics retention.
- Daily scheduled cleanup.
- Structured request IDs and operational logging without secret values.

## What v2.4.1 does not ship

The following are product concepts, not implemented production features in this release:

- PUBG-style live Battle Royale arena.
- Squad matchmaking and social graph.
- Live WebRTC/Clubhouse-style voice rooms.
- Spectator stadium / kill-feed system.
- Sprint Coins economy.
- Paid coins, Razorpay checkout, donations, subscriptions, or marketplace.
- AI video/graphic shortcut marketplace.
- Production WebApp gaming shell.

These may be developed later as separate, tested releases.

## Architecture

```text
Telegram
   |
   v
Cloudflare Worker (HTTP)
   |
   +--> D1 analytics projection
   |
   +--> Durable Object (per private chat)
   |       |
   |       +--> rate limits
   |       +--> duplicate/job state
   |       +--> short conversation context
   |       +--> student profile + learning signals
   |
   +--> Cloudflare Queue
           |
           v
       Queue consumer
           |
           +--> Vertex AI / Gemini
           |
           +--> profile update
           |
           +--> Telegram answer delivery
```

The Durable Object is the authoritative short-lived operational state for a private chat. D1 is an analytics/admin projection and is not used as the primary live question-processing state machine.

## Public/private boundary

This repository is public by design, but production access is still separated from source code.

**Public:** application source, tests, schemas, deployment instructions, public configuration templates, and engineering documentation.

**Never commit:** Telegram bot tokens, webhook/setup secrets, Google service-account private keys, admin passwords, session-signing secrets, Cloudflare API tokens, local `.dev.vars`, real student exports, or production log dumps.

See `SECURITY.md` and `docs/SECURITY_MODEL.md`.

## Quick start

Requirements:

- Node.js 22+
- npm
- A Cloudflare Workers project
- A Cloudflare D1 database
- A Cloudflare Queue and Durable Object binding
- A Telegram bot
- A Google Cloud project with Vertex AI access

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run check
npm test
```

The repository's example variables are templates only. Copy the required values into local development configuration; do not commit real secrets.

## Production deployment

Follow these documents in order:

1. `DEPLOY_DASHBOARD.md`
2. `PRODUCTION_CHECKLIST.md`
3. `docs/OPERATIONS_RUNBOOK.md`

After deployment, validate the release using `docs/TEST_PLAN.md`.

## Configuration summary

| Setting | Default | Purpose |
|---|---:|---|
| `DAILY_QUESTION_LIMIT` | `20` | Accepted AI questions per India calendar day |
| `BURST_QUESTION_LIMIT` | `5` | Accepted questions within the burst window |
| `BURST_WINDOW_SECONDS` | `10` | Burst window duration |
| `MAX_OUTPUT_TOKENS` | `1200` | Normal Gemini output ceiling |
| `MAX_QUESTION_LENGTH` | `4000` | Maximum incoming text length |
| `VERTEX_TIMEOUT_MS` | `25000` | Vertex request timeout |
| `ANALYTICS_RAW_RETENTION_DAYS` | `90` | D1 raw question/event retention |

## Identity and reset semantics

The canonical student identity is the Telegram `from.id` value for analytics and learning-profile identity. Private-chat operational routing uses the chat ID because the current product intentionally supports private chats only.

`/reset` clears the student's live study profile and starts a fresh conversation context. It does **not** erase centralized D1 operational analytics. The daily question allowance is a separate rate-limit state and is **not** reset by `/reset`.

This separation is intentional: a user may forget/reset their study personalization without receiving a new daily AI quota.

## Versioning

Parmar AI uses semantic-style release numbers for production milestones. See `docs/VERSIONING.md` for the release discipline and compatibility rules.

## License

The source in this repository is publicly readable but is **not granted an unrestricted open-source reuse license**. See `LICENSE` for the current terms.

## Security reporting

Do not disclose credentials or exploitable vulnerabilities in public issues. See `SECURITY.md` for private reporting guidance.
