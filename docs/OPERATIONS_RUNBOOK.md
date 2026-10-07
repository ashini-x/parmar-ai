# Operations Runbook

## First checks
1. Confirm Worker configuration.
2. Confirm Queue consumer and Durable Object.
3. Send one SSC question.
4. Confirm typing starts and stops.
5. Confirm answer delivery.
6. Confirm `/admin` analytics update.
7. Test Telegram connection from the dashboard.

## Telegram not responding
Check dashboard bot status, webhook info, Worker logs, Queue consumer, recent question-processing events, and Telegram delivery errors.

## Typing remains active
Inspect Queue retries, Durable Object leases/recovery, AI timeouts, and Telegram delivery failures. Typing must be bounded by recovery logic.

## Dashboard not interactive
Check the deployed revision, browser console, and generated dashboard JavaScript. Redeploy the exact verified revision if necessary.

## Student access action failure
For Grant/Revoke/Suspend/Unsuspend, verify admin session, same-origin request, `/admin/api/action` response, D1 state, and dashboard refresh. These mutations are server-side and verified.

## Telegram Test connection
The test action must not require a student Telegram ID. It should call Telegram `getMe` and `getWebhookInfo`. An `invalid_user_id` response indicates a regression in generic admin-action validation.

## Queue backlog
Check consumer health, retries, DLQ, Durable Object alarms, AI provider timeouts, and Telegram delivery. Do not delete state blindly.

## Secret rotation
Rotate at the provider, update Cloudflare, and validate the affected integration.

## Rollback
Use the last verified Cloudflare version. Do not treat an ad-hoc edited working directory as a rollback artifact.