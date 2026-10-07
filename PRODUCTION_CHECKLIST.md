# Production Checklist — v2.6.x

## Source
- [ ] Exact approved revision reviewed.\n- [ ] No secrets or production exports committed.\n- [ ] Documentation matches deployed behavior.

## Cloudflare
- [ ] Worker deployed.\n- [ ] Durable Object active.\n- [ ] D1 production binding active.\n- [ ] Queue and DLQ active.\n- [ ] Observability enabled.\n- [ ] Cleanup cron enabled.

## Secrets
- [ ] Telegram secrets stored securely.\n- [ ] Google service-account credentials stored securely.\n- [ ] Admin password/session secret stored securely.\n- [ ] Owner/Admin IDs configured outside public source.

## Telegram
- [ ] `/start`, `/help`, `/profile`, `/exam`, `/reset` verified.\n- [ ] Private-chat restriction verified.\n- [ ] Test connection works.\n- [ ] Switch/disconnect behavior verified.

## Limits
- [ ] 20/day confirmed.\n- [ ] 5/10-second burst confirmed.\n- [ ] Owner/Admin daily-quota exemption confirmed.\n- [ ] Burst protection still applies to privileged users.\n- [ ] Unauthorized users cannot run privileged commands.

## Admin
- [ ] Authentication required.\n- [ ] Cloudflare Access applied.\n- [ ] Grant/Revoke unlimited works.\n- [ ] Suspend/Unsuspend works.\n- [ ] Protected Owner/Admin records cannot be suspended.\n- [ ] Audit entries work.\n- [ ] Telegram Test connection works without student ID.\n- [ ] Same-origin mutation protection works.

## Data
- [ ] D1 schema initializes.\n- [ ] Analytics update after questions.\n- [ ] Retention configured.\n- [ ] Exports are treated as confidential.\n- [ ] No private student data exists in the repository.