# New-chat continuation prompt — Standard SSC Model Arena

Continue the Standard SSC Model Arena work in `ashini-x/parmar-ai`.

## First: read the source of truth

1. Read `docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md` completely.
2. Read `docs/README.md` and inspect the current implementation before changing anything.
3. Inspect the latest `main` branch, relevant PRs and GitHub Actions runs. Do not rely on an old chat summary as proof of current deployment state.
4. Inspect live Cloudflare settings for `parmar-ai-arena-staging`, its workers.dev route, D1 binding and secret binding names. Never retrieve, print or expose secret values.
5. Reconcile differences between the handoff and live state. Treat current GitHub/Cloudflare state as authoritative.

## Exact environment

- Repository: `ashini-x/parmar-ai`
- Arena Worker: `parmar-ai-arena-staging`
- URL: https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login
- Config: `wrangler.arena-staging.jsonc`
- Environment: `staging`
- Dedicated D1: `parmar-ai-arena-staging`
- D1 ID: `30df9bf6-e852-4f15-8fd7-43bd96cb1cdf`
- Configured admin username: `arena-admin`
- Google project: `project-90db7be4-619f-4ed7-89b`
- Gemini baseline: `gemini-3.8-flash`, location `global`, thinking `HIGH`
- FreeModel primary candidate: `claude-sonnet-5-5`

Implementation PR #400 and staging deployment workflow PR #401 are merged. The staging Worker is deployed. GitHub Actions run #44806050579 succeeded on attempt 2 after enabling the Worker-level workers.dev route. Do not redeploy production.

## Exact current user checkpoint — 2026-11-21

- A fresh Cloudflare settings inspection confirmed all six secret binding names are present as `secret_text`: `ADMIN_DASHBOARD_PASSWORD`, `ADMIN_SESSION_SECRET`, `GCP_CLIENT_EMAIL`, `GCP_PRIVATE_KEY`, `GCP_PRIVATE_KEY_ID` and `FREEMODEL_API_KEY`. Never read or expose their values.
- The staging Worker remains bound to the dedicated D1 ID `30df9bf6-e852-4f15-8fd7-43bd96cb1cdf`.
- The user supplied a screenshot of the signed-in staging admin dashboard with the FreeModel model selector open. The catalogue was visible, including Claude and other candidate entries. Dashboard access and FreeModel model discovery were working in the user's browser at that time.
- The user reports that they submitted **seven of their own questions with Auto-Router selected**.
- **The seven result screenshots or benchmark JSON export have not yet been uploaded to the assistant or reviewed.** There are no recorded PASS/REVIEW/FAIL outcomes for the seven comparisons.
- Do not assume Gemini and FreeModel both succeeded in all seven runs. Do not infer the actual model chosen by Auto-Router; inspect `modelUsed` and failover details in each result.
- The 31-item acceptance checklist previously proposed in chat is a future coverage plan, not completed testing.
- Individual pinned-model tests have not been confirmed.
- The user intentionally wants to begin a new chat and upload the seven-run evidence there. Do not start more tests in this chat or ask for a rerun before reviewing those uploads.

## Immediate task in the new chat — inspect the seven uploaded results first

1. Receive and inspect the seven-run screenshots or an Arena benchmark JSON export the user uploads. If not attached, ask the user to upload them; do not ask them to rerun the seven tests.
2. For each question, inspect the left Vertex AI/Gemini and right FreeModel result independently.
3. Record the exact question, provider success/failure, safe error code, actual model ID, Auto-Router failover information, raw AnswerPacket validity, factual correctness, SSC relevance, language/formatting, latency, token counts and displayed estimated cost where the evidence shows them.
4. Mark each provider/run PASS, REVIEW, FAIL or UNVERIFIED. Never infer missing data.
5. Check whether the results actually prove Vertex inference and FreeModel inference both work, rather than relying on the fact that FreeModel catalogue discovery succeeded.
6. Produce a concise review of the seven results and identify the smallest remaining test set needed to cover genuine gaps. Avoid repeating tests that the evidence already covers.
7. Continue testing with clear, beginner-friendly browser instructions. The user wants the questions, expected checks and where to inspect each outcome.
8. Update the handoff and continuation prompt with real outcomes after reviewing the evidence. Do not mark overall Arena acceptance complete until both providers and required SSC/prompt behavior are demonstrated.

## Technical and product boundaries

- Arena compares Google Vertex AI/Gemini on the left with FreeModel on the right.
- It reuses the production Standard SSC prompt builder and shared AnswerPacket validation. Both providers receive the same production-built user prompt.
- Vertex may additionally use configured Google Search grounding for current-fact prompts; FreeModel does not have an equivalent search tool attached. Account for this asymmetry when judging answers.
- An Arena run is stateless on the backend: no D1, KV, Durable Object or Queue write is made for the comparison. Browser conversation turns and localStorage votes remain client-side.
- Staging route guard permits only `/admin` and `/admin/*`; non-admin routes return 404.
- Dedicated staging D1 only. No production D1, Telegram Queue, Durable Object, BRVIN service or AI Search binding.
- The dropdown selects Auto-Router or an individual FreeModel model. It does not currently select among multiple FreeModel API keys/accounts.
- The user wants a future named API-connection selector. Treat it as a future enhancement, not existing functionality. Never expose secret values in the browser.
- The user has two active FreeModel dashboard keys. Both showed the same visible permissions and 60 rpm in their screenshot. The latest recommendation was Default API Key as the Arena credential; the actual configured secret value/label cannot be inferred from Cloudflare metadata. Do not claim which key was copied unless confirmed. Do not revoke either.
- The FreeModel plan-upgrade inheritance behavior for differently labelled keys was not conclusively verified. Do not promise it; verify after an actual upgrade.
- Arena cost figures are estimates, not provider invoices.

## Security and deployment rules

- Never ask the user to share service-account JSON, private keys, API keys, passwords, cookies or authorization headers in chat.
- Never commit credentials or full service-account JSON.
- Do not reuse production provider credentials.
- Do not modify production Telegram behavior, production admin configuration or production Worker for this staging task.
- Do not add production bindings to the Arena Worker.
- Use the manual Arena deployment workflow only if staging code/config needs a new Worker deployment; it has an explicit confirmation input.
- For Cloudflare secret updates, use Cloudflare Dashboard → Variables and Secrets → Deploy.
- Do not give terminal/CLI instructions to the user. Give beginner-friendly dashboard navigation.
- Do not repeat completed configuration steps or ask for facts already confirmed.
- Do not claim provider acceptance based only on a login page or catalogue dropdown.

## First response in the new chat

Acknowledge that the staging dashboard and FreeModel catalogue were already observed working, and that the user has seven Auto-Router question runs awaiting review. Ask them to attach the seven screenshots or benchmark JSON export if not already present, then inspect the actual evidence before suggesting more tests. Continue from that exact checkpoint.