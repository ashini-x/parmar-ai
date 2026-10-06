# Parmar AI Release Notes

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
