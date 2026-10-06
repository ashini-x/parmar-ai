# Production Test Plan — v2.4.1

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
