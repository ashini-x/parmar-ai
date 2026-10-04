# SawalNewton V1.1 — Language-aware test MVP

Telegram-first SSC test MVP on Cloudflare Workers + D1.

## User flow

Telegram Bot -> Mini App -> choose Hindi/English on first use -> SSC Maths -> random 10-question test -> server-side scoring -> result -> Telegram share.

The selected language is stored per Telegram user and is reused on later opens. A user can change language from the home screen.

## Important database change

This release adds two tables:

- `user_preferences` for the selected UI/question language (`en` or `hi`)
- `question_translations` for language-specific question and option text

The canonical fields in `questions` remain useful as the English/base question record. For Hindi tests, a Hindi translation must exist. Questions without a Hindi translation are excluded from Hindi test selection.

## Existing D1 database: one-time migration

Your current database already contains `users`, `questions`, `attempts`, and `attempt_questions`.

Run this file ONCE in the Cloudflare D1 Console:

`schemas/migrations/0001_language_and_translations.sql`

It creates only the new language-related tables and index. It does not delete existing users, questions, or attempts.

## Development seed

After the migration, run:

`schemas/seed-dev-bilingual.sql`

This adds Hindi and English translation rows for questions whose source is `SawalNewton DEV SEED`. It does not delete existing test attempts or questions.

This seed is only for development. The production question bank will later use verified SSC question records and reviewed translations.

## Cloudflare setup

Keep the existing Worker name and D1 database. The repository's `wrangler.jsonc` references:

- Worker: `parmar-ai`
- D1 binding: `DB`
- D1 database: `sawalnewton-db`

Keep these secrets in Cloudflare only:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SETUP_SECRET`

## Current backend routes

- `GET /health`
- `GET /`
- `GET /app`
- `GET /db-test`
- `GET /api/user/preferences`
- `POST /api/user/preferences`
- `POST /api/test/start`
- `POST /api/test/submit`
- `GET /telegram/setup`
- `POST /telegram/webhook`

`GET /api/user/preferences` expects the Telegram Mini App `initData` in the `x-telegram-init-data` header.

## V1.1 behavior

1. First Mini App open checks the user's saved preference.
2. If none exists, the user must choose `हिंदी` or `English`.
3. The choice is stored server-side.
4. Test generation uses the stored language.
5. Hindi tests require Hindi translations.
6. English tests use an English translation when available, otherwise the canonical English fields in `questions`.
7. The client never receives `correct_option` during the test.

## Next phase

The next major step is the production question-bank importer and validator for the 2016–2026 SSC bank, followed by balanced random test generation and seen-question avoidance.
