# Security notes

- Google service-account JSON files belong outside GitHub.
- `GCP_PRIVATE_KEY` must be stored as a Cloudflare Worker Secret.
- Telegram webhook requests are authenticated with `X-Telegram-Bot-Api-Secret-Token`.
- `/telegram/setup` is protected by a separate setup secret.
- The Worker never logs secret values.
- Student profile data is intentionally small: target exam, recent study topics, attention topics and revision queue. Raw question text is retained only in the short-lived per-job record needed for delivery/retry.
- The current profile is scoped to private Telegram chats; group messages are redirected to DM.
