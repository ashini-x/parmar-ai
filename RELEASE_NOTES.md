# Parmar AI Release Notes

## v2.4.2 — Privileged Test Access

### Purpose

Allow the creator/admin and explicitly authorized Telegram profiles to test Parmar AI without consuming the normal daily allowance, while preserving backend burst protection.

### Changes

- Added `BOT_OWNER_TELEGRAM_USER_ID` as the primary bot-owner/admin identity.
- Added `ADMIN_TELEGRAM_USER_IDS` for additional admins.
- Added `UNLIMITED_AI_TELEGRAM_USER_IDS` for static bootstrap access.
- Added D1 table `ai_access_overrides` for runtime grants/revocations by Telegram user ID.
- Added admin-only Telegram commands: `/grant <ID>`, `/revoke <ID>`, `/unlimited <ID>`.
- Admin/override accounts bypass only the daily quota.
- All accounts remain subject to the 5 questions / 10 seconds burst safeguard.
- `/profile` reports unlimited daily access for privileged accounts.
- Admin actions are recorded in the analytics event stream.

### Security

- Privileged access is determined server-side from configured admin identity or D1 override state.
- Normal users cannot grant access to themselves or others.
- Owner/admin access cannot be revoked through the Telegram self-service command.
- Admin commands are intentionally not published in the global Telegram command menu.


## v2.4.1 — Stable Production Release

### Purpose

Finalize the rebuilt v2.4 evidence-based personalization line and correct the quota UX.

### Changes

- Preserves v2.3 conversation intelligence and answer-reliability behavior.
- Preserves bounded recent conversation context.
- Preserves confusion-aware and simplification-aware response behavior.
- Adds robust `learningSignals` normalization and legacy-profile migration.
- Requires repeated explicit confusion/weakness evidence before persistent attention promotion.
- Keeps profile persistence best-effort so enrichment cannot block answer delivery.
- Keeps the default daily quota at 20 accepted AI questions per India calendar day.
- Keeps burst protection at 5 accepted questions per 10 seconds.
- Distinguishes burst-limit and daily-limit messages.
- Separates `burst_limit_reached` and `daily_limit_reached` analytics events.
- No D1 schema change.

### Regression targets

- Missing `learningSignals` never causes `.find()` on `undefined`.
- `normalizedQuestion` scope regressions from the later v2.5 branch are absent.
- `/reset` clears profile/conversation state but does not reset daily quota.
- Rate-limited requests do not create AI jobs.

## v2.4.0 — Rebuilt Evidence-Based Personalization

- Rebuilt from the known-good v2.3 conversation-intelligence architecture.
- Added `learningSignals` with confusion/weakness evidence counts.
- Added safe profile normalization and legacy v1-to-v2 profile handling.
- Added false-positive protection for ordinary fact questions/simple follow-ups.
- Added topic-anchored revision recommendations.
- Isolated profile persistence from primary answer delivery.

## v2.3.0 — Conversation Intelligence & Answer Reliability

- Added rolling six-turn conversation context.
- Improved contextual follow-up handling.
- Added confusion-aware/simplification-aware instructions.
- Rejected partial structured outputs ending in `MAX_TOKENS`.
- Added retries for incomplete/malformed answer structures.
- Normalized literal escaped whitespace before Telegram delivery.
- Preserved the existing Queue, Durable Object, Vertex, Telegram and D1 architecture.

## v2.2.1 — Admin/D1 Stabilization

- Fixed D1 schema initialization.
- Stabilized the central admin analytics projection.

## v2.2.0 — Central Admin Analytics

- Added D1-backed analytics projection.
- Added protected admin dashboard and JSON endpoints.
- Added user/question/event tracking.
- Added retention cleanup.
- Preserved Durable Object + Queue as the primary question-processing path.

## Pre-v2.2 history

Earlier milestones are maintained in repository history. This release line deliberately avoids inventing undocumented version details.
