# Release 2.2.0 — Central Admin Analytics

- Keeps Durable Object + Queue + Vertex AI user flow unchanged.
- Adds D1 as a centralized analytics/admin projection.
- Adds a password-protected `/admin` dashboard and JSON APIs.
- Tracks who first checked the bot, Telegram identity fields, questions, timestamps, answers, topics, subjects, modes, thinking level, grounding, attempts, latency and important command events.
- Adds daily raw-log cleanup (90 days by default).
- Adds a daily scheduled cleanup trigger.
- Keeps 20-question/day per Telegram user in the Durable Object.

Earlier release notes remain in Git history.
