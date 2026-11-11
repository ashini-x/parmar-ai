# Locked Telegram Bot Architecture — Reusable Production Baseline

**Status:** Locked as the production reference architecture  
**As-built source:** `ashini-x/parmar-ai`  
**Locked on:** 2026-11-07  
**Code baseline:** `main` after the Telegram runtime fast-path and progress-recovery releases  
**Authority:** Source code and deployed Worker configuration. This document records the implementation, not a proposal.

This is the canonical architecture to reuse when creating another Telegram bot. Read it before changing the Telegram request path or porting the design. The top-level [ARCHITECTURE.md](../ARCHITECTURE.md) is the short system map; this document is the detailed operational source of truth.

## 1. Locked design principles

The user-visible Telegram response is separated from slow work without sacrificing durable admission or per-chat ordering:

1. Authenticate Telegram's webhook secret-token header.
2. Treat `/start` as a special fast path: send the welcome first, then schedule non-essential preparation.
3. For questions, acknowledge quickly and perform authoritative access/admission checks.
4. Persist the job and publish it to Cloudflare Queues before acknowledging the webhook as queued.
5. Process the question in a Queue consumer; the per-private-chat Durable Object remains the operational source of truth.
6. Generate and validate a structured Vertex AI/Gemini response.
7. Deliver the final answer through Telegram; keep typing/progress cosmetic and failure-isolated.
8. Record analytics separately from operational job state.

**Never put full Analytics/BRVIN migrations, Gemini generation, command-menu synchronization, or non-essential analytics ahead of the original `/start` welcome. Never return a successful queued response before the Queue has accepted the job. Never move quota or duplicate protection out of the Durable Object transaction.**

## 2. Component map

| Component | Current implementation | Owns |
|---|---|---|
| Telegram ingress | Cloudflare Worker, `src/index.ts` | Webhook authentication, update routing, commands, acknowledgement, Queue publication |
| Bot credential registry | D1, `src/telegram/bot-store.ts` | Bot identity, encrypted token/secret, hashed webhook secret, active/disconnected state |
| Telegram API adapter | `src/telegram/api.ts` | Telegram HTTP calls, timeouts, retries, message/quiz/media delivery |
| Per-chat state | SQLite-backed Durable Object `JobDedupe`, `src/core/job-store.ts` | Atomic admission, dedupe, rate limits, jobs, leases, conversation, profile, alarms |
| Async work | Cloudflare Queue `QUESTION_QUEUE` | Durable hand-off, redelivery, retries and DLQ |
| AI execution | `src/ai/gemini.ts` + `src/auth/google.ts` | OAuth, Vertex AI requests, adaptive thinking, streamed JSON, validation and retries |
| Progress UX | `src/telegram/progress.ts` | Serialized/coalesced status and partial-answer edits; cosmetic failure isolation |
| Runtime analytics | D1 via `src/analytics/db.ts` | User/event/question/usage projections and access overrides |
| Configuration | `wrangler.jsonc` | Worker bindings, Queue consumer, D1, Durable Object, runtime variables, observability |

The Worker uses the `JOB_DEDUPE` Durable Object binding. `getJobStore(env, chatId)` selects the operational object by private chat ID. This serializes one student's operational state while allowing different chats to process concurrently.

## 3. Webhook authentication and bot identity

The webhook accepts Telegram's `X-Telegram-Bot-Api-Secret-Token` header and resolves the connection through `findTelegramBotByWebhookSecret`.

- `ensureTelegramBotSchema` provisions only `telegram_bots` and its partial unique active-connection index.
- The webhook secret is matched by SHA-256 hash; the stored secret and bot token are encrypted.
- Schema initialization is cached per D1 binding with a `WeakMap` promise. Failed initialization clears the cached promise so a later request can retry.
- A matching inactive connection is ignored. Queue admission and outbound delivery still re-check active-connection state at their security boundaries.
- A legacy environment-token fallback remains for installations with no persisted active bot record. It is compatibility behavior, not the preferred multi-bot connection path.

**Critical boundary:** webhook authentication must not call `ensureAnalyticsSchema` or trigger the full Analytics/BRVIN migration chain.

Typing/progress code uses short-lived isolate-local credential caches. These are only for cosmetic API calls; they do not replace authoritative active-connection checks for admission or final delivery.

## 4. First-contact `/start` path

The first visible response is deliberately isolated from analytics and preparation work:

1. Authenticate the webhook and parse the Telegram update.
2. Recognise `/start`.
3. Send the original welcome directly with `sendTelegramMessageWithToken(bot.token, ...)`.
4. Record delivery timing and whether Telegram accepted the send.
5. Only after the welcome attempt, schedule `user_seen` and `start` analytics with `ctx.waitUntil`.
6. Schedule command-menu synchronization with `ctx.waitUntil`.
7. Prefetch the short-lived Google OAuth access token with `ctx.waitUntil`, when credentials are configured. This is token preparation only; it does not create a Gemini session.

The current welcome copy is:

> So Hello Everyone, umeed karta hoon aap sabhi thik honge!
>
> Chalo, sawaal lao, seedha point pe aate hain!

Keep this exact copy when reusing the baseline unless the new bot explicitly defines its own greeting. Do not put analytics schema setup, model calls, BRVIN readiness checks, menu sync, or OAuth refresh before delivery.

Relevant logs:

- `telegram_webhook_authenticated` — `authenticationMs`
- `telegram_start_received` — `webhookAuthenticationMs`
- `telegram_start_welcome_delivery` — `deliveryMs`, `delivered`
- `google_access_token_prefetch_ready` / `google_access_token_prefetch_failed`

A Worker invocation's overall wall time can include work scheduled with `ctx.waitUntil`. Do not interpret full invocation wall time as the time the user waited for the welcome. Use the authentication and delivery fields above.

## 5. Question ingress and admission path

The normal question path in `handleTelegramWebhook` follows this order:

1. Validate update, chat, message and question fields; restrict the study path to private chats.
2. Queue first-seen analytics as background work for non-`/start` updates.
3. Start an early Telegram typing heartbeat immediately. The Worker sends a chat action and refreshes it every three seconds while preflight/admission is running.
4. Reserve the acknowledgement through the per-chat Durable Object using `reserve_ack`. This prevents duplicate status messages for repeated Telegram updates.
5. For a new reservation, send the short status message and save its message ID in Durable Object state. A cosmetic acknowledgement failure is logged but must not prevent admission.
6. Start the user-suspension check and bot-specific mode lookup concurrently through `runSuspensionAndModeLookup`. If suspension fails or the user is suspended, the admission path exits without waiting for or using the mode result; that lookup may already be in flight.
7. Resolve any pending quiz continuation state.
8. Call the Durable Object `begin` action. The entitlement check is performed through D1, then duplicate handling, daily allowance, burst allowance and pending-job creation are serialized inside one Durable Object storage transaction.
9. Publish the versioned question job to `QUESTION_QUEUE` and await the Queue send.
10. Once Queue publication succeeds, schedule `mark_queued` and the Durable Object-owned typing hand-off in `ctx.waitUntil`; stop the Worker-local typing heartbeat and return the webhook response.

The normal new-job path treats **successful Queue publication** as the durable hand-off. The Queue consumer can claim a job while its Durable Object state is still `pending`; therefore the cosmetic `mark_queued` state label and Telegram typing ping are not prerequisites for returning the webhook response. The existing `retry_ack` recovery branch is a separate idempotent recovery path and awaits its own enqueue/state update.

### Durable admission rules

The `begin` action:

- checks D1 unlimited-access overrides and environment-configured administrator/unlimited IDs;
- applies the configured India-calendar-day quota;
- applies the configured burst window even for users with unlimited daily access;
- accounts for a requested quiz batch as multiple usage units;
- checks for an existing job before creating a new one;
- writes the pending job and updated counters atomically.

Current production defaults in `wrangler.jsonc` are **20 questions per India calendar day** and **5 questions per 10 seconds**. Treat these as this bot's configuration, not universal defaults for every future bot.

## 6. Durable Object operational model

`JobDedupe` is keyed by private chat and owns the state that must remain consistent across webhook retries and Queue redelivery:

- acknowledgement reservations and status-message IDs;
- duplicate update/job detection;
- daily and burst counters;
- question jobs and their states: `pending`, `queued`, `processing`, `done`;
- Queue-message/lease ownership and lease version;
- student profile and profile-update idempotency markers;
- bounded conversation history and quiz-result context;
- bot-specific mode state;
- staged photo-album metadata when photo support is enabled;
- alarms for typing, recovery and retention.

The `claim` operation prevents a later active job from overtaking an older active job for the same chat. It increments a lease version and records the active Queue message ID. Mutations such as saving an answer packet, updating the profile and completing the job are lease-fenced so a stale Queue delivery cannot overwrite a newer attempt.

### Recovery and alarm policy

Current constants in `src/core/job-store.ts`:

| Policy | Current value | Purpose |
|---|---:|---|
| Pending job recovery | 45 seconds | Re-enqueue a pending job that never reached the Queue |
| Queued job recovery | 2 minutes | Re-enqueue a queued job that has gone stale |
| Processing lease | 5 minutes | Recover a worker/job whose processing lease expired |
| Maximum active job age | 20 minutes | Stop indefinitely recovering an old active job |
| Operational job/ack retention | 48 hours | Retain state for dedupe and bounded conversation/recovery |
| Typing feedback maximum age | 10 minutes | Prevent typing from remaining active forever |
| DO wait-state typing refresh | 2.5 seconds | Maintain feedback while a job waits |
| DO processing typing refresh | 4 seconds | Maintain feedback while work is processing |

The Durable Object alarm selects the oldest non-terminal job for typing feedback. It also performs stale-job recovery and retention cleanup. It retries transient token lookup/typing failures without making typing a source of truth.

## 7. Queue and processing path

The current Queue consumer configuration in `wrangler.jsonc` is:

| Setting | Value |
|---|---:|
| Max batch size | 1 |
| Max batch timeout | 1 second |
| Max retries | 10 |
| Retry delay | 15 seconds |
| Max concurrency | 50 |
| Dead-letter queue | `parmar-ai-questions-dlq` |

The Queue consumer:

1. validates the job envelope and confirms the bot connection is still active;
2. claims the job through the chat's Durable Object;
3. retries later if an older job or valid processing lease prevents the claim;
4. starts Google OAuth prefetch in parallel with independent context reads;
5. loads profile and recent conversation concurrently, each with its own safe fallback;
6. records question-start/processing analytics through the focused runtime schema;
7. optionally retrieves domain-specific evidence (Fatman/BRVIN is a Parmar-specific extension, not required by the base Telegram architecture);
8. calls Gemini/Vertex when no reusable answer packet is already stored;
9. stores the validated `AnswerPacket` under the active lease so a later Queue attempt can reuse it;
10. updates the student profile through lease-fenced, idempotent Durable Object operations. Profile failure must not prevent a valid answer from reaching the student;
11. stops progress updates before final delivery so a delayed cosmetic edit cannot overwrite the answer;
12. edits the existing status message with the final answer (or sends a new message if the edit is terminally invalid);
13. marks the Durable Object job complete, schedules result analytics, logs completion, and acknowledges the Queue message.

The Queue payload carries the bot connection ID, Telegram update/chat/message IDs, question, request ID, creation time, status-message ID, quiz metadata and relevant mode snapshot. Photo file IDs remain in the Durable Object job record for retry; image bytes are fetched from Telegram at processing time and are not stored as durable job payload data.

## 8. Gemini / Vertex AI contract

`generateGeminiAnswer` calls Vertex AI using the configured Google service-account OAuth access token and a structured response schema. The expected application contract is a validated `AnswerPacket`, not arbitrary unvalidated text.

Current implementation characteristics:

- adaptive LOW/MEDIUM/HIGH thinking, bounded by `GEMINI_THINKING_LEVEL`;
- Google Search grounding only when the question classifier marks the question time-sensitive and grounding is enabled;
- structured JSON response with `responseSchema`;
- streaming via `streamGenerateContent?alt=sse` when a progress handler is attached;
- maximum three internal model attempts for retryable generation failures;
- default normal-mode Vertex timeout of 25 seconds, overridable by `VERTEX_TIMEOUT_MS`; book/page-grounded mode has a longer floor;
- usage metadata is normalised for input, output, reasoning, tool and cached tokens with duplicate-safe accounting.

A model retry does not become a new student question. The existing Queue job and Durable Object lease remain the operational job.

## 9. Progress, typing and Telegram API resilience

Typing and progress are feedback only; they must never become prerequisites for model generation or final answer delivery.

- The Worker starts an immediate typing heartbeat while a question is entering admission.
- The Durable Object alarm owns continued feedback for the oldest active job across pending, queued and processing states.
- A single status message is reused for short contextual phases and partial-answer text.
- Status edits have a 500 ms minimum interval; streamed answer edits are coalesced at 850 ms.
- Phase variants rotate every 2.5 seconds; a writing state can appear after a 2.3-second answer-stream idle period.
- Each cosmetic progress edit uses one Telegram API attempt with a 1-second timeout. The progress updater retries transient failures on the normal cadence and disables only progress after three consecutive failures.
- A successful progress edit resets the consecutive-failure counter.
- Final Telegram message delivery uses the normal Telegram API retry policy, not the short cosmetic-progress timeout.
- The progress updater is stopped and any in-flight edit is settled before final answer/quiz delivery.

A Telegram progress timeout can temporarily affect visual status, but it must not cancel Gemini generation or strand the final answer.

## 10. D1 schema boundary

D1 is a persistence/projection layer; the per-chat Durable Object is the operational authority for duplicate protection, quota counters, active-job state, conversation and profile.

There are deliberately separate schema initializers.

### Telegram credential schema

`ensureTelegramBotSchema` creates only:

- `telegram_bots`;
- `idx_telegram_bots_one_active`.

This is the webhook-authentication prerequisite.

### Telegram runtime analytics schema

`ensureRuntimeAnalyticsSchema` creates only the runtime tables needed by Telegram admission and analytics:

- `users`;
- `events`;
- `questions`;
- `ai_access_overrides`;
- `ai_usage_attempts`;
- `admin_user_controls`;
- the related runtime indexes.

Its promise is cached per D1 binding and removed from the cache on failure so it can retry. It does not run legacy migration or BRVIN identity setup.

### Full application/admin schema

`ensureAnalyticsSchema` remains the full initializer for admin and BRVIN surfaces. It retains legacy BRVIN migration, compatibility, metadata and identity setup. Do not call it from webhook authentication, first-contact `/start`, or latency-sensitive question admission.

D1 analytics writes are best-effort/background where the calling path allows it. Do not use an analytics row as a substitute for an authoritative Durable Object job or quota record.

## 11. Latency observability

The code records per-stage timings so a slow message can be attributed to the right subsystem.

| Log event | Useful fields | What it measures |
|---|---|---|
| `telegram_webhook_authenticated` | `authenticationMs` | Secret lookup/authentication |
| `telegram_start_welcome_delivery` | `deliveryMs`, `delivered` | User-visible welcome send attempt |
| `telegram_question_queued` | `totalWebhookMs`, `acknowledgementReservationMs`, `acknowledgementDeliveryMs`, `suspensionAndModeLookupMs`, `quizStateMs`, `jobAdmissionMs`, `queuePublishMs` | Time to publish a new question to the Queue |
| `telegram_question_marked_queued` | `durationMs` | Background DO state/typing hand-off |
| `telegram_question_mark_queued_failed` | `durationMs`, `error` | Background state/typing hand-off failure |
| `question_processing_started` | `queueWaitMs`, `attempts` | Queue wait before consumer processing |
| `question_context_loaded` | `contextReadMs` | Parallel profile/history read time |
| `fatman_retrieval_completed` | `durationMs`, `searchCount`, `passageCount`, `pageImageCount` | Private BRVIN / Cloudflare AI Search retrieval stage for Fatman |
| `fatman_retrieval_failed` | `durationMs`, `retryable`, `errorType` | Failed Fatman retrieval stage without logging the query or source text |
| `question_answer_generated` | `answerPipelineMs`, `geminiGenerationMs`, optional `fatmanRetrievalMs`, `model`, `thinkingLevel`, `grounded` | End-to-end answer pipeline plus explicit search and Gemini stage timings |
| `gemini_generation_attempt_completed` | `attempt`, `durationMs`, `thinkingLevel`, `firstPartialAnswerMs`, `streamed`, token counts | One successful Vertex request; first useful streamed answer text is separately measured |
| `gemini_generation_attempt_failed` | `attempt`, `durationMs`, `status`, `retryable`, `streamed` | One failed Vertex request before retry/terminal failure |
| `question_completed` | `answerLength`, `attempts` | Successful end of processing/delivery |
| `telegram_partial_answer_stream_failed` | `error` | Cosmetic progress-edit failure |

Use a single request ID/update ID to correlate webhook, Queue and completion events. Do not log tokens, webhook secrets, full private message bodies or personal data.

**Important:** generic Worker `wallTimeMs` includes `ctx.waitUntil` work after the response path has finished. Use `telegram_question_queued.totalWebhookMs` and its stage fields for webhook-to-Queue latency; use `queueWaitMs`, `contextReadMs` and `answerPipelineMs` for processing latency. For Fatman, compare `fatmanRetrievalMs` with `geminiGenerationMs`; for non-Fatman answers, `geminiGenerationMs` isolates Vertex generation. Do not call the entire invocation wall time the user's wait time.

### Gemini latency investigation and staging-first tuning — 12 November 2026

A read-only inspection of production Worker telemetry and D1 usage records found:

- Six `question_answer_generated` events in the preceding seven-day query window were all `fatmanMode=false`, using `gemini-3.8-flash` at `global`. Their `answerPipelineMs` values were 5,319, 5,608, 5,772, 9,947, 11,073 and 24,856 ms. The 24.856-second request is the long-tail outlier.
- Because those six requests were not in Fatman mode, they did not call Cloudflare AI Search. Their delay is therefore not explained by AI Search retrieval. Fatman retrieval time must be measured separately from generation; this telemetry sample contained no Fatman answer event and cannot establish Fatman retrieval performance.
- The production `ai_usage_attempts` sample for the same seven-day period had 32 completed MEDIUM attempts averaging 3,606 prompt tokens, 211 candidate tokens and 251 thought tokens. One HIGH request produced a rejected structured response on attempt 1 and a completed response on attempt 2; it corresponds to the 24.856-second answer-pipeline outlier. This confirms that a retry can add a second full model request, but retries were uncommon in this sample.
- The earlier M15 PDF-assisted formula audit is not a like-for-like Telegram latency sample: it supplied an extracted original PDF page, used the strict source-grounded prompt and did not attach Telegram's partial-answer handler. Telegram streams through `streamGenerateContent` when its handler is present.

**Merged latency candidate — Core PR [#226](https://github.com/ashini-x/parmar-ai/pull/226), commit `d51c234b72957e7f8aa92565b07635858b524c7b`:**

- Ordinary short questions now default to LOW thinking.
- Explanations, comparisons and reasoning questions use MEDIUM.
- HIGH is reserved for explicit multi-step/derivation prompts or unusually long questions; the configured `GEMINI_THINKING_LEVEL` remains the hard ceiling.
- Each model attempt records duration, thinking tier, token counts, success/failure and whether streaming was used. On streamed Telegram requests it also records the time to the first useful partial answer, separately from total generation time.

**Validation and rollout boundary:** PR checks passed typecheck, full Vitest, Node tests and both Worker bundle dry-runs. M14 staging validation passed focused M14/M15 tests, provider-config verification and Wrangler dry-run. The merged code was deployed only to isolated Worker `parmar-ai-m14-staging`, deployment `9850e243-ae38-4e00-8fbc-a122f56fd7f9`, version `e3f24615-fcaa-4629-8077-ac09350d58fe`, at 100%. Release validation [#43086213061](https://github.com/ashini-x/parmar-ai/actions/runs/43086213061) passed and skipped production deployment/verification. Production `parmar-ai` remains on version `03233306-73d5-4990-be2d-a16dc99a8bd3` and private `brvin-service` remains on `66eac5b4-78f7-4708-a051-7cbe08b999a8`, both at 100%.

**Acceptance status:** this is a staged tuning change, not yet a measured production latency win. Do not claim a percentage improvement until the same normal Telegram workload is measured with the new tier policy. Compare first-partial latency and total answer latency separately, stratified by Fatman/non-Fatman, thinking tier, retry count and token counts. Keep Cloudflare AI Search as the current retrieval provider; no provider or production routing change is part of PR #226.

### Cloudflare AI Search cache and Fatman latency optimization — 12 November 2026

A read-only inspection of the live production Fatman AI Search instance found hybrid vector+keyword retrieval, RRF fusion and reranking enabled. The instance had caching enabled at the configuration level, but the shared Core retrieval provider explicitly overrode that setting with `cache: { enabled: false }` on every request.

**Merged implementation — PR [#227](https://github.com/ashini-x/parmar-ai/pull/227), commit `204b64c943c34695a707e952a7262c6e854ec202`:**

- Re-enable AI Search response caching per request, but use only `super_strict_match` similarity. This is intended for near-identical repeat queries, not loosely related wording.
- Keep vector+keyword hybrid retrieval, the existing score thresholds, the existing reranker and source-prefix filter unchanged.
- Core continues to validate every returned page key against the current D1-authorized source prefix after the provider returns the cached or fresh result.
- Keep Gemini answer generation fresh on every Telegram question. The cache applies to retrieval results only; it does not cache or replay a student's answer.
- Cloudflare documents a 48-hour default cache TTL, and states that cache entries are invalidated when indexed chunks are updated or deleted. This should be rechecked if the instance TTL or indexing workflow changes.

A direct, read-only comparison against the live 538-page Fatman index observed a strict-cache near-identical repeat taking about 594 ms versus about 1,313 ms with the cache explicitly disabled, with the same top source page. This is one warmed exact-query observation, not a guarantee for first-time or semantically different questions.

**Reranking was deliberately retained.** A separate paired comparison used the same source folder, hybrid search settings, candidate limit and threshold. Two-to-three Fatman query variants were searched concurrently, matching the production query-expansion pattern. Warm batch durations were approximately 1.4–2.0 seconds with either reranking setting and showed no consistent reranking latency penalty. Reranking did improve the expected Article 79 source page from outside the top five to the top five. Disabling reranking would therefore trade away useful ranking quality without a measured production-shaped speed gain.

The candidate also adds explicit queue-consumer stage fields:
- `fatman_retrieval_completed` / `fatman_retrieval_failed` report the private BRVIN search duration and bounded result counts.
- `question_answer_generated.geminiGenerationMs` reports Vertex generation separately from the broader answer pipeline.
- For Fatman, `question_answer_generated.fatmanRetrievalMs` reports retrieval separately from generation.

A historical read-only 30-day D1 sample contained 63 completed questions, with a mean end-to-end latency of 14,610 ms, median 14,127 ms, and maximum 40,145 ms. The average time from question receipt to Queue processing start was 3,815 ms (median 4,406 ms). These figures include Queue waiting and answer processing; they are not pure Gemini timings. The available recent `question_answer_generated` telemetry sample contained only non-Fatman answers (5,319–24,856 ms), so it cannot be used to claim historical Fatman search latency. The new stage logs are intended to make that split measurable from actual Telegram requests.

The same candidate changes ordinary simple explanation wording (for example, “Explain this in simple language”) to LOW thinking. Explicit why/reasoning and comparison questions remain MEDIUM. HIGH stays reserved for explicit multi-step/derivation requests or unusually long prompts. The configured `GEMINI_THINKING_LEVEL` remains the hard ceiling.

**Deployment receipt — 12 November 2026:**

- PR #227 merged as commit `204b64c943c34695a707e952a7262c6e854ec202`.
- Release validation [run #1168](https://github.com/ashini-x/parmar-ai/actions/runs/43092750374) passed: typecheck, full Vitest suite, Node tests, private BRVIN and Parmar Worker bundle dry-runs, production deployment, live root/BRVIN/Fatman smoke tests and release-manifest write.
- The isolated M14 staging Worker was also deployed and independently confirmed at 100%: deployment `7b5ada22-d43e-4915-9ece-8fe503405bc7`, version `f2a5c4ef-3c69-4fe8-a26c-fe1f888728eb`.
- Production `parmar-ai` is at 100% on deployment `82034528-fd6d-4aa6-ab78-5f037df607d7`, version `fbde2747-c095-4dd8-a9c7-a84c06866b15`.
- Production `brvin-service` is at 100% on deployment `7291d9a8-121a-4488-bd8a-e5606ace2bc0`, version `ff2ed4e3-3f06-4d05-833d-8bd98c045305`.
- Both automatic rollback jobs were skipped because deployment and smoke verification succeeded.

**Post-rollout measurement status:** the first 30-minute Observability query after deployment returned zero events for `gemini_generation_attempt_completed`, `fatman_retrieval_completed` and `question_answer_generated`. The release is live, but no real post-release Telegram request has yet been observed in that window. Do not claim a measured latency improvement until new Telegram traffic produces these stage timings. On subsequent requests, compare `geminiGenerationMs`, `fatmanRetrievalMs`, `firstPartialAnswerMs`, thinking level and retry count. Keep the existing Cloudflare AI Search provider and indexed source as-is; no provider migration, OCR mutation or index rebuild was part of this optimization.

## 12. Failure and retry boundaries

| Failure | Required behavior |
|---|---|
| Missing/invalid webhook secret | Reject before update processing |
| Inactive bot connection | Ignore or cancel at the appropriate security boundary |
| Duplicate Telegram update | Return duplicate outcome; do not create another active job or acknowledgement |
| Suspension/entitlement/rate limit | Reject before Queue publication and return the controlled user notice |
| Cosmetic acknowledgement/progress/typing error | Log; do not prevent authoritative admission or final delivery |
| Queue publish failure | Do not report the job as queued; return the enqueue failure path |
| Queue consumer transient error | Retry with the configured policy; DO alarm also recovers stale pending/queued/processing state |
| Gemini transient error | Internal model retry, then Queue retry if retryable |
| Profile read/write failure | Use fallback/read-safe behavior; do not withhold a valid final answer |
| Final Telegram delivery failure | Keep Queue retry semantics; do not mark the job complete before delivery succeeds |
| D1 analytics failure | Log separately; it must not become the operational job source of truth |

## 13. Reusing this architecture for another Telegram bot

Use this as a runtime architecture template, not as permission to share Parmar production state or domain-specific behavior.

### Copy the stable runtime pattern

- webhook authentication and bot-credential isolation;
- dedicated fast-path credential schema;
- `/start` direct delivery before analytics/menu/OAuth preparation;
- early acknowledgement and typing feedback;
- per-chat Durable Object for atomic dedupe, quota/admission, leases, conversation and recovery;
- Queue send as the durable hand-off;
- background `mark_queued`/typing hand-off after successful Queue publication;
- Queue consumer with lease claim, ordered per-chat processing, retries and DLQ;
- structured Gemini/Vertex response contract and bounded retries;
- non-blocking progress updater with bounded failure;
- runtime-only schema initialization separated from broad migrations;
- stage-level observability and production acceptance tests.

### Create new project-specific resources

For the new bot, create its own Worker/service name, D1 database, Queue, DLQ, Durable Object binding/namespace, secrets, encryption key, Google Cloud service-account access and project-specific observability. Use environment-specific bindings and placeholders in source control. Do not copy Parmar production database IDs, tokens, webhook secrets, encryption keys, user records, Queue messages or Cloudflare resource identifiers.

### Replace only domain-specific modules

Keep the generic Telegram runtime separate from the new bot's prompts, domain policies, response schema, quota policy, commands, profile model, admin tools and optional retrieval integration. Do not copy Fatman/BRVIN modules into a bot that does not need them. Do not remove safety, access, dedupe, lease, retry or observability boundaries to shorten a demo.

### First implementation checklist

1. Define the bot's response contract and commands.
2. Provision isolated Cloudflare resources and secrets.
3. Wire webhook secret validation and bot identity.
4. Implement the small bot-credential schema and cached runtime schema.
5. Port the `/start` fast path unchanged in ordering.
6. Port the per-chat Durable Object and Queue pattern.
7. Connect the domain-specific Gemini prompt/schema.
8. Add progress/final Telegram delivery with bounded retries.
9. Add stage-level structured logs and correlation IDs.
10. Run typecheck, unit/integration tests, Worker dry-runs, webhook acceptance, duplicate/retry tests and a production smoke test before enabling traffic.

## 14. Source map and regression tests

| Concern | Source | Required regression coverage |
|---|---|---|
| Webhook, commands, `/start`, Queue publication, consumer | `src/index.ts` | `test/worker.test.ts`, pipeline/acceptance tests |
| Bot credentials and light schema | `src/telegram/bot-store.ts` | `test/telegram-bot-store-schema.test.ts` |
| Durable state/admission/recovery | `src/core/job-store.ts` | job accounting, profile/quota, recovery and typing tests |
| Runtime schema isolation | `src/analytics/db.ts` | `test/telegram-bot-store-schema.test.ts` |
| Concurrent admission/context lookup | `src/telegram/parallel-work.ts` | `test/telegram-parallel-work.test.ts` |
| Telegram API and final/progress calls | `src/telegram/api.ts` | Telegram/API and release acceptance tests |
| Progress edit serialization/recovery | `src/telegram/progress.ts` | `test/telegram-progress.test.ts` |
| Vertex structured stream | `src/ai/gemini.ts` | AI pipeline and response-contract tests |
| Production bindings | `wrangler.jsonc` | both Worker dry-run validations |

The architecture is considered locked when code, tests, Worker bindings and this document agree. Any future architecture change must update this source of truth and its tests in the same change.

## 15. Telegram API 429 backoff and regression guard

The normal Telegram API adapter in `src/telegram/api.ts` distinguishes a per-request timeout from Telegram's rate-limit instruction. **Do not reintroduce a five-second cap on `retry_after`.** The `TELEGRAM_REQUEST_TIMEOUT_MS = 5_000` constant is the timeout for one HTTP attempt; it is not the maximum retry delay.

### Locked retry behavior

- Normal API calls allow at most **4 attempts** (`TELEGRAM_MAX_ATTEMPTS`). Each attempt uses the normal **5-second request timeout**, unless a caller explicitly overrides it.
- Telegram responses with retryable HTTP statuses (408, 429 or 5xx) are retried while attempts remain.
- When Telegram supplies `parameters.retry_after`, treat that value as authoritative seconds. Convert it to milliseconds with `Math.ceil(seconds * 1_000)`; do not clamp it to five seconds or another short local maximum.
- A positive delay retains a **250 ms minimum**. Missing, non-finite or non-positive values use the **1-second fallback**. Thus fractional values are rounded up (subject to the 250 ms minimum), and malformed values do not cause a zero/negative sleep.
- Transient network/timeout failures without a Telegram retry instruction use the existing exponential backoff of 300 ms, 600 ms, 1,200 ms, etc. The retry remains within the same API call and its bounded attempt budget.
- Cosmetic progress edits remain deliberately separate: one attempt with a 1-second timeout. They must not inherit the normal multi-attempt final-delivery policy or block answer generation.

The helper `getTelegramRetryDelayMs` is exported so the conversion/fallback policy can be unit-tested independently. Keep it in the shared API adapter so message, edit, quiz and other normal Telegram API calls use the same retry policy.

### Regression guard

`test/telegram-api.test.ts` covers:

1. Telegram delays beyond five seconds, including 10, 30 and 120 seconds.
2. Fractional delays, rounding upward and the 250 ms minimum.
3. Missing, `NaN`, infinite, zero and negative values using the one-second fallback.

Do not reduce the long-delay cases to a five-second maximum. A future change to retry policy must update these tests and this document together.

### Verification recorded

- Implementation and tests: commit [`c986d01`](https://github.com/ashini-x/parmar-ai/commit/c986d01f3ff1d481f1ee1c88ef01ffa16efc9f4f).
- GitHub Actions [Release validation run](https://github.com/ashini-x/parmar-ai/actions/runs/42532902093): successful. The run passed `npm run check`, `npm test` (**53 files / 306 tests**, including the 3 Telegram retry tests), `npm run test:node` (**8 files / 54 tests**), both Worker dry-run validations, and the production deploy/smoke-test and release-acceptance steps.
- The retry fix is on `main` and was included in the successful production deployment associated with that run.

This rate-limit rule is part of the reusable baseline: preserve Telegram's requested wait, keep attempt counts bounded, and keep cosmetic progress retries isolated from final message delivery.

