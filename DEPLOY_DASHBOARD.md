# Parmar AI — Production deployment (GitHub + Cloudflare dashboard only)

This version is designed for bursty/viral Telegram traffic.

Architecture:

```text
Telegram webhook
      ↓
Cloudflare Worker (fast ingress)
      ↓
Durable Object (idempotency + per-chat rate controls)
      ↓
Cloudflare Queue (durable buffer + retries)
      ↓
Queue consumer Worker
      ↓
Google OAuth service-account JWT (Web Crypto)
      ↓
Vertex AI / Gemini 3.8 Flash
      ↓
Telegram edit/send final answer
```

No terminal or CLI is required for the deployment steps below.

## 0. Recommended Cloudflare plan

Use **Workers Paid** for the public/viral launch. Workers Free is limited to 100,000 Worker requests per day; Workers Paid has no Worker request limit and currently starts at $5/month. Queues on Free includes 10,000 operations/day; Paid includes 1,000,000 operations/month before overage. Free queue retention is limited to 24 hours; Paid can retain messages for up to 14 days.

For a serious public launch, Paid is the correct baseline.

## 1. GitHub

Create a repository, for example:

```text
parmar-ai
```

Upload the **contents of this project folder** so `wrangler.jsonc` is at the repository root.

Do NOT upload:

- the Google service-account JSON file
- `.dev.vars`
- bot tokens
- private keys
- setup secrets

The repository should look approximately like:

```text
parmar-ai/
├─ src/
│  ├─ ai/gemini.ts
│  ├─ auth/google.ts
│  ├─ config/env.ts
│  ├─ core/job-store.ts
│  ├─ core/logger.ts
│  ├─ core/request-id.ts
│  ├─ http/response.ts
│  └─ telegram/api.ts
├─ test/worker.test.ts
├─ data/README.md
├─ prompts/README.md
├─ .dev.vars.example
├─ .gitignore
├─ CONTRIBUTING.md
├─ DEPLOY_DASHBOARD.md
├─ README.md
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
└─ wrangler.jsonc
```

## 2. Google Cloud

Select the Google Cloud project that owns the $300 trial credit.

Enable:

```text
Vertex AI API
```

For the production service account, prefer the narrow runtime permission:

```text
Vertex AI User
```

Avoid an administrator role for the runtime account when it is no longer needed.

From your existing service-account JSON, collect:

```text
project_id       → GCP_PROJECT_ID
client_email     → GCP_CLIENT_EMAIL
private_key      → GCP_PRIVATE_KEY
private_key_id   → GCP_PRIVATE_KEY_ID
```

Never upload the JSON to GitHub.

## 3. Create the production Queue in Cloudflare

In the Cloudflare dashboard, open **Queues**.

If Queues is not active, enable it.

Create this Queue exactly:

```text
parmar-ai-questions-prod
```

The production code already names the consumer and DLQ. The DLQ name is:

```text
parmar-ai-questions-dlq
```

The production deployment will bind to the queue in `wrangler.jsonc`. Cloudflare can create the named dead-letter queue automatically when it is referenced by the consumer configuration.

Use Workers Paid for the live bot so the queue can retain messages beyond the Free tier's 24-hour maximum.

## 4. Connect GitHub to Cloudflare

Cloudflare dashboard:

**Workers & Pages → Create application → Import a repository**

Select your GitHub repository.

Worker name:

```text
parmar-ai
```

Save and Deploy.

## 5. Build settings

Open:

**Workers & Pages → parmar-ai → Settings → Builds**

Use:

```text
Production branch: main
Root directory: /
Build command: npm run types && npm run check
Deploy command: npx wrangler deploy
Preview command: npx wrangler preview
```

Cloudflare Workers Builds runs the build command and then the deploy command for pushes to the production branch.

## 6. Cloudflare Variables

Open:

**Settings → Variables and Secrets**

Add ordinary Variables:

```text
ENVIRONMENT=production
APP_VERSION=1.0.0
GCP_PROJECT_ID=<your Google Cloud project ID>
GEMINI_MODEL=gemini-3.8-flash
GEMINI_LOCATION=global
MAX_OUTPUT_TOKENS=1200
MAX_QUESTION_LENGTH=4000
DAILY_QUESTION_LIMIT=100
BURST_QUESTION_LIMIT=5
BURST_WINDOW_SECONDS=10
```

These are ordinary configuration values, not secrets.

## 7. Cloudflare Secrets

Add each as a **Secret**:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_SETUP_SECRET
GCP_CLIENT_EMAIL
GCP_PRIVATE_KEY
GCP_PRIVATE_KEY_ID
```

### Telegram bot token

Paste the token from @BotFather.

### TELEGRAM_WEBHOOK_SECRET

Create a long random secret. Do not reuse the setup secret.

### TELEGRAM_SETUP_SECRET

Create another long random secret.

### GCP_CLIENT_EMAIL

Paste the exact `client_email` string from the Google service-account JSON.

### GCP_PRIVATE_KEY

Paste the exact `private_key` value.

It is okay if your Cloudflare input contains literal `\\n` sequences. The Worker normalizes them before importing the PKCS#8 key.

Do not paste the surrounding JSON quote marks.

### GCP_PRIVATE_KEY_ID

Paste the exact `private_key_id` value.

## 8. Deploy after secrets are saved

Save the variables/secrets and deploy the Worker.

Cloudflare will provision the SQLite-backed Durable Object namespace declared in `wrangler.jsonc` and attach the Queue producer/consumer configuration.

## 9. Health check

Open:

```text
https://<your-worker-domain>/health
```

Expected structure:

```json
{
  "ok": true,
  "service": "parmar-ai",
  "phase": "D",
  "telegramConfigured": true,
  "vertexAiConfigured": true,
  "queueConfigured": true,
  "jobStoreConfigured": true,
  "model": "gemini-3.8-flash",
  "location": "global"
}
```

The endpoint does not expose credentials.

## 10. Register the Telegram webhook

Open this in the browser:

```text
https://<your-worker-domain>/telegram/setup?key=<TELEGRAM_SETUP_SECRET>
```

A successful response will show the webhook URL. The setup route is safe to run again if you later change the Worker domain or need to re-register the webhook.

Keep this URL private because it contains the setup secret.

The Worker registers:

```text
https://<your-worker-domain>/telegram/webhook
```

with Telegram's secret-token webhook verification and high webhook connection capacity.

## 11. Production test

Send to the Telegram bot:

```text
What is the difference between Fundamental Rights and DPSP?
```

You should immediately see:

```text
✅ Sawal receive ho gaya. Answer bana raha hoon... 🤔
```

Then the same bot message is replaced by the Gemini answer.

This matters: the user is not left wondering whether the bot received the question.

## 12. What happens during a spike

For many users:

```text
Telegram
  ↓
Worker
  ↓
Durable Object dedupe
  ↓
Queue
  ↓
Auto-scaled consumer invocations
  ↓
Vertex AI
  ↓
Telegram
```

The queue buffers bursts instead of forcing every webhook request to wait for Gemini.

Cloudflare Queues uses at-least-once delivery, so the Worker explicitly stores per-update state and uses the queue message ID to make retries/idempotency safe. A repeated Telegram webhook or queue delivery should not create a second AI answer for the same update.

## 13. Failure behavior

### Telegram temporarily fails

Telegram API calls retry. If final delivery still fails, the queue message is retried.

### Vertex AI temporarily fails

The Worker retries inside the attempt and the Queue retries the job with increasing delays.

### Worker crashes after queue write

Telegram can retry the webhook. Durable Object state prevents a second logical job from being created.

### Queue consumer crashes

Cloudflare Queue retries the message.

### Persistent failure

After the configured retry limit, the user receives a user-facing failure message when delivery is possible, and the Queue retains failed delivery in the dead-letter queue for operator inspection.

## 14. Queue settings to verify in the dashboard

Open:

**Queues → parmar-ai-questions-prod → Settings**

For the live bot, verify the consumer is attached to `parmar-ai`.

The repository configuration uses:

```text
Batch size: 1
Batch timeout: 1 second
Max retries: 10
Retry delay: 15 seconds
Max consumer concurrency: 50
Dead-letter queue: parmar-ai-questions-dlq
```

The concurrency cap is deliberately conservative because Vertex AI and Telegram are external upstreams. Raise it only after observing actual production quotas and error rates.

## 15. Google billing protection

Open Google Cloud:

**Billing → Budgets & alerts**

Create a budget and alert around the project.

Remember: a billing budget alert is an alert, not an automatic hard stop. Your application-level limits are therefore intentional.

The Worker defaults are:

```text
5 questions / 10 seconds / chat
100 questions / UTC day / chat
4,000-character maximum user question
1,200 maximum output tokens
```

Change these through Cloudflare Variables when you understand the cost/traffic pattern.

## 16. Cloudflare observability

The repository enables Worker observability.

In the Cloudflare dashboard, inspect:

**Workers & Pages → parmar-ai → Observability / Logs**

Useful events include:

```text
telegram_message_received
question_queue_enqueue_failed
question_processing_failed
question_completed
final_failure_delivery_failed
telegram_webhook_unauthorized
```

The logs intentionally do not print Telegram tokens or Google private keys.

## 17. Important launch checklist

Before sharing the bot publicly:

- Workers Paid is active.
- `Vertex AI API` is enabled.
- The runtime service account can use Vertex AI.
- The Queue exists and the consumer is attached.
- The Worker health endpoint shows all four configuration flags as true.
- Telegram webhook setup succeeded.
- A real question gets an immediate acknowledgement.
- The acknowledgement changes to the final answer.
- A temporary Vertex failure results in Queue retry instead of silent loss.
- Google billing alerts are configured.
- The service-account JSON is NOT in GitHub.

## 18. What this does not guarantee

No distributed system can honestly guarantee that an external provider outage, revoked Telegram permission, exhausted Google quota, account suspension, or a total Cloudflare outage will never prevent a final answer.

What this architecture does guarantee operationally is much stronger than the previous `waitUntil()` design: the question is durably accepted before background AI processing, the user gets an immediate status message when Telegram permits it, transient AI/Telegram failures are retried, and duplicate webhook/queue deliveries are guarded by durable state.
