# Standard SSC Model Arena — Staging Handoff

**Status:** Blind judge implementation merged and deployed; post-PR #407 authenticated scorecard remains unverified; Arena Engineer is documented and ready for implementation  
**Checkpoint:** 2026-11-21 IST  
**Repository:** https://github.com/ashini-x/parmar-ai  
**Environment:** Isolated Cloudflare staging Worker only

This is the authoritative handoff for continuing Standard SSC Model Arena work in a new chat. Read it before changing code or infrastructure. It distinguishes facts verified from GitHub/Cloudflare from credential values or provider behavior that have not yet been tested.

## 1. Current status

The Model Arena implementation, blind judge, judge diagnostics, timeout correction, output-token correction and isolated staging deployment workflow are merged into main. The isolated Worker was verified at version 14 with 100% traffic on 2026-11-21. The admin dashboard and FreeModel catalogue were previously observed in the user's browser. The latest judge deployment passed CI, staging deployment and login smoke checks; however, a successful authenticated scorecard after the PR #407 token-budget fix is not yet recorded. Arena Engineer is fully specified in docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md but has not been implemented.

**Live admin URL:** https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login

| Area | Current state | Evidence / qualification |
|---|---|---|
| Arena implementation | Merged | PR #400 |
| Staging route guard | Merged and tested | PR #401 and route-guard test |
| Dedicated staging D1 | Created and bound | ID below |
| Staging Worker | Deployed | GitHub Actions run #44806050579, attempt 2 |
| workers.dev route | Enabled | Latest Cloudflare API read-back confirmed enabled=true |
| Login page smoke test | Passed | Deployment workflow attempt 2 |
| Authenticated dashboard | User-browser access observed | User screenshot shows the staging admin dashboard with the Arena model selector |
| FreeModel catalogue | Loaded in user browser | Screenshot shows catalogue entries including Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Astra, Kimi K3 and others |
| Admin username | Configured | arena-admin |
| Admin password/session secrets | Present by name | Cloudflare settings lists both as Secret; values are not inspectable |
| Google credential secrets | Present by name | Cloudflare settings lists all three GCP secrets; values and Vertex authentication remain unverified |
| FreeModel API key | Present by name | Cloudflare settings lists FREEMODEL_API_KEY as secret; key value and account-key label are not inspectable |
| Initial user-run comparisons | 7 questions submitted with Auto-Router | User-reported; result screenshots/exports have not yet been uploaded or reviewed |
| Vertex AI generation acceptance | Pending evidence review | Inspect seven runs to establish response success and valid AnswerPackets |
| FreeModel inference acceptance | Pending evidence review | Catalogue load succeeded; inspect seven runs to establish inference/model IDs and valid AnswerPackets |
| Overall Arena acceptance | Pending | Do not mark complete until uploaded evidence has been reviewed and remaining coverage gaps tested |

A listed secret binding proves only that a secret with that name is configured. It does not reveal, validate or prove the correctness of its value.

### 2026-11-21 — browser and initial-test checkpoint

A fresh live Cloudflare settings inspection confirmed all six required runtime secret binding names are present and each has type `secret_text`:

- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `GCP_CLIENT_EMAIL`
- `GCP_PRIVATE_KEY`
- `GCP_PRIVATE_KEY_ID`
- `FREEMODEL_API_KEY`

The same live inspection confirmed:
- Worker: `parmar-ai-arena-staging`
- workers.dev route: enabled
- `ENVIRONMENT`: present as plain-text configuration
- `ADMIN_DASHBOARD_USER`: present as plain-text configuration
- `DB`: bound to the dedicated staging D1 ID `30df9bf6-e852-4f15-8fd7-43bd96cb1cdf`

No secret values were retrieved or printed. The currently configured FreeModel API key's actual value or dashboard label cannot be determined from Cloudflare's binding metadata. In the prior chat, the user was advised to use the FreeModel **Default API Key**; treat that as the recommendation, not verified proof of which key value was stored.

**User-browser evidence:** the user supplied a screenshot of the staging admin dashboard with the FreeModel candidate selector open. The screenshot showed catalogue entries such as Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Astra, Claude Fable 5.1, Kimi K3 and other entries. This supports that the user reached the dashboard and that FreeModel catalogue discovery was working in the browser at that time. It does not establish that every listed model can successfully perform inference.

**User-reported preliminary exercise:** the user reports that they submitted **seven of their own questions** with **Auto-Router** selected. These seven questions were not the 31-question matrix proposed in the prior assistant response. The user has not uploaded the seven result screenshots or benchmark export in this conversation, and their outputs have not yet been reviewed. Therefore:

- Do not label any of the seven runs PASS, REVIEW or FAIL yet.
- Do not assume both Gemini and FreeModel succeeded in every run.
- Do not infer which FreeModel model actually answered from the Auto-Router default label; inspect each result's reported `modelUsed` and any failover details.
- Do not infer AnswerPacket validity, factual accuracy, latency, token count or cost if the relevant output/metric is not visible.
- No test result artifact has been uploaded to GitHub at this checkpoint.

The 31-item acceptance matrix suggested earlier remains a future coverage plan, not completed testing. The seven user-authored Auto-Router runs are the only user-reported initial comparison exercise at this point. No pinned individual-model test, current-fact grounding review, deliberate failure-path test, vote/export verification or mobile layout acceptance has been confirmed.

**New-chat instruction:** the user will start a new chat and upload the seven-run evidence there. Review those exact screenshots or benchmark export first. Assess the left Vertex AI/Gemini output and right FreeModel output separately for each run. Capture the question, actual model name/ID, any failover information, success/error state, raw AnswerPacket validity, factual/content quality, latency, token metrics and estimated cost only where shown. Mark absent evidence as unverified. Do not ask the user to repeat a run until its uploaded evidence has been inspected. After that review, identify only the additional tests needed to close the real gaps.


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

A Cloudflare settings read on 2026-11-21 confirms this binding is present as `secret_text`. The user's browser also displayed the FreeModel model catalogue. This confirms model-catalogue access, not successful inference for every listed model. The key's actual value and whether it is the dashboard's Default API Key are not visible through the settings inspection. The user was last advised to use the Default API Key; this remains a recommendation unless the user confirms which key was copied.

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

### Step 1 — Review the seven user-run Auto-Router comparisons

The user's next chat will contain the seven result screenshots or an Arena benchmark JSON export. **Inspect the uploaded evidence before asking the user to perform more tests.**

For each of the seven questions:

1. Capture the exact user question.
2. Inspect the left Vertex AI/Gemini result and right FreeModel result independently.
3. Record success/failure status and safe error code, if shown.
4. Record the actual FreeModel model ID used by Auto-Router (`modelUsed`) and any failover information.
5. Inspect the raw AnswerPacket and determine whether required fields/quiz structures are valid.
6. Review factual correctness, completeness, SSC relevance, language and Telegram-style formatting.
7. Record latency, tokens and displayed estimated cost only when visible.
8. Assign PASS, REVIEW or FAIL with a short reason. Use UNVERIFIED where the screenshot/export does not show enough evidence.

Do not conclude that both providers passed merely because the catalogue loaded. Do not fabricate a benchmark artifact or infer missing outputs.

No result screenshots, exports or test-result artifacts have been uploaded to GitHub as of this handoff.

### Step 2 — Identify the remaining test coverage gaps

The 31-item test plan previously proposed is a future coverage plan, not a completed test record. The seven user-authored Auto-Router comparisons are the only reported initial exercise. After reviewing their evidence, choose only the necessary remaining tests. Likely gaps to consider include:
- SSC subject breadth and statement traps;
- genuine supplied-MCQ solving and independent multi-item quiz generation;
- generic MCQ topic clarification and the topic follow-up;
- multi-turn follow-up and New Session isolation;
- current-fact grounding;
- out-of-scope handling and assistant identity;
- pinned individual FreeModel models versus Auto-Router;
- cooldown/failover behavior if safely testable without deliberately exhausting provider limits;
- vote persistence, JSON export and mobile responsiveness.

Do not ask the user to repeat any of the seven completed runs unless the uploaded evidence is missing or unusable.

### Step 3 — Verify Google configuration only if evidence requires it

The three GCP secret names are present, but their values are not inspectable. Use the seven-run evidence to determine whether Vertex authentication or generation actually failed. If a run shows an authentication/permission error, verify in Google Cloud project `project-90db7be4-619f-4ed7-89b`:
- Vertex AI API is enabled.
- Billing is active.
- Service account `parmar-ai-arena-staging` exists.
- It has Vertex AI User (`roles/aiplatform.user`).
- The Cloudflare secret values correspond to this service account.

Do not create duplicate service accounts or private keys if the existing setup already works.

### Step 4 — Configuration/deployment changes only when justified

At the current checkpoint all six required secret names are present and the user can reach the dashboard and catalogue. Do not add secrets again or redeploy simply because a new chat starts. If evidence identifies a real configuration defect, change only the staging Worker. Apply updated secrets through the Cloudflare Dashboard Deploy action; use the manual staging-only GitHub Actions workflow for code/config changes. Never deploy production for Arena acceptance.

### Step 5 — Continue browser acceptance

Use the staging URL:
https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login

Configured username: `arena-admin`. The user has already shown the signed-in dashboard in their browser. Revisit login only if needed.

After the initial seven-run evidence is reviewed, complete only the remaining tests selected from the coverage-gap review. Compare actual output quality and AnswerPacket validity, not just whether a request returned HTTP success.

### Step 6 — Record the acceptance evidence

Record test date/time, question, actual provider/model ID, success/error, safe AnswerPacket validation outcome, factual review, latency, token counts, displayed estimate and vote where shown. Never record passwords, private keys, API keys, cookies or authorization headers.

Do not mark the Arena fully accepted until both provider outputs and the required SSC/prompt behaviors are demonstrated. If a provider fails, preserve safe error codes and sanitized messages, correct the staging issue only, and rerun the smallest relevant test. Production remains untouched.


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


## 10. Current checkpoint — blind judge corrections and Arena Engineer next work (2026-11-21)

This section supersedes earlier “immediate next step” wording in this historical handoff. The next chat should start by implementing Arena Engineer, after revalidating the latest source and live staging state. The earlier seven-question Auto-Router evidence remains historical and is not a reason to postpone the approved feature unless a current acceptance gate requires it.

### Latest Arena implementation PRs

- **PR #404 — Blind judge:** merged commit 51a58cc9fcef81ff2f737570aba04e57c3e72c7b. Added the separate on-demand Gemini 3.8 Flash blind judge, randomized Candidate A/B order, existing weighted rubric and no automatic judging during generation.
- **PR #405 — Judge diagnostics:** merged commit 49c417a6589ea9bd2cef51c98458edc21cc8957b. Surfaced nested judge errors in the dashboard.
- **PR #406 — Timeout and staging deployment:** merged commit d688213d9b01778b0a194fd809b3642b51cb1b7e. Token acquisition now occurs outside the 60-second inference timer, auth/inference/total timings are separate, and the Arena staging workflow automatically deploys only when Arena-specific source/config/workflow paths change on main. Manual dispatch remains available with explicit confirmation.
- **PR #407 — Judge output budget:** merged commit f6b59c96f2fd7938277c81ca3be4319c679a1d0a. Increased judge maxOutputTokens from 2,500 to 8,192, retained Gemini 3.8 Flash and HIGH thinking, and constrained scorecard prose for a complete response.

### PR #407 verification and deployed staging state

- PR #407 CI: https://github.com/ashini-x/parmar-ai/actions/runs/44894288949 — success.
- Staging deployment: https://github.com/ashini-x/parmar-ai/actions/runs/44894387927 — success.
- Post-merge release validation: https://github.com/ashini-x/parmar-ai/actions/runs/44894387886 — success.
- Cloudflare Worker: parmar-ai-arena-staging.
- Version at this checkpoint: **14**, version ID c8154ec7-a1e3-4993-8ea2-636d85d6efbd, 100% traffic.
- Deployment smoke test verified the admin login page, not a complete authenticated model comparison or judge result.
- Production runtime classification passed; production deployment jobs were skipped. No production change was made.

### Blind judge technical state

- Model: Gemini 3.8 Flash.
- Thinking: HIGH.
- Inference timeout: 60,000 ms, started only after Google access-token acquisition.
- Timings: authenticationMs, inferenceMs and totalMs.
- Max output tokens: 8,192.
- Rubric weights remain accuracy 30%, relevance 20%, completeness 15%, SSC fit 15%, clarity 10%, format 10%.
- Candidate order remains randomized; model/provider labels and operational metrics remain excluded from the judge prompt.
- Actual authenticated post-PR #407 scorecard acceptance: **not yet confirmed in this handoff**. Do not describe the judge as fully proven until a real scorecard is observed.

### Critical implementation fact: Arena is currently stateless

The existing POST /admin/api/arena/run and POST /admin/api/arena/judge both return persistence: stateless. The generation route returns the two candidate outcomes to the browser; the judge route accepts question/context and candidate packets from the browser. Neither writes the run or scorecard to D1.

The staging Worker does have a dedicated D1 binding named DB:
- Database: parmar-ai-arena-staging
- ID: 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf

That binding does not mean Arena benchmark rows are persisted. The Engineer feature must add an explicitly isolated migration path and write only to this database. Do not mistake existing admin/other tables or a successful Worker deployment for Arena run persistence.

### Arena Engineer — approved next feature

Read **docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md** as the canonical detailed product and technical specification.

The feature adds:
- Server-side persistence of benchmark inputs, both candidate outputs, safe telemetry and the final blind judge scorecard.
- Durable run IDs and saved-run history.
- A separate, on-demand Gemini agent named Arena Engineer.
- An **Engineer** button enabled only after a valid judge result is saved and Vertex beats FreeModel by weighted score, or when FreeModel fails and Vertex supplies usable judgeable evidence.
- A saved evidence-based engineering diagnosis across answer quality, speed, router/failover, model selection, reliability and architecture.
- A prioritized improvement roadmap with confidence, trade-offs, effort and acceptance tests.
- A detailed, copyable Coding-Agent Implementation Prompt.
- Persisted reports that can be reopened after reload/new session.

The Engineer is advisory and read-only. It does not inspect the complete GitHub repository by assumption, change code, create PRs, access production resources or deploy. The generated coding-agent prompt instructs the actual repository-aware coding agent to inspect AGENTS.md and current source before implementation.

### Required implementation sequence

1. **E0 — Revalidate:** latest main, PRs, CI, staging Worker version, D1 binding and secret binding names. Never retrieve secret values.
2. **E1 — Persistence:** create the Arena-only D1 migration path, save generated runs and add list/load/delete/history.
3. **E2 — Durable judge:** load canonical saved packets by run ID, preserve the blind judge exactly, persist the scorecard and gate Engineer on confirmed D1 writes.
4. **E3 — Engineer backend:** select a supported Gemini reasoning model after verification; add its own prompt, schema, limits, telemetry, safe error handling and persisted reports.
5. **E4 — UI:** Engineer/View Report states, progress/retry, history, report view and copy-prompt controls, responsive layout.
6. **E5 — Acceptance:** test win/loss/tie, generation and judge failures, save failures, duplicate calls, prompt injection, history, deletion and strict staging-only persistence.
7. **E6 — Close:** record implementation, CI, merge, staging deploy, live verification and authenticated acceptance separately.

### Documentation maintenance rule for this workstream

After every material implementation, design, schema, endpoint, prompt, test, PR, merge, deployment or acceptance update:
- Update this Engineer specification with decisions, status and a dated change-log entry.
- Update this staging handoff with verified current state and exact remaining work.
- Update the continuation prompt with the latest checkpoint and next task.
- Update docs/README.md when the entrypoint or status changes.
- Keep all three documents synchronized. Distinguish proposed, implemented, merged, deployed and authenticated behavior.

No Arena Engineer feature code has been written at this checkpoint.