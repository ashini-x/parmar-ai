# SawalNewton V1.3 — AI-Optional Content Factory

SawalNewton is a Telegram-first SSC test platform on Cloudflare Workers.

This version keeps the working Telegram Mini App and bilingual test system while changing the content workflow so **structured TXT/CSV/JSON imports do not depend on Gemini**.

## Core content workflow

Fast Import:

`TXT / CSV / JSON -> deterministic parser -> validation -> exact duplicate check -> staging -> publish`

Optional AI:

`PDF / messy source -> Gemini extraction`

or, after import:

`staging candidate -> AI Enhance selected -> updated staging candidate`

A Gemini outage therefore does not block structured content ingestion.

## Current production pieces

- Telegram webhook
- Telegram Mini App
- Hindi / English user preference
- random Maths tests
- five-minute test timer
- server-side scoring
- D1 question bank
- bilingual question translations
- staging content factory
- deterministic TXT / CSV / JSON importer
- exact duplicate fingerprints
- optional AI extraction and enhancement
- admin review/publish queue

## Required Cloudflare secrets

Keep these as Worker secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SETUP_SECRET`
- `GEMINI_API_KEY` (only needed for optional AI operations)
- `ADMIN_SECRET`

## Database

Use the existing `sawalnewton-db` D1 database and binding `DB`.

V1.3 does not require a new migration. Existing content-factory tables from V1.2 are reused.

## Admin

Open:

`https://YOUR-WORKER-URL/admin/content`

The default processing mode is **Fast import — no AI**.

Use AI extraction only when you specifically want AI to parse a PDF or messy text source.

## First test

1. Deploy this version.
2. Open `/admin/content`.
3. Keep `Fast import — no AI` selected.
4. Upload `data/content-factory-sample.txt`.
5. Use the supplied development metadata.
6. Confirm the batch completes without any Gemini request.
7. Inspect the staging candidates.

For a bilingual auto-ready development example, use `data/content-factory-sample-bilingual.txt`.

Do not ingest copyrighted third-party material unless you have the right to use and redistribute it.


## V1.3.2 build fix

This version fixes an unescaped JavaScript template-literal issue inside the admin HTML template. It also keeps the deterministic import path independent of Gemini.
