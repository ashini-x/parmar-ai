# SawalNewton V1

Telegram-first SSC test MVP built on Cloudflare Workers + D1.

## Current flow

Telegram Bot -> Mini App -> D1 -> random 10-question Maths test -> server-side scoring -> result -> Telegram share.

## Required Cloudflare setup

1. Keep the Worker name as `parmar-ai` unless the Cloudflare dashboard Worker is renamed too.
2. Bind the existing D1 database `sawalnewton-db` to the Worker with the variable name `DB`. The provided `wrangler.jsonc` deliberately leaves the binding out so your existing dashboard binding is preserved.
3. Keep the existing Cloudflare secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `TELEGRAM_SETUP_SECRET`
4. Run the SQL in `schemas/schema.sql` against the existing D1 database if any of the four tables are missing.

## Development seed

`schemas/seed-dev.sql` contains ten clearly marked temporary Maths questions. Execute it only if you need a local/initial test bank. It first removes rows whose source is `SawalNewton DEV SEED`, so it can be safely re-run.

## Notes

- The Mini App never receives `correct_option` or `explanation` during the test.
- Telegram Mini App `initData` is validated server-side before user/test operations.
- Test questions are selected randomly from active Maths questions.
- A production-scale question generator will later replace the simple `ORDER BY RANDOM()` selection with balanced topic/difficulty rules and seen-question avoidance.

## Deployment checkpoint

After deployment, open `/db-test`. It should return the D1 tables. If it returns `d1_binding_missing`, re-open the Worker's Bindings page and confirm the existing `sawalnewton-db` database is bound as `DB`.
