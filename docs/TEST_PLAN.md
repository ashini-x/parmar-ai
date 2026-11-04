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
