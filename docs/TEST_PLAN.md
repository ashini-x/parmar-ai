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
- Data deletion behaves according to application semantics.

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