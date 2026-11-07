# Architecture — Parmar AI (current production baseline)

**Locked runtime baseline:** 2026-11-07  
**Repository:** `ashini-x/parmar-ai`  
**Product/domain baseline:** v2.8.0  
**Implementation authority:** `src/`, tests and `wrangler.jsonc`

The previous v2.5.2 architecture summary has been superseded. This file is the high-level map only. The detailed, code-audited source of truth is [Locked Telegram Bot Architecture — Reusable Production Baseline](docs/TELEGRAM_BOT_ARCHITECTURE.md). Use that document as the starting point when building another Telegram bot on this same runtime pattern.

## System shape

```text
Telegram Bot API
      |
      v
Cloudflare Worker --------------------> D1 bot credential registry
(webhook auth, /start, commands)       (encrypted token/secret, secret hash)
      |
      +--- /start: send original welcome immediately
      |              +-- analytics/menu/OAuth prefetch via waitUntil
      |
      +--- question: early typing + deduplicated acknowledgement
                     |
                     v
              JobDedupe Durable Object
              (one per private chat)
              - suspension/entitlement gate
              - atomic dedupe + quota + burst admission
              - job state + lease + recovery
              - conversation + student profile
                     |
                     v
              Cloudflare Queue
              (durable hand-off, retries, DLQ)
                     |
                     v
              Queue consumer
              - ordered lease claim
              - profile/history reads in parallel
              - Vertex AI / Gemini structured stream
              - validated AnswerPacket
              - Telegram final answer/quiz delivery
                     |
                     +----> Durable Object completion/profile state
                     +----> D1 analytics and usage projections
```

## Responsibility boundaries

**Worker ingress** authenticates Telegram updates, dispatches commands, acknowledges questions and publishes durable jobs. The `/start` greeting is delivered before first-seen analytics, command-menu sync or Google OAuth prefetch. Its original copy is preserved.

**Durable Object** is the operational authority per private chat: duplicate protection, acknowledgement reservations, daily/burst counters, job state, Queue leases, profile, recent conversation and recovery alarms. Same-chat work is serialized; different chats can run concurrently.

**Queue** isolates webhook response time from AI latency. Queue publication is awaited before the webhook returns `queued`. The later `mark_queued`/typing hand-off runs in background; the Queue consumer may claim a still-pending job.

**Vertex AI / Gemini** returns a schema-constrained `AnswerPacket`. Thinking is adaptive within the configured ceiling, grounding is selective, stream chunks update the same Telegram status message, and retryable model attempts are bounded.

**Progress and typing** are cosmetic. They must never become the authority for job state or block final delivery. A transient progress-edit timeout is retried; after three consecutive failures, only progress updates are disabled.

**D1** holds bot credentials, access overrides and analytics projections. It is not the authoritative source for per-chat quota counters, active jobs or conversation state.

## Locked latency invariants

- Webhook authentication provisions only the dedicated `telegram_bots` table/index; it never invokes full Analytics/BRVIN migrations.
- Runtime Telegram analytics/access checks use `ensureRuntimeAnalyticsSchema`, a small per-D1-binding cached initializer for the six required runtime tables and their indexes.
- Full `ensureAnalyticsSchema` remains available to admin/BRVIN surfaces.
- First-contact `/start` sends the existing welcome before analytics or preparation work.
- New questions return `queued` only after `QUESTION_QUEUE.send` succeeds.
- The cosmetic post-queue DO state/typing hand-off is scheduled with `ctx.waitUntil`.
- Progress edits use a short 1-second Telegram call, recover from transient failures and never cancel model generation.
- Per-stage telemetry distinguishes webhook admission, Queue wait, context reads and answer generation. Invocation wall time is not treated as user-visible latency because it can include background work.

## Parmar-specific extensions

The reusable Telegram runtime does not require the following domain modules. Parmar currently layers them on top:

- SSC prompts, question classification, native MCQs and student learning profile;
- optional photo-question processing;
- Fatman knowledge mode and BRVIN retrieval integration;
- Parmar admin dashboard, quiz sessions, reporting and project governance.

A future bot should copy the runtime boundaries and reliability tests, then supply its own commands, prompts, response schema, policies and data model. It must use its own Worker, D1, Queue, DLQ, Durable Object namespace/binding, secrets and provider configuration. Do not copy production identifiers, credentials, student data or unrelated Fatman/BRVIN modules.

## Source map

| Concern | Implementation |
|---|---|
| Webhook, /start, commands, queue consumer | `src/index.ts` |
| Bot credential storage and light schema | `src/telegram/bot-store.ts` |
| Telegram API timeout/retry and final delivery | `src/telegram/api.ts` |
| Progress state machine and bounded retries | `src/telegram/progress.ts` |
| Per-chat job state, quota, leases and alarms | `src/core/job-store.ts` |
| Concurrent preflight/context reads | `src/telegram/parallel-work.ts` |
| Runtime/full D1 schemas | `src/analytics/db.ts` |
| Vertex/Gemini structured streaming | `src/ai/gemini.ts` |
| Worker and Queue bindings | `wrangler.jsonc` |

See [docs/TELEGRAM_BOT_ARCHITECTURE.md](docs/TELEGRAM_BOT_ARCHITECTURE.md) for the exact lifecycle, current timing constants, observability fields, failure boundaries, source/test references and step-by-step reuse checklist.
