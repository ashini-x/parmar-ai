# Production Test Plan: v2.8.0

## Core Telegram
- `/start` returns.
- `/help` returns and refreshes Telegram webhook `allowed_updates` to include `callback_query` before rendering Fatman controls.
- `/fatman`, `/fatman on`, `/fatman off`, and `/fatman status` work as command fallbacks.
- `/id` returns a numeric ID.
- Ordinary SSC fact answers normally.
- The original Telegram `Thinking…` message transitions through truthful task-specific progress states, then becomes the streamed answer without sending duplicate status messages.
- Fatman questions show retrieval and page-review states before answer chunks; grounded current-fact questions show a source-check state.
- `/help` shows separate `Enter Fatman` and `Exit Fatman` actions; each explicitly sets mode and refreshes the same keyboard.
- Exiting Fatman works even if the book index is temporarily unavailable; entering is blocked until the index is ready.
- Legacy `fatman:toggle` callbacks remain supported for older messages.
- Image and quiz questions show their respective preparation states; retry attempts replace stale progress with a retry state.
- Long-running phases rotate concise, phase-accurate status variants every 2.5 seconds; answer-stream pauses temporarily show a writing cycle.
- Every progress label stays on one line: no line breaks and no more than 22 characters.
- Follow-up continuity works.
- Simplification works.
- `/profile` works.
- `/reset` resets study context without resetting daily quota.
- Data deletion removes centralized analytics, quiz sessions, and per-chat study state according to application semantics.
- Genuine MCQ/test intent renders as a native Telegram quiz while ordinary open-ended doubts remain text.
- A fresh generic “mcq”/“quiz” request asks for a topic instead of inventing one, while a topic-anchored request generates the quiz.
- A requested batch of up to 10 MCQs generates independent native Telegram quizzes; batch size is bounded and accounted for against limits.
- A student-supplied MCQ preserves its options where practical and records the selected answer.
- Native quiz selection shows the result in Telegram without a second bot message; the outcome remains available to later follow-up questions.
- Telegram webhook subscription includes poll_answer updates.

## Synthetic end-to-end student journey

- A deterministic integration test posts a signed-secret Telegram update to the real webhook handler, captures the Queue job, then invokes the real Queue consumer.
- The test uses a temporary encrypted test-bot record and mocks Telegram API, Vertex AI streaming, and the private BRVIN RPC. It makes no live Telegram messages, Gemini calls, or book-index searches.
- In Fatman mode, an explicit page request reaches BRVIN with its page locator; retrieved book evidence is included in the Gemini prompt.
- The delivered Telegram answer contains the verified book/PDF citation and the normal SSC Focus takeaway.
- The same completed journey creates one D1 question record, increments the Durable Object student profile exactly once, and consumes one unit of the shared daily quota.
- The test fails if the Queue job retries, the answer is not delivered, the page evidence is not passed to Gemini, or any of the profile, D1, and quota assertions fail.

This is an integration regression test with controlled external-service responses. It does not replace a production live-service check or assert that Google, Telegram, and Cloudflare's remote services are reachable at a particular moment.

## Phase 4: live production release acceptance

- The release acceptance script reads Cloudflare's deployment history for both `parmar-ai` and `brvin-service`.
- It evaluates the newest deployment record for each Worker and requires exactly one version receiving 100% traffic; an older 100% deployment must never mask a newer split or partial rollout.
- It probes the public root route and `/health`; the health response must confirm the private BRVIN service binding, ready Fatman retrieval, and at least one authorised source.
- It records the source revision, workflow run, deployment IDs, version IDs, rollout percentages, endpoint checks, and capture time in a JSON manifest and GitHub Actions summary.
- The same read-only acceptance can be run with `workflow_dispatch`; this path validates the current deployment and does not redeploy either Worker.
- The acceptance check does not send real Telegram messages, generate Gemini answers, consume student quota, or mutate production data. Continue to use the protected Telegram admin connection test and the synthetic student-journey integration test for their respective coverage.

## Owner Intelligence — per-chat token budget

Automated checks added for this release:

- Vertex CountTokens receives the exact bounded multi-turn user/model contents for the selected Owner model.
- A conversation at 200,000 committed tokens returns HTTP 409, identifies `session_token_limit_reached`, reports a locked usage state and does not persist the rejected user prompt.
- Creating another conversation initializes a separate 200,000-token budget with zero usage.
- Legacy conversations are backfilled from recorded assistant generation `total_tokens` metadata.
- Edit/regenerate preflight failure leaves the original prompt and later turns intact rather than committing a destructive edit before provider preflight succeeds.

Authenticated Owner browser evidence reported 2026-11-18:

- **M4 interaction acceptance — reported passed:** Owner observed the waiting/first-visible-token/streaming lifecycle; Stop retained partial text/status after reopening; Edit/resubmit and Regenerate retained turn order and the selected model/thinking level.
- **M4.1 meter/concurrency — reported passed:** Owner reports used/reserved/remaining and in-flight reservation behavior matched expectations. Two tabs on different conversations generated concurrently; two tabs on the same conversation did not permit a second simultaneous generation.
- This is a record of the Owner's browser report. No direct production D1 query or independent screenshot artifact was captured in this chat. Do not infer exact D1 reservation values or database non-persistence solely from the UI report.
- **Automated D1 boundary acceptance passed 2026-11-18:** PR [#341](https://github.com/ashini-x/parmar-ai/pull/341), merged `60ed1705c247530b6321290c38abae8ee309022f`. Tests run the real Owner generation route against the Cloudflare Workers Vitest local D1 binding (Miniflare SQLite) and mock only the Vertex provider methods. They prove exact final-fill (5 prompt + 5 output tokens consume the final 10), settlement to Used=200,000/Reserved=0 and subsequent 409; one-token-over rejection before opening the stream, with no prompt or reservation row; and a two-request CountTokens barrier race in which actual D1 admits one reservation and persists one user prompt. This uses no production D1 or billed Vertex call.

Production acceptance for this release:

- Open an existing Owner chat and confirm the meter shows used, in-flight reserved and remaining token counts; verify the meter refreshes after a completed, stopped or failed generation.
- Confirm an in-flight request reserves capacity and prevents a second concurrent generation in that chat, including when the reservation consumes all remaining capacity; it must not be displayed as a completed/read-only session until the reservation is settled. Owner reports the two-tab same-chat rejection and independent-chat concurrency check passed on 2026-11-18.
- **Exact boundary:** covered by the deterministic local-D1 tests above; do not consume 200K production tokens to re-run it. Creating a new conversation still initializes an independent fresh 200,000-token budget (covered by the existing Owner session tests).
- Verify the GitHub Markdown checkpoint reminder is visible and that the Owner can start a new chat and manually paste a checkpoint link. No automatic GitHub import or cross-chat context transfer is implemented.
- Confirm a stream with final usage metadata settles from `totalTokenCount`; an interrupted stream without final usage metadata is conservatively charged at its reservation.

The automated tests are not a substitute for authenticated Owner production browser acceptance. Record the exact deployed revision and workflow before marking the production acceptance complete.

**Automated and release evidence for 2026-11-18:** PR validation [44221814569](https://github.com/ashini-x/parmar-ai/actions/runs/44221814569) passed `npm run check`, 494 Vitest tests across 72 files, 62 Node tests across 9 files and dry-run bundle validation for the BRVIN service, Parmar AI Worker and standalone BRɅIN website Worker. Merged revision `109e21b155b794ec2ac1cc29274d5513e56c6762` was deployed by production workflow [44222082173](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173). Paired Worker deployment, root and health smoke checks, BRVIN service binding, Fatman retrieval readiness and release acceptance passed. Authenticated Owner-specific browser checks for the meter/in-flight reservation are reported passed on 2026-11-18. Exact boundary and same-chat reservation-race checks passed against local D1 in PR #341. M4.1's 200K accounting acceptance is closed; no production boundary mutation or token spend is required.

## Limits
- Five accepted questions in the burst window cause the sixth to receive the burst response.
- Daily quota blocks additional AI jobs at the configured limit.
- Privileged users bypass the daily limit but remain subject to burst protection.

## Admin Student controls
- Grant unlimited changes the backend state and dashboard.
- Revoke unlimited removes the runtime override.
- Suspend blocks student AI processing.
- Unsuspend restores processing.
- Protected Owner/Admin records cannot be suspended or revoked through student controls.

## Access tab
- Numeric Telegram ID is accepted.
- Grant unlimited produces a verified backend state.
- Audit record is created.

## Telegram tab
- Active bot details load.
- Test connection succeeds without a student ID.
- Switch verifies the new bot before deactivating the old one.
- Disconnect removes the webhook and records the disconnect.

## Failure cases
- Invalid webhook secret -> 401.
- Malformed webhook JSON -> 400.
- Group message -> private-chat notice.
- Malformed/incomplete Gemini output -> controlled retry/failure.
- Admin mutation without authentication -> rejected.
- Wrong Origin on mutation -> rejected.

## Release acceptance
Test the exact source revision intended for deployment, then record the resulting Cloudflare version ID.

## Production-hardening regression cases
- Current mutable fact without an explicit freshness keyword (for example, "Who is the RBI Governor?") requires live grounding.
- Historical office-holder question with an explicit year is not forced into current-fact handling.
- Ordinary non-current question is not recorded as Google-grounded merely because grounding was unnecessary.
- Lease ownership accepts the active queue message ID + lease version and rejects stale/mismatched ownership.
- Malformed Durable Object internal payloads are rejected rather than causing an unhandled JSON/body access error.
- In production, Telegram bot credential encryption requires TELEGRAM_BOT_ENCRYPTION_KEY; ADMIN_SESSION_SECRET is not used for new encryption.
- Legacy Telegram ciphertext can still be read during key migration when a dedicated production encryption key is present.
- Raw analytics retention defaults to 30 days when no override is configured.


## Owner Intelligence workspace — M2

- Anonymous GET of `/admin/intelligence` and the Owner API is rejected with 401.
- A valid ordinary admin session receives 403 on the Owner page and APIs.
- A valid Owner session can load the responsive dark workspace; response is `no-store`, has `nosniff`, and applies nonce-based script CSP.
- Owner can create a conversation, list it, reopen it after refresh, rename it and delete it.
- Owner-authored messages persist in `owner_intelligence_messages` and reappear when the conversation is reopened.
- Another configured Owner principal cannot list or read the first Owner's conversation.
- Mutations without the same-origin Origin header are rejected.
- Invalid titles and malformed conversation IDs are rejected.
- Deleting a conversation removes all associated message rows.
- The composer is disabled when no conversation is selected, enabled for an active conversation and saves on button click or Enter; Shift+Enter remains a newline.
- Do not expect Gemini assistant responses in M2; the UI identifies model generation as a later milestone.

### M2 production release evidence

Workflow [44145644996](https://github.com/ashini-x/parmar-ai/actions/runs/44145644996), source commit `dd5d1ec6b0f9ccbe61facf0ed0cfa4c11ef21d25): `npm run check` passed; `npm test` passed 470 tests across 71 files; `npm run test:node` passed 62 tests across 9 files; private BRVIN, Parmar AI and standalone BRɅIN web Worker dry-runs passed. Both production Workers deployed; root, health, BRVIN service binding and Fatman readiness checks passed; production release acceptance passed. No rollback was needed. The release did not perform a manual authenticated browser walkthrough of the private Owner page.



## Owner Intelligence — M3 Vertex catalogue and provider adapter

- Anonymous and authenticated non-Owner administrators cannot access `GET /admin/api/intelligence/models`; a valid Owner with missing Vertex configuration receives a sanitized unconfigured catalogue.
- Registry tests assert the centrally allowlisted candidates, per-model context/output ceilings, single-request caps and thinking metadata.
- Project/location Count Tokens probes use the configured server-side project/location and Google service-account token; only successful responses make a model selectable.
- 400/404, 401/403, 429/5xx and timeouts do not produce selectable entries.
- Probes are concurrency-limited, use per-model timeouts and successful catalogues are cached for 90 seconds.
- Provider adapter rejects unlisted and unverified models without calling GenerateContent, clamps output to the model's single-request API limit, parses text/usage metadata and sanitizes provider errors.
- Provider request contains only general-purpose Owner messages/system instruction; no SSC prompt, AnswerPacket, student profile/quota or automatic BRɅIN/Fatman context.
- Owner workspace model picker only displays server-returned `selectable: true` entries and shows a safe disabled state when the catalogue is unavailable or no candidate passes.
- M3 does not generate replies in the chat composer. Thinking settings, streaming, cancellation, regenerate and edit/resubmit belong to M4.

### M3 release evidence

Initial server-side provider deployment: commit `75be2818b1688f7e70745cb3560ed8c7c56ec6b2`; paired production workflow [44153429958](https://github.com/ashini-x/parmar-ai/actions/runs/44153429958) succeeded. Follow-up source commit `fc2e3488f4508da6298bdbcfcd134500cf2ccdfc` adds the in-workspace picker, model-specific token limits and a server-side selectable-model gate. Workflow [44157348057](https://github.com/ashini-x/parmar-ai/actions/runs/44157348057) succeeded: typecheck, 478 Vitest tests, 62 Node tests and all three Worker dry-runs passed; paired production deployment, root/health smoke checks, BRVIN service binding, Fatman retrieval readiness and production release acceptance passed. Deployed versions: `brvin-service` `ad04c1ac-98b8-43ef-92c1-bef8dbead2ac`; `parmar-ai` `add293a6-6489-400b-996f-168034203058`. No rollback was needed. On 2026-11-18, the Owner supplied a production screenshot showing the model picker populated with the project/location-probed selectable candidates; a real Owner generation request is still pending.


## Owner Intelligence — M4 thinking and streamed generation

- Model picker populates thinking choices and default from the selected server registry entry; changing models replaces the choices.
- Gemini 4 Hydrogen supports LOW/MEDIUM/HIGH/XHIGH; Gemini 4 Carbon and Argon support LOW/MEDIUM/HIGH; Gemini 3.8/3.7 support LOW/MEDIUM/HIGH; Gemini 3.6 and 3.5 Flash/Flash-Lite support MINIMAL/LOW/MEDIUM/HIGH, subject to registry metadata and live availability.
- Generation rejects unlisted/unverified models and thinking levels unsupported by the chosen model; the Vertex payload contains `generationConfig.thinkingConfig.thinkingLevel`.
- Owner generation is inaccessible to anonymous users and ordinary admin sessions; same-origin mutation checks and Owner-scoped D1 reads/writes remain enforced.
- SSE parsing emits only user-facing text; provider parts marked `thought` are not rendered.
- Stop/request cancellation aborts the upstream Vertex stream; received partial text is persisted with `partial` status, while success/failure is persisted as `complete`/`error`.
- Regenerate reuses the latest user turn and removes subsequent turns; Edit replaces the selected user turn and removes subsequent turns.
- Assistant messages record model ID, thinking level, input/output/total token counts when returned, and elapsed time in the separate Owner generation metadata table.
- Reopening a conversation shows persisted partial/final messages. Automatic in-place stream reconnection is not part of this M4 slice.
- The provider and route tests use controlled fake Vertex responses; they do not make a live billed Gemini request. A real Owner browser generation check remains a separate production acceptance step.
- Model-catalogue liveness is bounded at each layer: Google access-token acquisition has a 12-second deadline; each Count Tokens probe has an 8-second Promise-level deadline and abort; the browser model-list request has a 45-second AbortController deadline.
- A probe that never settles is returned as unverified rather than holding the catalogue response open; a token request that never settles returns a safe `google_auth_unavailable` state.
- The workspace replaces the initial loading placeholder with a specific unavailable/no-verified/timed-out state and a Retry control where retry is meaningful. Model/thinking change listeners are registered once, and composer state is refreshed after catalogue success or failure.
- Regression tests cover never-settling Count Tokens and Google token lookups; the workspace response test asserts the retry control and browser abort signal.

### M4 model-catalogue liveness fix evidence

PR [#322](https://github.com/ashini-x/parmar-ai/pull/322), merge commit `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`. PR validation workflow [44175582649](https://github.com/ashini-x/parmar-ai/actions/runs/44175582649) passed `npm run check`, 484 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and release acceptance. Deployed versions: `brvin-service` `b9008a5e-3181-4345-9cbd-c06fb0a75ea2`; `parmar-ai` `aec54709-e501-4f6d-b1d2-e7887f3e42b6`. Manifest artifact `14368709148`. No rollback. The automated acceptance verifies the timeout/error/retry behaviour; a fresh authenticated Owner browser check after deployment remains to be done.

### M4 frontend application startup and conversation liveness

- `/admin/intelligence` serves only static workspace HTML plus a deferred same-origin `<script src="/admin/intelligence.js">`; the HTML no longer contains an inline application script or nonce dependency.
- `GET /admin/intelligence.js` is Owner-only: anonymous access is 401, authenticated non-Owner admin is 403, and the Owner receives JavaScript with `application/javascript`, `no-store` and `nosniff` headers.
- The workspace CSP keeps `default-src 'none'` and uses `script-src 'self'`; API connections remain same-origin only.
- The client application asset attaches New chat, model, thinking, composer and history listeners after the page elements exist (`defer`).
- Conversation API calls have a 15-second abort deadline. Failed sidebar loads replace the perpetual loading label with a readable error and Retry control; New chat failure is visible and its button is restored after completion.
- The model catalogue is still bounded separately by the M4 liveness tests: 12-second Google access-token acquisition, 8-second Count Tokens probes and a 45-second browser model-list deadline.
- Route/page tests verify the protected script asset, restrictive CSP, external script tag, client timeout and retry/error UI. These tests prove server responses and markup; manual authenticated production browser verification is still needed to confirm the browser loads the script and starts its API calls.

### M4 frontend runtime fix evidence

PR [#324](https://github.com/ashini-x/parmar-ai/pull/324), merge commit `df48b707cfc953b68cc6e099818b5c68965e6c58`. PR validation [44179589879](https://github.com/ashini-x/parmar-ai/actions/runs/44179589879) passed `npm run check`, 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `863531a6-add5-44f0-94d1-5753ade79c96`; `parmar-ai` `cebd3677-458f-4860-b191-7c6c18d26bc3`. Manifest artifact `14372720383`. No rollback. A fresh authenticated Owner browser reload and client API activity confirmation remains pending.

### M4 chat activity, completion states and selected-model verification performance

- User messages render as compact, right-aligned conversation bubbles; assistant replies render in response cards to match familiar chat conventions.
- Assistant response metadata displays the actual model ID and selected thinking level; it does not imply that different thinking levels guarantee a particular reasoning trace or answer quality.
- During generation, the activity card transitions through observable states only: sending request; Vertex has accepted the request and the client is waiting for the first visible text; response streaming; stopped; failed.
- Raw provider parts marked `thought` remain filtered by the server and are never presented as a live chain-of-thought transcript.
- On a completed answer, the assistant card shows a green Completed badge and response time/token usage when those values are returned and persisted. Partial and failed answers have distinct status tags.
- Provider verification is bounded by the selected model: a fresh full catalogue check populates per-model verification cache entries; after expiry, generation acquires one access token, probes only the selected model if needed, reuses that token for the generation request, and caches the selected-model verification.
- Regression test verifies the stream path sends one Count Tokens probe for the selected model rather than probing the full registry when there is no fresh selected-model cache. UI test verifies the activity stages, model/thinking badge and Completed state.
- Manual authenticated Owner acceptance remains required: observe first-token wait and streaming for a supported model/thinking level, record model/level and response timing, verify the completion metadata and Stop/partial state. Do not treat a status card as an actual provider reasoning transcript.

### M4 chat activity/performance release evidence

PR [#327](https://github.com/ashini-x/parmar-ai/pull/327), merge commit `dff54f783d660c7ac397b6f6670b7eee92ecaf98`. PR validation [44188012230](https://github.com/ashini-x/parmar-ai/actions/runs/44188012230) passed TypeScript, 485 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and release acceptance. Deployed versions: `brvin-service` `1ce188ed-f48c-4e08-8318-095959aa8f4d`; `parmar-ai` `ca6b3b66-3aa0-4991-8ad3-8bab8646dbdf`. Manifest artifact `14375891872`. No rollback. Authenticated visual/latency acceptance remains pending.

### M4 cross-model conversation context and GenerateContent permission

- A failed/empty assistant message is persisted for the UI, but must not be sent as a model turn. Exclude assistant rows with `pending` or `error` status and exclude any whitespace-only message.
- Non-empty partial assistant replies may remain as context; complete user/model turns remain in chronological order.
- After failed/empty rows are removed, adjacent messages with the same role are coalesced so Vertex receives a clean alternating user/model sequence and the newest prompt remains the final user turn.
- Prompt assembly sends at most 49 turns and 300,000 characters, with each text part at most 50,000 characters. It selects a recent suffix and drops an orphaned leading model turn if context truncation starts mid-pair.
- Context assembly does not delete or rewrite the Owner's complete D1 transcript. It only chooses a bounded model input for the current request, allowing the same conversation to move between supported models with different request constraints.
- Provider validation independently rejects empty turns, repeated roles, non-user-led/non-user-ended contents, more than 50 turns, oversized parts and total context above 300,000 characters before calling Vertex.
- A Count Tokens probe may make a model selectable for token estimation but does not guarantee GenerateContent permission. A stream/generation 401/403 is a separate IAM/model access error; the UI message explicitly distinguishes it.
- Regression tests reproduce the Owner screenshot sequence: successful earlier context, an empty failed assistant row, and a subsequent retry after switching models. Other tests verify bounded suffix selection, valid roles and GenerateContent 403 guidance.
- Authenticated browser acceptance: reopen the affected conversation, retry with Hydrogen and verify history is retained without failed/empty rows poisoning the request; then test Carbon and follow the explicit Google Cloud access message if 403 remains.

### M4 cross-model context fix release evidence

PR [#329](https://github.com/ashini-x/parmar-ai/pull/329), merge commit `252622df4a8429448252471dd61ce0cc48adc092`. Validation [44195649792](https://github.com/ashini-x/parmar-ai/actions/runs/44195649792) passed TypeScript, 489 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44195976369](https://github.com/ashini-x/parmar-ai/actions/runs/44195976369) passed paired deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `c0bd4f4d-148a-4985-a864-33acb0fcd924`; `parmar-ai` `dbbbc9ab-81ed-4e6d-81aa-9dd9345d4b54`. Manifest artifact `14379620781`. No rollback. Authenticated browser confirmation remains pending.

### M4 Carbon provider-stage diagnostic coverage and acceptance

- Provider errors retain an explicit stage: `count_tokens_probe`, `generate_content` or `stream_generate_content`. A failed availability probe must say that no generation request was sent; a stream 401/403 must identify `StreamGenerateContent` denial separately from non-stream `GenerateContent`.
- Extract only safe Google fields: HTTP status, Google error status, reason code and IAM permission name. Parse both structured ErrorInfo and the formatted Google error message. Never surface the raw provider message, resource path, project identifier, access token or credential data.
- Regression tests cover a Count Tokens 403 (and prove no stream request follows), a GenerateContent 403 (and prove the stream request was reached), safe permission reporting, and resource-path redaction.
- The service-account OAuth implementation already requests `https://www.googleapis.com/auth/cloud-platform`; this was verified in `src/auth/google.ts`. Do not change OAuth scopes as a response to a generic 403.
- Google documents `aiplatform.endpoints.predict` as required for `GenerateContent` and `StreamGenerateContent`; the Agent Platform User role includes it. This is guidance only: do not change IAM until the exact stage/reason/permission is known. References: [GenerateContent/StreamGenerateContent IAM](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rpc/google.cloud.aiplatform.v1), [Agent Platform permissions and roles](https://docs.cloud.google.com/iam/docs/roles-permissions/aiplatform).
- Production reproduction: Carbon HIGH at 2026-11-17 23:24:08 UTC failed with zero recorded tokens; its matching Worker request returned HTTP 502 after ~6.8 seconds. Historical telemetry did not retain the upstream Google response body, so no exact failure stage can be retroactively inferred.
- Cross-model context acceptance: after that Carbon failure, Hydrogen HIGH and two Hydrogen XHIGH responses completed in the same conversation; prompt token counts increased 5,842 → 6,075 → 6,717. This verifies the failed Carbon placeholder no longer poisons the conversation.
- Remaining live acceptance: retry Carbon HIGH after PR #331 in the same conversation. The new UI message must distinguish a Count Tokens probe failure from a GenerateContent denial and show only safe Google status/reason/permission values.

### M4 provider diagnostic release evidence

PR [#331](https://github.com/ashini-x/parmar-ai/pull/331), merged as `9acd131b48336f0584cd9173837017651741a4e6`. Validation [44200420616](https://github.com/ashini-x/parmar-ai/actions/runs/44200420616) passed TypeScript, 490 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. Production workflow [44200720507](https://github.com/ashini-x/parmar-ai/actions/runs/44200720507) passed paired deployment, root/health, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `a1c5a9c9-7710-4310-885f-6252bdbbd053`; `parmar-ai` `b3be9246-5fab-485a-9bb5-ffe7f019e2c1`. Acceptance manifest artifact `14380957337`. No rollback. The post-release Carbon retest has not yet been performed.

### M4 latest Carbon production reproduction and audit-log path

- Owner screenshot at 2026-11-17 23:51:22 UTC: Carbon HIGH, `PERMISSION_DENIED` after model availability check, no permission/reason detail. D1 recorded zero tokens; matching Worker request at 23:51:29 UTC returned HTTP 502 after 6.8 seconds, version `b3be9246-5fab-485a-9bb5-ffe7f019e2c1`.
- Same conversation Carbon HIGH succeeded at 21:51:37 and 22:23:58 UTC; failed again at 22:43:49, 23:24:08 and 23:51:22 UTC. Hydrogen continued succeeding. Treat as intermittent until the upstream reason is known.
- PR #333 (`46d8d4a738d7f2d6d9c2fe37d9899caf8d8c6bd5`) deployed exact `StreamGenerateContent` labeling and safe message fallback. Validation [44205106618](https://github.com/ashini-x/parmar-ai/actions/runs/44205106618): 491 Vitest tests/72 files, 62 Node tests/9 files, TypeScript and three Worker dry-runs passed. Production [44205352694](https://github.com/ashini-x/parmar-ai/actions/runs/44205352694) passed paired deployment and acceptance; versions `brvin-service` `03df3ad9-d5a3-4785-919f-d2e251ff3733`, `parmar-ai` `8ae9c848-28a1-4ec7-9c5a-001f8380d7f9`, manifest `14382239548`.
- If the post-release retry still provides only `PERMISSION_DENIED`, use Google Agent Platform Data Access audit logs. When `DATA_READ` is enabled, logs record `streamGenerateContent`, `generateContent` and `countTokens`, plus principal and target model; Data Access logs are disabled by default and may incur Cloud Logging charges. Query `protoPayload.serviceName="aiplatform.googleapis.com"`, `protoPayload.status.code=7`, and `protoPayload.authenticationInfo.principalEmail="<GCP_CLIENT_EMAIL>"` in the failed request's time window. See [Agent Platform audit logs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/enable-audit-logs) and [Data Access logging configuration](https://docs.cloud.google.com/logging/docs/audit/configure-data-access).

### M4 transient Vertex stream-open rate-limit handling

- Owner-reported production screenshot on 2026-11-18 shows `StreamGenerateContent` failure with Google `RESOURCE_EXHAUSTED`. This is a Vertex provider/shared-capacity response, not the Owner app's M4.1 200,000-token conversation budget.
- The Worker already targets the `global` Vertex endpoint. For the initial stream-open HTTP response only, retry 408, 429 and 5xx failures with a maximum of three total attempts (two retries), exponential backoff, jitter and a bounded `Retry-After` delay.
- Do not retry permanent 4xx responses (including 400/401/403/404), do not restart a stream once a successful SSE response has been accepted, and stop backoff immediately when the Owner cancels generation.
- Every attempt must preserve the exact selected model, thinking level, contents, output cap and authorization token. Do not silently switch models, locations, APIs or providers.
- Regression tests must cover recovery after transient `RESOURCE_EXHAUSTED`, bounded exhaustion that preserves the final safe diagnostic, backoff timing, same request body, and the absence of retries for permanent errors.
- This retry policy does not bypass persistent Google project quotas, billing restrictions or unavailable capacity. If throttling persists after the bounded retries, inspect the exact Google error and the project's Agent Platform usage/quota state.

### M4 automated evidence

PR #320 validation workflow [44167885365](https://github.com/ashini-x/parmar-ai/actions/runs/44167885365) passed `npm run check`, 482 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. The merged main release workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) also passed validation, paired production deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Release manifest artifact: `14367310746`. No rollback was needed. These automated tests use mocked Vertex responses; a real billed Owner browser prompt/stream/Stop/Edit/Regenerate acceptance is still pending. Automatic in-place SSE reconnection is deferred and is not implemented.



### M4.2 — Scratchpad and topic foundation (merged and deployed)

- Local D1/Miniflare integration proves an older conversation schema is extended additively: existing conversation ID, transcript message and per-chat `used_tokens=1,234` / `token_limit=200,000` remain unchanged; new metadata defaults to `topic_id=null`, `session_kind=scratchpad`, `lifecycle_status=active`.
- Owner API tests prove topic create/list/rename, Scratchpad as the default new-chat type, explicit optional topic association for a new chat, and rejection of a foreign Owner's topic ID.
- Owner workspace tests verify the HTML page exposes the Scratchpad-default selector and the protected same-origin client script populates topics and passes an explicit topic ID on creation.
- PR [#343](https://github.com/ashini-x/parmar-ai/pull/343) merged as `5dfd42499fc9f14dfda915c3c264242af779dc2d`. Validation [44340775103](https://github.com/ashini-x/parmar-ai/actions/runs/44340775103) passed `npm run check`, 503 Vitest tests across 73 files, 62 Node tests across 9 files and all three Worker dry-run bundles. Production workflow [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839) passed paired Worker deployment, root/health smoke, BRVIN binding, Fatman retrieval and release acceptance. `parmar-ai` version `107a75e0-4f62-4a16-a748-6b0f0b6e6894`; `brvin-service` version `030e0db4-c94d-40e7-a246-a22213aca3b8`; release manifest artifact `14443836745`. Both are at 100% traffic.
- This is topic/Scratchpad infrastructure only. Project Memory files are not loaded, commits are not written to GitHub, and repository/branch/commit snapshots are not pinned yet; these belong to M4.3–M4.4. No automatic expiry/deletion was added. The 200K limit and accounting code are unchanged.

### Vertex transient retry live observation

- **Owner-reported 2026-11-18:** the latest Hydrogen HIGH production request responds and no longer shows `RESOURCE_EXHAUSTED` after PR #338's bounded initial stream-open retry release. This is evidence of recovery on the tested request, not proof that shared Vertex capacity/rate limits can never recur. Keep the retry guard; do not switch model or endpoint silently. If the error recurs, capture the new provider diagnostic and then inspect project/model quota, billing tier and capacity.

### M4.3 — GitHub authorization and reviewed Save to GitHub (complete — live acceptance and production evidence reconciled 2026-11-19 IST)

#### Automated local-D1 tests
- Owner boundary: anonymous GitHub API calls return 401; non-Owner admin sessions return 403; all topic/conversation/preview D1 reads and writes are scoped to the configured Owner.
- Same-origin mutations: manifest creation, installation start, preview creation and save confirmation reject missing/cross-origin mutation headers.
- App boundary: private App manifest requests exactly Metadata read + Contents write and no webhook events. App private key and client secret are encrypted in Owner D1. One-use hashed state is Owner-bound, purpose-bound, expires and rejects replay.
- PKCE: the installation setup callback does not trust the callback installation ID alone. GitHub user authorization with PKCE must complete and GET /user/installations must confirm the exact App ID and installation ID for that authorized user; temporary user access tokens are discarded.
- Permission drift: before issuing repository tokens, verify App ID, installation ID, exact App and installation permission sets, and selected-repository mode. An expanded permission set or all-repository installation fails closed.
- Token scope: repository discovery/attachment receive short-lived Contents read tokens narrowed to the chosen repository ID. Assert no Contents write token is minted before explicit Save confirmation; Save receives one selected-repository Contents write token only after confirmation.
- Draft safety: use only the existing selected model and thinking level; do not fan out a full model-catalogue probe during a memory draft. CountTokens receives the same source contents plus fixed system instruction as GenerateContent. Prompt and output allowance are reserved in the existing 200K D1 ledger and usageMetadata settles a successful generation. GenerateContent uses a 90-second per-attempt timeout and at most three attempts only for explicit HTTP 429 capacity rejections, with bounded exponential backoff/jitter; never replay 408/5xx responses, an ambiguous timeout or a lost connection. A definitive validation/auth/model/capacity rejection (400/401/403/404/429) releases the unused reservation; timeouts and ambiguous server/network failures remain conservatively charged. Verify the visible meter refreshes after the draft attempt.
- Prompt injection and secrets: source Markdown/transcript are untrusted reference data; the fixed system instruction rejects embedded instructions. Assert common private-key/token/API-key/Bearer/labelled-secret patterns are redacted before generation and before persistence. Redaction is best effort, not a promise to identify every possible secret.
- Preview and Owner-text preservation: read existing Markdown at one immutable base commit; show repository, branch, memory root, base SHA, model, thinking level and draft token cost. Allow the exact five named files only; enforce per-file/aggregate limits and 30-minute expiry. Gemini returns additive fragments only; the Worker appends each in a unique preview-scoped block and never replaces existing Markdown or earlier generated/Owner-edited blocks. Regression-test an externally added ordinary line and HTML comment through preview, commit read-back and a subsequent preview. The Owner can edit every file. No GitHub write happens during preview.
- Confirmation and conflicts: require confirmed=true and the complete exact path/content set. Recheck project/repository association and branch head. A changed head returns Conflict without minting a write token or force-updating external content.
- Commit safety: create one Git tree and commit; persist commit SHA in D1 before branch update; use non-force branch ref update. GitHub 409/422 remains Conflict. A write interrupted after commit creation must recover using the recorded SHA, without creating a second commit.
- Verification: read the exact commit and every expected file at that commit SHA and compare complete content. Only after read-back succeeds may D1 mark the preview Synced, update the topic commit SHA and promote an existing Scratchpad conversation to the topic.
- Idempotency: repeated confirmation after Synced returns the same stored commit result and does not mint a second write token or create another commit. Verifying/committing states retry the stored commit; conflicts require a fresh preview.
- Transcript integrity: compare conversation/message IDs and content plus generation metadata before/after preview and save. GitHub save does not delete or rewrite D1 transcript messages. The draft generation alone adds its measured/estimated usage to the same 200K ledger.

#### Owner-authenticated browser acceptance — completed

The live acceptance journey is complete. Evidence is recorded in [OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md](OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md): the dedicated App is installed selected-only on the private hub; the topic/repository/branch/root association is present in production D1; the external-edit stale preview reached Conflict; a fresh preview retained the Owner's marker; the Owner explicitly confirmed Save; and D1/GitHub both record the verified Synced commit. The saved production conversation was already a Topic conversation, so live Scratchpad promotion was not applicable to this run. The local-D1 GitHub-save regression creates a conversation without a topic, saves it to the selected topic and asserts the post-Synced topic association; promotion occurs only after exact read-back.

The post-save read-only reconciliation also compared all five preview files byte-for-byte at the saved commit SHA and current hub main, then reconciled nine same-chat settled reservation rows to the D1 meter: 40,496 used, zero reserved, under the unchanged 200,000-token limit. No production row was modified to obtain this evidence.
Current-head PR validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files, and all three Worker dry-run bundles. PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`. Production workflow [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deployment, root/health, BRVIN service binding, Fatman retrieval and release-acceptance checks. Deployed parmar-ai version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and brvin-service version `d43a9f7b-32b3-486f-9845-75ed11811165`, each at 100% traffic. This historical PR #346 deployment record is superseded by the later #352, #355 and #356 fixes and the final live acceptance recorded below. The current production Worker versions and the read-only M4.3 closeout are recorded in [OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md](OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md).

## Owner Intelligence — project memory and token-aware continuity (M4.4 accepted; M4.5–M4.8 planned)

M4.3 and M4.4 are fully accepted. M4.4 implementation, automated validation, production release and authenticated Owner attach/read plus independent Scratchpad-isolation walkthrough passed on 2026-11-19. M4.5–M4.8 remain future milestones. See [OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md) and [M4.4 acceptance record](OWNER_INTELLIGENCE_M4_4_ACCEPTANCE.md).

### M4.2 — Scratchpad and topic foundation
- New Chat creates a D1-backed Scratchpad with no forced project selection.
- Scratchpads survive browser refresh, browser storage clearing and a different device while the Owner remains authenticated.
- Existing conversation IDs, messages, generation metadata and 200K usage rows migrate without loss; migrations are additive/reversible where practical.
- No automatic expiry is applied unless the Owner explicitly enables a documented, recoverable retention policy.

### M4.3 — GitHub authorization and Save to GitHub
- Only the authenticated Owner can start/complete repository authorization and memory commits.
- GitHub App permissions are limited to Owner-selected repositories and required Contents read/write operations; tokens/private keys never reach the browser or logs.
- Save preview is visible and editable before explicit confirmation; failed/conflicting commits never show Synced.
- Multi-file save is one conflict-aware atomic commit; after commit, the app reads back/validates the expected commit SHA and file set.
- The original D1 transcript is unchanged by summarization or GitHub sync.

### M4.4 — Attach and load Project Memory (implementation/CI and authenticated Owner acceptance passed)
- **Manifest validation:** versioned hub/catalog/project/workstream/feature manifests are schema- and identity-validated; invalid IDs, paths, namespaces, unsupported versions and unlisted memory references fail closed.
- **Allowlist:** only project-memory.md, progress.md and decisions.md are implicitly loadable for Owner Gemini Intelligence. Archive, session notes, handoff/collaboration folders and unlisted files are excluded.
- **Pinned snapshot integrity:** each attachment persists Owner and conversation scope, stable project/workstream/feature IDs, exact hub repository/branch/commit, governing manifest blob SHAs, active file blob SHAs and immutable Markdown content in D1.
- **No silent refresh:** a later hub main update does not change an existing conversation's pinned prompt context.
- **Isolation:** cross-Owner snapshot reads are denied. One primary project scope is allowed by default. A secondary scope requires both the conversation-level cross-project switch and explicit per-snapshot Owner opt-in. Disabling cross-project mode deactivates secondary scope without deleting the primary snapshot.
- **Prompt accounting:** pinned memory is included in the exact effective prompt measured by selected-model Vertex CountTokens before existing M4.1 prompt/output reservation. The 200,000-token conversation budget is unchanged and project-memory estimates do not increment cumulative chat usage until turns are sent.
- **Trust boundary:** memory Markdown remains untrusted reference data and cannot override application or Owner policy.
- **CI evidence:** workflow [44568064917](https://github.com/ashini-x/parmar-ai/actions/runs/44568064917) passed TypeScript, 521 Vitest tests/76 files, 62 Node tests/9 files and three Worker dry-run builds.
- **Deployment evidence:** workflow 44568064917 deployed both Workers and passed root, BRVIN-backed health and release acceptance. M4.4 versions: parmar-ai fd932efb-9d97-4e8f-837f-79a460409495; brvin-service 90b21e52-2a55-402e-8398-0c6e308d3a0e.
- **Authenticated Owner production acceptance — PASSED 2026-11-19:** from a New Chat Scratchpad, select the Owner Intelligence topic and Owner Gemini Intelligence project; leave Workstream/Feature at none and both cross-project controls off; attach pinned memory. The card showed `ashini-x/owner-memory-hub`, `main`, pinned commit `91e5c98cbc375b3c418207b6559021b16200e0b4`, the three allowlisted active file paths/blob provenance and a 2,599-token estimate. Gemini 4 Hydrogen / High reproduced the pinned SHA and active file names in its answer. A separate unattached Scratchpad asked for the private project's SHA/files received an explicit no-access/no-memory response. The symbolic `owner-memory-v1` label was not separately visible; catalog commit and file blob provenance were visible. See the M4.4 acceptance record for the complete observation and limitations.

### M4.5 — Automatic rollover
- The UI warns at 180,000 committed-plus-reserved tokens and offers Roll Over at 190,000; the optional 195,000 state is not implemented. The server independently enforces the 190,000 threshold for rollover and retains the existing 200,000 hard lock.
- Rollover is unavailable while an in-flight reservation exists. The reservation update requires the conversation to remain active so a generation that passed preflight before rollover cannot reserve tokens after the source is archived.
- Rollover preserves every source message, generation metadata row and old usage/reservation ledger; the old conversation becomes read-only. One linked successor inherits topic/session scope and gets an independent zero-used/zero-reserved 200,000-token ledger.
- Clone only the source's active immutable Project Memory snapshot(s), preserving the exact hub repo/branch/commit, manifest/file blob provenance and scoped opt-ins.
- Handoff D1 record contains the source/successor conversation IDs, complete ordered source message IDs, snapshot provenance, deterministic bounded Markdown, and GitHub sync status/commit. Approval-language detection is only a candidate with source ID; tests must ensure it is not silently promoted to an accepted decision.
- A unique `rollover:<source-id>` D1 memory-job/outbox key and unique handoff-per-source constraint make timeout/retry idempotent. Repeating rollover must return the same successor; concurrent attempts must not create duplicates.
- Archived source append, edit and generate requests are rejected server-side; in particular, test the reservation race after an earlier prompt preflight.
- The successor UI displays the handoff as historical reference material. Its first model request includes the handoff in the exact selected-model Vertex CountTokens input and the same measured GenerateContent prompt; no hidden model/summarizer is used to create the handoff.
- Owner-reviewed GitHub Save preview must include the complete handoff as `handoffs/<date>-<successor-prefix>.md`, not only a bounded session excerpt. The file is outside the active Project Memory manifest allowlist. Existing branch-head Conflict behavior remains strict.
- Set handoff/job Synced only after the existing Save flow commits and reads back every preview file byte-for-byte. If GitHub is unreachable, D1 remains canonical and the UI shows Sync pending review; the user can continue in the D1-backed successor and retry through the reviewed Save flow.
- Tests must also cover Owner/same-origin authorization, below-threshold rejection, zero reservation at rollover, D1 atomicity, fresh budget, snapshot clone, idempotent retry, source transcript preservation and pending/synced state. Do not mutate production token usage to manufacture thresholds.

### M4.5 current deployment evidence — 2026-11-20 IST

- Reconciled PR validation [#44620484798](https://github.com/ashini-x/parmar-ai/actions/runs/44620484798) passed current-head TypeScript, 522 Vitest tests/76 files, 62 Node tests/9 files and all three Worker dry-run builds.
- Merged main release [#44620959101](https://github.com/ashini-x/parmar-ai/actions/runs/44620959101) passed the same validation and deployed both Workers. Root/health smoke, BRVIN connectivity and Fatman source readiness passed.
- Production D1 read-only schema checks confirmed `owner_intelligence_handoffs`, `owner_intelligence_memory_jobs`, uniqueness constraints and owner/status indexes. The schema queries wrote zero rows; no usage, transcript or conversation data was modified.
- **Still required:** authenticated Owner browser verification of the 180K warning/190K action when an eligible test conversation exists, one linked successor, old transcript read-only preservation, fresh 0/200K usage, pinned snapshot/handoff visibility and the complete reviewed GitHub handoff artifact. Do not modify production usage to manufacture a threshold, and do not confirm Save on the Owner's behalf.

### M4.6 — Token-aware context builder and historical recall
- The exact complete prompt—including all application instructions, project context, retrieved history, current history and new user turn—is measured for the chosen model/API before the user turn mutation is committed.
- Context selection is token-based, respects that model's real context/output constraints and reserves output capacity; character counts and fixed turn counts are only early filters, never final acceptance checks.
- D1 keyword/FTS retrieval returns exact source messages/message pairs with IDs; summaries always retain provenance links to their source turns.
- A failed search never claims complete recall; all original D1 turns remain accessible.
- Historical retrieval is constrained to the authenticated Owner and selected topic/project.

### M4.6-P0 — Cloudflare capacity and durability readiness (required before M4.6 implementation)

These checks are a future measurement/release gate, not evidence that the current Cloudflare account has been measured. The Owner confirms Workers Free; actual aggregate usage and remaining headroom are unknown until this gate runs. Use the authoritative values and links in [OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md](OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md), then re-check live Cloudflare documentation and dashboard.

- Confirm the actual account plan, billing state, spend limit/alerts and the inventory of all Workers/services sharing account allowances.
- Capture representative and peak Workers requests/day, CPU time per invocation, 10 ms Free CPU failures, subrequest counts, errors and traffic patterns. Exercise the Owner chat, preview, context assembly, historical recall and GitHub verification paths with production-like payload sizes.
- Capture D1 rows read/written, storage, per-database size, query latency, queries per Worker invocation and index/query plans. Include existing production usage; verify that query exhaustion is surfaced without losing the D1 transcript or usage ledger.
- If a dedicated Owner Queue is proposed, measure write/read/delete/retry/DLQ operations and retention. On Free, verify the 24-hour message expiry is not relied upon for durable state.
- If a dedicated Owner Workflow is proposed, measure executions, steps/day, CPU per step, persisted state, concurrency and retention; do not assume completed Workflow state is permanent.
- Verify a D1 outbox/reconciler can re-dispatch an idempotent pending job after Queue message expiry, Queue/consumer outage, retry exhaustion, deployment or Workflow instance state expiry. A duplicate delivery must not produce a duplicate GitHub commit.
- Produce a dated load/cost report and recommend (a) stay Free with measured headroom, (b) optimize queries/CPU/retries, or (c) move to Workers Paid. Estimate Workers, D1, Queues and Workflows separately. A $5/month Paid base is not an all-in bill cap; inspect spending-limit effects before enabling overages.
- No Free-to-Paid change and no new D1 database, Queue, Workflow, R2, KV, Vectorize, AI Search or Workers AI resource is part of this gate without explicit Owner approval.

### Locked single-provider regression checks

- Assert Owner chat generation, CountTokens and memory drafting use the selected verified Gemini model through the Vertex adapter; the Save draft preserves the selected thinking level and consumes the same 200K chat ledger.
- Assert a Vertex error remains an explicit error and preserves state; no automatic alternate model, provider or hidden summarizer is invoked.
- Assert Owner Intelligence has no Workers AI binding/provider path. Do not confuse existing unrelated BRɅIN/student Cloudflare products with the Owner runtime.

### M4.6 — Cloudflare Owner Context Replicator and bounded-growth acceptance

These are planned tests, not tests that have passed. The Replicator is an approved M4.6 architecture and is not implemented yet.

- **Owner boundary:** unauthenticated and non-Owner callers cannot access the middleware, D1 conversation data, project snapshot, retrieval endpoint or outbox jobs. Every query and job is scoped to the configured Owner principal.
- **Context source contract:** assemble from mandatory application/Owner instructions, the current turn, bounded recent valid turns, compact structured state, pinned manifest-selected active Project Memory, and only those older exact D1 message pairs returned by scoped retrieval. Pending/failed/empty assistant rows are excluded; role ordering stays valid.
- **Single budget:** all included sources, including project memory and retrieval, count toward the same selected-model/API input budget B after required output capacity and request overhead are reserved. There is no unmetered second context bucket.
- **Exact final measurement:** call Vertex CountTokens using the selected model/API on the final effective prompt. The contents passed to generation must match those measured. Character counts and turn counts are early filters only.
- **Deterministic trimming:** when optional context exceeds B, remove it in documented lowest-priority order and re-count. Never remove security policy or silently truncate the current turn. If mandatory instructions plus the user turn cannot fit, fail before committing the prompt or starting generation.
- **M4.1 accounting order:** preserve exact CountTokens preflight, atomic D1 reservation of prompt plus permitted output, concurrency protection, prompt-persistence ordering and final usage settlement. A rejected request leaves the original prompt and later turns intact.
- **10/50/100/200-turn scaling series:** run a deterministic scripted workload with a fixed selected model, fixed B, fixed project snapshot and representative per-turn token sizes. Assert every request input is ≤ B and the aggregate prompt input over N turns is ≤ N × B. Once the recent suffix/retrieval set has saturated, adding older D1 transcript rows must not cause those rows to be replayed or increase the prompt beyond B.
- **Quadratic baseline comparison:** run the same scripted conversation using naive full-history replay and record its triangular aggregate input-token curve. The bounded-context path must obey the N × B linear upper bound and materially remain below the full-replay aggregate for long histories. Do not use this finite benchmark to claim a mathematical proof for arbitrary workloads; the proof is the per-request invariant plus the fixed-B sum bound.
- **Canonical transcript integrity:** the full D1 transcript and usage records remain intact after context assembly, trimming, failed retrieval, rollover or compaction. Retrieval returns exact message IDs/pairs and source provenance.
- **Failure and injection handling:** empty, slow or failed retrieval cannot produce a false “complete recall” claim; it degrades to a safe bounded context or a clear error. Project notes and historical user text are untrusted data and cannot override application policy.
- **Memory job durability:** Owner-confirmed save/rollover/compaction writes an idempotent D1 outbox item before dispatch. Duplicate Queue/Workflow delivery cannot create duplicate GitHub commits; missing GitHub connectivity leaves a durable D1 handoff and a truthful pending status.

### M4.7 — Compact Memory and Fork Chat
- Active project memory above 40,000 measured tokens triggers a warning, not an automatic rewrite.
- Compaction produces a preview and diff; a master context targets under 10,000 tokens only where it can preserve required state and decisions.
- Source notes are archived in the same versioned commit and are not silently discarded; provenance is preserved.
- A fork is linked to its parent, has an independent 200K budget and pins the same project-memory revision; experiments do not update main project memory until explicit save/merge.

### M4.8 — Context caching and retrieval optimization
- Cache support, minimum token count, TTL, cache-read/write pricing, API surface and region are checked for the exact selected model before creating/reusing cache entries.
- Cache namespaces are isolated by Owner/project/session as required; stale or unavailable caches fall back to the equivalent uncached request.
- Tests and production metrics compare token counts, cache hit rate, latency and cost before caching or semantic indexing is enabled.
- No model, thinking level, prompt policy or access boundary changes silently as a caching fallback.

These criteria must be added to the relevant automated suites as each sub-milestone is implemented. The existence of this planned checklist is not evidence of implementation or production acceptance.

## Owner Memory Hub and AI Collaboration — planned acceptance (not run)

These checks become mandatory as M4.4–M4.8 implement the approved architecture. They are not evidence of current runtime capability.

### Repository and separation
- Verify the Owner Memory App is installed in selected-only mode on the private hub repository and has only Metadata read + Contents read/write, with no webhook events.
- Verify the hub contains no application source trees or credentials. Source repositories remain unchanged and are referenced only by repository/path/commit metadata.
- Verify ChatGPT uses its separate GitHub/deployment authorization; no ChatGPT credential is stored in Worker bindings, D1, prompts or logs.
- Verify multiple project topics can target the same hub repository while using distinct project memory-root paths during the M4.3 transition.

### Hierarchy and context isolation
- Create unrelated projects and several workstreams/features under one project using stable IDs and validated manifests.
- Verify a new Scratchpad stays unclassified until Owner promotion.
- Verify one project/workstream/feature conversation loads only its allowed manifest paths and excludes unrelated projects by default.
- Verify cross-project retrieval occurs only after explicit Owner intent and returns source commit/path provenance.
- Verify snapshots remain pinned when the hub branch advances; refresh is explicit.

### AI collaboration
- Record a Gemini proposal, separate ChatGPT review, Gemini response and Owner decision as distinct versioned artifacts.
- Prove no proposal/review can set its own status to accepted or implementation-ready.
- Prove ChatGPT refuses implementation of a proposed-only/unapproved brief and requires a complete bounded implementation contract.
- Verify ChatGPT implementation reports contain actual PR/merge commit, test results, deployment workflow/version and rollback evidence; missing evidence stays explicitly unknown.
- Verify Gemini treats ChatGPT artifacts as untrusted input and can flag differences from the accepted design without mutating source code.
- Verify no GitHub commit automatically wakes the other AI or shares its private transcript; the Owner initiates each handoff.

### Shared-hub concurrency
- Two writers changing separate project paths must not lose either update.
- A same-path or controlling-manifest collision must result in a reviewable conflict, not force-push or silent last-write-wins.
- An unrelated branch advance may be rebased only after touched-file and manifest blob SHA preconditions pass; retry is bounded and idempotent.
- Until path-aware concurrency is shipped, the existing strict branch-head conflict behavior remains the accepted safe fallback.

### Original Gemini token/continuity acceptance remains mandatory
- Preserve the exact M4.1 200,000-token per-conversation budget and reservation/settlement ordering.
- Count project, workstream, feature and collaboration artifacts inside one M4.6 per-request budget B with the exact final Vertex CountTokens request.
- For fixed B, test 10, 50, 100 and 200 turns; prove every request ≤ B and aggregate prompt input ≤ N × B while a naïve full-history baseline exhibits triangular growth.
- Preserve complete D1 transcript, exact historical message IDs, role order and provenance despite compaction, rollover, failed retrieval, forks and GitHub sync conflicts.
- Preserve all seven Owner journeys recorded in the canonical Memory and Context Architecture.

### Topic API routing regression — production issue found 2026-11-19 IST

- Production diagnosis: the browser client used `/admin/api/intelligence/conversations/topics` for topic GET/POST/PATCH; the Worker exposes `/admin/api/intelligence/topics`.
- Read-only production D1 inspection of the configured `parmar-ai-admin-prod` binding found zero rows in `owner_intelligence_topics`; the Owner's attempted `Owner Intelligence` topic was not created.
- Corrective source change introduces a dedicated `topicsApi`, routes list/create/rename to the Worker route, and uses a topic-specific `Retry topics` handler instead of incorrectly showing `Could not load conversations` and retrying only conversation history.
- Regression test asserts the topic status container, correct GET/POST/PATCH endpoint strings, absence of the incorrect conversations/topics path, and topic-specific retry behavior.
- **Automated fix validation and production deployment passed:** PR [#352](https://github.com/ashini-x/parmar-ai/pull/352), merge `c555d9428421fbbe600a872093730fa3dce644e1`; workflow [44411119143](https://github.com/ashini-x/parmar-ai/actions/runs/44411119143) succeeded. Cloudflare deployment `582658d9-cd4c-4d2a-b2a8-4325c18591e0` serves `parmar-ai` version `1df8cbae-4777-44f9-87b4-e26dc6acde93` at 100% traffic. The full workflow passed typecheck, Vitest, Node tests, three dry-run bundles, production deployment and root/BRVIN/Fatman smoke checks.
- **Historical pending check — completed and superseded 2026-11-19:** following PR #352, the Owner created/attached the topic and the production D1 record now confirms `Owner Intelligence` is attached to `ashini-x/owner-memory-hub`, `main`, and `projects/owner-intelligence/memory`. The full final acceptance evidence follows below.

### M4.3 Owner acceptance and production closeout — COMPLETE (2026-11-19 IST)

**M4.3 is fully accepted and closed.** The complete dated evidence is in [OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md](OWNER_INTELLIGENCE_M4_3_ACCEPTANCE.md).

- **Owner live test:** a stale preview after an external GitHub edit reached Conflict. A fresh Preview included the manual marker; the Owner explicitly confirmed Save to main; the Owner then confirmed generated progress was appended below the manual comment on GitHub read-back.
- **Production D1 association:** conversation 43bca53d-baa1-4a49-a447-947f3fb8e243 has session_kind=topic and is associated with topic Owner Intelligence (a3a58a83-90a0-4c23-a9a4-46eaf2ae6709). Topic metadata pins the private ashini-x/owner-memory-hub, branch main, root projects/owner-intelligence/memory, and current commit b40e46c50ee4e7663f5d2c2dd6ad85725979b656. The installation is active and selected-only.
- **Conflict and Synced evidence:** stale preview 46116e56-1890-4cf5-91b9-9a145b3c0510 is conflict; final preview 86534fbd-05ce-43c3-ae8b-866758efbe62 is synced to commit b40e46c50ee4e7663f5d2c2dd6ad85725979b656. All five persisted preview files match byte-for-byte at the saved SHA and current hub main.
- **Scratchpad promotion scope:** this saved conversation was already a Topic conversation, so live promotion was not applicable to this particular journey. The local-D1 GitHub-save regression creates a conversation without a topic, saves it to the selected topic and asserts the post-Synced association; the implementation promotes only after exact five-file read-back.
- **Usage ledger:** nine of nine reservation rows for this same conversation are settled; actual-token totals sum to 40,496, matching D1 session usage. The meter is 40,496 used / 200,000 limit / 0 reserved. No token top-up was made.
- **Deployment and CI:** PR #356 CI [44455732385](https://github.com/ashini-x/parmar-ai/actions/runs/44455732385) passed typecheck/check, 513 Vitest tests across 75 files, 62 Node tests across 9 files, and all three Worker dry-run builds. Cloudflare deployment listings show parmar-ai version 74fade9d-422e-4a91-8be4-f98340b76eb4 and brvin-service version 1999a4c1-9137-447e-8dc7-596f70a338b9 at 100% traffic. PR CI and deployment activation are distinct; no additional post-#356 production smoke is claimed.

**Do not repeat** the accepted live Save, reinstall/broaden the App, or weaken the strict branch-head Conflict rule. M4.3 and M4.4 are closed. M4.5 — Automatic rollover and handoff — is now the next milestone.

### M4.4 authenticated production Owner acceptance (PASSED 2026-11-19 IST)

1. The Owner created a New Chat Scratchpad, selected the connected Owner Intelligence topic and Owner Gemini Intelligence project, left Workstream and Feature at none, kept both cross-project controls unchecked and selected Attach pinned Project Memory.
2. The Project Context card displayed the stable project, private hub `ashini-x/owner-memory-hub`, branch `main`, full pinned commit `91e5c98cbc375b3c418207b6559021b16200e0b4`, the three active allowlisted file paths (`project-memory.md`, `progress.md`, `decisions.md`), file blob identifiers and 2,599 estimated tokens.
3. Gemini 4 Hydrogen / High answered a fresh prompt using the attached Project Memory and reproduced the exact pinned SHA and active file names. Captured excerpts also showed project purpose/governance and distinguished a historical commit mentioned in `progress.md` from the pinned snapshot.
4. The symbolic `owner-memory-v1` label was not separately visible in the captured panel; the catalog-commit prefix and file blob provenance were visible. Do not claim the symbolic label was displayed.
5. The Owner created a second Scratchpad with no topic, project or Project Memory attached. Gemini explicitly said it had no access and could not verify the private project SHA or active files.
6. This authenticated browser test complements, but does not replace, automated M4.4 validation and release checks; those checks alone do not exercise authenticated Project Context. The M4.4 acceptance record contains the complete observation and limitations.
7. **Result:** M4.4 is accepted and closed. M4.5 is next; M4.6-P0 remains required before M4.6 only.
