# Owner Gemini Intelligence — Product Roadmap

**Status:** M0–M3 complete; M4 implementation deployed with authenticated interaction acceptance pending; M4.1 per-chat 200,000-token lifetime budget merged/deployed with automated production release acceptance passed but authenticated meter/boundary acceptance pending; approved M4.2–M4.8 memory and context-continuity sub-milestones documented only (not implemented); automatic stream reconnection deferred
**Last updated:** 2026-11-18  
**Repository:** `ashini-x/parmar-ai`  
**Product surface:** Existing protected Admin Control Center  
**Working name:** Owner Gemini Intelligence

> This is a separate owner-only feature. It does not replace or broaden the student-facing परमार्थAI Telegram tutor.

## 1. Product goal

Build a private, general-purpose Gemini workspace for the Owner inside the existing protected Admin Control Center. The Owner signs in once, chooses a Gemini model that is actually available to the configured Google Cloud / Vertex AI project and location, and asks open-ended questions without going to Google Cloud Console, AI Studio or a separate Gemini chat interface.

There are two input routes to the same text conversation:

1. **Text chat:** the Owner types into the message box and sends the prompt.
2. **Voice dictation:** the Owner speaks into a microphone control; speech is transcribed into editable text in the message box. The Owner can review, correct, cancel or send that transcript. Once sent, it is an ordinary text message and uses the exact same selected model, thinking setting, conversation history and generation endpoint as typed text.

The product is a direct, model-aware workspace over the Gemini capabilities exposed by the selected model and chosen API surface. It is not a copy of every Google product or the consumer Gemini app. “Full Gemini capability” means the Owner can ask general questions and use applicable model/API features without student-specific restrictions; it does not mean every public model, tool, modality, entitlement or Google product feature is automatically available in this project.

The selected model is the Owner's choice. The application must not silently replace it, downgrade its thinking level, route it to another provider, or force a request into a BRɅIN/SSC workflow. A capability may be offered only when it is useful for the task and verified for the selected model, API version, project and location.

### Product principles

1. **Owner-only:** available only to an explicitly authenticated Owner principal.
2. **Separate from students:** no changes to student Telegram scope, prompts, quotas, profiles, data or answer contracts.
3. **General-purpose:** the Owner can ask about any subject or task; do not impose SSC topics, subject classification, a fixed answer schema or BRɅIN-first retrieval.
4. **Owner chooses the model:** show the project/location-verified Gemini model catalogue and make the chosen model explicit for each generation.
5. **Model-aware settings:** thinking levels, context limits, input types and optional tools are determined by the selected model and API, not by a universal front-end assumption.
6. **One text-generation path:** typed prompts and reviewed voice transcripts become the same text message and use the same conversation/generation pipeline.
7. **Voice means dictation, not a live voice assistant:** transcribe speech to editable text before sending. Real-time Gemini Live sessions, speech-to-speech conversation and assistant voice output are not part of this product scope.
8. **No student-style application cap:** do not apply student daily-question or burst limits to Owner chats. Google Cloud quotas, model availability, billing, context and API limits still apply.
9. **Private by default:** Owner conversations and their metadata remain separate from student records and BRɅIN retrieval data.
10. **Documentation is part of delivery:** every completed task updates this roadmap and the continuation prompt before it is considered complete.
11. **Per-chat usage boundary:** each Owner conversation has an application-enforced cumulative 200,000-token lifetime budget. This is not the model context window or a provider account-wide quota; a new chat has an independent budget and context is carried manually through a GitHub Markdown checkpoint.

## 2. Current repository baseline (verified 2026-11-18)

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

## 3. Target Owner experience

The workspace is reachable from an Owner-only entry in the existing admin panel:

- Admin sign-in: `/admin/login`
- Owner workspace: `/admin/intelligence`
- Owner APIs: `/admin/api/intelligence/*`

### Core interface

- A responsive dark chat workspace inside the existing Admin Control Center.
- New chat, conversation history, reopen, rename and delete.
- Multiline text composer with a clear send action.
- Optional microphone/dictation control beside the composer.
- Voice capture produces a transcript in the composer; the Owner can review and edit it before sending. It must not auto-submit an unreviewed transcript.
- Typed and transcribed messages share the same conversation, model selection, thinking setting, request path, response stream and persistence rules.
- Stream assistant text; support Stop, Regenerate and Edit/resubmit.
- Render ordinary Gemini text responses well, including Markdown, code, tables, maths and long answers.
- Show the selected model and supported thinking level used for each response.
- Surface provider errors, unsupported settings, quota/limit failures and cancellation honestly. Never silently switch models.
- Keep keyboard access, mobile layout and accessible recording/transcription states.

### General-purpose Gemini behaviour

- Do not use the student SSC-only prompt, student classifier, `AnswerPacket`, student profile context, student usage admission or SSC post-processing.
- Let the chosen Gemini model answer open-ended questions in its normal supported request format. Do not require the Owner to choose an academic subject, exam, task category or rigid response schema.
- Keep any minimal Owner system instruction neutral and task-agnostic; do not inject BRɅIN/Fatman context, tool instructions or unrelated project data by default.
- Where the selected API supports useful capabilities such as web grounding, URL context or code execution, evaluate and expose only the capabilities that materially help the Owner's request. Tool use must be transparent, model/API compatible and permission-aware; do not add every available Google tool merely because it exists.
- Do not claim to expose hidden chain-of-thought or private internal reasoning tokens. User-facing explanations, concise reasoning summaries, citations and results are appropriate where supported.

### Gemini model catalogue and thinking selector

Maintain provider-aware metadata on the server rather than a fixed front-end list. For every selectable model, track:

- Provider model ID and display label.
- API surface/version and request format used by this workspace.
- Project/location availability and eligibility.
- Lifecycle state (GA, preview, deprecated, retired), where documented.
- Supported text input/output and any other input modalities deliberately enabled for this workspace.
- Supported thinking/reasoning levels and defaults.
- Context/output limits relevant to the chosen API.
- Optional tool compatibility and request-field constraints.

The server is authoritative. The browser receives only the catalogue approved for this deployment. A public model listing is not proof that this project can invoke that model. Re-check availability and compatibility before enabling new models or API features.

### Voice transcription

Voice is an input convenience only. M5 must select a transcription approach based on actual browser support, quality for the Owner's languages, privacy, latency, cost and Worker-compatible integration. Do not assume that Gemini Live is needed, and do not stream raw microphone audio into the chat-generation endpoint.

The transcript is ordinary text. It must be visible and editable before the Owner sends it. Unless separately approved, do not retain raw audio after transcription; retain the sent transcript as the conversation's user message under the existing Owner data policy.

### Owner usage and resource policy

- Do not apply the student daily question limit, student burst limit, SSC subject scope or student-only thinking ceiling to Owner requests.
- Do not describe the service as technically unlimited. Vertex AI remains subject to project/model quotas, region availability, context limits, billing and provider capacity.
- Record Owner generation usage independently: model, thinking level, returned token counts, latency and status; add cost estimates only where they can be grounded in pricing and usage data.
- Provide understandable usage/cost visibility and configurable budget alerts if useful. An alert is not a hidden student-style per-day cap.
- Never silently downgrade a model, thinking level, provider or API version after an error.

### Optional BRɅIN knowledge context

BRɅIN retrieval is a separate, optional add-on—not the purpose or default context of Owner Gemini Intelligence. Keep it off for ordinary chats. When explicitly enabled, use the approved private BRɅIN service contract, project/source authorization and provenance rules. The general-purpose chat must work fully without BRɅIN retrieval.

## 4. Target architecture and boundaries

`text/voice input
      |
      +-- typed text -------------------------+
      |                                       |
      +-- microphone -> transcription -> review/edit
                                              |
                                              v
                                  Owner text conversation
                                              |
                                  Owner-only API + D1 store
                                              |
                                  selected Gemini model/API
                                  + selected thinking level
                                              |
                                streamed text response
                                              |
                                Owner D1 response/metadata

                     optional, explicit BRɅIN context
                     (separate add-on; off by default)

                     optional Gemini API tools
                     (only when relevant and verified)`

Preserve these boundaries:

- **Identity:** establish the Owner principal server-side from the signed admin session. Never trust a browser-supplied role.
- **Authorization:** every conversation read/write, model-list, generation, stop, transcription, tool and delete operation must recheck Owner authorization. Mutations retain same-origin protections.
- **Storage:** Owner conversations/messages and generation metadata remain in dedicated Owner records. Do not store Owner prompts in student questions, profiles, Durable Object state or quiz records.
- **Transcription:** protect mic capture and transcription with Owner authorization, input-size/time limits and clear browser permission states. Do not store raw audio unless a separate retention requirement is explicitly approved.
- **Model credentials:** keep Google service-account credentials and access tokens server-side.
- **Request path:** use one general-purpose Owner text-generation path for typed text and reviewed transcripts. Reuse only low-level safe Vertex transport utilities; never reuse the student-specific prompt, `AnswerPacket`, answer classifier or SSC post-processing.
- **Model selection:** send the exact verified model selected by the Owner and its supported thinking setting. No automatic model/provider fallback.
- **Tools:** treat native Gemini tools as optional request capabilities, not mandatory global middleware. Validate tool/model/API compatibility server-side. Any tool that performs an external or sensitive action requires a separate explicit authorization/confirmation design.
- **BRɅIN retrieval:** separate, opt-in and provenance-preserving. No implicit student or unrelated tenant data access.
- **Audit:** record security-relevant actions without logging secrets, raw audio or unnecessary prompt content.
- **Failure handling:** handle provider 429/5xx, model unavailability, timeouts, disconnects, cancellation and partial streams without losing already-saved turns or showing false success.
- **Privacy:** define retention/deletion for conversations and transcripts. Keep data out of Git and ordinary application logs.

### Approved long-session continuity architecture (documentation-approved; not implemented)

The approved design is specified in [OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md). It extends the current D1-backed chat and M4.1 token ledger; it does not replace them.

- D1 remains canonical for complete live conversations, messages, per-chat token usage/reservations, topic metadata and memory-job state.
- GitHub becomes the versioned, curated project-memory store only after a dedicated server-side GitHub App integration is implemented. It is not a replacement for D1 transcripts and the existing ChatGPT GitHub connector is not a production Worker credential.
- A Scratchpad is the default for New Chat. Attaching project memory is optional. Saving to GitHub is an explicit preview-and-confirm action.
- Prompt construction becomes token-aware: retain useful recent turns, add only manifest-selected project memory, and retrieve older exact D1 messages on demand. Every final prompt must be counted for the selected model/API before prompt mutation is committed.
- Keep the existing 200,000-token cumulative conversation budget and its reservation/settlement semantics. Rollover creates a new conversation with a separate budget and an explicit, provenance-rich handoff.
- Context caching and semantic indexing are optional optimizations, never correctness dependencies. Enable them only after exact model/API support, privacy isolation, cache lifetime, pricing and measured benefit are verified.
- No R2, KV, Vectorize or Workers AI resource is a prerequisite for M4.2–M4.8. Reinspect the live Cloudflare account before proposing any binding/resource change; the last account inspection found R2 not enabled, no KV namespaces and no Vectorize indexes.

The continuity extension is nested under M4 so M5–M8 retain their original meaning and acceptance criteria. Its implementation is gated behind the still-pending authenticated M4/M4.1 production acceptance listed below.

## 5. Milestones and acceptance criteria

M0–M4 preserve the verified implementation history. The forward plan is intentionally focused on a powerful text-first Owner assistant rather than cloning every Google product surface.

| Milestone | Scope | Acceptance criteria | Status |
|---|---|---|---|
| **M0 — Product and architecture baseline** | Define owner-only scope, existing admin baseline, trust boundaries, model/thinking registry, data boundaries, delivery workflow and handoff. | Roadmap and continuation prompt committed; implementation state accurately recorded; docs index updated. | **Complete — documentation only** |
| **M1 — Owner identity and authorization** | Add explicit Owner identity/role to the existing admin sign-in/session flow. Protect the Owner route and API namespace server-side. | Owner signs in through `/admin/login`; non-Owner admins and forged role claims are denied; session expiry/logout and credential rotation work; authorization tests and production acceptance pass. | **Complete — deployed** |
| **M2 — Workspace shell and chat persistence** | Deploy the Owner-only responsive workspace and isolated D1 conversations/messages; implement new chat, history, reopen, rename and delete. | Every route/API is Owner-only; Owner messages persist across reload; records are scoped to the configured Owner; same-origin mutation protection and student-flow regression checks pass. | **Complete — deployed** |
| **M3 — Gemini model catalogue and provider adapter** | Build a server-side model allowlist, project/location eligibility checks, Owner model selector and a separate general-purpose Gemini provider adapter. | Only project/location-verified models are selectable; model/API metadata is server-controlled; provider errors remain explicit; no student prompt/contract or silent fallback is used. | **Complete — deployed; model picker observed in production** |
| **M4 — Thinking controls and text response lifecycle** | Map each model to supported thinking settings; stream Owner text responses; support Stop, Regenerate and Edit/resubmit; persist partial/final state and generation metadata. | Selected model/thinking setting reaches Vertex correctly; SSE streams user-facing text only; Stop retains a truthful partial response; Edit/Regenerate preserve turn order; metadata is Owner-scoped. A real billed Owner browser acceptance remains outstanding. Automatic in-place stream reconnection remains deferred. | **Implementation deployed; authenticated Owner acceptance pending; reconnection deferred** |
| **M4.1 — Per-chat token budget and manual checkpoint handoff** | Enforce an independent 200,000-token cumulative lifetime budget per Owner conversation; count the exact Vertex prompt before committing changes; reserve prompt + output capacity; settle actual usage; display usage and the manual GitHub Markdown continuation instruction. | Server-side D1 accounting blocks over-budget and concurrent requests before prompt persistence; Vertex usage settles the reservation or missing usage is charged conservatively; new chats receive fresh budgets; old chats backfill available recorded totals; Owner sees used/reserved/remaining and read-only state; no auto-import of GitHub context. | **Merged and deployed; PR checks and paired production release acceptance passed; authenticated Owner meter/boundary browser acceptance pending** |
| **M4.2 — Scratchpad and topic foundation** | Add D1-backed topics and session lifecycle metadata; New Chat defaults to Scratchpad; project attachment is optional. | Existing chats migrate reversibly; Owner scoping is preserved; scratchpads survive device/browser changes; no silent expiry/deletion; project association and pinned revision are explicit. | Approved; not started |
| **M4.3 — GitHub authorization and Save to GitHub** | Add a dedicated server-side GitHub App installation flow for Owner-selected repositories, then a preview/confirm save that writes concise Markdown project memory. | Narrow repository Contents permissions; credentials remain server-side; multi-file updates are atomic/conflict-aware; saved commit is read back/verified before showing Synced; D1 transcript remains intact. | Approved; not started |
| **M4.4 — Attach and load Project Memory** | Add an optional project selector and a manifest that allowlists active memory files; load a pinned Git commit snapshot into a new chat. | Only active manifest-selected files load by default; old session notes/archive are on-demand; effective prompt is CountTokens-checked for the selected model/API; project context is clearly distinguished from the new chat's 200K usage meter until actually sent. | Approved; not started |
| **M4.5 — Automatic rollover and handoff** | Warn at 180K cumulative tokens; offer Roll Over at 190K (with an optional urgent 195K state); preserve the old chat and create a new linked chat with fresh budget. | Thresholds use committed plus in-flight reserved usage; handoff includes goal, locked decisions, technical/file state, blockers and next step with D1 message provenance; GitHub sync is verified before Synced; if GitHub is unavailable, handoff is retained in D1 and sync remains pending; 200K server lock remains authoritative. | Approved; not started |
| **M4.6 — Token-aware context builder and historical recall** | Replace character-only context selection with exact token-aware assembly; retrieve older exact D1 turns when relevant, using lexical/FTS search first. | Count the complete effective request for the selected model/API; fit history and selected project memory within the request's real context/output limits; summaries retain source message IDs; exact source turns can be opened; no 100% recall claim; semantic indexing is benchmark-gated. | Approved; not started |
| **M4.7 — Compact Memory and Fork Chat** | Add previewable memory compaction and isolated child conversations with independent budgets. | Warn when active project memory exceeds 40K measured tokens; compact toward a 10K-token master only where sufficient; archive originals in the same versioned commit; preserve provenance; forks pin the same memory revision, retain parent history, and do not alter main project memory until explicit save/merge. | Approved; not started |
| **M4.8 — Measured caching and retrieval optimization** | Evaluate stable prompt prefixes, Vertex implicit/explicit context caching and optional semantic retrieval against real Owner workloads. | Verify support for the exact selected model, API surface, region, token thresholds and TTL; isolate cache data per Owner/project/session; measure hit rate, latency and cost before enabling; retain uncached fallback; never change model or weaken authorization. | Approved; not started |
| **M5 — Voice dictation to editable text** | Add a microphone input that transcribes speech into the existing text composer. The transcript is reviewed/edited and manually sent through the exact same Owner chat path as typed text. | Owner-only capture/transcription; explicit mic permission and clear recording/error states; transcript is editable before send; cancel/retry works; supported language/quality is tested; raw audio is not retained by default; the sent transcript persists as an ordinary user text message. Do not implement Gemini Live, voice-to-voice sessions or assistant speech output. | Not started |
| **M6 — Relevant Gemini API capabilities** | Evaluate and selectively integrate only native Gemini capabilities that materially improve general Owner requests, such as Google Search grounding/citations, URL context or code execution, where supported by the selected model/API and configured project. | A server-owned compatibility map records model/API/project/location support; each enabled tool is useful, transparent and tested; the selected model is preserved; results/citations are shown where returned; disabled/unsupported tools are not sent. No broad tool catalogue is added just for parity. External or sensitive actions require separate explicit confirmation and are not part of this milestone by default. | Not started |
| **M7 — Owner usage and cost visibility** | Provide separate usage visibility for model, thinking level, tokens, latency, errors and defensible cost estimates/alerts. | Owner data is separate from student analytics; estimates are labelled; Google quotas/billing are explained; alerts are testable; no student-style daily or burst cap is added. | Not started |
| **M8 — Security, quality and production acceptance** | Complete cross-feature privacy, authorization, prompt-boundary, transcription, model/API compatibility, streaming, usage and regression checks. | Real authenticated Owner journey passes for typed chat and voice dictation; model selection/thinking are honoured; Stop/Edit/Regenerate work; tool behaviour is verified when M6 is enabled; student Telegram, Admin Control Center and BRɅIN admin remain unchanged; production revision and rollback evidence are recorded. | Not started |


### M4 continuity execution gate and ordering

The new M4.2–M4.8 rows are approved design work, not implemented capabilities. Do not start them ahead of the already-open production acceptance:

1. Finish the outstanding authenticated M4 interaction checks: Stop/partial retention, Edit/resubmit, Regenerate, and the waiting/streaming activity transitions. Automatic in-place stream reconnection remains explicitly deferred.
2. Finish M4.1's authenticated usage-meter refresh, in-flight reservation display and exact 200,000-token hard-boundary check.
3. Then implement M4.2 through M4.8 in order, updating this roadmap and the continuation prompt at every task.
4. Only after this M4 continuity sequence, return to the unchanged original M5 voice-dictation milestone, then M6–M8 as already defined.

The numbering is deliberately nested under M4. It does not mark M4 complete, change M5–M8 scope, or convert any approved future design into shipped product behaviour.

### Optional add-on — BRɅIN knowledge context (outside the core milestone sequence)

BRɅIN retrieval may be added only when explicitly enabled by the Owner. It must remain off by default and cannot be a precondition for ordinary Gemini chat or voice-dictated questions. Implementation must use the approved private BRɅIN contract, authorization and provenance rules.

### Deferred / not in the approved baseline

- Private file and image/PDF uploads.
- Gemini Live or real-time audio/video sessions.
- Speech-to-speech conversation or assistant voice output.
- Image, video or audio generation.
- Computer use, MCP servers and generic external-action integrations.
- Consumer Gemini app feature parity or an attempt to mirror every Google Cloud console capability.

These are not implicit milestones. Add a separate milestone only after a concrete Owner need is approved and the relevant model/API/project support is verified.

### Milestone completion rule

A milestone is complete only when its acceptance criteria are satisfied by code and test evidence. A UI mock, local-only result, documentation statement or passing type check alone is not enough. Production milestones also require the intended deployment to succeed and the deployed behavior to be verified.

## 6. Non-goals and explicit exclusions

Unless separately approved, this feature does not:

- Turn the student Telegram bot into a general-purpose chatbot or change its SSC scope, prompts, quotas, profiles, data or answer contracts.
- Give teachers, ordinary operators or other admin users Owner access.
- Reuse student conversation/profile data as automatic Owner context.
- Automatically inject Fatman or BRɅIN passages into ordinary Owner questions.
- Implement Gemini Live, real-time voice/video, speech-to-speech interaction or assistant voice output.
- Generate images, video or audio, or add computer-use/MCP/general-purpose external-action surfaces by default.
- Require file/image/PDF uploads in the initial product.
- Claim parity with every feature in the consumer Gemini app or Google Cloud Console.
- Expose provider secrets, private reasoning traces or internal authentication state.
- Promise unlimited provider capacity, zero billing or models the configured Vertex project cannot access.
- Silently switch models, thinking levels, providers or API versions after a failure.

## 7. Living implementation ledger

This section is the current source of truth for this feature's progress. Update it with every completed implementation task.

### Current checkpoint

- **Completed and deployed:** M0 product/architecture baseline; M1 Owner identity and authorization; M2 Owner workspace shell and chat persistence; M3 Vertex model registry/provider adapter and production model-picker verification; M4 model-aware thinking control and streamed text generation implementation.
- **M4.1 implementation (PR #335):** 200,000 cumulative tokens per conversation, not per browser session or model context window. Exact Vertex CountTokens preflight runs before new/edit/regenerate prompt mutations; the Worker reserves the prompt count plus up to 8,192 permitted output tokens in D1, and caps the generation's `maxOutputTokens` to that allowance. Final accounting uses Vertex `usageMetadata.totalTokenCount`; missing final usage conservatively charges the full reservation. Legacy conversations backfill from recorded assistant `total_tokens`; a new chat starts at zero. The client displays used/reserved/remaining plus a GitHub Markdown checkpoint reminder and makes exhausted chats read-only. The handoff is manual: no GitHub read/import endpoint exists. Merged as `109e21b155b794ec2ac1cc29274d5513e56c6762` via PR [#335](https://github.com/ashini-x/parmar-ai/pull/335). Final PR validation [44221814569](https://github.com/ashini-x/parmar-ai/actions/runs/44221814569) passed `npm run check`, 494 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44222082173](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman retrieval readiness and release acceptance. `parmar-ai` version `e94b142b-5ddf-448e-a51b-0c9709bfb7f1` (deployment `52ca8f91-2fd3-4c8f-8b17-3903d9eb03ff`) and `brvin-service` version `44547ea0-830e-41f8-97cb-95594959cae2` (deployment `50e181b9-a36e-4e5f-b7bf-209a0f17d42d`) are each at 100% traffic. Release manifest artifact [14391366648](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173/artifacts/14391366648). Automated production release checks passed; authenticated Owner browser acceptance of the meter and hard 200,000-token boundary remains a manual follow-up.

- **Approved M4.2–M4.8 continuity extension (documentation-only, 2026-11-18):** the design now covers Scratchpad/topic lifecycle, server-side GitHub App auth and explicit Save to GitHub, manifest-selected Project Memory snapshots, token-aware context assembly and exact historical recall, rollover/handoff at 180K/190K ahead of the existing 200K hard limit, versioned compaction/forking, and model-specific measured caching. None of these capabilities is implemented yet. D1 remains the full transcript and usage system of record; GitHub stores curated, versioned project memory. No R2/KV/Vectorize/Workers AI provisioning is approved or required. The first M4.2 task remains blocked on the outstanding M4/M4.1 authenticated production acceptance above. See [memory/context architecture](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md).

- **M3 live verification:** on 2026-11-18 the Owner supplied a production screenshot showing the model selector populated with project/location-verified candidates. The UI only displays catalogue rows with `selectable: true`; do not infer that unlisted candidates are enabled.
- **M4 production release:** merged commit `2912d55cde147c48d1cc608b4b318b51487697ba`, PR [#320](https://github.com/ashini-x/parmar-ai/pull/320), workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) succeeded. Typecheck passed; `npm test` passed 482 tests across 72 files; `npm run test:node` passed 62 tests across 9 files; all three Worker dry-runs passed. Paired production deploy, root/health smoke checks, BRVIN service binding, Fatman readiness and release acceptance passed. Versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Manifest artifact `14367310746`. No rollback was needed.
- **M4 implementation:** selected-model thinking control, Vertex `generationConfig.thinkingConfig.thinkingLevel` binding, Owner-only SSE text generation, thought-part filtering, incremental partial persistence, Stop/request cancellation, Regenerate, Edit/resubmit and the dedicated `owner_intelligence_generation_metadata` table are deployed.
- **M4 model-catalogue loading fix deployed:** PR [#322](https://github.com/ashini-x/parmar-ai/pull/322), merged commit `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`; production workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) passed. The server now bounds Google token acquisition to 12 seconds and each Count Tokens probe to 8 seconds with a Promise-level timeout/abort. The browser request has a 45-second timeout, clears the loading state, and shows a Retry control for retryable failures or when no model verifies. Composer state is refreshed after catalogue success/failure. A fresh authenticated Owner browser check after this deployment is still pending.
- **Workspace startup/browser check completed 2026-11-18:** the Owner confirmed the external script, conversation list, model picker, New chat and first-message composer now work in the authenticated production browser.
- **M4 chat UX and first-token latency improvement deployed:** PR [#327](https://github.com/ashini-x/parmar-ai/pull/327), merged commit `dff54f783d660c7ac397b6f6670b7eee92ecaf98`; PR workflow [44188012230](https://github.com/ashini-x/parmar-ai/actions/runs/44188012230) and production workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed. The chat now follows familiar conversational conventions: right-aligned user bubbles, assistant response cards, model and thinking-level badges, a green Completed tag, and response-time/token metadata when returned. A compact activity card shows only observable states—sending request, Vertex accepted/waiting for first visible token, streaming, stopped or failed. It deliberately does not reveal raw thought parts or private chain-of-thought. On expired model-catalogue cache, generation now rechecks only the exact selected model, reuses the access token from that probe, and caches that model verification instead of re-probing the full registry before generation. Tests: `npm run check` passed; 485 Vitest tests across 72 files and 62 Node tests across 9 files passed; all three Worker dry-runs passed. Paired production deployment and root/health, BRVIN binding, Fatman readiness and release acceptance passed. Versions: `brvin-service` `1ce188ed-f48c-4e08-8318-095959aa8f4d`; `parmar-ai` `ca6b3b66-3aa0-4991-8ad3-8bab8646dbdf`; manifest artifact `14375891872`. No rollback.
- **M4 cross-model conversation-context fix deployed:** production issue reproduced from the Owner screenshots. After a failed generation, an empty `status=error` assistant row was being forwarded to the next model; repeated roles and long transcripts could also exceed the Gemini request validator. PR [#329](https://github.com/ashini-x/parmar-ai/pull/329), merged commit `252622df4a8429448252471dd61ce0cc48adc092`; PR validation [44195649792](https://github.com/ashini-x/parmar-ai/actions/runs/44195649792) passed TypeScript, 489 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Prompt assembly now excludes pending/error/empty assistant rows, merges adjacent same-role turns into a valid alternating user/model sequence, and sends only the newest bounded suffix (up to 49 turns / 300,000 characters). The entire transcript remains untouched in Owner D1. The provider validates ordering, non-empty turns and the same size cap. The model-picker tooltip now clarifies that Count Tokens eligibility does not guarantee GenerateContent permission; 401/403 generation errors explicitly tell the Owner to check service-account/model access. Production workflow [44195976369](https://github.com/ashini-x/parmar-ai/actions/runs/44195976369) passed paired deployment, root/health, BRVIN service binding, Fatman readiness and release acceptance. Versions: `brvin-service` `c0bd4f4d-148a-4985-a864-33acb0fcd924`; `parmar-ai` `dbbbc9ab-81ed-4e6d-81aa-9dd9345d4b54`; manifest artifact `14379620781`. No rollback.
- **M4 provider-stage diagnostics deployed:** Carbon HIGH was retried on 2026-11-17 23:24:08 UTC in the same conversation; D1 recorded `gemini-4-carbon` / `HIGH` as `error` with 0 tokens, and the matching Worker request returned HTTP 502 after ~6.8 seconds. Historical telemetry did not retain Google's upstream error body, so the exact stage/reason cannot be reconstructed. PR [#331](https://github.com/ashini-x/parmar-ai/pull/331), merge commit `9acd131b48336f0584cd9173837017651741a4e6`, now distinguishes `:countTokens` probe failures from `:streamGenerateContent` failures and surfaces only safe provider status/reason/permission fields; raw messages and resource paths are excluded. PR workflow [44200420616](https://github.com/ashini-x/parmar-ai/actions/runs/44200420616) passed TypeScript, 490 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44200720507](https://github.com/ashini-x/parmar-ai/actions/runs/44200720507) passed paired deployment, root/health, BRVIN service binding, Fatman readiness and production acceptance. Versions: `brvin-service` `a1c5a9c9-7710-4310-885f-6252bdbbd053`; `parmar-ai` `b3be9246-5fab-485a-9bb5-ffe7f019e2c1`; acceptance manifest artifact `14380957337`. No rollback. The subsequent post-PR #333 failure and later successful Carbon HIGH completion are recorded in the next checkpoint entry.
- **M4 Carbon denial follow-up + post-PR #333 retry and subsequent recovery:** PR [#333](https://github.com/ashini-x/parmar-ai/pull/333), merged as `46d8d4a738d7f2d6d9c2fe37d9899caf8d8c6bd5`, deployed in workflow [44205352694](https://github.com/ashini-x/parmar-ai/actions/runs/44205352694). The post-release retry in the same `hello` conversation at 2026-11-18 00:24:02 UTC (05:54:02 IST) failed with D1 `error`, zero tokens and empty content; matching POST returned Worker HTTP 502 after 7,339 ms at 00:24:09.588 UTC. Source inspection confirms generation-start maps upstream Vertex 401/403 to Worker 502, but retained D1/Cloudflare telemetry cannot distinguish `CountTokens` from `StreamGenerateContent` or identify the permission/reason. **Subsequent recovery is now verified:** at 2026-11-18 00:50:52 UTC (06:20:52 IST), Gemini 4 Carbon HIGH completed in the same conversation. D1 records `status=complete`, 7,673 prompt tokens, 61 output tokens, 8,011 total tokens, 11,486 ms and 227 response characters; the Owner screenshot shows the selected Carbon model, HIGH thinking, green Completed status, and 11s / 8,011 tokens. This confirms Carbon currently works despite the earlier intermittent denial. Do not label Carbon unsupported or infer that its earlier root cause has been fixed permanently. No IAM role, OAuth scope, secret or configuration was changed.
- **M4 workspace JavaScript startup fix deployed:** production telemetry showed successful `/admin/intelligence` page responses but no following requests to the conversations or Gemini model APIs for the sampled page loads. PR [#324](https://github.com/ashini-x/parmar-ai/pull/324), merged commit `df48b707cfc953b68cc6e099818b5c68965e6c58`; workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) passed `npm run check`, 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. The workspace app is now served from the same-origin, Owner-protected `/admin/intelligence.js` asset; the page no longer depends on its inline nonce script. CSP allows same-origin scripts only. Conversation list/create/reopen requests have a 15-second deadline, and history/New chat failures show retryable errors rather than remaining stuck. Paired production deployment and root/health, BRVIN binding, Fatman readiness and release acceptance passed. Deployed versions: `brvin-service` `863531a6-add5-44f0-94d1-5753ade79c96`; `parmar-ai` `cebd3677-458f-4860-b191-7c6c18d26bc3`. Manifest artifact `14372720383`. No rollback.
- **M4 acceptance status:** authenticated production generation is now verified on Gemini 4 Carbon HIGH. The 2026-11-18 00:50:52 UTC completion in the same `hello` conversation has `status=complete`, a 227-character response, 7,673 prompt tokens, 61 output tokens, 8,011 total tokens and 11,486 ms elapsed; the Owner screenshot shows the selected Carbon model, HIGH badge, green Completed tag and matching rounded 11-second / 8,011-token metadata. Earlier Carbon HIGH retries included intermittent upstream 401/403 failures, but this later successful generation confirms Carbon can invoke and respond; do not classify it as unsupported. The old 00:24 denial's exact provider stage/permission remains unknown and is a diagnostic follow-up, not evidence of a permanently missing role. Cross-model context continuity on Hydrogen HIGH/XHIGH remains verified. Remaining authenticated M4 checks: observe the waiting/first-token/streaming activity states, verify Stop with persisted partial text, Edit/resubmit and Regenerate. Automatic in-place SSE reconnection remains deferred.
- **Next action:** ask the Owner to sign in to production, confirm the meter/checkpoint reminder is visible, test a generation and verify used/reserved/remaining values refresh, and confirm the 200,000-token boundary becomes read-only before another prompt is persisted. In the same acceptance pass, finish M4 Stop/partial retention, Edit/resubmit, Regenerate and observe waiting/streaming activity states. Keep M4 open until its remaining authenticated interactions pass; then move to M5 voice dictation to editable text—not Gemini Live.
- **M4.1 code review notes:** D1 reservations are serialized per conversation (`reserved_tokens = 0` precondition) and the reservation ledger's guarded status update prevents repeated settlement. Provider stream timeout is 8 minutes; reservation expiry is 10 minutes and stale reservations are charged at the reserved amount. The UI treats a full in-flight reservation as busy, not as a final read-only lock. These are application-level safeguards; they do not replace Google Cloud billing/quotas.
- **M2 workspace/storage:** `/admin/intelligence` provides a responsive dark workspace with New chat, conversation history, reopen, rename and delete. `owner_intelligence_conversations` and `owner_intelligence_messages` remain separate from student tables and Durable Object state; all reads/writes are scoped to the configured Owner.
- **M3 model API:** `GET /admin/api/intelligence/models` is Owner-only, uses the server-configured project/location and server-side Google service-account auth, and probes registry candidates with Vertex `countTokens`. Only successful probes make a model selectable.
- **M3 registry and adapter:** the current registry includes Gemini 4 Hydrogen/Carbon/Argon, Gemini 3.8/3.7/3.6 Flash and Gemini 3.5 Flash/Flash-Lite. The adapter sends plain multi-turn text and an optional neutral Owner system instruction. It does not invoke student SSC logic, Search grounding or BRɅIN/Fatman context. The UI uses only `selectable: true` entries; no silent fallback is permitted.
- **Production identity:** `OWNER_DASHBOARD_USER=admin` remains explicitly configured as the current single production Owner principal. A legacy pre-M1 session requires a fresh login.
- **Scope boundary recorded 2026-11-18:** Owner interaction is text-first. Voice is dictation to an editable text transcript. Gemini Live, real-time audio/video, assistant speech, media generation and generic Google capability parity are explicitly out of scope. Only useful, verified, model/API-compatible capabilities may be added.
- **Not implemented:** voice dictation (M5), relevant native Gemini tools (M6), Owner usage/cost view (M7), and final overall acceptance (M8). File/media input and BRɅIN context are deferred/optional as described above.

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
| OIW-ADR-012 | Owner thinking level is selected and validated against the chosen server registry entry, then sent using Vertex `generationConfig.thinkingConfig.thinkingLevel`. | Thinking options and request payload compatibility vary by Gemini model; rejecting unsupported values prevents silent downgrades. | Implemented and deployed in M4 |
| OIW-ADR-013 | Streamed Owner assistant text and generation metadata remain in dedicated Owner D1 records; Stop/disconnect retains a truthful partial status. | The Owner must be able to reopen interrupted conversations without mixing generation data into student analytics or implying incomplete text is final. | Implemented and deployed in M4; automatic reconnection deferred |
| OIW-ADR-014 | Owner Gemini Intelligence is a text-first general-purpose Gemini workspace. Voice is dictation transcribed into editable text and then sent through the same selected-model text chat pipeline. | The Owner asked for broad Gemini model capability through text or spoken input, not a clone of every Google surface. A separate transcription step avoids making Gemini Live, voice output or real-time audio/video architectural dependencies. | Accepted 2026-11-18; implementation not started |
| OIW-ADR-015 | Add only Gemini API capabilities that are useful to Owner requests and verified for the exact model/API/project/location. | Avoids building feature parity with the consumer Gemini app or exposing every Google tool without a concrete use case. | Accepted 2026-11-18; M6 evaluation pending |
| OIW-ADR-016 | Model-catalogue discovery must have bounded provider and browser waits, with explicit retryable UI states. | The model picker must never remain indefinitely in its initial loading state when Google auth, a model probe or the browser request stalls. | Implemented and deployed 2026-11-18 |
| OIW-ADR-017 | Serve the Owner workspace client app as a same-origin, Owner-protected JavaScript asset instead of inline JavaScript. | Browser execution must not depend on inline nonce handling; CSP stays restrictive with `script-src 'self'`, and the application code is independently gated by the Owner session. | Implemented and deployed 2026-11-18 |
| OIW-ADR-018 | The chat activity UI may show only observable request lifecycle and user-facing response status, not private model thought parts. | The Owner needs feedback while the model is processing, but provider thought parts/internal chain-of-thought are not surfaced. Status labels are grounded in actual client/server events. | Implemented and deployed 2026-11-18 |
| OIW-ADR-019 | When the model-verification cache expires, generation re-verifies only the Owner-selected model and reuses the resulting access token for the stream request. | Re-running the full model registry check before every long-lived chat wastes time before first token. Selected-model re-verification preserves server authorization while reducing unnecessary pre-generation work. | Implemented and deployed 2026-11-18 |
| OIW-ADR-020 | Build Gemini context from completed/non-empty turns only; merge adjacent same-role turns and send a bounded recent suffix. | Failed or pending assistant records are UI state, not model context. A model switch must preserve meaningful prior context without sending malformed roles or an unbounded transcript. The durable D1 transcript is never truncated by prompt assembly. | Implemented and deployed 2026-11-18 |
| OIW-ADR-021 | A project/location Count Tokens probe is eligibility metadata, not proof of GenerateContent permission. | The actual generation call may still return 401/403 because IAM or model-level access differs. The Owner UI must not label this probe as guaranteed generation access and must explain the distinct failure class. | Implemented and deployed 2026-11-18 |
| OIW-ADR-024 | Enforce a cumulative 200,000-token budget independently for each Owner conversation with exact CountTokens preflight, atomic prompt/output reservation and final usage settlement. | Prevents a single long-running Owner chat from growing without bound while leaving the Owner free to start another chat; provider billing and context limits remain separate. | Implemented in M4.1 |
| OIW-ADR-025 | Carry context between chats through an Owner-authored GitHub Markdown checkpoint pasted into the new chat; do not automatically fetch GitHub content. | Keeps the boundary explicit and avoids granting the chat an implicit GitHub read/import capability. | Accepted and shown in M4.1 UI |
| OIW-ADR-022 | Preserve the provider failure stage and only expose safe structured Google diagnostics. | A generic 403 cannot distinguish a Count Tokens probe failure from a GenerateContent denial. Keep the upstream stage, HTTP status, Google status/reason and permission name; never expose raw provider messages, project/resource paths or credentials. This makes the next Owner retry actionable without guessing at IAM changes. | Implemented and deployed 2026-11-18 |
| OIW-ADR-023 | When Google returns a generic `PERMISSION_DENIED` without ErrorInfo, use Data Access audit logs before changing IAM. | A generic 403 is not enough to identify an IAM permission, policy deny or model-access restriction. Agent Platform DATA_READ audit logs record publisher-model generation/token-count methods, principal and target resource when enabled; they are disabled by default and can incur log charges. Never enable them or change roles silently. | Accepted; manual Google Cloud log review pending |

### Completed task log

| Date | Task | Files updated | Evidence / result |
| 2026-11-18 | Added safe fallback parsing for formatted Vertex IAM errors and identified the latest intermittent Carbon HIGH failure. | `src/admin/intelligence-provider.ts`, `test/admin-owner-intelligence-provider.test.ts`, both Owner workspace docs, API/test docs, README and changelog. | PR [#333](https://github.com/ashini-x/parmar-ai/pull/333), merged `46d8d4a738d7f2d6d9c2fe37d9899caf8d8c6bd5`. Validation [44205106618](https://github.com/ashini-x/parmar-ai/actions/runs/44205106618): TypeScript, 491 Vitest tests/72 files, 62 Node tests/9 files, three Worker dry-runs passed. Production [44205352694](https://github.com/ashini-x/parmar-ai/actions/runs/44205352694): paired deployment and acceptance passed. Versions: `brvin-service` `03df3ad9-d5a3-4785-919f-d2e251ff3733`; `parmar-ai` `8ae9c848-28a1-4ec7-9c5a-001f8380d7f9`; manifest `14382239548`. The latest 23:51 UTC Carbon HIGH screenshot predates this release and shows only `PERMISSION_DENIED` at StreamGenerateContent. Two earlier Carbon HIGH runs in the same conversation succeeded; three later attempts failed. At the time of the PR #333 task-log entry, the post-release retry had not yet occurred; its later result and production correlation are recorded in the newer task-log entry above. |
| 2026-11-18 | Correlated the post-PR #333 Carbon HIGH retry with production D1 and Cloudflare Workers Observability; confirmed the application HTTP 502 maps an upstream Vertex 401/403, while the exact provider stage and permission/reason were not retained. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/README.md` | Read-only production evidence: D1 records 00:24:02 UTC / 05:54:02 IST as `error` with zero tokens and empty assistant content; matching Worker POST on version `8ae9c848-28a1-4ec7-9c5a-001f8380d7f9` returned HTTP 502 after 7,339 ms at 00:24:09.588 UTC. No code commit, app tests or deployment: documentation-only update. No IAM, OAuth, secret or environment changes. Documentation commits: roadmap checkpoint/history `4cd5bd6066cafcb660b74633b9fb169f4ac4e6b1`; continuation prompt `23bfad86935c7f9ef27bc63e7023766825f2b44d`; README `ea48df418bcb988428842a87906e7fbc6bf0489c`. |
| 2026-11-18 | Verified successful Gemini 4 Carbon HIGH production generation after earlier intermittent 401/403 failures; matched the Owner screenshot to the latest Owner-scoped D1 generation metadata. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/README.md` | Owner screenshot shows Gemini 4 Carbon / HIGH, green Completed status, 11s and 8,011 tokens. D1 record in the same `hello` conversation at `2026-11-18 00:50:52 UTC` confirms `status=complete`, 7,673 prompt tokens, 61 output tokens, 8,011 total tokens, 11,486 ms and 227 response characters. This confirms Carbon generation currently works; it does not explain the earlier isolated upstream 401/403. No application code, tests, IAM, OAuth scopes, secrets or deployment changed. Documentation-only checkpoint update. Documentation commits: roadmap task-log `93c36d2d8b70c8b4355ca28aa2bae84a6123154c`; continuation prompt `f2e7c539ae130ca55e8fe8a9c8bbb57e11165053`; README `fb7792e4ae6403630ae4fb5c751a2b418bc57c06`. |
| 2026-11-18 | Diagnosed and instrumented Carbon/Vertex provider failures by stage. | `src/admin/intelligence-provider.ts`, `test/admin-owner-intelligence-provider.test.ts`, Owner roadmap/continuation, API/test docs, README and changelog. | PR [#331](https://github.com/ashini-x/parmar-ai/pull/331), merge `9acd131b48336f0584cd9173837017651741a4e6`. Validation [44200420616](https://github.com/ashini-x/parmar-ai/actions/runs/44200420616): TypeScript, 490 Vitest tests/72 files, 62 Node tests/9 files and all three Worker dry-runs passed. Production [44200720507](https://github.com/ashini-x/parmar-ai/actions/runs/44200720507): paired deploy and smoke/release acceptance passed. Deployed `brvin-service` `a1c5a9c9-7710-4310-885f-6252bdbbd053`, `parmar-ai` `b3be9246-5fab-485a-9bb5-ffe7f019e2c1`, manifest `14380957337`. The previous Carbon HIGH failure is stage-ambiguous in historical logs; Hydrogen HIGH/XHIGH then completed in the same conversation (5,842–6,717 prompt tokens), verifying cross-model context continuity. New stage-specific diagnostics are deployed; Carbon retest remains pending. |
|---|---|---|---|
| 2026-11-17 | M0 documentation baseline created and verified. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/README.md` | Commits: `aa29d00787d06d5a60da31b450c4b6f1a9dbe02f` (roadmap), `b1e1a24c8c1f613cfed44fa8e63fc62b7e1c6fbf` (prompt), `482569563aae6539652fa99ad563bbb9c60cea11` (index). All three documents fetched back from `main` and their cross-links verified. Tests: not run (documentation-only). Deployment: none. |
| 2026-11-17 | M1 Owner identity and authorization implemented and deployed. | `src/admin/auth.ts`, `src/config/env.ts`, `src/index.ts`, `wrangler.jsonc`, `test/admin-owner-auth.test.ts`, `docs/SECURITY_MODEL.md`, both Owner workspace docs and `docs/README.md` | Code commits: `fa1285b027b5debcc072818d20e5df7f82947bbd` and `f672177761c1f933186eb143aadba91fa123158c`. Release workflow [44131054109](https://github.com/ashini-x/parmar-ai/actions/runs/44131054109): success. Passed `npm run check`, `npm test`, `npm run test:node`, three Worker dry-runs, paired production deploy, production smoke test and release acceptance. Rollback was not needed. Authenticated browser login was not manually smoke-tested from this session. |
| 2026-11-17 | Resolved production Error 1101 on the Owner login path and deployed the fix. | `src/analytics/db.ts`, `src/index.ts`, `test/worker.test.ts`, `test/telegram-bot-store-schema.test.ts`, `test/brvin-admin-script.node.test.ts`, both Owner workspace docs, `docs/SECURITY_MODEL.md` and `docs/README.md` | Cloudflare Ray `a5c06d999bd6cc0f` identified `POST /admin/login` failing because an in-flight module-global schema Promise crossed Worker request contexts. Fix commits: `4762f014f2352aa0799c85c9fb4899235b7bbfb8`, `09e0eb600bd79b4e8ad827bd4aae527493e7b028`, `fb7bbb101d422939a4cc074564a96faf82cda34c`, `8253a1dafc6fbc919324423f7c7bd79e360b5df7`. Final workflow [44139900378](https://github.com/ashini-x/parmar-ai/actions/runs/44139900378): success. Passed typecheck, 466 Vitest tests, Node-specific tests (62 tests), all three Worker dry-runs, paired production deploy, production smoke test and release acceptance. No rollback. A real-credential browser sign-in was not manually executed from this session. |
| 2026-11-17 | M2 Owner Intelligence workspace and conversation persistence implemented and deployed. | `src/admin/intelligence.ts`, `src/index.ts`, `test/admin-owner-intelligence.test.ts`, and Owner workspace, data, security, API, privacy and test documents. | Runtime commits include `6333912746610c31ac963b78f7747b9b780589a9`, `cf04645b384a232a1f33f2fb1891139cc0b0f245`, `e424b49fa96977bffd3c60e4e63a176bd8c53cde`, `43bca853efa98039ffb0d1ca20fe122844ad18db`, final source `dd5d1ec6b0f9ccbe61facf0ed0cfa4c11ef21d25`; test coverage commits `b76fb634e6dcae1dea8bd8568ab2bc69f2e09aa6` and `7c162d5f2aec944db02d8e6b819dbe6f0018115d`. Production workflow [44145644996](https://github.com/ashini-x/parmar-ai/actions/runs/44145644996): success. Typecheck passed; 470 Vitest tests and 62 Node tests passed; all three Worker dry-runs passed; both Workers deployed; production smoke and release acceptance passed. No rollback. Authenticated manual browser walkthrough was not performed. |
| 2026-11-18 | M3 Vertex model catalogue, Owner model selector and provider eligibility hardening. | `src/admin/intelligence-provider.ts`, `src/admin/intelligence.ts`, `test/admin-owner-intelligence-provider.test.ts`, `test/admin-owner-intelligence.test.ts`, and the Owner workspace, API, security, AI and test documents. | Initial provider deployment: commit `75be2818b1688f7e70745cb3560ed8c7c56ec6b2`, workflow [44153429958](https://github.com/ashini-x/parmar-ai/actions/runs/44153429958), success. Follow-up source commit `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc`, production workflow [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057), success on 2026-11-17. `npm run check` passed; `npm test` passed 478 tests across 72 files; `npm run test:node` passed 62 tests across 9 files; private BRVIN, Parmar AI and standalone BRɅIN website Worker dry-runs passed. Paired production deployment, root/health smoke checks, BRVIN service binding, Fatman retrieval readiness and production release acceptance all passed. No rollback was needed. Deployed Worker versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`; `parmar-ai` `add293a6-6489-400b-996f-168034203058`. Production release manifest uploaded as artifact `14362111251`. On 2026-11-18, the Owner supplied a production screenshot showing the model selector populated with the candidates the server had marked selectable for the configured project/location. |
| 2026-11-18 | M4 model-specific thinking selector and streamed Owner generation implemented, validated and deployed. | `src/admin/intelligence.ts`, `src/admin/intelligence-provider.ts`, `test/admin-owner-intelligence.test.ts`, `test/admin-owner-intelligence-provider.test.ts`, `docs/API.md`, `docs/AI_PIPELINE.md`, `docs/SECURITY_MODEL.md`, `docs/DATA_MODEL.md`, `docs/DATA_GOVERNANCE.md`, `docs/TEST_PLAN.md`, `docs/README.md`, `CHANGELOG.md`, `PRIVACY.md` and both Owner workspace documents. | PR [#320](https://github.com/ashini-x/parmar-ai/pull/320), merged as `2912d55cde147c48d1cc608b4b318b51487697ba`. PR validation and main workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) succeeded. `npm run check` passed; `npm test` passed 482 tests across 72 files; `npm run test:node` passed 62 tests across 9 files; three Worker dry-runs passed. Paired production deploy, root/health smoke checks, BRVIN service binding, Fatman readiness and release acceptance passed. Deployed versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Manifest artifact `14367310746`. No rollback. A real billed Owner browser generation test remains outstanding; automatic stream reconnection is deferred. |
| 2026-11-18 | Clarified Owner Gemini Intelligence product scope as a general-purpose, text-first Gemini workspace with voice dictation. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/README.md`, `CHANGELOG.md`. | Documentation-only scope/ADR update. No source code, tests or deployment changed. Primary roadmap commit `7cfc060f95951553df6ab976ef72c16bc7767843`; continuation prompt commit `ef404fbaf7561882f364b109e464900e5e530a3b`; docs index commit `d161212ba397eec81afd611d7a4b415fb5e10b41`; changelog commit `886bee2327966332d3bd33a60c98e45d7642c6ea`. M4's real Owner acceptance remains the next action. |

| 2026-11-18 | Fixed indefinite Owner Gemini model-picker loading and deployed bounded catalogue checks with a visible Retry state. | `src/admin/intelligence-provider.ts`, `src/admin/intelligence.ts`, `test/admin-owner-intelligence-provider.test.ts`, `test/admin-owner-intelligence.test.ts`, `docs/TEST_PLAN.md`, both Owner workspace documents, `docs/README.md` and `CHANGELOG.md`. | PR [#322](https://github.com/ashini-x/parmar-ai/pull/322), merged as `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`. PR validation [44175582649](https://github.com/ashini-x/parmar-ai/actions/runs/44175582649) passed `npm run check`, 484 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Main production workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `b9008a5e-3181-4345-9cbd-c06fb0a75ea2`; `parmar-ai` `aec54709-e501-4f6d-b1d2-e7887f3e42b6`; manifest artifact `14368709148`. No rollback. A new authenticated Owner browser screenshot/session check after this fix remains outstanding. |

| 2026-11-18 | Fixed Owner Intelligence frontend startup: moved client JS to a protected same-origin asset, removed inline-script nonce dependency, and added bounded/retryable conversation loading and New chat behavior. | `src/admin/intelligence.ts`, `src/index.ts`, `test/admin-owner-intelligence.test.ts`, both Owner workspace documents, `docs/TEST_PLAN.md`, `docs/README.md` and `CHANGELOG.md`. | PR [#324](https://github.com/ashini-x/parmar-ai/pull/324), merged as `df48b707cfc953b68cc6e099818b5c68965e6c58`. PR validation [44179589879](https://github.com/ashini-x/parmar-ai/actions/runs/44179589879) passed `npm run check`, 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Main production workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `863531a6-add5-44f0-94d1-5753ade79c96`; `parmar-ai` `cebd3677-458f-4860-b191-7c6c18d26bc3`; manifest artifact `14372720383`. No rollback. Fresh authenticated browser confirmation after this deployment remains pending. |

| 2026-11-18 | Refreshed Owner chat presentation with familiar message cards, observable generation activity and completion metadata; reduced pre-stream verification to the selected model. | `src/admin/intelligence.ts`, `src/admin/intelligence-provider.ts`, `test/admin-owner-intelligence.test.ts`, `test/admin-owner-intelligence-provider.test.ts`, both Owner workspace documents, `docs/TEST_PLAN.md`, `docs/README.md` and `CHANGELOG.md`. | PR [#327](https://github.com/ashini-x/parmar-ai/pull/327), merged as `dff54f783d660c7ac397b6f6670b7eee92ecaf98`. PR validation workflow [44188012230](https://github.com/ashini-x/parmar-ai/actions/runs/44188012230) passed `npm run check`, 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Main production workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `1ce188ed-f48c-4e08-8318-095959aa8f4d`; `parmar-ai` `ca6b3b66-3aa0-4991-8ad3-8bab8646dbdf`; manifest artifact `14375891872`. No rollback. Authenticated Owner visual/latency acceptance remains pending. |

| 2026-11-18 | Fixed cross-model conversation history after failed generations and clarified Count Tokens vs GenerateContent permission. | `src/admin/intelligence.ts`, `src/admin/intelligence-provider.ts`, `test/admin-owner-intelligence.test.ts`, `test/admin-owner-intelligence-provider.test.ts`, `docs/API.md`, `docs/TEST_PLAN.md`, both Owner workspace documents, `docs/README.md` and `CHANGELOG.md`. | PR [#329](https://github.com/ashini-x/parmar-ai/pull/329), merged as `252622df4a8429448252471dd61ce0cc48adc092`. PR validation [44195649792](https://github.com/ashini-x/parmar-ai/actions/runs/44195649792) passed TypeScript, 489 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44195976369](https://github.com/ashini-x/parmar-ai/actions/runs/44195976369) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `c0bd4f4d-148a-4985-a864-33acb0fcd924`; `parmar-ai` `dbbbc9ab-81ed-4e6d-81aa-9dd9345d4b54`; manifest artifact `14379620781`. No rollback. Authenticated cross-model browser confirmation after this fix remains pending. |

| 2026-11-18 | Implemented per-chat 200,000-token lifetime budget and manual Markdown checkpoint handoff (M4.1). | `src/admin/intelligence-provider.ts`, `src/admin/intelligence.ts`, `test/admin-owner-intelligence-provider.test.ts`, `test/admin-owner-intelligence.test.ts`, `docs/API.md`, `docs/AI_PIPELINE.md`, `docs/DATA_MODEL.md`, `docs/DATA_GOVERNANCE.md`, `docs/SECURITY_MODEL.md`, `docs/TEST_PLAN.md`, `PRIVACY.md`, `CHANGELOG.md`, and both Owner workspace docs. | PR [#335](https://github.com/ashini-x/parmar-ai/pull/335); feature commits include `dd5b82949557cdc3b7d51e3703be6e75f8f6629b` plus follow-up UI fix `123c9dc07ba1628424447be00925d4e37f624c18`. Merged as `109e21b155b794ec2ac1cc29274d5513e56c6762` via PR [#335](https://github.com/ashini-x/parmar-ai/pull/335). Final PR validation [44221814569](https://github.com/ashini-x/parmar-ai/actions/runs/44221814569) passed `npm run check`, 494 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44222082173](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman retrieval readiness and release acceptance. `parmar-ai` version `e94b142b-5ddf-448e-a51b-0c9709bfb7f1` (deployment `52ca8f91-2fd3-4c8f-8b17-3903d9eb03ff`) and `brvin-service` version `44547ea0-830e-41f8-97cb-95594959cae2` (deployment `50e181b9-a36e-4e5f-b7bf-209a0f17d42d`) are each at 100% traffic. Release manifest artifact [14391366648](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173/artifacts/14391366648). Automated production release checks passed; authenticated Owner browser acceptance of the meter and hard 200,000-token boundary remains a manual follow-up. |

| 2026-11-18 | Approved and documented the Owner Intelligence memory, project continuity and token-aware context architecture as M4.2–M4.8 sub-milestones without changing the unfinished M4/M4.1 acceptance state or original M5–M8 milestone definitions. | `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`, `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`, `docs/OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md`, `docs/TEST_PLAN.md`, `docs/README.md`, `CHANGELOG.md` | Documentation-only architecture lock. PR [#336](https://github.com/ashini-x/parmar-ai/pull/336), validation workflow [44233899226](https://github.com/ashini-x/parmar-ai/actions/runs/44233899226) passed `npm run check`, 494 Vitest tests across 72 files, 62 Node tests across 9 files, and all three Worker dry-run bundle checks. The workflow classified the change as docs-only and skipped production deployment jobs by repository policy; no runtime code changed and no Worker redeployment was required. The complete planned acceptance matrix is recorded as not yet implemented; the current M4/M4.1 browser checks remain first. |

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

- [ ] Anonymous visitor cannot load workspace UI or use any Owner API.
- [ ] Authenticated non-Owner admin cannot load workspace UI or use any Owner API.
- [ ] Owner can enter using the existing admin sign-in journey; role/session tampering fails.
- [ ] Owner messages and generation metadata never appear in student data or student analytics.
- [ ] Open-ended questions use the Owner's selected model without SSC prompt/schema/classifier or forced BRɅIN context.
- [ ] The selected model and supported thinking setting are honoured; no silent model/provider downgrade occurs.
- [ ] Typed messages and reviewed voice transcripts use the same conversation and generation endpoint.
- [ ] Voice transcript is editable before send; mic permissions, cancel, errors and supported language quality are handled; raw audio is not retained by default.
- [ ] Stream interruption, Stop, partial retention, Edit/resubmit and Regenerate preserve conversation consistency.
- [ ] Every enabled native Gemini tool is useful, selected-model/API/project compatible, transparent and tested.
- [ ] External or sensitive tool actions require explicit Owner confirmation before execution.
- [ ] Optional BRɅIN context is off by default and respects project/source authorization and provenance.
- [ ] Provider quotas, billing, context and request limits are communicated accurately.
- [ ] Gemini Live, real-time audio/video, assistant voice output and generated media are not added without a separate approved scope change.
- [ ] Existing student Telegram, Admin Control Center and BRɅIN admin tests remain green.
- [ ] Production Owner-only acceptance and rollback procedure are verified.
- [ ] The per-chat budget is proven in an authenticated production browser at the near-limit/exhausted boundary; the manual GitHub Markdown checkpoint handoff is visible and usable.
- [ ] This roadmap and the continuation prompt match the latest repository state.

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
