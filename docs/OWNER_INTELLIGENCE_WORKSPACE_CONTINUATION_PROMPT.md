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
- M1 — Owner identity and authorization: **complete and deployed** at `f672177761c1f933186eb143aadba91fa123158c`.
- Production release workflow: [44131054109](https://github.com/ashini-x/parmar-ai/actions/runs/44131054109), conclusion `success`. Typecheck, full Vitest, Node tests, all three Worker dry-runs, paired production Worker deployment, smoke test and release acceptance passed.
- The existing admin login now issues signed `admin` or `owner` session claims. Owner sessions are HMAC-bound to the configured Owner credential, so rotating that credential revokes active Owner sessions. Legacy pre-M1 cookies remain admin-only.
- Production currently has one configured web-admin principal. `wrangler.jsonc` explicitly sets `OWNER_DASHBOARD_USER=admin`, so the current existing admin username/password is also the Owner credential. There is no separate Owner password secret in this deployment. Sign out and sign in again after deployment to receive a new Owner session.
- `/admin/intelligence` is a protected placeholder route; the real workspace UI is not built. `/admin/api/intelligence/*` is an Owner-only reserved namespace with no application handlers yet.
- No conversation database, chat history, Gemini owner pipeline, model catalogue, thinking selector, uploads or BRɅIN context integration is implemented yet.
- **Next milestone: M2 — workspace shell and owner chat persistence.**

Re-read the roadmap for the precise implementation log, acceptance evidence and any changes since this checkpoint.

## Non-negotiable implementation discipline

- Before every task, inspect the latest default branch and relevant source files. At minimum, understand `src/admin/auth.ts`, `src/index.ts`, `src/admin/dashboard.ts`, `src/config/env.ts`, `src/ai/gemini.ts`, `src/analytics/db.ts`, plus the security/data/AI/test documents as relevant. For M2, begin from the deployed M1 role gate; do not rewrite or bypass it.
- The current code has `requireAdmin` and a separate `requireOwner`. Do not rely on a hidden UI link or client-supplied role. Preserve server-side Owner authorization on the page and every future API, stream, stop, file and conversation endpoint. M1 guards `/admin/intelligence` and the reserved `/admin/api/intelligence/*` namespace; M2 must keep those checks when adding handlers.
- Keep Owner conversations, messages, file references and usage separate from student records, Durable Object state, profiles, quiz history and student quota accounting.
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
