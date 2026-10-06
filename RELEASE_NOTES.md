# Release 2.4.1 — Quota Messaging & Stable v2.4

## Changes
- Keeps the rebuilt v2.4 evidence-based personalization architecture as the base.
- Separates burst-limit notifications from daily-limit notifications.
- Burst protection remains 5 questions per 10 seconds by default.
- Daily allowance remains 20 accepted AI questions per India calendar day, resetting at 00:00 IST.
- Analytics now records `burst_limit_reached` separately from `daily_limit_reached`.
- The user-facing daily-limit message explicitly tells the student that the daily allowance is complete and to return after the next daily reset.
- The burst-limit message remains a short temporary cooldown message.
- No D1 schema change.

## Regression target
- A user who exceeds the burst window receives the burst message.
- A user who reaches the daily quota receives the daily-limit message.
- Neither rate-limit path starts an AI job or leaves an unnecessary Telegram typing indicator.

---

# Release 2.4.0

## Evidence-based personalization
- Keeps the v2.3 conversation-intelligence and answer-reliability behavior as the stable base.
- Adds persistent learning-signal evidence (`confusionCount`, `weakCount`, `lastSeenAt`) with repeated-signal thresholds before a topic becomes a persistent attention area.
- Safely migrates legacy v1 profiles stored under the existing `profile:v1` key without requiring a D1 migration. Legacy attention topics become one historical signal and are not immediately re-promoted as persistent attention.
- Prevents generic facts and simple follow-ups from generating weakness/confusion signals unless the student explicitly provides evidence.
- Keeps revision recommendations anchored to the current topic for confusion/weakness/revision-mode questions.
- Makes student-profile persistence best-effort: a profile write failure is logged but must not prevent a valid AI answer from being delivered.
- Preserves the existing Queue, Durable Object, D1, Vertex AI, Telegram, daily-limit, and admin architecture.

## Regression targets
- Fact -> `iska reason?` -> `simple mein samjha de` stays on the same topic and does not create a fake focus recommendation.
- `X se confuse ho raha hoon` creates one learning signal but does not become a persistent attention area until the evidence repeats.
- A second explicit confusion/weakness signal on the same topic promotes that topic into attention areas.
- Legacy v2.3 profiles load without `undefined` arrays and migrate safely to the v2 profile shape.
- Profile persistence errors cannot strand the Telegram job in an endless typing state.

---


## Conversation intelligence
- Added rolling six-turn per-student conversation context from completed jobs.
- Follow-ups such as “iska”, “isko”, “isme”, “ye”, “same”, “phir se”, and “simple mein” are explicitly resolved against recent context.
- Confusion and simplification requests now instruct the model to address the exact sticking point instead of restarting the topic.

## Answer reliability
- `MAX_TOKENS` responses are retried instead of exposing partial answers.
- Malformed/truncated JSON-like model output is rejected and retried.
- Literal `\n`, `\r`, and `\t` escapes are normalized before Telegram delivery.
- Student-facing delivery reloads the latest profile after the current answer updates learning signals.

## Student experience
- Keeps SSC-first concise-answer behavior.
- Keeps adaptive thinking with HIGH as the ceiling: LOW for direct facts, MEDIUM for normal questions, HIGH for complex/confused/trap questions.
- Keeps the 20 accepted AI-question/day/user rule.
- `/reset` now also starts a fresh conversational context while leaving admin analytics intact.

## Compatibility
- No D1 schema change.
- Existing Queue, Durable Object, Vertex AI credentials, Telegram secrets, and admin dashboard remain compatible.

---

# Release 2.2.1

- Fixed D1 schema initialization to use the supported `env.DB.batch()` API.
- This resolves the admin dashboard Worker exception that occurred immediately after successful login.
- Bumped APP_VERSION to 2.2.1.

# Release 2.2.0 — Central Admin Analytics

- Keeps Durable Object + Queue + Vertex AI user flow unchanged.
- Adds D1 as a centralized analytics/admin projection.
- Adds a password-protected `/admin` dashboard and JSON APIs.
- Tracks who first checked the bot, Telegram identity fields, questions, timestamps, answers, topics, subjects, modes, thinking level, grounding, attempts, latency and important command events.
- Adds daily raw-log cleanup (90 days by default).
- Adds a daily scheduled cleanup trigger.
- Keeps 20-question/day per Telegram user in the Durable Object.

Earlier release notes remain in Git history.


## 2.3.0 — Conversation Intelligence & Answer Reliability

- Added a rolling six-exchange per-student conversation context from completed jobs in the Durable Object.
- Follow-up references such as “iska”, “isko”, “isme”, “ye”, “phir se”, and “simple mein” now have explicit continuity instructions.
- Added confusion-aware and simplification-aware response behavior.
- Rejects structured Gemini responses that end at `MAX_TOKENS` instead of showing partial answers.
- Retries incomplete structured output with a compact completion instruction and a slightly larger one-time output ceiling.
- Normalizes literal `\n`, `\r`, and `\t` sequences before Telegram delivery.
- Student delivery now reloads the latest profile after the current question updates learning signals.
- No D1 schema change; existing admin database remains compatible.
