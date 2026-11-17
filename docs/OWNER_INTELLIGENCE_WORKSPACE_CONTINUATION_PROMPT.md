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
- M3 — server-side Vertex Gemini model registry, project/location Count Tokens availability probes, Owner model picker and general-purpose provider adapter: **complete and deployed**.
- **M3 live Owner-session check completed:** the Owner supplied a production screenshot on 2026-11-18 showing the model dropdown populated with the candidates returned as selectable by the project/location probe. The UI only renders `selectable: true` catalogue entries; this does not make every public registry candidate available.
- M3 follow-up source commit: `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`; production workflow [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057) passed typecheck, 478 Vitest tests, 62 Node tests, three Worker dry-runs, paired production deployment, root/health/BRVIN/Fatman checks and release acceptance. Deployed Worker versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`; `parmar-ai` `add293a6-6489-400b-996f-168034203058`. Production acceptance artifact: `14362111251`.
- The server-side registry remains authoritative for model thinking support. Google compatibility references checked 2026-11-18: [thinking-level matrix](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking), [Gemini 4 limits](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4), [Gemini 3.8 Flash guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash), [Gemini 4 Argon guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon).
- **M4 implementation is in PR #320:** [feat(admin): complete M4 Owner Gemini thinking and streamed chat](https://github.com/ashini-x/parmar-ai/pull/320), branch `feat/owner-intelligence-m4`. It adds a model-specific thinking selector, Vertex `generationConfig.thinkingConfig.thinkingLevel`, Owner-only SSE response generation, thought-part filtering, incremental partial persistence, Stop/request cancellation, Edit/resubmit, Regenerate and separate `owner_intelligence_generation_metadata` records for model, thinking, token counts and elapsed time.
- M4 regression tests have been added for thinking compatibility, SSE text/usage parsing, thought-part exclusion, Owner route authorization, unsupported thinking levels and edit/regenerate persistence. **CI has not yet been verified, and no M4 production deployment has been performed at this checkpoint.**
- **Known M4 gap:** automatic in-place SSE reconnection is not implemented in this slice. A conversation can be reopened with its persisted partial response; the Owner can retry through Regenerate. Do not claim generation resumes automatically after a lost connection.
- M5 — private files/images/PDFs remains not started; M6 — explicit opt-in BRɅIN context remains not started; M7 — Owner observability/cost controls remains not started.
- Production still maps `OWNER_DASHBOARD_USER=admin` to the Owner role. Sign out and sign in again if using a legacy pre-M1 session. Owner records remain separate from student data.

**Next action:** review PR #320's complete diff and automated checks, merge only if CI/release prerequisites pass, and deploy through the repository's paired production workflow. After deployment, verify a real Owner prompt using a chosen model/thinking level, streaming, Stop/partial persistence and Edit/Regenerate in the production browser. Keep M4 open until the remaining stream-reconnection decision and production acceptance are resolved.

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
