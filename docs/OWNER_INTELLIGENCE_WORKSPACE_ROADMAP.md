# BRɅIN Intelligence — Owner Workspace Roadmap

**Status:** M0–M3 implementation complete and deployed; first live Owner-session model availability check pending  
**Last updated:** 2026-11-18  
**Repository:** `ashini-x/parmar-ai`  
**Product surface:** Existing protected Admin Control Center  
**Working name:** BRɅIN Intelligence

> This is a separate owner-only feature. It does not replace or broaden the student-facing परमार्थAI Telegram tutor.

## 1. Product goal

Build a ChatGPT-like AI workspace for the BRɅIN owner, accessible only after signing in through the existing Admin Control Center login.

The owner should be able to ask open-ended questions across subjects and professional domains, including mathematics, reasoning, science, coding, software architecture, research, writing and general knowledge. The workspace should use Gemini models available to the configured Google Cloud / Vertex AI project and expose each model's supported reasoning/thinking settings.

The owner chooses the model and its supported thinking level. The interface must not show settings that the selected model or API does not support.

### Product principles

1. **Owner-only:** available only to an explicitly authenticated Owner principal.
2. **Separate from students:** no changes to student Telegram scope, prompts, quotas, profiles, or answer contracts.
3. **Model choice belongs to the owner:** expose the Gemini models the configured Vertex AI project can actually use, not an invented or globally assumed catalogue.
4. **Thinking settings are model-aware:** show the provider-supported levels for the selected model, and send only valid parameters.
5. **No student-style application cap:** do not apply the student's daily question quota or student burst policy to owner conversations. This does not override Google Cloud quotas, model availability, context limits, billing, or account/project restrictions.
6. **Private by default:** owner conversations and uploads are separate from student records and BRɅIN retrieval data.
7. **Documentation is part of delivery:** every completed implementation task must update this roadmap and the continuation prompt before that task is considered complete.

## 2. Current repository baseline (verified 2026-11-17)

The existing app already provides a suitable protected admin surface:

- `/admin/login` accepts the configured dashboard username and password.
- `src/admin/auth.ts` signs a 12-hour HMAC session cookie named `parmar_admin_session` with `HttpOnly`, `Secure`, and `SameSite=Strict`.
- Failed admin login attempts are recorded in D1; five failures within the active five-minute window trigger a ten-minute lockout.
- `requireAdmin(request, env)` validates the signed session.
- `src/index.ts` protects `/admin`, existing BRɅIN/Fatman admin pages and `/admin/api/*` with `requireAdmin`. Existing POST admin APIs also apply same-origin checks.
- `src/admin/dashboard.ts` renders the existing Admin Control Center and reads operational data from D1.
- `src/config/env.ts` defines the Vertex AI project/model configuration and the admin credential bindings.

### M1 implementation: explicit web Owner identity

M1 adds a signed `admin` / `owner` role claim to the existing 12-hour admin session. `requireAdmin` accepts either valid role for the existing admin surface; `requireOwner` accepts only the Owner role. The role is derived from server-side credential configuration and the session HMAC. A role value supplied by the browser cannot elevate access.

Production currently has one configured web-admin principal. `wrangler.jsonc` explicitly sets `OWNER_DASHBOARD_USER` to the existing `ADMIN_DASHBOARD_USER` (`admin`), so the current admin credentials are deliberately assigned the Owner role without introducing a second shared account or requiring another password secret. If a distinct Owner login is introduced later, configure a different `OWNER_DASHBOARD_USER` and store `OWNER_DASHBOARD_PASSWORD` as a Cloudflare Worker secret. A different admin username/session remains `admin` and is not implicitly Owner.

Sessions minted before M1 keep their legacy two-part format and remain admin-only. The Owner must sign in again after deployment to receive the Owner role claim. New Owner sessions are signed using a key derived from `ADMIN_SESSION_SECRET` and the credential currently assigned to the Owner principal; rotating that credential revokes existing Owner sessions. Existing 12-hour expiry, HttpOnly, Secure, SameSite=Strict cookie attributes and logout clearing are preserved.

`/admin/intelligence` is now a protected Owner-only placeholder page. `/admin/api/intelligence` and its subpaths are reserved behind the same Owner check and intentionally return 404 to an authenticated Owner until M2 adds handlers. Anonymous requests receive 401; authenticated non-Owner admins receive 403. The `BOT_OWNER_TELEGRAM_USER_ID` setting remains unrelated to web-admin Owner identity.

### Existing student boundary to preserve

The Telegram product is intentionally SSC GA/GS-focused and runs through its own Worker/Queue/Durable Object pipeline. It has student-specific answer contracts, profile context, usage admission and quota controls. Owner Intelligence must use a separate request path and must not inherit those student-specific restrictions or mutate student profile/history state.

### Source files to re-read before implementation

- `src/admin/auth.ts` — login, session signature, logout and current admin identity.
- `src/index.ts` — route dispatch, admin route guards and same-origin checks.
- `src/admin/dashboard.ts` — Admin Control Center UI/API patterns.
- `src/config/env.ts` — Worker environment bindings and current Vertex configuration.
- `src/ai/gemini.ts` — current Vertex/Gemini request construction, streaming and usage handling.
- `src/analytics/db.ts` — D1 schema boundaries, accounting and audit patterns.
- `docs/SECURITY_MODEL.md`, `docs/DATA_MODEL.md`, `docs/DATA_GOVERNANCE.md`, `docs/AI_PIPELINE.md`, and `docs/TEST_PLAN.md`.

Do not assume the source files or deployment configuration remain unchanged. Re-read the latest default branch before each implementation task.

## 3. Target owner experience

The workspace should be reachable from an Owner-only entry in the existing admin panel, for example:

- Admin sign-in: `/admin/login` (existing)
- Owner workspace: `/admin/intelligence` (M1 protected placeholder; M2 replaces it with the chat interface)
- Owner APIs: `/admin/api/intelligence/*` (M1 Owner-only reserved namespace; no feature handlers yet)

### Core interface

- ChatGPT-like conversation layout that fits the existing admin product and works on desktop and mobile.
- New chat, conversation history, reopen and rename conversations.
- Message composer with multiline input.
- Stream responses into the current conversation.
- Stop generation, regenerate, edit/resubmit a prompt, and copy response.
- Clear rendering for formatted text, code, tables, equations and long responses.
- Show the active model and thinking level on each conversation/response.
- Model and thinking selectors in the composer/settings area.
- Useful loading, retry, provider error, quota and upload states. Provider errors must be understandable and must not silently switch models.
- Accessible keyboard behaviour and responsive layout.

### Broad owner assistant

The owner assistant must not use the student SSC-only system prompt or student answer schema. It should support open-ended questions, and must not force every request into SSC subject/topic/exam fields.

The assistant can generate explanatory derivations, summaries of its approach, assumptions, verification steps and citations where available. It must not claim to reveal private internal chain-of-thought tokens or hidden reasoning traces.

### Gemini model catalogue and thinking selector

The catalogue must be maintained as provider-aware metadata, not as a permanently hardcoded list in the front end.

For every candidate model, track at least:

- Provider model ID and display label.
- API surface/version and supported request format.
- Project/location availability and eligibility.
- Lifecycle state (GA, preview, deprecated, retired), where the provider documents it.
- Supported input/output modalities and relevant capabilities.
- Supported thinking/reasoning levels and defaults.
- Context/output limits relevant to the chosen API.
- Any required request fields, incompatible fields or migration notes.

The server is authoritative. The browser receives only the allowed catalogue for this deployment. If a model is unavailable, retired, unsupported in the configured region, or rejected by the project, it must not be presented as selectable.

The UI should update the thinking selector whenever the model changes. It must submit only the selected model's supported configuration. Do not assume that every model supports the same values. For example, current Google documentation describes Gemini 4 Hydrogen with `LOW`, `MEDIUM`, `HIGH`, and `XHIGH`, while Gemini 4 Carbon and Argon support `LOW`, `MEDIUM`, and `HIGH`; `MINIMAL` and the older `thinking_budget` parameter are not valid for Gemini 4. These are examples of why the catalogue must be model-specific, not a permanent exhaustive list.

Official provider references checked on 2026-11-17:

- [Thinking levels and supported-model matrix](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking)
- [Get started with Gemini 4](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4)
- [Gemini 4 Hydrogen developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-hydrogen)
- [Gemini inference API reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference)

The live project/location must be checked before enabling a model. Public documentation does not prove that the current BRɅIN Google Cloud project is entitled to every listed model.

### Owner-only usage and resource policy

- Do not apply the student daily question limit, student burst limit, SSC subject scope, or adaptive student-only thinking ceiling to owner workspace requests.
- Do not present this as technically unlimited. Vertex AI remains subject to project/model quotas, regional availability, service limits, billing, context limits and temporary provider capacity.
- Record owner usage independently: model, thinking level, token counts where returned, latency, status and estimated cost.
- Provide clear usage/cost visibility and configurable billing alerts or owner notifications. A budget alert is not a hidden per-day student-style question cap.
- Never silently downgrade a model or thinking level after an error. Explain the failure and let the owner choose a supported alternative.

### Files and multimodal input

Planned support includes PDF, common image formats and supported document/file types. Before implementation, verify the selected Vertex API/model's current file support and choose a private storage path.

Uploads must be owner-authorized, type/size-validated, isolated from student and BRɅIN source storage, retained only under a documented policy, and deleted when the associated conversation/file is deleted. Do not expose public object URLs.

### Optional BRɅIN knowledge context

BRɅIN retrieval may be offered as an explicit, opt-in context source for the owner. It must be off by default for general-purpose chats and must not automatically force BRɅIN/Fatman passages into every prompt.

When enabled, use the approved private BRɅIN service contract and its source/project authorization rules. Keep general Vertex chat generation separate from the retrieval provider. An owner question should still work without BRɅIN context.

## 4. Target architecture and boundaries

```text
Owner browser
    |
    v
Existing /admin/login
    |
    v
Signed admin session + explicit Owner role check
    |
    +---- Existing Admin Control Center (unchanged)
    |
    +---- Owner-only /admin/intelligence
                |
                v
         Owner Intelligence API
         (Owner authorization on every request)
                |
          +-----+-----------------------+
          |                             |
          v                             v
     Owner chat store             Vertex AI / Gemini
     (separate D1 records)        (selected model + valid
          |                        model-specific thinking)
          v                             |
     Private uploads                    v
     (isolated object storage)     streamed response
          |
          +---- optional, explicitly enabled BRɅIN context
```

Implementation must preserve these boundaries:

- **Identity:** role/owner principal is established and verified server-side from the signed admin session. Never trust a role value supplied by the browser.
- **Authorization:** every read, write, stream, stop, regenerate, upload and delete operation rechecks Owner access.
- **Storage:** use separate owner conversation/message/upload records. Do not store Owner prompts in the student `questions`, profile, Durable Object or quiz records.
- **Model credentials:** use the existing server-side Google service-account/Vertex authentication path where compatible. Never send private keys, access tokens or provider credentials to the browser.
- **Request path:** build a dedicated general-purpose assistant pipeline. Reuse low-level safe Vertex transport utilities only after reviewing their assumptions; do not reuse the student-specific prompt, `AnswerPacket`, answer classifier or SSC post-processing.
- **BRɅIN retrieval:** separate, optional, explicitly selected context. No implicit student or unrelated tenant data access.
- **Audit:** record security-relevant owner actions without storing secrets or unnecessary prompt contents in audit logs.
- **Failure handling:** handle Vertex 429/5xx, model unavailability, timeouts, disconnects, cancellation and partial streams without losing previously saved turns or showing a false success.
- **Privacy:** apply retention and deletion to conversations and uploaded source files. Keep data out of Git and ordinary application logs.

## 5. Milestones and acceptance criteria

Milestones are ordered. Do not skip a security or persistence prerequisite to build a visually complete chat page.

| Milestone | Scope | Acceptance criteria | Status |
|---|---|---|---|
| **M0 — Product and architecture baseline** | Define owner-only scope, existing admin baseline, trust boundaries, target UX, model/thinking registry, data boundaries, delivery workflow and continuation prompt. | Roadmap and continuation prompt committed; current implementation clearly marked as not started; docs index updated. | **Complete — documentation only** |
| **M1 — Owner identity and authorization** | Add explicit Owner identity/role to the existing admin sign-in/session flow. Keep regular admin access distinct. Protect the Owner route and reserved API namespace server-side. | Configured Owner signs in through `/admin/login`; admin-only sessions and forged role claims are denied; sessions expire/logout; credential rotation revokes Owner sessions; route/API guards enforce Owner authorization; authorization tests pass; production deploy and smoke/acceptance succeed. | **Complete — deployed** |
| **M2 — Workspace shell and owner chat persistence** | Deploy the Owner-only responsive BRɅIN Intelligence workspace; create isolated D1 conversations/messages; implement new chat, history, reopen, rename, delete and user-message persistence. | Owner-only route/API guards; separate D1 tables scoped by configured Owner principal; create/list/reopen/rename/delete; saved user messages survive reload; same-origin mutation protection; responsive dark workspace; student flows unchanged. | **Complete — deployed** |
| **M3 — Vertex AI model registry and provider adapter** | Build the server-side Gemini allowlist/catalogue, project/location capability checks, Owner-facing model selector and a separate general-purpose Gemini provider adapter. | Model metadata is server-controlled; only a model with a successful Count Tokens probe at the configured project/location is selectable; provider failures remain explicit; unverified models are rejected by the adapter; no student prompt/contract or silent model fallback is used. | **Complete — deployed and live picker observed** |
| **M4 — Model-specific thinking and live response controls** | Map each model to its supported thinking settings; stream output; support stop, regenerate and edit/resubmit; persist partial/final status and generation metadata safely. | Model change updates valid choices; server validates the model/API-specific thinking value; Vertex request uses the selected level; SSE streams only user-facing text; Stop/request cancellation retains partial text; Regenerate and Edit/resubmit keep turn order coherent; actual model/level/token/latency metadata is Owner-scoped. Automatic in-place stream reconnection and a real billed browser generation check remain explicit acceptance items. | **Implementation in PR #320; CI/deployment/production acceptance pending** |
| **M5 — Private files and multimodal conversations** | Add secure upload, private storage, file-to-conversation association and supported Gemini file/image/PDF inputs. | Owner-only access enforced for upload/read/delete; MIME/type/size and provider support validated; no public URLs or secret leakage; file deletion and retention verified; representative image/PDF/document tests pass. | Not started |
| **M6 — Optional BRɅIN context** | Provide an explicit opt-in for approved BRɅIN retrieval context; maintain provenance and source access rules. | Off by default; only authorized and ready BRɅIN sources are used; citations/provenance are preserved where available; general chats work without retrieval; no student or other tenant data can be queried. | Not started |
| **M7 — Owner observability and cost controls** | Add a dedicated usage view for owner chats, model/level/token/latency/error data and configurable billing alerts. | Owner usage is separate from student metrics; estimates are labelled estimates; provider quota/billing realities are clear; alerts are testable; no student-style daily cap is applied. | Not started |
| **M8 — Security, regression and production release** | Run authorization, isolation, prompt-boundary, provider, streaming, file, responsive UI, cost and regression tests; deploy behind Owner-only access. | Full checks and targeted acceptance pass; student Telegram and existing Admin/BRɅIN flows remain unchanged; production owner-only smoke tests pass; rollback path and deployed revision are recorded; docs and continuation prompt reflect verified production state. | Not started |

### Milestone completion rule

A milestone is complete only when its acceptance criteria are satisfied by code and test evidence. A UI mock, local-only result, documentation statement or passing type check alone is not enough. Production milestones also require the intended deployment to succeed and the deployed behavior to be verified.

## 6. Non-goals and explicit exclusions

Unless separately approved, this feature does not:

- Turn the student Telegram bot into a general-purpose chatbot.
- Change student SSC scope, student prompts, quotas, exam profiles, question history or quiz contracts.
- Give teachers, ordinary operators or other admin users Owner access.
- Reuse student conversation/profile data as automatic Owner context.
- Automatically inject Fatman or BRɅIN passages into general-purpose answers.
- Expose provider secrets, private reasoning traces, or internal authentication state.
- Promise unlimited provider capacity, zero billing, or models the configured Vertex project cannot access.
- Silently switch models, thinking levels, providers or API versions after a failure.

## 7. Living implementation ledger

This section is the current source of truth for this feature's progress. Update it with every completed implementation task.

### Current checkpoint

- **Completed:** M0 product/architecture baseline; M1 Owner identity and authorization; M2 Owner workspace shell and chat persistence; M3 Vertex model registry/provider adapter and live Owner model-picker verification.
- **M3 live verification:** on 2026-11-18 the Owner supplied a production screenshot showing the model selector populated with the project/location-verified candidates. The UI only displays catalogue rows with `selectable: true`; do not infer that unlisted registry candidates are enabled.
- **M4 implementation:** the Owner-specific thinking selector, Vertex thinkingConfig binding, SSE generation endpoint, partial persistence, Stop, Regenerate, Edit/resubmit and separate generation metadata table are implemented on `feat/owner-intelligence-m4` and submitted in PR [#320](https://github.com/ashini-x/parmar-ai/pull/320). The PR includes tests and documentation updates. CI, merge, production deploy and post-deploy Owner generation acceptance are not yet verified.
- **Next:** complete PR #320 review/checks, merge and deploy through the paired production workflow; then run the real Owner browser acceptance for one short response, one selected thinking level, stop/partial retention and regenerate/edit. Automatic in-place stream reconnection is not included in this slice and remains a follow-up; do not mark M4 complete until its acceptance criteria are closed.
- **M2 implementation:** `/admin/intelligence` remains the responsive dark workspace. It provides New chat, conversation history, reopen, rename and delete. Owner-authored messages persist in D1.
- **M2 storage:** `owner_intelligence_conversations` and `owner_intelligence_messages` remain separate from student tables and Durable Object state. Every read/write is scoped by the normalized configured Owner username. No automatic Owner-chat retention cleanup is configured; chats remain until individually deleted.
- **M2 APIs:** `GET/POST /admin/api/intelligence/conversations`; `GET/PATCH/DELETE /admin/api/intelligence/conversations/:id`; `POST /admin/api/intelligence/conversations/:id/messages`. The complete namespace remains behind `requireOwner`; mutations require same-origin Origin checks.
- **M3 model API:** `GET /admin/api/intelligence/models` is Owner-only, uses the server-configured project/location and the existing server-side Google service-account token utility, and probes the central registry candidates with Vertex `countTokens`. Only HTTP success makes a model selectable. The complete catalogue is cached for 90 seconds; no more than three probes run concurrently and each candidate has an 8-second timeout.
- **M3 current registry:** Gemini 4 Hydrogen, Carbon and Argon; Gemini 3.8, 3.7 and 3.6 Flash; Gemini 3.5 Flash and Flash-Lite. The Owner UI only displays entries with `selectable: true`. It prefers Hydrogen, then 3.8 Flash, then the first available candidate as the initial page selection. The model choice is page-local and is not yet wired to generation.
- **M3 provider adapter:** `generateOwnerGeminiContent` uses plain multi-turn text content and an optional Owner system instruction. It does not invoke the student SSC prompt, `AnswerPacket`, student profile, student quota, Google Search grounding or BRɅIN/Fatman context. It refuses a model without a recent successful project/location probe, applies the model's API single-request output ceiling, sanitizes provider errors and never auto-falls back.
- **Official Google compatibility references checked 2026-11-18:** [thinking-level matrix](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking), [Gemini 4 limits and migration guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4), [Gemini 3.8 Flash developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash), and [Gemini 4 Argon developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon). The 4 family has a 1,048,576-token unified input/output budget; the current non-streaming direct HTTP adapter's per-request output ceiling is 65,536 for Hydrogen and 32,768 for Carbon/Argon. Gemini 3.8/3.7/3.6/3.5 candidates have a 1,048,576 context window and 65,536 output ceiling. Thinking metadata is recorded but M4 will send the selected thinking setting.
- **M3 release:** provider layer first deployed by `75be2818b1688f7e70745cb3560ed8c7c56ec6b2` through workflow [44153429958](https://github.com/ashini-x/parmar-ai/actions/runs/44153429958). The follow-up model-selector/provider-hardening release is built from `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`; workflow evidence will be appended once the deployment/release gate completes.
- **Not implemented:** actual chat response generation in the UI, model-specific thinking controls, streaming, stop/regenerate/edit, private attachments and optional BRɅIN retrieval. These remain M4–M6.
- **Production identity:** `OWNER_DASHBOARD_USER=admin` remains explicitly configured as the current single production Owner principal. Existing sessions minted before M1 require a fresh login.

### Decisions recorded

| ID | Decision | Rationale | Status |
|---|---|---|---|
| OIW-ADR-001 | Build Owner Intelligence inside the existing protected Admin Control Center. | Reuses the existing admin entry/sign-in rather than introducing an unrelated public product surface. | Accepted |
| OIW-ADR-002 | Add an explicit Owner role claim; only the server-configured Owner username receives it. | Authenticated admin status alone is insufficient. Production explicitly maps the current single admin principal to Owner; a distinct Owner credential can be configured when separate principals are introduced. | Accepted |
| OIW-ADR-003 | Keep Owner chat data and request pipeline separate from student Telegram state and schema. | Prevents SSC rules, quotas, profiles and student records from leaking into the owner assistant. | Accepted |
| OIW-ADR-004 | Use a server-authoritative model catalogue with model-specific thinking metadata. | Model availability and thinking support vary by model, API version, project and location. | Accepted |
| OIW-ADR-005 | Do not apply student daily/burst question caps to Owner chats; surface provider quotas and cost instead. | Owner has no student-style app cap, but Vertex AI remains subject to provider, account and billing limits. | Accepted |
| OIW-ADR-006 | BRɅIN retrieval is opt-in and off by default for general chats. | Prevents unrelated knowledge context from silently shaping answers. | Accepted |
| OIW-ADR-007 | Include the role in the signed session; sign Owner sessions using a key derived from the configured Owner credential. | Client role tampering fails HMAC validation, and credential rotation revokes active Owner sessions. | Implemented |
| OIW-ADR-008 | Store Owner conversations and messages in dedicated D1 tables and scope every query to the configured Owner principal. | Keeps general Owner prompts and history isolated from student analytics, profiles and Durable Object state. | Implemented in M2 |
| OIW-ADR-009 | M2 persists Owner-authored messages but does not invoke Gemini or fabricate assistant replies. | Workspace shell and persistence can be verified before the M3 provider adapter and M4 generation controls are ready. | Implemented in M2 |
| OIW-ADR-010 | The Owner model catalogue is a server-side allowlist, and availability is determined by a project/location Count Tokens probe. | Public model documentation does not prove this project's entitlement, regional access or enablement. | Implemented in M3 |
| OIW-ADR-011 | Owner generation must require a selectable catalogue entry and never silently fall back to another model. | A syntactically valid model ID is not proof that the configured project can invoke it. | Implemented in M3 |
| OIW-ADR-012 | Owner thinking level is selected and validated against the chosen server registry entry, then sent using Vertex `generationConfig.thinkingConfig.thinkingLevel`. | Thinking options and request payload compatibility vary by Gemini model; rejecting unsupported values prevents silent downgrades. | Implemented in M4 branch; release pending |
| OIW-ADR-013 | Streamed Owner assistant text and generation metadata remain in dedicated Owner D1 records; Stop/disconnect retains a truthful partial status. | The Owner must be able to reopen interrupted conversations without mixing generation data into student analytics or implying incomplete text is final. | Implemented in M4 branch; release pending |

### Completed task log

| Date | Task | Files updated | Evidence / result |
|---|---|---|---|
| 2026-11-17 | M0 documentation baseline created and verified. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/README.md` | Commits: `aa29d00787d06d5a60da31b450c4b6f1a9dbe02f` (roadmap), `b1e1a24c8c1f613cfed44fa8e63fc62b7e1c6fbf` (prompt), `482569563aae6539652fa99ad563bbb9c60cea11` (index). All three documents fetched back from `main` and their cross-links verified. Tests: not run (documentation-only). Deployment: none. |
| 2026-11-17 | M1 Owner identity and authorization implemented and deployed. | `src/admin/auth.ts`, `src/config/env.ts`, `src/index.ts`, `wrangler.jsonc`, `test/admin-owner-auth.test.ts`, `docs/SECURITY_MODEL.md`, both Owner workspace docs and `docs/README.md` | Code commits: `fa1285b027b5debcc072818d20e5df7f82947bbd` and `f672177761c1f933186eb143aadba91fa123158c`. Release workflow [44131054109](https://github.com/ashini-x/parmar-ai/actions/runs/44131054109): success. Passed `npm run check`, `npm test`, `npm run test:node`, three Worker dry-runs, paired production deploy, production smoke test and release acceptance. Rollback was not needed. Authenticated browser login was not manually smoke-tested from this session. |
| 2026-11-17 | Resolved production Error 1101 on the Owner login path and deployed the fix. | `src/analytics/db.ts`, `src/index.ts`, `test/worker.test.ts`, `test/telegram-bot-store-schema.test.ts`, `test/brvin-admin-script.node.test.ts`, both Owner workspace docs, `docs/SECURITY_MODEL.md` and `docs/README.md` | Cloudflare Ray `a5c06d999bd6cc0f` identified `POST /admin/login` failing because an in-flight module-global schema Promise crossed Worker request contexts. Fix commits: `4762f014f2352aa0799c85c9fb4899235b7bbfb8`, `09e0eb600bd79b4e8ad827bd4aae527493e7b028`, `fb7bbb101d422939a4cc074564a96faf82cda34c`, `8253a1dafc6fbc919324423f7c7bd79e360b5df7`. Final workflow [44139900378](https://github.com/ashini-x/parmar-ai/actions/runs/44139900378): success. Passed typecheck, 466 Vitest tests, Node-specific tests (62 tests), all three Worker dry-runs, paired production deploy, production smoke test and release acceptance. No rollback. A real-credential browser sign-in was not manually executed from this session. |
| 2026-11-17 | M2 Owner Intelligence workspace and conversation persistence implemented and deployed. | `src/admin/intelligence.ts`, `src/index.ts`, `test/admin-owner-intelligence.test.ts`, and Owner workspace, data, security, API, privacy and test documents. | Runtime commits include `6333912746610c31ac963b78f7747b9b780589a9`, `cf04645b384a232a1f33f2fb1891139cc0b0f245`, `e424b49fa96977bffd3c60e4e63a176bd8c53cde`, `43bca853efa98039ffb0d1ca20fe122844ad18db`, final source `dd5d1ec6b0f9ccbe61facf0ed0cfa4c11ef21d25`; test coverage commits `b76fb634e6dcae1dea8bd8568ab2bc69f2e09aa6` and `7c162d5f2aec944db02d8e6b819dbe6f0018115d`. Production workflow [44145644996](https://github.com/ashini-x/parmar-ai/actions/runs/44145644996): success. Typecheck passed; 470 Vitest tests and 62 Node tests passed; all three Worker dry-runs passed; both Workers deployed; production smoke and release acceptance passed. No rollback. Authenticated manual browser walkthrough was not performed. |
| 2026-11-18 | M3 Vertex model catalogue, Owner model selector and provider eligibility hardening. | `src/admin/intelligence-provider.ts`, `src/admin/intelligence.ts`, `test/admin-owner-intelligence-provider.test.ts`, `test/admin-owner-intelligence.test.ts`, and the Owner workspace, API, security, AI and test documents. | Initial provider deployment: commit `75be2818b1688f7e70745cb3560ed8c7c56ec6b2`, workflow [44153429958](https://github.com/ashini-x/parmar-ai/actions/runs/44153429958), success. Follow-up source commit `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`, production workflow [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057), success on 2026-11-17. `npm run check` passed; `npm test` passed 478 tests across 72 files; `npm run test:node` passed 62 tests across 9 files; private BRVIN, Parmar AI and standalone BRɅIN website Worker dry-runs passed. Paired production deployment, root/health smoke checks, BRVIN service binding, Fatman retrieval readiness and production release acceptance all passed. No rollback was needed. Deployed Worker versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`; `parmar-ai` `add293a6-6489-400b-996f-168034203058`. Production release manifest uploaded as artifact `14362111251`. A real authenticated Owner-session catalogue check has not yet been performed. |

### Required update after every feature task

Before closing any implementation task, update all applicable entries below:

1. **Milestone table:** status, completed scope, remaining acceptance criteria and next milestone.
2. **Current checkpoint:** in-progress/next task, implementation state, deployed state and current commit/workflow evidence.
3. **Task log:** date, task, changed files, tests, deployment outcome and commit SHA.
4. **Decisions:** add or amend an ADR when architecture, security, storage, model, API or UX decisions change.
5. **Model compatibility:** update the current catalogue/API/thinking compatibility notes when provider behaviour changes; record the source and verification date.
6. **Testing:** list actual tests run and results. Never claim unrun tests passed.
7. **Known issues:** add unresolved failures, deferred work or operational risks.
8. **Continuation prompt:** update `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md` so it points to the actual next task and current checkpoint.
9. **Documentation index:** update `docs/README.md` if a new active feature document or source-of-truth document is added.

A task is not complete until the relevant code/test/deployment work and these documentation updates are committed together (or in an immediately following documentation commit that is explicitly linked to the implementation commit).

## 8. Verification checklist for the overall feature

- [ ] Anonymous visitor cannot load workspace UI or use any workspace API.
- [ ] Authenticated non-owner admin cannot load workspace UI or use any workspace API.
- [ ] Owner can enter using the existing admin sign-in journey.
- [ ] Client-side role tampering cannot elevate access.
- [ ] Session expiry, logout and credential/role revocation prevent further access.
- [ ] Owner messages, files and usage do not appear in student records or student analytics.
- [ ] Owner assistant can answer open-ended non-SSC requests without the student prompt/schema.
- [ ] Selected model is confirmed available to this project and location.
- [ ] Thinking options and generation payload are valid for the selected model/API.
- [ ] No silent model or thinking downgrade occurs.
- [ ] Stream interruption, stop, retry and regeneration preserve conversation consistency.
- [ ] Uploads are private, validated, isolated and deletable.
- [ ] BRɅIN context is opt-in and respects project/source authorization.
- [ ] Provider quotas, billing and context limits are communicated accurately.
- [ ] Existing student Telegram, Admin Control Center and BRɅIN admin tests remain green.
- [ ] Production Owner-only smoke tests and rollback procedure are verified.
- [ ] This roadmap and the continuation prompt match the deployed commit.

## 9. Related project documentation

- [Engineering documentation index](README.md)
- [High-level architecture](../ARCHITECTURE.md)
- [Security model](SECURITY_MODEL.md)
- [Data model](DATA_MODEL.md)
- [Data governance](DATA_GOVERNANCE.md)
- [AI pipeline](AI_PIPELINE.md)
- [Test plan](TEST_PLAN.md)
- [Documentation policy](DOCUMENTATION_POLICY.md)
- [Current source: admin authentication](../src/admin/auth.ts)
- [Current source: route authorization](../src/index.ts)
- [Current source: admin dashboard](../src/admin/dashboard.ts)
- [Current source: Worker environment contract](../src/config/env.ts)
- [Continuation prompt](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md)
