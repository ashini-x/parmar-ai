# Production Checklist — v2.6.x

## Source
- [ ] Exact approved revision reviewed.
- [ ] No secrets or production exports committed.
- [ ] Documentation matches deployed behavior.

## Cloudflare
- [ ] Worker deployed.
- [ ] Durable Object active.
- [ ] D1 production binding active.
- [ ] Queue and DLQ active.
- [ ] Observability enabled.
- [ ] Cleanup cron enabled.

## Secrets
- [ ] Telegram secrets stored securely.
- [ ] Google service-account credentials stored securely.
- [ ] Admin password/session secret stored securely.
- [ ] Owner/Admin IDs configured outside public source.

## Telegram
- [ ] `/start`, `/help`, `/profile`, `/exam`, `/reset` verified.
- [ ] Private-chat restriction verified.
- [ ] Test connection works.
- [ ] Switch/disconnect behavior verified.

## Limits
- [ ] 20/day confirmed.
- [ ] 5/10-second burst confirmed.
- [ ] Owner/Admin daily-quota exemption confirmed.
- [ ] Burst protection still applies to privileged users.
- [ ] Unauthorized users cannot run privileged commands.

## Admin
- [ ] Authentication required.
- [ ] Cloudflare Access applied.
- [ ] Grant/Revoke unlimited works.
- [ ] Suspend/Unsuspend works.
- [ ] Protected Owner/Admin records cannot be suspended.
- [ ] Audit entries work.
- [ ] Telegram Test connection works without student ID.
- [ ] Same-origin mutation protection works.

## Data
- [ ] D1 schema initializes.
- [ ] Analytics update after questions.
- [ ] Retention configured.
- [ ] Exports are treated as confidential.
- [ ] No private student data exists in the repository.