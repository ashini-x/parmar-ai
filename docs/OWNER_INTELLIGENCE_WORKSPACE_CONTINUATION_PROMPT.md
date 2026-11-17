# New-chat continuation prompt — Owner Gemini Intelligence

Continue the owner-only **Owner Gemini Intelligence** workspace in `ashini-x/parmar-ai`.

## Read the source of truth first

1. Read the latest default-branch version of `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`.
2. Read the latest default-branch version of this file: `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`.
3. Read `docs/README.md` and the source/docs relevant to the current milestone.
4. Inspect the latest code, commits and workflow/deployment state. Do not assume this prompt is more current than GitHub. The roadmap is the authoritative feature status and acceptance ledger.

## Product boundary

Build a private, general-purpose Gemini workspace **inside the existing protected Admin Control Center**. The Owner signs in through the existing admin login and chooses the Gemini model they want from the models the configured Vertex AI project/location can actually invoke.

This is separate from the student-facing परमार्थAI Telegram tutor. Do not broaden the student bot beyond SSC GA/GS, and do not change student prompts, quotas, profiles, data or answer contracts as part of this feature.

The Owner can interact in two ways:
- Type a prompt in the chat box.
- Speak through a dictation control; speech is transcribed into editable text, reviewed by the Owner, and then sent as a normal text message.

Both input routes use the same conversation, selected Gemini model, supported thinking level and text-generation path. The assistant returns text. Do not build Gemini Live, real-time audio/video, speech-to-speech sessions or assistant voice output.

“Full Gemini capability” means open-ended use of the chosen model and selectively exposed API capabilities that are useful and actually supported by that model/API/project/location. It does not mean consumer Gemini app parity or every Google API/tool. Candidate native tools such as Search grounding, URL context or code execution should be assessed individually and only enabled when useful and verified. BRɅIN retrieval is optional, off by default, and never automatically injected.

Do not describe this as unlimited provider capacity. Do not apply student daily/burst caps to the Owner workspace, but respect Google Cloud quotas, region/model availability, billing, context and API limits. Never silently downgrade a model or thinking level.

## Current checkpoint (latest source inspected: 2026-11-18)

- M0 — product, architecture, security and milestone baseline: **complete**.
- M1 — explicit Owner identity and authorization: **complete and deployed**.
- M2 — responsive Owner workspace and isolated D1 chat persistence: **complete and deployed**.
- M3 — server-side Vertex Gemini model registry, project/location Count Tokens availability probes, Owner model picker and general-purpose provider adapter: **complete and deployed**.
- **M3 live Owner-session check completed:** the Owner supplied a production screenshot on 2026-11-18 showing the model dropdown populated with candidates returned as selectable by the project/location probe. This does not mean every public registry candidate is enabled.
- M3 follow-up source commit: `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`; workflow [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057) succeeded. Deployed versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`; `parmar-ai` `add293a6-6489-400b-996f-168034203058`.
- **M4 implementation deployed:** PR [#320](https://github.com/ashini-x/parmar-ai/pull/320), merged commit `2912d55cde147c48d1cc608b4b318b51487697ba`; workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) succeeded.
- M4 adds model-specific thinking selection, binds it to Vertex `generationConfig.thinkingConfig.thinkingLevel`, streams user-facing text through Owner-only SSE, filters provider thought parts, persists partial responses, supports Stop, Edit/resubmit and Regenerate, and stores model/thinking/token/latency metadata in `owner_intelligence_generation_metadata`.
- **M4 model-catalogue loading fix deployed:** PR [#322](https://github.com/ashini-x/parmar-ai/pull/322), merge commit `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`; workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) succeeded. Google access-token acquisition is bounded at 12 seconds and each project/location Count Tokens probe at 8 seconds, enforced with Promise-level timeout and abort. The browser fetch is bounded at 45 seconds and displays a Retry control on retryable failure/no verified models instead of staying at “Checking models…”.
- **M4 chat UX and pre-generation latency improvement deployed:** PR [#327](https://github.com/ashini-x/parmar-ai/pull/327), merge commit `dff54f783d660c7ac397b6f6670b7eee92ecaf98`; PR validation [44188012230](https://github.com/ashini-x/parmar-ai/actions/runs/44188012230) and production workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed. User messages now use familiar bubbles, assistant replies use response cards, model/thinking badges are visible, and completed replies have a green status badge plus response time/token metadata when returned. During generation, an activity card reports sending, Vertex accepted/waiting for first visible token, streaming, stopped or failed. It shows no hidden chain-of-thought or raw thought tokens. If the catalogue cache expires, generation re-verifies only the selected model and reuses that access token rather than probing the full registry. Validation: 485 Vitest tests across 72 files, 62 Node tests across 9 files, TypeScript and all three Worker dry-runs passed. Paired production deploy/acceptance passed. Versions: `brvin-service` `1ce188ed-f48c-4e08-8318-095959aa8f4d`; `parmar-ai` `ca6b3b66-3aa0-4991-8ad3-8bab8646dbdf`; manifest artifact `14375891872`.
- **M4 frontend startup fix deployed:** production telemetry samples showed `/admin/intelligence` returning 200 without subsequent conversation/model API requests. PR [#324](https://github.com/ashini-x/parmar-ai/pull/324), merged commit `df48b707cfc953b68cc6e099818b5c68965e6c58`; workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) succeeded. Client code is now a separately served Owner-protected same-origin asset at `/admin/intelligence.js`; the HTML has no inline app script, and CSP uses `script-src 'self'`. Conversation requests time out after 15 seconds; the sidebar shows a visible retry state, and New chat reports failures instead of silently leaving controls disabled. Tests: 485 Vitest tests across 72 files, 62 Node tests across 9 files, and three Worker dry-runs passed. Production paired deploy and smoke/release acceptance passed. Versions: `brvin-service` `863531a6-add5-44f0-94d1-5753ade79c96`; `parmar-ai` `cebd3677-458f-4860-b191-7c6c18d26bc3`; manifest artifact `14372720383`.
- M4 verification: `npm run check` passed; `npm test` passed **482 tests across 72 files**; `npm run test:node` passed **62 tests across 9 files**; all three Worker dry-runs passed. Paired production deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and release acceptance passed. No rollback.
- M4 deployed versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Release manifest artifact `14367310746`.
- **M4 visual/activity acceptance still pending:** in the authenticated Owner workspace, submit one short prompt and confirm the user bubble, assistant card, chosen model/thinking badges, visible waiting/streaming activity, green Completed tag and response metadata. Compare a low and higher supported thinking setting on the same model only if useful; record the exact model/level and timing, but do not expect or expose an internal reasoning transcript. Verify that Stop still produces a partial saved state. CI and production health do not substitute for this browser observation.
- **Post-fix Owner browser check still pending:** sign in at `/admin/login` and reload `/admin/intelligence`. Confirm the browser fetches `/admin/intelligence.js`, the conversation API returns and populates the sidebar, and the model API either populates verified models or shows its failure/Retry state. Confirm New chat creates and selects a conversation and the composer becomes clickable. Then send a short typed prompt and verify selected model/thinking, streamed output, Stop/partial retention, Edit/resubmit and Regenerate. No authenticated browser verification was performed from the deployment workflow.
- **M4 browser acceptance still pending:** no real billed Owner prompt has yet been sent from the authenticated production browser. Sign in at `/admin/login`, open `/admin/intelligence`, choose a verified model and thinking level, send a short typed prompt, verify the response/model/level, then test Stop/partial retention, Edit/resubmit and Regenerate. Keep M4 open until verified.
- **Known deferred M4 capability:** automatic in-place SSE reconnection is not implemented. Saved partial text can be reopened and manually regenerated; do not claim automatic resume.
- **Next action:** finish the post-fix authenticated browser startup check (script + conversation API + models API + New chat + clickable composer), then complete real typed Gemini generation acceptance for M4. Only after that move to M5, which is voice dictation to editable text—not Gemini Live.
- **Approved forward milestones:** M5 voice dictation; M6 selected-model/useful Gemini API tools only where compatible (for example Search grounding, URL context or code execution after verification); M7 Owner usage/cost visibility; M8 full security, quality and production acceptance. BRɅIN context remains a separate optional add-on outside this sequence.
- **Scope explicitly excludes:** Gemini Live, real-time voice/video, speech-to-speech, assistant voice output, image/video/audio generation, computer-use/MCP by default, and required file/image/PDF uploads. Do not add these without a separate Owner-approved scope change.
- Production maps `OWNER_DASHBOARD_USER=admin` to the Owner role. Sign out and sign in again if using a legacy pre-M1 session. Owner records remain separate from student data.

Re-read the roadmap for the full milestone ledger, architecture decisions, completed task evidence and production revisions before doing more work.

## Non-negotiable implementation discipline

- Before every task, inspect the latest default branch and relevant source files. At minimum, understand `src/admin/auth.ts`, `src/index.ts`, `src/admin/dashboard.ts`, `src/config/env.ts`, `src/ai/gemini.ts`, `src/analytics/db.ts`, plus the security/data/AI/test documents as relevant. For M2, begin from the deployed M1 role gate; do not rewrite or bypass it.
- The current code has `requireAdmin` and a separate `requireOwner`. Do not rely on a hidden UI link or client-supplied role. The deployed M2 page and conversation APIs already enforce `requireOwner`; preserve that guard on all model, generation, stream, stop, transcription and optional retrieval/tool endpoints. Every data operation must remain scoped to the configured Owner principal, and mutations must retain same-origin checks.
- M2 stores Owner conversations/messages in dedicated `owner_intelligence_conversations` and `owner_intelligence_messages` tables. Keep any future transcription-job metadata and model usage/generation records separate too; never write Owner prompts to student analytics, profiles, quiz history or Durable Object state.
- Use server-side credentials only. Never expose service-account keys, Vertex access tokens, session secrets or uploaded-object credentials to the browser.
- Make model availability and thinking compatibility server-authoritative and project/location-aware. Verify current Google documentation and the actual configured project before enabling a model. Do not hardcode a stale model catalogue or present a global model list as guaranteed access.
- Do not use student SSC prompts, `AnswerPacket`, student classification, Fatman context or automatic BRɅIN retrieval for general Owner messages.
- Keep typed messages and reviewed voice transcripts on one Owner text-generation path. Never make Gemini Live or voice output an architectural dependency.
- Do not add Google tools, model modalities, file uploads or external integrations solely for feature parity. Validate that a capability is useful and supported by the exact selected model/API/project/location before implementing it.
- Voice transcription is not assistant conversation: transcription provider choice is an M5 design decision. Compare browser support and privacy/quality/cost before choosing; raw audio is not retained by default.
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
