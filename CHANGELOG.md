## 2026-11-19 IST: Owner Intelligence M4.3 merged and deployed to production

- PR [#346](https://github.com/ashini-x/parmar-ai/pull/346) merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`.
- Current-head PR validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests across 74 files, 62 Node tests across 9 files and all three Worker dry-run bundles.
- Production workflow [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired Worker deploy, root/health, BRVIN service binding, Fatman retrieval and release-acceptance checks. No rollback was triggered.
- `parmar-ai` version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` (deployment `034968d5-a1ff-4a35-a085-457eee2b3c13`) and `brvin-service` version `d43a9f7b-32b3-486f-9845-75ed11811165` (deployment `063b01b9-c852-44d4-8ad9-a3ba8893e6c5`) are each at 100% traffic. Release acceptance artifact [14464228113](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092/artifacts/14464228113).
- The deployed M4.3 feature includes dedicated PKCE GitHub App auth, selected-only installation, metered Gemini memory drafting, editable five-file preview, explicit confirmation, write token only after confirmation, non-force conflict-aware commit, durable retry/verification and byte-exact read-back before Synced.
- Remaining: authenticated Owner creates/installs the private App on selected repositories and completes the live preview/edit/confirm/read-back and stale-branch-conflict browser acceptance. M4.4 Project Memory prompt loading/pinned snapshots remain unimplemented.

## 2026-11-18: Owner Intelligence M4.3 reviewed GitHub Save implementation (PR #346; release gates pending)

- Added the Owner-only Gemini-drafted Markdown preview and explicit Save confirmation to the existing dedicated PKCE-verified GitHub App integration.
- The preview preserves the current selected Gemini model/thinking level, reads existing project Markdown at one pinned base commit, uses bounded D1 transcript excerpts, and produces editable project-memory.md, progress.md and decisions.md while preserving index.md and proposing a source-linked session note.
- Draft generation calls Vertex CountTokens for the exact conversation content plus fixed system instruction, reserves prompt/output in the same conversation's D1 200K ledger and settles provider usage; the token meter refreshes after the attempt.
- Added best-effort credential redaction before model input and before file persistence; the Owner must still review each proposed file.
- Confirmation is explicit. Contents write token is minted only after confirmation; expected branch head is rechecked; one Git tree/commit is created; commit SHA is recorded in D1 before a non-force branch update; every expected file is read back at the exact commit SHA before Synced and Scratchpad promotion.
- Added durable preview states/expiry, exact path/content and size validation, conflict and idempotent retry handling, and local-D1 test coverage for metered Gemini drafting, secret redaction, confirmation, commit/read-back, duplicate confirm and stale-branch conflict.
- PR #346 current-head checks after the latest UI/redaction refinements are pending. A previously green baseline run [44379838462](https://github.com/ashini-x/parmar-ai/actions/runs/44379838462) passed 505 Vitest tests/74 files, 62 Node tests/9 files and all three Worker dry-run bundles at commit c6f2b2ed27f9fc134db268e8b5408c40b9eecfe7. No production deployment or live Owner GitHub App installation/save acceptance has happened yet.
- M4.4 remains responsible for manifest-selected Project Memory loading and pinned repository/branch/commit snapshots.

## 2026-11-18: Owner Intelligence M4.3 GitHub App authorization and repository attachment validated

- Feature branch `feat/owner-intelligence-m4-3-github-app-auth` implements a dedicated private BRɅIN Owner Memory GitHub App, separate from BRVIN Connect and the ChatGPT GitHub connector.
- Requests only repository Metadata read and Contents write; no webhook events. App private key/client secret are encrypted in Owner-scoped D1. Manifest and installation callbacks use one-time Owner-bound state.
- Uses GitHub user authorization with PKCE to verify the exact App installation against `GET /user/installations`; does not trust `installation_id` from a setup URL by itself. The temporary user token is discarded.
- Mints short-lived installation tokens scoped to the selected repository ID and Contents read for repository discovery/attachment. Verifies repository ID/full name and branch before attaching repository/branch/memory-root references to an Owner topic. Contents write is reserved for a later write token minted only after explicit Save confirmation.
- Adds Owner workspace controls for App registration, installation, account/repository selection and topic attachment. This does not load Project Memory or write a Git commit.
- Adds `test/admin-owner-github.test.ts` for mocked App registration, encrypted credential storage, single-use state, distinct callback/setup URLs, PKCE user/installation verification, read-scoped repository listing, and topic repository attachment on local D1. PR validation [44356289855](https://github.com/ashini-x/parmar-ai/actions/runs/44356289855) passed TypeScript, 505 Vitest tests/74 files, 62 Node tests/9 files and all three Worker dry-run bundles. PR #346 is open; merge/deployment are pending.
- Still to implement in M4.3: reviewed memory draft/diff, explicit confirmation, conflict-aware atomic commit, read-back verification, and only then Archived & Synced status.

## 2026-11-18: Owner Intelligence M4.2 Scratchpad/topic foundation deployed

- PR [#343](https://github.com/ashini-x/parmar-ai/pull/343) merged as `5dfd42499fc9f14dfda915c3c264242af779dc2d`.
- PR validation [44340775103](https://github.com/ashini-x/parmar-ai/actions/runs/44340775103): TypeScript, 503 Vitest tests/73 files, 62 Node tests/9 files and all three Worker dry-run bundles passed.
- Production workflow [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839) passed paired Worker deployment, root/health smoke, BRVIN service binding, Fatman retrieval readiness and production acceptance. `parmar-ai` version `107a75e0-4f62-4a16-a748-6b0f0b6e6894` (deployment `06dcc10a-0ee3-4b6c-be66-81b7746c9e20`) and `brvin-service` version `030e0db4-c94d-40e7-a246-a22213aca3b8` (deployment `f111b1b0-b659-4f5d-8560-50d578c20411`) are both at 100% traffic. Manifest artifact [14443836745](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839/artifacts/14443836745). No rollback was required.
- M4.2 provides D1-backed Owner topics, additive conversation metadata, persistent Scratchpad default, optional topic association and protected topic controls. It does not load GitHub Project Memory or pin repository/branch/commit snapshots; those belong to M4.3–M4.4.
- Owner reports latest Hydrogen HIGH request responds without displaying `RESOURCE_EXHAUSTED` after PR #338. This is a successful observed request, not proof that transient shared provider capacity issues can never recur.

## 2026-11-18: Owner Intelligence M4.1 exact 200K boundary acceptance completed

- Add deterministic Owner generation tests against the Cloudflare Workers Vitest local D1 binding (Miniflare SQLite), with Vertex CountTokens/stream calls mocked.
- Prove the final permitted prompt-plus-output reservation exactly fills the remaining 10 tokens, settles Used to 200,000 and Reserved to zero, and a subsequent prompt is rejected with 409 before persistence.
- Prove a request one output token beyond remaining capacity is rejected before stream startup, with no user prompt and no reservation persisted.
- Prove two same-chat requests released from CountTokens simultaneously are serialized by the actual local D1 conditional reservation: exactly one reservation and one user prompt are admitted.
- PR [#341](https://github.com/ashini-x/parmar-ai/pull/341), merged as `60ed1705c247530b6321290c38abae8ee309022f`. Workflow [44335838504](https://github.com/ashini-x/parmar-ai/actions/runs/44335838504) passed `npm run check`, 499 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs.
- Test-only change; production runtime and deployment were unchanged. No production D1 records were mutated and no live Gemini tokens were consumed. The original per-conversation 200,000-token limit, reservations, settlement, meter and read-only state are unchanged.

## 2026-11-18: Owner reports M4 interaction and M4.1 meter/concurrency acceptance

- Record the Owner's authenticated production browser report that M4 waiting/first-visible-token/streaming, Stop with partial retention after reopening, Edit/resubmit, Regenerate and selected model/thinking-level preservation behaved as expected.
- Record M4.1 meter/in-flight reservation checks as passed by Owner report, plus cross-tab concurrency: different conversations can generate concurrently, while a second simultaneous request to the same conversation is rejected.
- These are Owner-reported UI results; no direct production D1 inspection was captured in this chat. The exact 200,000-token hard-boundary test (final reservation, one-token-over rejection and rejected-prompt non-persistence) remains pending. Do not start M4.2 until that acceptance is closed.

## 2026-11-18: Owner Gemini transient Vertex stream throttling resilience

- Add at most two retries (three attempts total) for transient initial `StreamGenerateContent` HTTP 408/429/5xx responses, using exponential backoff, jitter and a bounded `Retry-After` delay.
- Keep the configured `global` endpoint; preserve the exact model, thinking level, prompt contents and output cap. Do not retry permanent 4xx or restart an SSE stream after it has been accepted. Stop cancels a pending backoff.
- The screenshot's `RESOURCE_EXHAUSTED` is a Vertex provider-capacity/rate-limit condition, not the application's M4.1 200,000-token chat budget. The complete M4.1 D1 budget, reservations, settlement, meter and read-only boundary remain unchanged.
- Regression coverage added for transient recovery and bounded retry exhaustion. PR [#338](https://github.com/ashini-x/parmar-ai/pull/338) merged as `518dd899db443caa0f9db3e402961e90cb5baf82`. PR workflow [44248188580](https://github.com/ashini-x/parmar-ai/actions/runs/44248188580) passed TypeScript, 496 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Cloudflare confirms production deployment `23141013-465e-490a-a428-bcb2fcaac001`, Worker version `3dc555ca-c84b-49c0-8f73-2575c2397143`, at 100% traffic. The Owner's post-deployment live Hydrogen HIGH retry is still pending; persistent Google capacity/quota issues remain possible.

## 2026-11-18: Owner Context Replicator architecture finalized (documentation-only)

- Name the **Cloudflare Owner Context Replicator** as the single logical Worker-side middleware that scopes the Owner request, selects bounded recent context and exact D1 recall, includes pinned Project Memory, runs exact Vertex CountTokens preflight, preserves M4.1 reservation ordering and hands the measured payload to the existing Vertex REST/SSE adapter.
- Specify the scaling invariant: for a fixed per-request input budget B, each prompt is at most B tokens and aggregate prompt input over N turns is at most N × B = O(N); naive full-history replay is approximately O(N²). The 10/50/100/200-turn deterministic proof/acceptance suite is planned, not run.
- Explicitly map all seven Owner workflows: Save a discussion, persistent Scratchpad, near-limit rollover, return to pinned project memory, promote Scratchpad, preview safe compaction and fork an isolated experiment.
- Update M4.6 roadmap acceptance, ADRs, TEST_PLAN.md and the new-chat continuation prompt. Preserve the outstanding authenticated M4/M4.1 gates and keep M4.2–M4.8 approved/not started.
- No application code, database migration, secret, Cloudflare resource/binding or runtime configuration changed. No production deployment is required for this documentation-only architecture finalization. The Replicator and all seven workflows remain unimplemented.

## 2026-11-18: Owner Intelligence long-session memory and token-aware context plan approved (documentation-only)

- Approve M4.2–M4.8 as nested continuity sub-milestones without renumbering or marking the original M4/M5–M8 milestones complete.
- Preserve D1 as the full live conversation and token-accounting system of record; use GitHub only for curated, versioned project memory after a dedicated server-side GitHub App integration is implemented.
- Record Scratchpad-by-default, optional Project Memory attachment, explicit preview/confirm Save to GitHub, 180K warning / 190K rollover action / 200K existing hard cap, token-aware prompt construction, exact historical recall, reversible compaction/forking and measured model-specific caching.
- Keep authenticated M4 and M4.1 production acceptance as the first outstanding tasks before M4.2 implementation. Original M5 voice dictation and M6–M8 remain unchanged and follow the continuity sequence.
- No application code, database schema, Cloudflare resource/binding or production runtime behaviour changed in this documentation-only task. PR [#336](https://github.com/ashini-x/parmar-ai/pull/336) validation [44233899226](https://github.com/ashini-x/parmar-ai/actions/runs/44233899226) passed `npm run check`, 494 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production deployment jobs were correctly skipped by the repository's docs-only path filter.

## 2026-11-18: Owner Intelligence per-chat 200,000-token budget (PR #335)

- Enforce a cumulative 200,000-token lifetime budget independently for each Owner conversation; it is not the Gemini model context window or an account-wide provider limit.
- Use Vertex CountTokens on the exact bounded prompt before committing new/edit/regenerate changes; reserve prompt plus allowed output capacity atomically in Owner-scoped D1.
- Cap the stream's output allowance to the available session budget and settle accounting from Vertex `usageMetadata.totalTokenCount`; conservatively charge the reservation when final usage metadata is missing.
- Backfill existing chats from available assistant generation totals; new chats start with a clean independent budget. Edit and Regenerate do not refund provider usage already consumed.
- Display used, reserved and remaining tokens, enforce a read-only state after exhaustion, and show the manual GitHub Markdown checkpoint workflow. GitHub content is not automatically fetched or imported.
- Preserve Owner-only authorization and the existing separation from student Telegram, BRɅIN retrieval and the selected model/thinking behaviour.
- PR [#335](https://github.com/ashini-x/parmar-ai/pull/335), merged as `109e21b155b794ec2ac1cc29274d5513e56c6762`. Validation [44221814569](https://github.com/ashini-x/parmar-ai/actions/runs/44221814569) passed TypeScript, 494 Vitest tests/72 files, 62 Node tests/9 files and all three Worker dry-runs. Production [44222082173](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173) passed paired deployment and release acceptance. Deployed `parmar-ai` `e94b142b-5ddf-448e-a51b-0c9709bfb7f1`, `brvin-service` `44547ea0-830e-41f8-97cb-95594959cae2`; manifest artifact `14391366648`. Authenticated Owner browser verification of the visible meter/exhaustion boundary remains pending.
## 2026-11-18: Owner Gemini Carbon formatted-error diagnostics and StreamGenerateContent stage

- Name the actual failing operation as `StreamGenerateContent`, separately from non-stream `GenerateContent` and the `:countTokens` availability probe.
- Parse the safe IAM permission and reason identifiers from either structured Google ErrorInfo or the formatted Google REST error message. Never return the raw provider message or project/resource path.
- Add regression tests for formatted-message extraction and resource identifier redaction.
- The latest Carbon HIGH screenshot before this release showed `PERMISSION_DENIED` but no permission/reason. Production records confirm two earlier Carbon HIGH completions in the same conversation followed by later intermittent zero-token failures.
- Google documents `aiplatform.endpoints.predict` for both `CountTokens` and `StreamGenerateContent`; its IAM role reference lists `roles/aiplatform.user` as including that permission. Do not infer a missing role from generic `PERMISSION_DENIED`; inspect Data Access audit logs if the post-release retry still lacks ErrorInfo. Data Access logs are disabled by default and can incur logging charges. [Agent Platform Data Access logging](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/enable-audit-logs) · [Google IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/aiplatform).
- PR [#333](https://github.com/ashini-x/parmar-ai/pull/333), merged as `46d8d4a738d7f2d6d9c2fe37d9899caf8d8c6bd5`. Validation [44205106618](https://github.com/ashini-x/parmar-ai/actions/runs/44205106618) passed TypeScript, 491 Vitest tests, 62 Node tests and all three Worker dry-runs. Production [44205352694](https://github.com/ashini-x/parmar-ai/actions/runs/44205352694) passed paired deployment and release acceptance.
- Deployed versions: `brvin-service` `03df3ad9-d5a3-4785-919f-d2e251ff3733`; `parmar-ai` `8ae9c848-28a1-4ec7-9c5a-001f8380d7f9`. Manifest artifact `14382239548`. Post-release Carbon retest remains pending.

## 2026-11-18: Owner Gemini provider-stage diagnostics for Carbon

- Distinguish a failed Vertex `:countTokens` availability probe from a failed `:streamGenerateContent` call. The old generic 401/403 message could incorrectly imply that GenerateContent had been reached.
- Preserve only safe Google diagnostic fields (HTTP status, Google status, reason code and IAM permission name). Raw provider messages, resource paths, project identifiers and credential data are not returned.
- Add regression tests covering both provider stages, prove a failed probe does not proceed to GenerateContent, and prove resource-path redaction.
- Confirm the existing service-account OAuth scope remains `https://www.googleapis.com/auth/cloud-platform`; no OAuth or IAM changes were made.
- Google documents `aiplatform.endpoints.predict` for GenerateContent/StreamGenerateContent and includes it in Agent Platform User (`roles/aiplatform.user`). Do not grant permissions based on the previous generic error; first inspect the new stage/reason. [Operation IAM](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rpc/google.cloud.aiplatform.v1) · [Role permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/aiplatform).
- PR [#331](https://github.com/ashini-x/parmar-ai/pull/331), merged as `9acd131b48336f0584cd9173837017651741a4e6`. Validation [44200420616](https://github.com/ashini-x/parmar-ai/actions/runs/44200420616) passed TypeScript, 490 Vitest tests, 62 Node tests and all three Worker dry-runs. Production [44200720507](https://github.com/ashini-x/parmar-ai/actions/runs/44200720507) passed paired deployment and release acceptance.
- Deployed versions: `brvin-service` `a1c5a9c9-7710-4310-885f-6252bdbbd053`; `parmar-ai` `b3be9246-5fab-485a-9bb5-ffe7f019e2c1`. Manifest artifact `14380957337`.
- Production validation: Hydrogen HIGH and two XHIGH requests completed in the same conversation after the earlier Carbon HIGH failure; the failed assistant row did not poison context. Retest Carbon after the diagnostic release remains pending.

## 2026-11-18: Owner Gemini cross-model conversation continuity fix

- Exclude pending, failed and empty assistant rows from the prompt sent to Gemini. These rows remain in the UI transcript but are not valid model turns.
- Merge adjacent same-role messages after filtering to produce a valid alternating user/model conversation when a prior generation failed before returning text.
- Bound the request to the newest recent history (maximum 49 turns / 300,000 characters, 50,000 characters per part) while keeping the full conversation unchanged in Owner D1.
- Add provider-side validation for user-led alternating turns, non-empty text parts and the total context limit.
- Clarify that Count Tokens eligibility does not guarantee GenerateContent permission; explain 401/403 access failures without silently switching models.
- Merged as `252622df4a8429448252471dd61ce0cc48adc092` (PR [#329](https://github.com/ashini-x/parmar-ai/pull/329)). Validation [44195649792](https://github.com/ashini-x/parmar-ai/actions/runs/44195649792) passed TypeScript, 489 Vitest tests, 62 Node tests and all three Worker dry-runs. Production workflow [44195976369](https://github.com/ashini-x/parmar-ai/actions/runs/44195976369) passed paired deployment and release acceptance.
- Deployed versions: `brvin-service` `c0bd4f4d-148a-4985-a864-33acb0fcd924`; `parmar-ai` `dbbbc9ab-81ed-4e6d-81aa-9dd9345d4b54`. Manifest artifact `14379620781`.

## 2026-11-18: Owner Gemini chat activity, completion cards and selected-model verification performance

- Refresh the Owner workspace with familiar chat conventions: right-aligned user bubbles, bordered assistant response cards, model/thinking-level badges and green Completed status tags.
- Show a compact activity card for observable phases: sending request, Vertex accepted/waiting for the first visible response token, response streaming, stopped or failed.
- Show response time and token usage when returned by the provider and persisted with the response.
- Do not expose provider thought parts or private chain-of-thought; the activity card reports request/stream state only.
- Reduce latency after catalogue-cache expiry: acquire one access token, re-verify only the selected model if needed, reuse the token for generation and cache that model's successful verification.
- Merged as `dff54f783d660c7ac397b6f6670b7eee92ecaf98` (PR [#327](https://github.com/ashini-x/parmar-ai/pull/327)). Validation [44188012230](https://github.com/ashini-x/parmar-ai/actions/runs/44188012230) passed TypeScript, 485 Vitest tests, 62 Node tests and all three Worker dry-runs. Production workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed paired deployment and release acceptance.
- Deployed versions: `brvin-service` `1ce188ed-f48c-4e08-8318-095959aa8f4d`; `parmar-ai` `ca6b3b66-3aa0-4991-8ad3-8bab8646dbdf`. Manifest artifact `14375891872`.

## 2026-11-18: Owner Intelligence frontend startup and conversation loading fix

- Move the Owner workspace application JavaScript out of the HTML inline script and serve it from `/admin/intelligence.js`.
- Protect the JavaScript route with the existing Owner role check; anonymous access is 401 and non-Owner admin access is 403.
- Replace nonce-based inline application script execution with a same-origin-only script policy (`script-src 'self'`).
- Add 15-second deadlines for conversation list/create/reopen requests.
- Replace the perpetual sidebar loading placeholder with a clear error and Retry control; make New chat failures visible and restore the button after the request settles.
- Add regression tests for the protected script route, CSP, client request deadline and retry UI.
- PR [#324](https://github.com/ashini-x/parmar-ai/pull/324), merged as `df48b707cfc953b68cc6e099818b5c68965e6c58`. Workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) passed 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Paired production deployment and release acceptance passed.
- Deployed versions: `brvin-service` `863531a6-add5-44f0-94d1-5753ade79c96`; `parmar-ai` `cebd3677-458f-4860-b191-7c6c18d26bc3`. Manifest artifact `14372720383`.

## 2026-11-18: Owner Gemini model picker liveness fix

- Bound Google access-token acquisition to 12 seconds and every Vertex Count Tokens capability probe to 8 seconds with a Promise-level timeout; abort the underlying probe when it times out.
- Add a 45-second browser model-catalogue deadline so the picker cannot remain in “Checking models…” indefinitely.
- Show clear Vertex-unavailable, no-verified-models, timed-out or connection-failure states, with a Retry control where retry is meaningful.
- Register model/thinking change listeners once and refresh composer availability after catalogue success/failure.
- Add regression tests for never-settling token and model-probe requests.
- Merged as `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`; production workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) passed paired deployment and release acceptance. Deployed versions: `brvin-service` `b9008a5e-3181-4345-9cbd-c06fb0a75ea2`; `parmar-ai` `aec54709-e501-4f6d-b1d2-e7887f3e42b6`.

## 2026-11-18: BRɅIN Intelligence M4 Owner Gemini chat

- Add a model-aware thinking selector populated from the project/location-verified Owner Gemini registry and bind the selected level to Vertex `generationConfig.thinkingConfig.thinkingLevel`; unsupported levels are rejected instead of downgraded.
- Add an Owner-only SSE generation endpoint using the selected model, with user-facing text deltas, sanitized errors, usage metadata and filtering of provider thought parts.
- Add Stop/request cancellation, incremental partial-response persistence, Edit/resubmit and Regenerate while retaining Owner-scoped conversation order.
- Store response model, thinking level, returned token counts and elapsed time in the separate Owner generation metadata table.
- Keep Owner prompts, assistant responses and generation metadata outside student analytics, profiles, quiz records, quotas and Durable Object state.
- Automatic in-place stream reconnection is not included; saved partial text remains available after reopening the conversation.

## 2026-11-18: Owner Gemini Intelligence product scope clarified

- Define the Owner workspace as a private, general-purpose Gemini text chat where the Owner chooses a verified model and supported thinking level.
- Support voice as dictation only: transcribe speech into editable text and submit it through the same selected-model chat pipeline used by typed prompts.
- Keep Gemini Live, real-time audio/video, speech-to-speech, assistant voice output, media generation and broad Google-product parity outside the approved scope.
- Evaluate only useful native Gemini API tools after validating compatibility with the selected model, API surface, project and location; keep BRɅIN retrieval a separate opt-in add-on.
- Update the Owner roadmap, ADRs, continuation prompt and engineering index. This is a documentation-only scope clarification; no code, tests or deployment changed.

## Unreleased: Locked reusable Telegram runtime architecture

- Lock the as-built production Telegram runtime as the reusable baseline for future bots, with code-level documentation for webhook authentication, the immediate `/start` path, per-chat Durable Object admission/recovery, Queue hand-off, Gemini streaming, progress recovery, D1 schema separation and latency telemetry.
- Replace the superseded v2.5.2 architecture summary with the current production system map and publish `docs/TELEGRAM_BOT_ARCHITECTURE.md` as the canonical copy-forward reference.
- Keep webhook credential setup isolated to `telegram_bots`; use a cached runtime-only D1 schema for Telegram access/analytics paths while retaining full migrations for admin/BRVIN.
- Await successful Queue publication, then move the normal post-queue state/typing hand-off into `ctx.waitUntil` so cosmetic work does not hold the webhook response.
- Add stage-level timing diagnostics for acknowledgement, admission, Queue publish/wait, context reads and answer generation.
- Recover from transient Telegram progress-edit timeouts with bounded retries; after three consecutive failures only cosmetic progress is disabled.
- Update the AI pipeline, operations runbook, repository map and engineering documentation index to match the implementation and provide a safe reuse checklist for the next bot.

## Unreleased: Faster first-contact Telegram /start
- Keep Telegram webhook credential lookup independent from the full analytics/BRVIN schema initializer; only the small `telegram_bots` table and active-connection index are ensured on the authentication path.
- Deliver the existing welcome before starting first-seen and `/start` analytics writes, preventing cold-isolate analytics initialization from competing with the first visible response.
- Add webhook-authentication and welcome-delivery timing logs to distinguish D1/authentication latency from Telegram API delivery latency.
- Add regression coverage that Telegram bot schema setup does not invoke the full application schema initializer.

## Unreleased: Phase 4 live production release acceptance
- Add a read-only production acceptance gate that verifies the newest Cloudflare deployment for both Workers is a single version at 100% traffic.
- Probe the public root and BRVIN-backed health response for connected retrieval, ready Fatman status, and at least one authorised source.
- Write a deployment evidence manifest and GitHub Actions summary containing source revision and both Worker deployment/version IDs.
- Add a manual acceptance-only workflow path that checks the current production deployment without redeploying or touching student data.
- Add regression tests proving split rollouts fail closed and older active records cannot mask a newer partial deployment.

## Unreleased: Harden source-PDF lifecycle prefix guard
- Treat unterminated ancestor prefixes such as `brvin` and `brvin/source-pdfs` as broad matches that could include source PDFs. Permit only the dedicated temporary Vision prefix and exact legacy per-book `ocr/` subtrees.

## Unreleased: Automatic post-READY Vision OCR retention
- New book uploads store source PDFs under `brvin/source-pdfs/<book-id>/` and temporary Vision JSON under `brvin/temporary-vision-ocr/<book-id>/`.
- Once all pages are indexed and retrieval QA passes, a separate background workflow deletes only the temporary OCR prefix. Persistent AI Search page text/chunks remain available for project retrieval; source PDFs and project grants remain intact.
- Added a 30-day Cloud Storage lifecycle Delete rule scoped only to the temporary OCR prefix, preserving existing unrelated lifecycle rules and refusing broad rules that may include source PDFs. Added a five-minute retry supervisor and migrated cleanup for READY books using the legacy per-book `ocr/` layout.

## Unreleased: BRVIN book archive and restore
- Added reversible archive/restore controls for fully indexed imported PDF books. Archived books are excluded from project retrieval while their PDF, Vision OCR output, AI Search pages, and project grants remain intact.
- Archived books can still use the existing protected per-book purge. Built-in Fatman sources remain protected; OCR-only cleanup remains an explicit administrator action to preserve re-indexing and recovery options.

## Unreleased: Looping Telegram progress feedback
- Long-running progress phases now rotate through compact, phase-accurate one-line variants instead of leaving a stale status on screen.
- Genuine phase changes are applied faster (500 ms minimum interval); streamed answer chunks remain separately throttled and coalesced (850 ms).
- If answer streaming pauses, the same message temporarily returns to a writing cycle and resumes the cumulative answer when the next chunk arrives.
- Progress timers stop before final delivery, preventing a late status edit from overwriting a completed answer.

# Changelog

## Unreleased: Mobile-safe Telegram progress labels
- Shortened every live status to 22 characters or fewer and removed long explanatory phrases so each progress state is designed to fit a single line in Telegram mobile bubbles.
- Centralized the labels and added a regression test for both the one-line constraint and maximum length.

## Unreleased: Live Telegram progress states
- Replaced the single generic wait label with contextual progress states for question understanding, Fatman retrieval and page review, current-source checks, image interpretation, quiz preparation, and safe retries.
- Reuses the original Telegram status message for every state and then transitions it into the existing streamed answer, avoiding separate status-message clutter.
- Serializes and coalesces edits to respect Telegram's practical edit cadence without dropping the latest answer chunk; progress edits remain best-effort and cannot interrupt generation.
- Added regression tests for status-to-answer transitions, chunk coalescing, and Telegram edit failures.

## Unreleased: Fatman Google Vision OCR importer
- Replaced Cloudflare image OCR with Google Cloud Vision Document Text Detection; extracted per-page text is indexed in the existing Cloudflare AI Search instance with exact PDF page metadata.
- Added a zero-image Google Vision connectivity check, explicit confirmation of at least 538 remaining free OCR units, sequential page processing, and resumable page indexing.
- Let Cloudflare index extracted text asynchronously while the admin page polls overall progress, so normal indexing delays do not stop page uploads.

## Unreleased: Fatman async indexing failures
- Wait for Cloudflare’s indexing result for each uploaded page and stop immediately when processing fails or remains pending.
- Surface the provider’s page error in the admin status instead of continuing bulk uploads.

## Unreleased: Fatman PDF importer fix
- Injected the approved PDF fingerprint into the browser-side import module so the full selected PDF can be validated before indexing begins.
- Added regression coverage for the served admin page fingerprint.

## Unreleased: Photo Doubt Support (feature branch)
- Added private Telegram photo doubts, including photo-only albums of up to 5 pictures, as one SSC doubt and one quota unit; albums over the limit are rejected.
- Explicitly reject videos and mixed photo/video albums; rate-limit unsupported-video notices to prevent reply spam.
- Added bounded image downloads and Gemini multimodal input; image bytes are not persisted.
- Album photo IDs stay in Durable Object retry state and are cleared when processing completes.


## 2.8.0: Production Multi-MCQ Quiz Batches
- Added bounded multi-MCQ requests with up to 10 independent native Telegram quizzes per request.
- Batch size is carried through Durable Object job state and accounted for against daily and burst controls.
- Underspecified batch requests ask for the topic and remember the requested quantity for the topic reply.
- Removed separate bot result messages after quiz selections; Telegram's native quiz result is the student-facing result surface.
- Persisted quiz outcomes into conversation context for follow-up questions about an answered quiz.
- Added cleanup for partial batch delivery and quiz-session persistence failures.

## 2.7.0: Intent-Driven Native Telegram Quizzes
- Added semantic response-mode selection so ordinary doubts remain text while genuine MCQ/test/quiz intents become native Telegram quizzes.
- Added non-anonymous Telegram quiz delivery with exactly one correct answer, compact in-card explanations, and immediate result feedback.
- Added D1 quiz-session persistence for poll correlation, deletion, retention, and correct/incorrect outcome tracking.
- Added poll-answer webhook handling and protected multi-bot quiz correlation.
- Added fallback behavior when quiz-session persistence is unavailable so a valid answer can still reach the student.
- Added regression coverage for quiz packet validation and poll-answer webhook subscription.

## 2.6.1: Production Hardening
- Aligned release metadata and runtime fallback on v2.6.1.
- Made dedicated Telegram credential encryption mandatory for production writes, with controlled legacy-read compatibility during key migration.
- Reduced the public health endpoint to a minimal health response.
- Reduced the production raw analytics retention baseline from 90 days to 30 days.
- Hardened Durable Object internal payload handling and centralized lease-ownership validation.
- Added regression coverage for freshness classification, lease ownership, malformed AnswerPackets, retention defaults, encryption configuration, and public health behavior.

## 2.6.0: Production Reliability & Access Control Hardening
- Fixed Student action-button event handling.
- Added D1 read-back verification for suspend/unsuspend.
- Hardened unlimited-access verification and audit handling.
- Fixed Access-tab Telegram ID validation.
- Fixed Telegram Test connection/Disconnect validation.
- Added proprietary licensing, AI/ML restrictions, brand policy, privacy notice, governance, support, and documentation-index files.
- Refreshed release, operations, and production test documentation.
- Lease-fenced Durable Object jobs and stale-job recovery.
- Correct processing/typing lifecycle and retry classification.
- End-to-end dashboard unlimited-access verification.
- Broader grounding detection and truthful analytics.
- Secure Telegram setup authentication.
- Explicit user data deletion.

Historical releases remain below this entry.