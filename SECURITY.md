# Security notes

- Google service-account JSON files belong outside GitHub.
- `GCP_PRIVATE_KEY` must be stored as a Cloudflare Worker Secret.
- Telegram webhook requests are authenticated with `X-Telegram-Bot-Api-Secret-Token`.
- `/telegram/setup` is protected by a separate setup secret.
- The Worker never logs secret values.
- Student profile data is intentionally small: target exam, recent study topics, attention topics and revision queue. Raw question text is retained only in the short-lived per-job record needed for delivery/retry.
- The current profile is scoped to private Telegram chats; group messages are redirected to DM.


## Admin dashboard

The admin dashboard stores operational student/question data in D1. The dashboard has its own signed session cookie and should also be protected by a Cloudflare Access path policy for defense in depth. Never place Telegram or Google credentials in D1, logs, source control, or dashboard variables.
