# SawalNewton V1.2 — Content Factory

This version adds the first automated question-ingestion pipeline on top of the working SawalNewton Telegram Mini App.

## What it does

Upload a source PDF, TXT, or CSV from:

`/admin/content`

The AI pipeline then:

1. extracts real MCQs from the source;
2. creates clean English + Hindi versions;
3. classifies the subject topic and estimates difficulty;
4. compares the source answer key with an independent AI check;
5. computes a deterministic question fingerprint;
6. detects exact duplicates against the production bank and staging queue;
7. places candidates in a staging queue;
8. marks high-confidence answer-matched candidates as `auto_ready`;
9. lets the admin publish selected candidates into the production D1 question bank.

No question-by-question transcription is required.

## Required Cloudflare secret

Add:

`ADMIN_SECRET`

Keep it as a Cloudflare Worker secret; never commit it.

The existing:

`TELEGRAM_BOT_TOKEN`
`TELEGRAM_WEBHOOK_SECRET`
`TELEGRAM_SETUP_SECRET`
`GEMINI_API_KEY`

remain unchanged.

## Database migration

In the D1 Console, run the contents of:

`schemas/migrations/0002_content_factory.sql`

Do not paste the filename itself into the console.

The migration is non-destructive. It adds the staging/batch tables and the question fingerprint column/index.

## Open the factory

After deployment:

`https://YOUR-WORKER-URL/admin/content`

Enter the `ADMIN_SECRET`.

For the first test, use a small SSC source file containing a limited number of questions. Set the correct:

- Exam
- Tier
- Year
- Shift
- Subject

The factory currently accepts PDF, TXT, and CSV and caps one run at 25 questions.

## Publication rule

Candidates with:

- complete English + Hindi content,
- a matching source answer and independent answer,
- confidence >= 0.90,
- and no exact duplicate

are marked `auto_ready`.

They are still not automatically published. You can select them and click `Publish selected`.

Everything else goes to `needs_review` or `duplicate`.

## Important content rule

Only ingest sources you are allowed to use. The factory can automate processing, but it does not grant copyright or redistribution rights to source material.
