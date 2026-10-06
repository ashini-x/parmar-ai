# Production launch checklist

- [ ] GitHub repository contains no credentials.
- [ ] Vertex AI API is enabled in the exact project configured in `GCP_PROJECT_ID`.
- [ ] Runtime service account has Vertex AI User permission.
- [ ] Billing/trial credit is attached to the same Google Cloud project.
- [ ] Cloudflare Workers Paid is active for the public launch.
- [ ] Queue `parmar-ai-questions-prod` exists.
- [ ] DLQ `parmar-ai-questions-dlq` is configured.
- [ ] All six Worker secrets are present.
- [ ] `/health` shows Telegram, Vertex, Queue and Job Store configured.
- [ ] Telegram webhook is registered with the secret token.
- [ ] `/start`, `/exam cgl`, `/profile`, `/reset` work.
- [ ] A real SSC GA/GS question returns an answer.
- [ ] Typing continues while processing in a private chat.
- [ ] Cloudflare Observability is enabled.
- [ ] Google Cloud budget alerts are configured.
- [ ] The first public test is monitored before advertising broadly.
- [ ] Current-affairs questions are verified through Google Search grounding when enabled; static SSC questions do not use web grounding.
- [ ] The 20/day student limit is confirmed in `/profile` before launch.

## Capacity reality

The system is designed to absorb bursts instead of failing the webhook immediately. That does not mean Google or Telegram provide infinite capacity. During an extreme simultaneous spike, questions can spend longer in the Queue; the user has already received the acknowledgement, and the job is durable and retryable.


## Admin / analytics

- [ ] Create D1 database `parmar-ai-admin-prod` in the Cloudflare dashboard.
- [ ] Put its real database ID into `wrangler.jsonc`.
- [ ] Add `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET` as Worker Secrets.
- [ ] Deploy and open `/admin`.
- [ ] Confirm the dashboard shows the test student and test questions.
- [ ] Add a Cloudflare Access application for `/admin*` (do not protect `/telegram/webhook`).
- [ ] Confirm 90-day scheduled cleanup is configured.
- [ ] Before a major public launch, monitor D1/Workers/Queue Free-plan limits and upgrade Cloudflare before limits become user-visible.


## 2.4.0 behavior tests
- Ask a fact question, then a contextual follow-up such as “iska main reason?”, then “simple mein samjha de”; verify the bot stays on the same topic.
- Say “ryotwari se confuse ho raha hoon” after discussing Permanent Settlement; verify the answer directly contrasts the two rather than restarting the entire chapter.
- Confirm no literal `\n` text appears in Telegram.
- Confirm a partially generated/`MAX_TOKENS` response is never sent as a partial answer.
- Run `/reset` and verify subsequent follow-ups do not use the pre-reset conversation.


## v2.4.0 evidence-based personalization regression cases
- Ask a fact question, then “iska reason?”, then “simple mein samjha de”; verify same-topic continuity and no speculative focus recommendation.
- Say “ryotwari se confuse ho raha hoon” after discussing Permanent Settlement; verify direct contrast and exactly one learning signal.
- Ask another normal question; verify a single signal does not create a persistent attention area.
- Repeat an explicit confusion/weakness signal for the same topic; verify the topic is promoted to attention areas.
- Run `/profile`; verify learning signals render safely even when none exist.
- Test a v2.3-existing student profile; verify it loads and migrates without `undefined` arrays.
- Temporarily induce a profile-write failure; verify the AI answer is still delivered and typing does not remain stuck.
