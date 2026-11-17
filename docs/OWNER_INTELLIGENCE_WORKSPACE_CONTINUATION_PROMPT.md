# New-chat continuation prompt — BRɅIN Intelligence Owner Workspace

Continue the owner-only **BRɅIN Intelligence** feature in `ashini-x/parmar-ai`.

## Read the source of truth first

1. Read the latest default-branch version of `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`.
2. Read the latest default-branch version of this file: `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`.
3. Read `docs/README.md` and the source/docs relevant to the current milestone.
4. Inspect the latest code, commits and workflow/deployment state. Do not assume this prompt is more current than GitHub. The roadmap is the authoritative feature status and acceptance ledger.

## Product boundary

Build a ChatGPT-like general-purpose AI workspace **inside the existing protected Admin Control Center**. The Owner signs in through the existing admin login. The workspace is owner-only; ordinary admin/operator access must not inherit Owner permissions.

This is separate from the student-facing परमार्थAI Telegram tutor. Do not broaden the student bot beyond SSC GA/GS, and do not change student prompts, quotas, profiles, data or answer contracts as part of this feature.

The Owner should be able to use Gemini models that the configured Vertex AI project/location can actually access, select model-specific supported thinking levels, ask open-ended questions, maintain chat history, stream answers, stop/regenerate/edit prompts, and eventually upload supported files/images/PDFs. BRɅIN knowledge context may be an explicit opt-in, never automatic by default.

Do not describe this as unlimited provider capacity. Do not apply student daily/burst caps to the Owner workspace, but clearly respect Google Cloud quotas, regional/model availability, billing, context and API limits. Never silently downgrade a model or thinking level.

## Current checkpoint (latest source inspected: 2026-11-18)

- M0 — product/architecture/security/milestone baseline: **complete**.
- M1 — explicit Owner identity and authorization: **complete and deployed**.
- M2 — responsive Owner workspace and isolated D1 chat persistence: **complete and deployed**.
- M3 — server-side Vertex Gemini model registry, project/location Count Tokens availability probes, Owner model picker and general-purpose provider adapter: **complete and deployed; first live Owner-session project/location check pending**.
- Initial M3 provider deployment: commit `75be2818b1688f7e70745cb3560ed8c7c56ec6b2`; workflow [44153429958](https://github.com/ashini-x/parmar-ai/actions/runs/44153429958) succeeded and deployed both production Workers.
- Follow-up M3 source commit: `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`. It adds the visible model dropdown, Gemini 3.6 Flash, explicit token-window/output-limit metadata, model-specific non-streaming output caps, and a requirement that a model pass a recent project/location probe before provider generation. Its release workflow is [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057); typecheck, 478 Vitest tests, 62 Node tests and all three Worker dry-runs have passed. Paired production deployment and release acceptance succeeded. Deployed versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`, `parmar-ai` `add293a6-6489-400b-996f-168034203058`. Production release manifest artifact ID: `14362111251`.
- Model catalogue endpoint: `GET /admin/api/intelligence/models` (Owner-only). The server reads the configured project/location and obtains a Google Cloud token using the existing server-side service-account utility. Each centrally allowlisted Gemini model is checked using Vertex `countTokens`; only 2xx makes it selectable. The completed catalogue cache is 90 seconds; maximum concurrency is 3 and per-model timeout is 8 seconds.
- Registry candidates: Gemini 4 Hydrogen, Carbon and Argon; Gemini 3.8, 3.7 and 3.6 Flash; Gemini 3.5 Flash and Flash-Lite. The UI only lists `selectable: true` models. It initially prefers Hydrogen, then 3.8 Flash, then the first available candidate. Selection is page-local until M4 binds it to actual generation.
- Provider module: `src/admin/intelligence-provider.ts`. It has a plain general-purpose Owner adapter, no SSC/student `AnswerPacket` pipeline, no student profile/quota, no automatic grounding, no BRɅIN/Fatman retrieval, and no automatic fallback. It refuses unverified or unlisted models and sanitizes provider failures.
- Thinking and API documentation checked 2026-11-18: [thinking levels](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking), [Gemini 4 limits](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4), [Gemini 3.8 Flash guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash), [Gemini 4 Argon guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon). Thinking metadata is in the registry, but M4 will wire the setting to generation.
- **Live project check still required:** a real authenticated Owner browser session has not loaded `/admin/api/intelligence/models` from production yet. Do not claim a particular candidate is actually enabled for the production project until the picker renders it as verified. Sign in through `/admin/login`, then open `/admin/intelligence`.
- M3 does not yet invoke the provider from the chat composer. Real assistant responses, per-model thinking controls, streaming, stop/regenerate/edit are M4; private files are M5; optional BRɅIN retrieval is M6.
- Production currently maps the existing principal `OWNER_DASHBOARD_USER=admin` to Owner. Sign out and sign in again if using a legacy pre-M1 session. Owner messages remain in dedicated D1 tables and are not mixed with student rows.

**Next action:** complete a real Owner sign-in and inspect the model dropdown's project/location results. Then proceed to M4 — bind the chosen model and its supported thinking level to general-purpose response generation and implement safe streaming/stop/regenerate/edit controls.

Re-read the roadmap for the full acceptance ledger, completed tasks and production deployment revisions before making further changes.

## Non-negotiable implementation discipline

- Before every task, inspect the latest default branch and relevant source files. At minimum, understand `src/admin/auth.ts`, `src/index.ts`, `src/admin/dashboard.ts`, `src/config/env.ts`, `src/ai/gemini.ts`, `src/analytics/db.ts`, plus the security/data/AI/test documents as relevant. For M2, begin from the deployed M1 role gate; do not rewrite or bypass it.
- The current code has `requireAdmin` and a separate `requireOwner`. Do not rely on a hidden UI link or client-supplied role. The deployed M2 page and conversation APIs already enforce `requireOwner`; preserve that guard on all M3+ model, generation, stream, stop, file and retrieval endpoints. Every data operation must remain scoped to the configured Owner principal, and mutations must retain same-origin checks.
- M2 stores Owner conversations/messages in dedicated `owner_intelligence_conversations` and `owner_intelligence_messages` tables. Keep later file references, model usage and generations separate too; never write Owner prompts to student analytics, profiles, quiz history or Durable Object state.
- Use server-side credentials only. Never expose service-account keys, Vertex access tokens, session secrets or uploaded-object credentials to the browser.
- Make model availability and thinking compatibility server-authoritative and project/location-aware. Verify current Google documentation and the actual configured project before enabling a model. Do not hardcode a stale model catalogue or present a global model list as guaranteed access.
- Do not use student SSC prompts, `AnswerPacket`, student classification, Fatman context or automatic BRɅIN retrieval for general Owner messages.
- Preserve current Admin Control Center, BRɅIN admin and student Telegram behaviour unless a task explicitly requires a reviewed change.
- Run the relevant tests; report exact evidence. Do not claim unrun tests or deployment.
- Deploy only when the task/request authorizes deployment and the repository's release discipline is met.

## Mandatory living-documentation rule

**After each completed task for this feature, update the roadmap and this prompt in the same task/release.** Update:

1. Milestone status and acceptance criteria.
2. Current checkpoint and exact next task.
3. Completed task log, changed files and commit SHA.
4. Architecture decisions/ADRs and security/data/model notes when changed.
5. Actual tests and their pass/fail results.
6. Deployment state, deployed revision and workflow URL/result when applicable.
7. Known issues, deferred work and rollback notes.
8. This continuation prompt's current checkpoint and next action.
9. `docs/README.md` whenever the documentation index needs to change.

Never mark a task or milestone complete based only on a plan, a mock UI, a local screenshot or type-checking. For production tasks, verify the deployed behaviour and record the evidence. If code is completed but docs are not updated, the task is not complete.

## How to continue

Read the roadmap and determine the first incomplete milestone. Work on the smallest coherent task within that milestone. Do not jump ahead or re-ask for decisions already accepted in the roadmap. If a decision genuinely blocks implementation, explain the conflict and propose a safe default rather than silently changing the approved architecture.

When you finish the task:
- update the roadmap's milestone, task log, decisions, tests and checkpoint;
- update this prompt to match the new current checkpoint;
- update the docs index if needed;
- commit the implementation and documentation changes;
- report what changed, tests run, commit, workflow/deployment status, and the next milestone.

**Roadmap:** `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`  
**Continuation prompt:** `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`
