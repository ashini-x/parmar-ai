# Production Test Plan — v2.6.x

## Core Telegram
- `/start` returns.\n- `/help` returns.\n- `/id` returns a numeric ID.\n- Ordinary SSC fact answers normally.\n- Follow-up continuity works.\n- Simplification works.\n- `/profile` works.\n- `/reset` resets study context without resetting daily quota.\n- Data deletion behaves according to application semantics.

## Limits
- Five accepted questions in the burst window cause the sixth to receive the burst response.\n- Daily quota blocks additional AI jobs at the configured limit.\n- Privileged users bypass the daily limit but remain subject to burst protection.

## Admin Student controls
- Grant unlimited changes the backend state and dashboard.\n- Revoke unlimited removes the runtime override.\n- Suspend blocks student AI processing.\n- Unsuspend restores processing.\n- Protected Owner/Admin records cannot be suspended or revoked through student controls.

## Access tab
- Numeric Telegram ID is accepted.\n- Grant unlimited produces a verified backend state.\n- Audit record is created.

## Telegram tab
- Active bot details load.\n- Test connection succeeds without a student ID.\n- Switch verifies the new bot before deactivating the old one.\n- Disconnect removes the webhook and records the disconnect.

## Failure cases
- Invalid webhook secret -> 401.\n- Malformed webhook JSON -> 400.\n- Group message -> private-chat notice.\n- Malformed/incomplete Gemini output -> controlled retry/failure.\n- Admin mutation without authentication -> rejected.\n- Wrong Origin on mutation -> rejected.

## Release acceptance
Test the exact source revision intended for deployment, then record the resulting Cloudflare version ID.