# New-chat continuation prompt — Standard SSC Model Arena

Continue the Standard SSC Model Arena work in ashini-x/parmar-ai.

## First: recover the exact current state

1. Read docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md completely. It is the authoritative handoff for implementation, infrastructure, security boundaries, deployment history, provider configuration, confirmed facts and pending acceptance.
2. Read docs/README.md and inspect the current source before changing anything.
3. Inspect the current main branch, recent commits, PRs and relevant GitHub Actions runs. Do not rely on old chat summaries as proof of current state.
4. Inspect Cloudflare live settings for Worker parmar-ai-arena-staging, its workers.dev route, D1 binding and secret binding names. Never retrieve, print, expose or ask for secret values.
5. Reconcile differences between this prompt, the handoff and live state. Treat current GitHub/Cloudflare state as authoritative for what is deployed.

## Exact environment

- Repository: ashini-x/parmar-ai
- Arena Worker: parmar-ai-arena-staging
- URL: https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login
- Config: wrangler.arena-staging.jsonc
- Environment: staging
- D1: parmar-ai-arena-staging
- D1 ID: 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf
- Configured admin username: arena-admin
- Google project configured: project-90db7be4-619f-4ed7-89b
- Gemini baseline configured: gemini-3.8-flash, location global, thinking HIGH
- FreeModel primary candidate configured: claude-sonnet-5-5

Implementation PR #400 and deployment-workflow PR #401 are merged. The isolated staging Worker is already deployed. GitHub Actions run #44806050579 succeeded on attempt 2 after enabling the Worker-level workers.dev route in Cloudflare. Do not redeploy production.

## Immediate task

Complete live provider configuration and end-to-end acceptance:

1. Inspect Cloudflare Worker secret binding names. At the documented checkpoint, ADMIN_DASHBOARD_PASSWORD, ADMIN_SESSION_SECRET, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY and GCP_PRIVATE_KEY_ID were present by name. FREEMODEL_API_KEY was missing.
2. The user was advised to use the FreeModel dashboard's Default API Key as the primary credential, stored only as Cloudflare Secret FREEMODEL_API_KEY. Do not ask the user to paste it into chat. Do not revoke either of the two existing FreeModel keys.
3. Google credential secret names appeared in Cloudflare, but their values, service-account identity, IAM role, Vertex API enablement and model-call success were not verified. Verify before creating another service account or key. Expected service account: parmar-ai-arena-staging in project project-90db7be4-619f-4ed7-89b, with Vertex AI User (roles/aiplatform.user) and Vertex AI API enabled.
4. Once the FreeModel secret is present and Google settings are verified, guide the user to click Deploy in the Cloudflare dashboard. Do not run a production deployment.
5. Verify admin login interactively with the user at the staging URL. Username is arena-admin; password is the staging-only value set as ADMIN_DASHBOARD_PASSWORD.
6. Open Model Arena, refresh the FreeModel catalogue, confirm available models appear, and run a simple SSC GA/GS test question.
7. Confirm both Gemini/Vertex AI and FreeModel return valid AnswerPackets. Capture safe model IDs, status/error codes and non-secret performance metrics as acceptance evidence.
8. Update the handoff and continuation prompt with actual results. Do not call the Arena fully accepted until both providers have generated successfully.

## Product and technical boundaries

- Arena compares Google Vertex AI/Gemini (left baseline) with FreeModel (right candidate).
- It reuses the production SSC prompt builder and AnswerPacket validation; both receive the same production-built user prompt.
- Current-fact grounding asymmetry matters: Vertex may invoke configured Google Search grounding; FreeModel has no equivalent tool attached.
- Arena runs are stateless on the backend. No D1, KV, Durable Object or Queue write occurs for a comparison. Browser session turns and localStorage votes are client-side only.
- Staging route guard permits only /admin and /admin/*; non-admin paths return 404.
- Dedicated D1 only. No production D1, Telegram Queue, Durable Object, BRVIN service or AI Search bindings.
- The Arena dropdown selects Auto-Router or an individual FreeModel model from the provider catalogue. It does not currently select between multiple API credentials/accounts.
- User wants a future named API-connection selector. Treat it as a separate future enhancement; never expose API key values to the browser.
- FreeModel dashboard screenshots showed both Free Tier Key and Default API Key active, with the same visible scopes (inference, models:read, embeddings) and 60 rpm. The latest recommendation was Default API Key as the main credential, but the two labels' paid-upgrade behavior was not proven. Do not promise key/plan inheritance; verify after any actual upgrade.
- Configured AI cost rates are estimates, not provider invoice guarantees.

## Security and workflow rules

- Never ask the user to share service-account JSON, private keys, API keys, passwords, cookies or authorization headers in chat.
- Never commit credentials or raw private-key JSON.
- Never reuse production provider credentials.
- Do not modify production Telegram behavior, production admin configuration or production Worker for this staging task.
- Do not add production bindings to the Arena staging Worker.
- Use the manual Arena deployment workflow only when code/config changes need a new staging Worker deployment; it has an explicit confirmation input.
- For Cloudflare secret updates, use Cloudflare Dashboard → Variables and Secrets → Deploy.
- Do not give terminal/CLI instructions to the user. Give clear beginner-friendly dashboard navigation.
- When asking the user to do something, explain exactly where to click, what variable name to enter, which value to copy from their own account, and what not to share. Do not ask again for facts already confirmed.
- State uncertainty plainly; never claim provider acceptance based only on a login-page smoke test.

## First response in the new chat

Start by summarizing the documented state and what is still pending. Then inspect live Cloudflare binding names and relevant GitHub state. The likely missing item is FREEMODEL_API_KEY, but verify before instructing the user. Continue from that exact point.