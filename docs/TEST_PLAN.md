# Production Test Plan — v2.6.x

## Core Telegram
- `/start` returns.
- `/help` returns.
- `/id` returns a numeric ID.
- Ordinary SSC fact answers normally.
- Follow-up continuity works.
- Simplification works.
- `/profile` works.
- `/reset` resets study context without resetting daily quota.
- Data deletion removes centralized analytics, quiz sessions, and per-chat study state according to application semantics.
- Genuine MCQ/test intent renders as a native Telegram quiz while ordinary open-ended doubts remain text.
- A student-supplied MCQ preserves its options where practical and records the selected answer.
- Correct and incorrect quiz selections produce immediate result feedback, with the explanation stored in the native quiz card.
- Telegram webhook subscription includes poll_answer updates.

## Limits
- Five accepted questions in the burst window cause the sixth to receive the burst response.
- Daily quota blocks additional AI jobs at the configured limit.
- Privileged users bypass the daily limit but remain subject to burst protection.

## Admin Student controls
- Grant unlimited changes the backend state and dashboard.
- Revoke unlimited removes the runtime override.
- Suspend blocks student AI processing.
- Unsuspend restores processing.
- Protected Owner/Admin records cannot be suspended or revoked through student controls.

## Access tab
- Numeric Telegram ID is accepted.
- Grant unlimited produces a verified backend state.
- Audit record is created.

## Telegram tab
- Active bot details load.
- Test connection succeeds without a student ID.
- Switch verifies the new bot before deactivating the old one.
- Disconnect removes the webhook and records the disconnect.

## Failure cases
- Invalid webhook secret -> 401.
- Malformed webhook JSON -> 400.
- Group message -> private-chat notice.
- Malformed/incomplete Gemini output -> controlled retry/failure.
- Admin mutation without authentication -> rejected.
- Wrong Origin on mutation -> rejected.

## Release acceptance
Test the exact source revision intended for deployment, then record the resulting Cloudflare version ID.

## Production-hardening regression cases
- Current mutable fact without an explicit freshness keyword (for example, "Who is the RBI Governor?") requires live grounding.
- Historical office-holder question with an explicit year is not forced into current-fact handling.
- Ordinary non-current question is not recorded as Google-grounded merely because grounding was unnecessary.
- Lease ownership accepts the active queue message ID + lease version and rejects stale/mismatched ownership.
- Malformed Durable Object internal payloads are rejected rather than causing an unhandled JSON/body access error.
- In production, Telegram bot credential encryption requires TELEGRAM_BOT_ENCRYPTION_KEY; ADMIN_SESSION_SECRET is not used for new encryption.
- Legacy Telegram ciphertext can still be read during key migration when a dedicated production encryption key is present.
- Raw analytics retention defaults to 30 days when no override is configured.
