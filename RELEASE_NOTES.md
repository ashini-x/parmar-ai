# Parmar AI Release Notes

## v2.6.1 — Production Hardening

### Security
- Production Telegram bot credential encryption now requires the dedicated `TELEGRAM_BOT_ENCRYPTION_KEY`.
- New Telegram credential writes never use `ADMIN_SESSION_SECRET` for encryption.
- Existing legacy ciphertext remains readable during a controlled migration when the dedicated production key is configured.
- The public `/health` endpoint now returns only coarse service health.

### Reliability and validation
- Durable Object internal requests reject malformed JSON/body payloads instead of relying on unchecked casts.
- Lease ownership validation is centralized around queue message ID + lease version.
- Added regression tests for stale/mismatched lease ownership and malformed AnswerPackets.

### Privacy and release discipline
- Production raw analytics retention baseline is now 30 days.
- Release metadata is aligned to v2.6.1 across package, Worker configuration, manifest, and runtime fallback.
- Added regression coverage for current mutable-fact detection and retention/security configuration.

## v2.6.0 — Production Reliability & Access Control Hardening

### Critical fixes
- Added Durable Object lease fencing using queue message ID + lease version so stale workers cannot mutate a job after ownership changes.
- Added recovery for stale pending, queued, and processing jobs, with a bounded maximum active lifetime so one stuck question cannot block a chat indefinitely.
- Reserved typing heartbeats for actively processing jobs instead of queued/pending jobs.
- Stopped retrying unexpected programming/runtime errors as if they were transient infrastructure failures.
- Added runtime validation for persisted answer packets before they enter Durable Object state.
- Made dashboard processing metrics use an explicit processing database state.
- Made Queue processing establish the analytics processing state before AI generation.
- Fixed the AI-cost test to match the current production function signature.

### Admin access
- Fixed dashboard unlimited-access mutation so the D1 write is verified and effective access is verified immediately.
- Fixed dashboard grant UI naming collision (grantId) that could interfere with the browser global created by the input element.
- Protected configured owner/admin accounts from unlimited-access revocation through the dashboard backend.
- Dashboard grants are audited as a system-originated runtime grant rather than falsely attributing them to the bot owner Telegram ID.

### AI freshness
- Expanded current/mutable-fact detection beyond explicit words such as “current” and “latest”.
- Current office-holder and appointment questions are now treated conservatively as freshness-sensitive.
- grounded analytics now means actual Google Search grounding occurred; ordinary non-grounding questions are no longer counted as grounded.

### Security / privacy
- Moved Telegram setup authentication from a URL query parameter to POST /telegram/setup with X-Setup-Secret.
- Reduced the public /health response to coarse service health checks.
- Added /delete-my-data to remove the user's stored analytics/history, runtime access override, suspension record, and Durable Object study state.

### Deployment note
- This release does not change the Telegram bot token, Google service-account secrets, D1 database identity, Queue identity, or Durable Object binding names. Existing production bindings remain the source of truth.
# Parmar AI Release Notes

## v2.5.2 — Admin Access Controls UI Fix

### Goal
Correct the Students access-control interface so configured owner/admin/static-unlimited users are recognized consistently and administrative action buttons execute with the intended action names.

### Fixed
- Owner/admin/static-unlimited accounts now display effective unlimited access in the Students directory.
- Owner/admin accounts are visibly protected from suspension and revocation actions in the directory.
- Grant/revoke unlimited buttons now pass explicit action strings to the browser handler.
- Suspend/unsuspend buttons now pass explicit action strings to the browser handler.
- Admin action failures now surface an explicit error message instead of failing silently.
- The underlying server-side authorization rules remain unchanged.

### Compatibility
- Student daily quota remains 20 by default.
- Burst protection remains 5 accepted questions per 10 seconds for all accounts.
- Existing D1, Queue and Durable Object data is reused; no new migration is required for this UI-only access-control correction.


## v2.5.1 — Admin UI Interaction Fix

### Goal
Restore the interactive behavior of the v2.5.0 Admin Control Center without changing the backend architecture or student limits.

### Fix
- Correct a browser-side JavaScript parse error caused by the administrator confirmation text for study-profile reset.
- The malformed string prevented the dashboard script from loading, which made navigation tabs, buttons, search actions, access controls, sign-out and report export appear non-clickable.
- No database schema, quota, AI model, pricing estimate, access-control or student-processing behavior changed.
- Release verification includes generated-browser-JavaScript syntax validation.

## v2.5.0 — Admin Control Center + AI Economics

### Goal

Turn the protected admin surface into a genuine owner/operations control center while preserving the stable v2.4.2 student experience.

### Student path preserved

- SSC GA/GS-focused doubt solving.
- Conversation continuity and follow-up resolution.
- Evidence-based learning signals and targeted revision suggestions.
- Queue-backed processing with Durable Object state.
- 20 accepted AI questions per India calendar day for ordinary users.
- 5 accepted questions per 10-second burst window for all accounts.
- Owner/admin/test accounts can bypass only the daily quota.

### Admin control center

The protected `/admin` dashboard now provides:

- Live overview of students, new users, active users, returning users and question volume.
- 24-hour success/failure rate, latency, pending/processing/retry visibility and operational alerts.
- Daily quota distribution and quota-hit monitoring.
- Most-active users and cohort retention snapshots.
- Searchable student directory and detailed per-student view.
- Per-student question volume, estimated AI spend, token usage, topics and learning signals.
- Unlimited access grant/revoke controls.
- Suspend/unsuspend controls with protection against suspending configured owner/admin accounts.
- Admin-triggered study-profile reset.
- Administrator audit trail.

### AI economics

- Records Gemini response token metadata per genuine model attempt.
- Tracks prompt, candidate/output, thoughts/reasoning, tool-use and cached-input tokens when supplied.
- Uses queue-attempt + internal-attempt uniqueness to avoid double-counting retries.
- Calculates estimated per-attempt and aggregate AI cost in integer micro-USD.
- Shows spend by thinking level, model/policy and grounding usage.
- Shows token composition, most expensive requests, retry spend and seven-day trends.
- Supports an optional administrator-defined AI budget threshold and remaining-budget estimate.
- Shows a simple 30-day run-rate projection from current-day spend.

The token metadata fields are documented by Google for the GenerateContent response, including prompt, candidates, thoughts, tool-use, cached-content and total token counts. The release uses configurable pricing rates rather than pretending the estimate is the final cloud invoice.

### Operations

- Live dashboard overview refreshes every five seconds.
- System page exposes runtime version, environment, model, location, thinking ceiling, queue/Durable Object status and retention configuration.
- Critical technical details remain behind the protected admin surface.
- AI accounting and analytics are isolated from primary answer delivery.

### Reporting

The admin API can export a JSON analytics snapshot. The repository ships an offline Python/Matplotlib utility that creates:

- founder PDF report
- daily AI CSV summary
- AI spend PNG
- AI token PNG
- Markdown executive summary

Python is intentionally not part of the Worker request path.

### Known boundary

Student helpful/not-helpful feedback is not yet collected by the student UI in v2.5.0. The dashboard explicitly reports that state rather than fabricating feedback statistics. A future release may add optional Telegram feedback buttons and persist those ratings.

## v2.4.2 — Privileged Test Access

- Add bot-owner/admin identity configuration.
- Add D1-backed unlimited-AI overrides.
- Add owner/admin Telegram commands.
- Preserve 20/day for ordinary users and 5/10-second burst protection for everyone.

## v2.4.1 — Stable Production Release

- Separate burst and daily quota messages/events.
- Rebuilt v2.4 personalization architecture.
- Profile-learning failures isolated from answer delivery.

## v2.4.0 — Evidence-Based Personalization

- Add learning signals and safe migration.
- Require explicit/repeated evidence for attention areas.

## v2.3.0 — Conversation Intelligence & Answer Reliability

- Add recent conversation context.
- Improve follow-ups and confusion handling.
- Retry malformed/incomplete structured model responses.

## v2.2.1 — Admin/D1 Stabilization

- Fix and stabilize D1 initialization.

## v2.2.0 — Central Admin Analytics

- Add D1 analytics and protected admin dashboard.
