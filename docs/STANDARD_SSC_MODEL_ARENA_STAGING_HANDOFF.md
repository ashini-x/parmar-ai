# Standard SSC Model Arena — Staging Handoff

**Status:** Staging Worker deployed; provider configuration and live model acceptance remain in progress  
**Checkpoint:** 2026-11-21 IST  
**Repository:** https://github.com/ashini-x/parmar-ai  
**Environment:** Isolated Cloudflare staging Worker only

This is the authoritative handoff for continuing Standard SSC Model Arena work in a new chat. Read it before changing code or infrastructure. It distinguishes facts verified from GitHub/Cloudflare from credential values or provider behavior that have not yet been tested.

## 1. Current status

The Model Arena implementation and its manual staging deployment workflow are merged into main. The isolated Worker is live, its workers.dev route is enabled, and the deployment workflow's admin-login page smoke test passed on retry.

**Live admin URL:** https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login

| Area | Current state | Evidence / qualification |
|---|---|---|
| Arena implementation | Merged | PR #400 |
| Staging route guard | Merged and tested | PR #401 and route-guard test |
| Dedicated staging D1 | Created and bound | ID below |
| Staging Worker | Deployed | GitHub Actions run #44806050579, attempt 2 |
| workers.dev route | Enabled | Cloudflare API read-back confirmed enabled=true |
| Login page smoke test | Passed | Deployment workflow attempt 2 |
| Admin username | Configured | arena-admin |
| Admin password/session secrets | Present by name | Cloudflare settings lists both as Secret; values are not inspected |
| Google credential secrets | Present by name | Cloudflare settings lists all three GCP secrets; values and provider auth are unverified |
| FreeModel API key | Missing at last live inspection | FREEMODEL_API_KEY was absent from Cloudflare settings |
| Successful interactive login | Not yet accepted | Page smoke test is not an authenticated login test |
| Vertex AI generation | Not yet accepted | Needs a real generation request |
| FreeModel catalogue/generation | Not yet accepted | Needs key and real API requests |
| Two-provider comparison | Pending | Both must return valid AnswerPackets |

A listed secret binding proves only that the name exists. It does not reveal, validate or prove the correctness of its value.

## 2. GitHub implementation and release history

### PR #400 — Standard SSC Model Arena

- PR: https://github.com/ashini-x/parmar-ai/pull/400
- Merged commit: 2fdf95af9d585ccb5bd0ba2187a67132d9ad7051
- Commit title: [staging-only] Add Standard SSC Model Arena

Implemented the Arena inside the existing admin dashboard. It uses the production SSC prompt builder and shared AnswerPacket validation. Vertex AI/Gemini is the baseline; FreeModel is the candidate. Both receive the same production-built user prompt.

The FreeModel side includes catalogue discovery, candidate model selection, configured primary model, Auto-Router/failover, and handling for unavailable models, rate limits, server errors, timeouts and malformed responses. JSON response mode is requested only where model capability metadata advertises support. The implementation does not force a reasoning-effort parameter onto candidate models.

The UI includes side-by-side outputs, model catalogue refresh, Auto-Router and individual model selection, fact/comparison/follow-up/quiz/identity/scope presets, Telegram-style formatted previews, raw AnswerPacket inspection, latency/token/thinking/estimated-cost metrics, browser-session turns, local winner/tie voting and JSON benchmark export.

An Arena comparison is stateless on the backend. It does not write the request, model responses or votes to D1, KV, Durable Objects or Queues. Temporary conversation turns and votes remain in the browser; votes are stored in localStorage and can be exported as JSON. The shared admin application has a dedicated D1 binding, but Arena comparisons do not persist into it.

### PR #401 — Manual staging deploy and route isolation

- PR: https://github.com/ashini-x/parmar-ai/pull/401
- Merged commit: 2262bb93b00fbb83942667dfd452d91ef70abac0
- Commit title: [staging-only] Add safe manual deployment for Model Arena

Added .github/workflows/arena-staging-deploy.yml. It is workflow_dispatch only. It does not automatically deploy on push, merge or PR. The confirmation input defaults to do-not-deploy and requires selecting deploy-arena-staging.

The workflow checks out the selected branch, installs dependencies, verifies the existing GitHub Cloudflare deployment credentials, performs an Arena-config dry-run, deploys only the isolated Arena Worker and smoke-tests its admin login page.

GitHub Actions deployment credentials were present and passed validation:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID (repository secret or repository variable)

These are GitHub deployment credentials, not Worker runtime variables. Do not add them to the Cloudflare Worker.

The staging route guard in src/index.ts allows only /admin and /admin/* paths when ENVIRONMENT is staging. Other paths, including root, health and Telegram webhook/setup paths, return 404. test/arena-staging-route-guard.test.ts verifies /admin/login remains available and paths such as /health return 404.

**Scope note:** this is an admin-path boundary, not a newly isolated Arena-only router. The shared admin application code is reused. Use the staging Worker for Arena acceptance; do not assume every legacy admin subpage has its production dependencies in staging.

### Validation and deployment evidence

- PR #401 pre-merge validation passed typecheck, Vitest, Node tests, Worker dry-runs including the Arena config, and production-scope checks.
- Post-merge Release validation passed: https://github.com/ashini-x/parmar-ai/actions/runs/44805623907. Production deployment jobs were skipped for the staging-only change.
- Arena staging deploy workflow: https://github.com/ashini-x/parmar-ai/actions/runs/44806050579.

The first deployment attempt failed after Worker script upload. Cloudflare returned error 10007 when Wrangler queried the script's workers.dev subdomain: “This Worker does not exist on your account.” The account-level thenewtongs workers.dev subdomain existed and the Arena script had been uploaded, but the script's own workers.dev route was disabled.

The remediation was performed directly in Cloudflare:
- POST /accounts/{account_id}/workers/scripts/parmar-ai-arena-staging/subdomain
- Body: enabled=true, previews_enabled=false
- A follow-up GET confirmed that the route was enabled.

The failed GitHub job was re-run. Deployment and the “Verify the Arena admin login page” smoke test both succeeded on attempt 2. Final run conclusion: success.

This was a Cloudflare route-provisioning issue, not an Arena code, D1 schema or model-provider failure. It did not require changing production configuration.

## 3. Cloudflare staging resources

### Worker

| Setting | Value |
|---|---|
| Worker | parmar-ai-arena-staging |
| Config | wrangler.arena-staging.jsonc |
| Entrypoint | src/index.ts |
| Environment | staging |
| Hostname | parmar-ai-arena-staging.thenewtongs.workers.dev |
| Login | /admin/login |
| workers.dev | Enabled, confirmed by Cloudflare API |

The staging config has workers_dev=true and keep_vars=true. Keep the dashboard-managed runtime variables/secrets intact during Wrangler deployments. Do not casually remove or change keep_vars.

### Dedicated D1

| Setting | Value |
|---|---|
| Name | parmar-ai-arena-staging |
| Database ID | 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf |
| Region | APAC |
| Worker binding | DB |

This is a dedicated staging database, not production parmar-ai D1. The staging config binds only this database. It does not bind the production Telegram Queue, production Durable Object namespace, production BRVIN service, production AI Search or production D1.

### Plain configuration values in wrangler.arena-staging.jsonc

| Variable | Configured value |
|---|---|
| APP_VERSION | arena-staging-1 |
| ENVIRONMENT | staging |
| GCP_PROJECT_ID | project-90db7be4-619f-4ed7-89b |
| GEMINI_MODEL | gemini-3.8-flash |
| GEMINI_LOCATION | global |
| GEMINI_THINKING_LEVEL | HIGH |
| ENABLE_GOOGLE_SEARCH_GROUNDING | true |
| MAX_OUTPUT_TOKENS | 1200 |
| MAX_QUESTION_LENGTH | 4000 |
| VERTEX_TIMEOUT_MS | 25000 |
| AI_INPUT_USD_PER_MILLION | 0.75 |
| AI_CACHED_INPUT_USD_PER_MILLION | 0.075 |
| AI_OUTPUT_USD_PER_MILLION | 3.75 |
| ADMIN_DASHBOARD_USER | arena-admin |
| FREEMODEL_PRIMARY_MODEL | claude-sonnet-5-5 |

The AI cost-rate variables are used for Arena estimates. They are not authoritative provider invoice amounts.

### Live Worker binding-name inspection

A Cloudflare settings read during this handoff confirmed the following names and types. Secret values were not retrieved.

| Binding | Type |
|---|---|
| ADMIN_DASHBOARD_PASSWORD | secret_text |
| ADMIN_SESSION_SECRET | secret_text |
| GCP_CLIENT_EMAIL | secret_text |
| GCP_PRIVATE_KEY | secret_text |
| GCP_PRIVATE_KEY_ID | secret_text |
| ADMIN_DASHBOARD_USER | plain_text |
| GCP_PROJECT_ID | plain_text |
| GEMINI_MODEL | plain_text |
| GEMINI_LOCATION | plain_text |
| GEMINI_THINKING_LEVEL | plain_text |
| ENABLE_GOOGLE_SEARCH_GROUNDING | plain_text |
| FREEMODEL_PRIMARY_MODEL | plain_text |
| DB | d1 |

**Important:** FREEMODEL_API_KEY did not appear in this Cloudflare settings response. Add it before testing the FreeModel catalogue or running a FreeModel comparison.

## 4. Provider credentials — exact checkpoint

Never put actual credentials, keys, passwords, tokens or full credential files in GitHub documentation, source code, issues, PR comments or chat.

### Admin login

The user confirmed adding:
- ADMIN_DASHBOARD_PASSWORD
- ADMIN_SESSION_SECRET

Cloudflare settings API independently confirmed both secret binding names exist. The username is already configured as ADMIN_DASHBOARD_USER=arena-admin.

The password and session secret must be unique to staging and different from each other and from production values. Their values are intentionally not recorded.

**Not verified:** interactive sign-in. The GitHub smoke test only verified that the login page returned HTTP 200 with expected page text.

### Google Vertex AI

Cloudflare currently lists these secret names:
- GCP_CLIENT_EMAIL
- GCP_PRIVATE_KEY
- GCP_PRIVATE_KEY_ID

Their values and validity are not inspectable through the settings read. The service-account identity, role grant and API enablement must be checked in Google Cloud if not already completed.

Intended Google setup:
- Project: project-90db7be4-619f-4ed7-89b
- Dedicated service account: parmar-ai-arena-staging
- Required IAM role: Vertex AI User (roles/aiplatform.user)
- API: Vertex AI API (aiplatform.googleapis.com)
- JSON field client_email maps to GCP_CLIENT_EMAIL.
- JSON field private_key maps to GCP_PRIVATE_KEY.
- JSON field private_key_id maps to GCP_PRIVATE_KEY_ID.

GCP_PRIVATE_KEY_ID is optional in the current code, but it is useful and already appears as a secret binding. The private key must be the full PKCS#8 PEM value including its BEGIN/END markers. src/auth/google.ts converts escaped newline sequences to actual newlines before importing the key with Web Crypto.

**Not verified:** the service account exists in the intended project, has Vertex AI User, Vertex AI API is enabled, billing is active, and the current secret values belong to that service account. A real Vertex generation request is the acceptance test.

If the service account or role has not been created, create/verify it in Google Cloud rather than making another project or reusing production credentials. Keep any downloaded JSON key private; never commit it.

### FreeModel key and account choice

Screenshots supplied by the user showed two active FreeModel keys:
- “Free Tier Key”, masked ending ea63.
- “Default API Key”, masked ending fab7.

Both screenshots showed the same visible permissions: inference, models:read, embeddings and 60 rpm. Actual key values are not recorded.

The usage screenshot showed 236K used, 764K remaining, 23.6% of the free allowance used and a $0.00 prepaid balance at the time of capture. It is a historical screenshot snapshot, not a live account reading.

The recommendation changed during the conversation: an earlier answer suggested the Free Tier Key; the latest recommendation was the **Default API Key** as the primary Arena key because the two dashboard labels do not prove that the Free Tier Key will inherit a future paid-plan entitlement. This is a conservative recommendation, not a verified provider guarantee. Keep both active; do not revoke either as part of setup.

The current Worker requires:
- FREEMODEL_API_KEY — Cloudflare Secret

A Cloudflare settings read at this handoff did **not** show this binding. The user was last instructed to copy the Default API Key into this secret; addition was not confirmed. Treat it as pending until Cloudflare read-back or user confirmation proves it exists.

Current code behavior:
- src/ai/freemodel.ts reads one credential from env.FREEMODEL_API_KEY.
- Default API base URL is https://freemodel.in/v1.
- Default primary model is claude-sonnet-5-5, also configured in staging.
- Model catalogue is read from the FreeModel API.
- src/admin/dashboard.ts presents Auto-Router and catalogue-discovered individual models.

**Important distinction:** the current Arena dropdown selects an AI model by model name/ID. It does not select among multiple FreeModel API keys or named accounts. There is one runtime FreeModel API key binding.

The user wants a future option to name and select API connections inside the Arena (for example, a main account and a secondary account). Record this as a future enhancement, not delivered functionality. Multiple named credentials must remain server-side; the browser should see only safe connection names/status, never key values.

The user also asked whether the same key automatically receives paid-plan entitlements after upgrading. The conversation did not conclusively verify that for the differently labelled keys. Do not promise it. After a future upgrade, verify actual usage limits/catalogue using the existing key and provider account. Replace/rotate the key only if the provider requires it. A subscription upgrade alone should not trigger a code change.

## 5. Arena behavior

### Left side — baseline
- Provider: Google Vertex AI / Gemini.
- Configured model: gemini-3.8-flash.
- Location: global.
- Thinking configuration: HIGH.
- Google Search grounding is enabled in staging for prompts meeting the existing grounding conditions.

### Right side — candidate
- Provider: FreeModel OpenAI-compatible API.
- Model catalogue is discovered at runtime.
- Configured primary candidate: claude-sonnet-5-5.
- UI supports Auto-Router or an individual available model.
- Availability, cooldown and rate limits depend on the provider.

### Prompt/answer parity
The Arena reuses the production Standard SSC prompt builder and shared AnswerPacket validation. Both sides receive the same production-built user prompt. The Arena uses a neutral profile (SSC not specified) and browser-session conversation turns; it does not load a real student's saved profile.

For current-fact prompts, Vertex may additionally invoke configured Google Search grounding. FreeModel does not have an equivalent search tool attached. This difference is shown in the Arena UI and must be considered when judging factual outputs.

### Persistence and evaluation
- An Arena comparison does not create a backend D1 history row.
- Run outputs return to the browser.
- Session turns remain browser-side and bounded.
- Votes are stored only in browser localStorage.
- Benchmark votes can be exported as JSON.
- Student Telegram traffic, saved student profiles, production quotas and production D1 are outside Arena runs.

## 6. Exact next steps

Continue in this order. Do not deploy production and do not change the production Worker.

### Step 1 — Add the missing FreeModel secret

In Cloudflare:
1. Open Workers & Pages.
2. Select parmar-ai-arena-staging.
3. Open Settings → Variables and Secrets.
4. Add a new binding with type Secret.
5. Name it FREEMODEL_API_KEY.
6. Paste the selected FreeModel Default API Key directly from the provider dashboard.
7. Do not paste the key into chat or GitHub.
8. Keep both provider keys active; do not revoke either.

### Step 2 — Verify Google configuration

In Google Cloud Console select project project-90db7be4-619f-4ed7-89b and verify:
- Vertex AI API is enabled.
- Billing is active.
- Service account parmar-ai-arena-staging exists.
- It has Vertex AI User (roles/aiplatform.user).
- The email and private key represented by the current Cloudflare secrets match that service account's JSON key.

If already completed, do not create another account or key. Verify first.

### Step 3 — Deploy the pending Cloudflare secret

After FREEMODEL_API_KEY is present and Google settings are verified:
1. Review all six runtime secret names.
2. Confirm every one has type Secret.
3. Click Deploy in the Cloudflare dashboard.
4. Wait for deployment success.

Six secrets:
- ADMIN_DASHBOARD_PASSWORD
- ADMIN_SESSION_SECRET
- GCP_CLIENT_EMAIL
- GCP_PRIVATE_KEY
- GCP_PRIVATE_KEY_ID
- FREEMODEL_API_KEY

ADMIN_DASHBOARD_USER is already a plain config variable with value arena-admin. Do not add it as a secret.

### Step 4 — Verify authenticated admin access

Open https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login and sign in with:
- Username: arena-admin
- Password: the staging-only ADMIN_DASHBOARD_PASSWORD value

If login fails, inspect secret presence/type and the exact error or Cloudflare logs. Do not rotate production credentials.

### Step 5 — Verify the FreeModel catalogue

1. Open the Model Arena dashboard tab.
2. Click Refresh Models.
3. Confirm the catalogue loads.
4. Confirm the primary model appears.
5. Confirm individual available model choices appear.

If catalogue discovery fails, inspect the provider status and sanitized error code. Do not assume the UI is faulty without checking the API result.

### Step 6 — Run the first two-provider comparison

Use a stable SSC GA/GS question, for example: “Which Article of the Indian Constitution deals with the abolition of untouchability?”

1. Enter the question.
2. Keep Auto-Router selected for the first run unless the UI requires another choice.
3. Click Compare Models.
4. Confirm the left Vertex AI/Gemini side returns a valid AnswerPacket.
5. Confirm the right FreeModel side returns a valid AnswerPacket.
6. Inspect model IDs, formatted previews, latency, tokens, estimated costs and raw AnswerPackets.
7. Save a browser-local vote or export JSON only if useful.

Do not call provider acceptance complete if only one side succeeds. A successful login-page smoke test is not successful sign-in or successful model generation.

### Step 7 — Record acceptance evidence

Record date/time, test question, selected FreeModel model, safe provider success/failure codes, returned model IDs, latency/token metrics and whether both AnswerPackets validated. Never record credentials, private keys, passwords, cookies or authorization headers.

If a provider fails, keep only safe error codes and sanitized messages. Fix staging configuration/code and rerun acceptance. Production remains untouched.

## 7. Deployment and operational safety

- Never deploy the staging Arena with the production Wrangler config.
- Use .github/workflows/arena-staging-deploy.yml only when code/config changes require a staging Worker deploy. It is manual-only and has an explicit confirmation input.
- Use the Cloudflare Dashboard Deploy action when applying Worker secrets/variables.
- Never commit provider keys or service-account JSON.
- Do not add production D1, Telegram Queue, Durable Object, BRVIN service or AI Search bindings.
- Do not change the production parmar-ai Worker or the student-facing Telegram path as part of Arena testing.
- Keep Arena credentials separate from production credentials.
- Displayed costs are estimates, not provider invoice truth.
- Do not assume a FreeModel plan upgrade changes key behavior without verifying the actual account.
- Do not claim full Arena acceptance until login, catalogue discovery and successful two-provider generation are demonstrated.

## 8. Relevant source files

| File | Purpose |
|---|---|
| wrangler.arena-staging.jsonc | Isolated Worker config and dedicated D1 |
| .github/workflows/arena-staging-deploy.yml | Manual staging deploy and login smoke test |
| src/index.ts | Staging route guard and protected Arena API endpoints |
| src/ai/arena.ts | Parallel provider execution, prompt parity and response formatting |
| src/ai/freemodel.ts | FreeModel auth, catalogue, routing and generation |
| src/auth/google.ts | Google service-account JWT/token authentication |
| src/admin/dashboard.ts | Arena UI, model selector, metrics and browser-side state |
| src/config/env.ts | Runtime environment binding types |
| test/arena-staging-route-guard.test.ts | Staging admin-only route regression test |

## 9. New-chat continuation

Use STANDARD_SSC_MODEL_ARENA_CONTINUATION_PROMPT.md as the copyable instruction for the next chat. Start by reading this handoff and re-checking live GitHub and Cloudflare state. The immediate task is to verify/add FREEMODEL_API_KEY, verify the existing Google credentials without creating duplicates, deploy the secrets once, and complete authenticated two-provider acceptance.