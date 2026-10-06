# Production Checklist — v2.5.2

## Source

- [ ] Correct v2.5.2 source is deployed.
- [ ] No local `.env`, `.dev.vars`, key files, or credentials are committed.
- [ ] `wrangler.jsonc` contains no secrets.
- [ ] Version in code/config/docs is consistent.

## Cloudflare

- [ ] Worker deployed.
- [ ] Durable Object binding `JOB_DEDUPE` active.
- [ ] D1 binding `DB` points to production database.
- [ ] Queue producer active.
- [ ] Queue consumer active.
- [ ] Dead-letter queue exists.
- [ ] Observability/logging enabled.
- [ ] Daily cleanup cron enabled.

## Secrets

- [ ] Telegram token configured as secret.
- [ ] Telegram webhook secret configured.
- [ ] Telegram setup secret configured.
- [ ] Google service-account credentials configured as secrets.
- [ ] Admin password and session secret configured as secrets.
- [ ] Owner/admin Telegram ID configured outside the public repository.
- [ ] Any additional admin IDs are explicitly reviewed.

## Telegram

- [ ] Webhook secret validation works.
- [ ] Private chat accepted.
- [ ] Group messages rejected safely.
- [ ] `/start` works.
- [ ] `/help` works.
- [ ] `/reset` works.
- [ ] `/profile` works.
- [ ] `/exam` works.

## AI

- [ ] Direct fact question succeeds.
- [ ] Follow-up continuity succeeds.
- [ ] Simplification succeeds.
- [ ] Explicit confusion handling succeeds.
- [ ] Profile learning signal persists safely.
- [ ] Malformed/incomplete model output is rejected/retried.
- [ ] Time-sensitive grounding behaves as configured.

## Limits

- [ ] 20/day default confirmed.
- [ ] 5/10-second burst default confirmed.
- [ ] Daily-limit text differs from burst-limit text.
- [ ] `/reset` does not reset daily quota.
- [ ] Quota resets at 00:00 IST.
- [ ] Owner can exceed the 20/day daily quota.
- [ ] Owner is still subject to 5/10-second burst protection.
- [ ] `/grant`, `/revoke`, and `/unlimited` work only for configured admins.

## Admin/security

- [ ] `/admin` requires authentication.
- [ ] Cloudflare Access is applied to `/admin*`.
- [ ] No secrets appear in logs.
- [ ] D1 retention cleanup verified.
