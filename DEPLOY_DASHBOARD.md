# Parmar AI — Dashboard-Only Production Deployment

## 1. GitHub

Create/open the GitHub repository and upload the contents of this folder at repository root.

The root must contain `wrangler.jsonc`, `package.json`, `src/` and `test/`.

Do not upload any Google service-account JSON, `.env`, or `.dev.vars`.

## 2. Google Cloud

Use the Google Cloud project referenced by `GCP_PROJECT_ID`.

Enable Vertex AI API.

Grant the runtime service account the least privilege needed for model use; `Vertex AI User` is the intended runtime role. Avoid keeping an administrator role unless it is genuinely needed for some other operational task.

Confirm billing/trial credit is attached to the same project.

## 3. Cloudflare Workers plan

For a public production bot, use Workers Paid rather than relying on the Free limits.

## 4. Create the Queue

In Cloudflare Dashboard → Queues, create:

`parmar-ai-questions-prod`

The configured DLQ name is:

`parmar-ai-questions-dlq`

The Wrangler configuration will create the named DLQ automatically if needed when supported by the account.

## 5. Connect GitHub

Cloudflare Dashboard → Workers & Pages → Create application → Import an existing Git repository.

Select the repository and configure:

- Worker name: `parmar-ai`
- Production branch: `main`
- Root directory: `/`
- Build command: `npm run types && npm run check`
- Deploy command: `npx wrangler deploy`

## 6. Cloudflare variables

Keep `wrangler.jsonc` synchronized with the dashboard. The current non-secret variables are already present in the repository file.

Important current values:

- `GCP_PROJECT_ID` = the Google project ID used by Vertex AI
- `GEMINI_MODEL` = `gemini-3.8-flash`
- `GEMINI_LOCATION` = `global`
- `GEMINI_THINKING_LEVEL` = `HIGH` (this is the maximum cap; the code chooses LOW/MEDIUM/HIGH adaptively)
- `MAX_OUTPUT_TOKENS` = `1200`
- `MAX_QUESTION_LENGTH` = `4000`
- `VERTEX_TIMEOUT_MS` = `25000`
- `DAILY_QUESTION_LIMIT` = `20`
- `BURST_QUESTION_LIMIT` = `5`
- `BURST_WINDOW_SECONDS` = `10`

## 7. Cloudflare secrets

Worker → Settings → Variables and Secrets → Add secret:

`TELEGRAM_BOT_TOKEN`

`TELEGRAM_WEBHOOK_SECRET`

`TELEGRAM_SETUP_SECRET`

`GCP_CLIENT_EMAIL`

`GCP_PRIVATE_KEY`

`GCP_PRIVATE_KEY_ID`

Do not put `GCP_PRIVATE_KEY` in `wrangler.jsonc`.

## 8. Deploy

Commit the repository changes and let Cloudflare build/deploy from GitHub.

## 9. Health check

Open:

`https://YOUR-WORKER.workers.dev/health`

Confirm:

- `telegramConfigured: true`
- `vertexAiConfigured: true`
- `queueConfigured: true`
- `jobStoreConfigured: true`
- `model: gemini-3.8-flash`
- `thinkingPolicy: ADAPTIVE (max HIGH)`
- `studentProfile: true`

## 10. Register Telegram webhook

Open in your browser:

`https://YOUR-WORKER.workers.dev/telegram/setup?key=YOUR_TELEGRAM_SETUP_SECRET`

This registers `/telegram/webhook` and sets the bot command menu.

## 11. Test

Send:

`/start`

then:

`/exam cgl`

then an SSC GA/GS doubt such as:

`Permanent Settlement was introduced by whom?`

Expected UX:

1. User receives an immediate acknowledgement.
2. Telegram shows the bot typing.
3. Typing is refreshed while the job waits/processes.
4. Gemini 3.8 Flash answers using SSC-first instructions and the student's stored context.
5. The acknowledgement becomes the final answer.
6. The student's recent topic/revision profile is updated.

## 12. Profile test

After a few questions:

`/profile`

Then:

`what should I study next?`

The bot should return a focused revision list based on the student's recent topics and attention areas.

## 13. If authentication fails

Check Cloudflare Logs for the `question_processing_failed` event. Never paste tokens or private keys into support messages. A 401/403 generally points to service-account credentials, IAM, API enablement, billing/project mismatch, or model access.

### Additional production variable

Add this normal Worker variable:

```text
ENABLE_GOOGLE_SEARCH_GROUNDING=true
```

It is used only when a question looks time-sensitive/current. It is not enabled as a web-search tool for every SSC question.


## 14. Create the D1 admin database (dashboard only)

In Cloudflare Dashboard, go to D1 SQL Databases → Create Database. Name it:

`parmar-ai-admin-prod`

Choose the Asia-Pacific location hint if available and appropriate for your users. Cloudflare documents APAC as a supported D1 location hint.

After creation, copy the database ID. In GitHub open `wrangler.jsonc` and replace:

`REPLACE_WITH_D1_DATABASE_ID`

with the real D1 database ID. This is the one required manual configuration value before the GitHub build can deploy the D1 binding.

Cloudflare also supports adding a D1 binding from the Worker Dashboard under Bindings, but keep `wrangler.jsonc` synchronized because this repository is GitHub-deployed.

## 15. Admin secrets

Add these under Worker → Settings → Variables and Secrets → Secrets:

`ADMIN_DASHBOARD_PASSWORD` — strong admin password

`ADMIN_SESSION_SECRET` — long random secret used to sign the admin session cookie

`ADMIN_DASHBOARD_USER` may remain the normal variable `admin`.

## 16. Initialize and use the admin dashboard

After deployment, open:

`https://YOUR-WORKER.workers.dev/admin`

Sign in with the admin credentials. The first authenticated admin request initializes the D1 schema automatically. No terminal or migration command is required.

The dashboard shows total students, new students, questions by period, average latency, non-completed jobs, daily-limit hits, top subjects/topics, thinking-level distribution, recent questions, and searchable student records. Selecting a student can show their stored question history through the admin API.

For production, additionally protect the `/admin*` path with Cloudflare Access. Do not protect the whole Worker, because `/telegram/webhook` must remain publicly reachable by Telegram. Cloudflare documents hostname/path-specific Access applications for this use case.

## 17. What is stored

D1 stores the Telegram identity fields available in the update, first-seen time, exam selection, accepted question text, timestamps, answer text, SSC classification, thinking level, grounding flag, attempts, latency, status, and a small event log for important commands.

Raw question/event records are automatically deleted after `ANALYTICS_RAW_RETENTION_DAYS` (90 days by default) by the daily scheduled cleanup.

The Durable Object remains the source of truth for real-time per-student rate limiting, deduplication, typing state, active jobs, and the learning profile.


### Important when replacing the repository
This release's `wrangler.jsonc` uses `REPLACE_WITH_D1_DATABASE_ID` as a safe placeholder if the real D1 UUID is not known to the package. Before committing the replacement, preserve the real `database_id` from your currently working GitHub `wrangler.jsonc`. Do not create a new D1 database just for this release.
