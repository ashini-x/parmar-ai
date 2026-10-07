# Parmar AI

**Production Release: v2.6.0**

Parmar AI is a Telegram-first, SSC-focused AI study companion built for fast doubt solving, conversation continuity, evidence-based study personalization, and owner-grade operational visibility.

The production application runs on **Cloudflare Workers**, **Cloudflare Queues**, **SQLite-backed Durable Objects**, **Cloudflare D1**, **Telegram Bot API**, and **Google Vertex AI / Gemini**.

This repository intentionally contains the complete public application and engineering documentation for the v2.6.0 release. Production secrets, credentials, private user exports, and operational tokens are never committed.

> **Repository status:** Public production source for v2.6.0. Future Battle Arena, social, voice, marketplace, and payments concepts are not shipped unless explicitly marked below.

## What v2.6.0 ships

### Student experience
- SSC GA/GS-first doubt solving.
- Concise, exam-oriented answers with an SSC takeaway when useful.
- Adaptive Gemini thinking: LOW, MEDIUM, or HIGH within the configured ceiling.
- Conversation continuity across recent completed in-scope turns.
- Follow-up handling for phrases such as `iska`, `isko`, `isme`, `ye`, `same`, `phir se`, and `simple mein`.
- Explicit confusion-aware and simplification-aware responses.
- Persistent evidence-based learning signals for repeated, explicit confusion/weakness.
- Targeted revision suggestions anchored to the current topic.
- `/profile`, `/exam`, `/reset`, `/help`, and `/id` commands.

### Reliability and safety
- Queue-backed asynchronous AI processing.
- Durable per-private-chat job state and duplicate protection.
- Retry and dead-letter-queue handling.
- Structured Gemini answer validation.
- Retry of incomplete `MAX_TOKENS` output.
- Profile persistence isolated from primary answer delivery.
- Telegram typing lifecycle and terminal failure handling.
- Server-side suspension control for abusive or test-blocked accounts.

### Usage controls
- **20 accepted AI questions per India calendar day by default.**
- Daily reset at **00:00 IST**.
- **5 accepted AI questions per 10 seconds** by default for burst protection.
- Daily quota and burst protection are independent.
- Privileged owner/admin/test profiles can bypass only the daily quota.
- Unlimited accounts remain subject to the burst safeguard.
- Daily-limit and burst-limit messages are separate.

### Admin and founder control center
The protected `/admin` application is a non-technical operations console with:

- Live overview of students, activity, success rate, latency, backlog and quota events.
- AI token usage: prompt, output/candidate, reasoning/thought, cached and total tokens.
- Estimated AI cost per request and aggregate spend.
- Configurable AI budget display with estimated remaining budget.
- Simple 30-day spend run-rate projection.
- Spend by thinking level, model and location.
- Most expensive requests.
- Searchable student directory and individual student profiles.
- Student usage, estimated cost, recent topics and learning signals.
- Unlimited-access grant/revoke controls.
- Student suspend/unsuspend controls.
- Admin-triggered student profile reset.
- Admin audit log.
- Recent/live question activity with tokens, cost, latency and attempts.
- Learning analytics for subjects, topics, modes and repeated explicit confusion.
- System configuration/health visibility.
- JSON report export.

### Offline reporting
A Python/Matplotlib reporting utility lives under `reports/`. It is intentionally **not** on the production request path. It consumes exported admin JSON and produces local charts and a Markdown summary for founder/ops review.

### AI economics accounting
For each successful HTTP 200 Vertex response, the app records the token metadata returned by Gemini, including prompt, candidate output, thought and tool-use token counts when available. Google documents `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount`, `cachedContentTokenCount`, and `totalTokenCount` in the GenerateContent response metadata. citeturn802934search2

The dashboard converts that usage into an **estimate**, using configurable per-million-token rates. For the current production model, the default global standard rates are **$0.75 / 1M input**, **$0.075 / 1M cached input**, and **$3.75 / 1M text output (response + reasoning)** through December 31, 2026. Google lists higher standard rates beginning January 1, 2027. citeturn802934search0

The dashboard never presents this estimate as the authoritative Google Cloud invoice.

## What v2.6.0 does not ship

- PUBG-style live Battle Royale arena.
- Squad matchmaking and social graph.
- WebRTC/Clubhouse-style voice rooms.
- Spectator stadium / kill-feed system.
- Sprint Coins economy.
- Paid coins, payments, donations, subscriptions, or marketplace.
- Production Telegram WebApp gaming shell.

## Architecture

```text
Telegram private chat
        |
        v
Cloudflare Worker
        |
        +--> D1 analytics projection
        |
        +--> Durable Object (per private chat)
        |       |
        |       +--> daily/burst rate metadata
        |       +--> duplicate/job state
        |       +--> recent conversation context
        |       +--> student profile + learning signals
        |
        +--> Cloudflare Queue
                |
                v
           Queue consumer
                |
                +--> Vertex AI / Gemini
                |      |
                |      +--> token metadata
                |      +--> structured answer
                |
                +--> D1 AI usage accounting
                +--> profile update
                +--> Telegram answer delivery

Protected /admin
        |
        v
D1 analytics + AI usage + access controls + audit log
        |
        +--> live dashboard
        +--> JSON export --> offline Python/Matplotlib reports
```

D1 is the admin/analytics projection; the Durable Object + Queue path remains the primary operational question-processing state machine.

## Public/private boundary

**Public:** application source, tests, schemas, deployment templates, documentation, admin UI code, and report tooling.

**Never commit:** Telegram bot tokens, webhook/setup secrets, Google service-account private keys, admin passwords, session-signing secrets, Cloudflare API tokens, local `.dev.vars`, real student exports, production log dumps, or private billing credentials.

The repository uses placeholders in `wrangler.example.jsonc` and `.dev.vars.example`.

## Quick start

Requirements:
- Node.js 22+
- npm
- Cloudflare Workers/D1/Queues/Durable Objects
- Telegram bot
- Google Cloud project with Vertex AI access

```bash
npm install
npm run check
npm test
```

Python reporting is optional and local-only:

```bash
python reports/generate_report.py exported-report.json --output-dir report-output
```

## Production deployment

Follow:

1. `DEPLOY_DASHBOARD.md`
2. `PRODUCTION_CHECKLIST.md`
3. `docs/OPERATIONS_RUNBOOK.md`
4. `docs/TEST_PLAN.md`

## Configuration summary

| Setting | Default | Purpose |
|---|---:|---|
| `DAILY_QUESTION_LIMIT` | `20` | Accepted AI questions per India calendar day |
| `BURST_QUESTION_LIMIT` | `5` | Accepted questions in the burst window |
| `BURST_WINDOW_SECONDS` | `10` | Burst window duration |
| `MAX_OUTPUT_TOKENS` | `1200` | Normal Gemini output ceiling |
| `MAX_QUESTION_LENGTH` | `4000` | Maximum incoming text length |
| `VERTEX_TIMEOUT_MS` | `25000` | Vertex request timeout |
| `ANALYTICS_RAW_RETENTION_DAYS` | `90` | D1 raw question/event/usage retention |
| `AI_BUDGET_USD` | unset | Optional daily budget used only for dashboard estimates |
| `AI_INPUT_USD_PER_MILLION` | `0.75` | Estimated non-cached input rate |
| `AI_CACHED_INPUT_USD_PER_MILLION` | `0.075` | Estimated cached-input rate |
| `AI_OUTPUT_USD_PER_MILLION` | `3.75` | Estimated text output + reasoning rate |
| `BOT_OWNER_TELEGRAM_USER_ID` | — | Primary bot owner/admin identity |
| `ADMIN_TELEGRAM_USER_IDS` | — | Additional admin IDs |
| `UNLIMITED_AI_TELEGRAM_USER_IDS` | — | Static unlimited-AI test allowlist |

## Privileged access

The owner and configured Telegram admins are exempt from the daily question quota. Specific test profiles can receive unlimited daily AI access through D1 runtime overrides or the static allowlist.

Unlimited means **no daily quota**, not unlimited traffic. All accounts remain protected by the 5-question / 10-second burst rule.

## Identity and reset semantics

The canonical student identity is the Telegram `from.id` value for analytics and learning-profile identity. Private-chat operational routing continues to use chat ID because v2.6.0 supports private chats only.

`/reset` clears the student's study profile and conversation context. It does **not** erase centralized analytics, and it does **not** reset the daily AI quota.

## AI cost accounting caveat

Token usage is recorded from Gemini response metadata after successful HTTP 200 responses. The displayed AI spend is an estimate based on the configured pricing snapshot. It is deliberately separate from the actual Google Cloud billing account balance or final invoice.

## Versioning

See `docs/VERSIONING.md`. v2.6.x is the production-reliability and access-control hardening line built on top of the stable v2.4.2 application line.

## License

See `LICENSE`.

## Security reporting

Do not disclose credentials or exploitable vulnerabilities in public issues. See `SECURITY.md`.
