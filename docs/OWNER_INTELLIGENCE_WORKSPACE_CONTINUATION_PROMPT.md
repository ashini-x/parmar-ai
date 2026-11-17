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

## Current checkpoint (latest verified: 2026-11-17)

- M0 — product/architecture/security/milestone baseline: **complete**.
- M1 — Owner identity and authorization: **complete and deployed**.
- M2 — responsive Owner workspace and chat persistence: **complete and deployed**.
- Latest deployed source: `dd5d1ec6b0f9ccbe61facf0ed0cfa4c11ef21d25`; workflow [44145644996](https://github.com/ashini-x/parmar-ai/actions/runs/44145644996) succeeded.
- Production Worker versions: `brvin-service` = `742f4710-799c-444e-97a6-780cd2873e7a`; `parmar-ai` = `33969d3d-52f8-402d-be89-ce83f8495e35`. Root, health, BRVIN service binding and Fatman readiness checks passed; no rollback was needed.
- M2 added responsive dark `/admin/intelligence`, conversation history, New chat, reopen, rename and delete. The composer saves Owner-authored messages and reloads them from D1.
- Dedicated D1 tables: `owner_intelligence_conversations` and `owner_intelligence_messages`. All queries are scoped to the normalized configured Owner username. Deleting a conversation deletes its messages. No automatic retention cleanup or bulk-delete facility exists yet.
- Owner-only APIs: `GET/POST /admin/api/intelligence/conversations`; `GET/PATCH/DELETE /admin/api/intelligence/conversations/:id`; `POST /admin/api/intelligence/conversations/:id/messages`. Mutations require a same-origin Origin header.
- The composer persists user messages only. Gemini answers, model catalogue, thinking levels, streaming, stop/regenerate/edit, uploads and optional BRɅIN retrieval are **not implemented**. Do not imply that this workspace already generates AI replies.
- Verification: `npm run check`; `npm test` (71 files / 470 tests); `npm run test:node` (9 files / 62 tests); three Worker dry-runs; paired production deployment; smoke test and release acceptance — all passed.
- Production maps the existing single admin principal to Owner with `OWNER_DASHBOARD_USER=admin`; sign out and sign back in if using a pre-M1 session. A real-credential browser walkthrough was not performed.
- Known M2 limitations: Owner chats remain until individually deleted. Changing `OWNER_DASHBOARD_USER` requires a deliberate `owner_id` migration; password rotation does not change that scope.
- **Next milestone: M3 — Vertex AI model registry and general-purpose Owner provider adapter.** Inspect existing Vertex authentication utilities and verify model IDs against the configured project's actual access/location. Do not reuse the student answer pipeline or prompt.

Re-read the roadmap for the full acceptance ledger and implementation history before changing code.

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
