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
- `DAILY_QUESTION_LIMIT` = `100`
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
