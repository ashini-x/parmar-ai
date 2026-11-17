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

### M4 automated evidence

PR #320 validation workflow [44167885365](https://github.com/ashini-x/parmar-ai/actions/runs/44167885365) passed `npm run check`, 482 Vitest tests across 72 files, 62 Node tests across 9 files and all three Worker dry-runs. The merged main release workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) also passed validation, paired production deployment, root/health smoke checks, BRVIN service binding, Fatman readiness and production release acceptance. Deployed versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Release manifest artifact: `14367310746`. No rollback was needed. These automated tests use mocked Vertex responses; a real billed Owner browser prompt/stream/Stop/Edit/Regenerate acceptance is still pending. Automatic in-place SSE reconnection is deferred and is not implemented.
