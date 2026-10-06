# Production Test Plan — v2.5.0

## Smoke tests

| Test | Expected |
|---|---|
| `/start` | Start message returns. |
| Ordinary SSC fact | Concise answer + SSC takeaway. |
| Follow-up `iska reason?` | Previous topic is resolved. |
| `simple mein samjha de` | Same topic is simplified. |
| Explicit confusion | Targeted comparison/explanation. |
| `/profile` | Profile and usage display. |
| `/reset` | Profile/context reset; quota unchanged. |

## Personalization tests

### First confusion signal
Input:
`Mujhe zamindari aur mahalwari baar baar confuse hota hai.`

Expected: explanation + one learning signal; no overconfident permanent diagnosis.

### Repeated signal
Repeat a confusion/weakness signal on the same topic.

Expected: topic may promote into `attentionTopics` once the configured evidence threshold is reached.

### False-positive prevention
Ask a generic factual question and a simple contextual follow-up.

Expected: no invented weakness signal merely because the question was asked.

## Rate-limit tests

### Burst
Send five accepted questions quickly, then a sixth inside the active window.

Expected: burst message; no AI job for the rejected request.

### Daily
Reach the configured daily count.

Expected: explicit daily-quota message; no additional AI job; counter resets at 00:00 IST.

### Reset isolation
Use `/reset` after reaching part of the daily quota.

Expected: learning/conversation state resets, daily usage does not.

## Failure tests

- Invalid Telegram secret → HTTP 401.
- Malformed webhook JSON → HTTP 400.
- Group message → DM-only notice.
- Profile missing `learningSignals` → normalized safely.
- Gemini malformed JSON → retry/controlled failure.
- Gemini `MAX_TOKENS` → retry/controlled failure.
- Profile write error → answer still delivered.
- Telegram delivery failure → job state remains diagnosable.

## Release acceptance

A release is not production-ready until all smoke, personalization, rate-limit, and failure tests pass against the exact artifact being deployed.


## Privileged-access tests

- Configure a test owner ID and verify `/id` returns that account's Telegram user ID.
- Verify the owner can exceed the 20/day daily quota.
- Verify the owner is still blocked by 5 questions / 10 seconds.
- From the owner, `/grant <target_id>` gives unlimited daily access to the target.
- Verify the target is not blocked by the 20/day limit.
- `/unlimited <target_id>` reports the expected state.
- `/revoke <target_id>` restores the normal 20/day policy.
- Verify an ordinary user cannot execute `/grant` or `/revoke` as an admin command.
