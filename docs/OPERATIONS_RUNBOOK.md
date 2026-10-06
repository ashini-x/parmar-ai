# Operations Runbook

## First check after deployment

1. Open the Worker logs.
2. Confirm the Worker starts without configuration errors.
3. Confirm the Queue consumer is active.
4. Send one direct factual SSC question.
5. Confirm typing starts and stops normally.
6. Confirm a `question_processing_*` event is visible in logs.
7. Open `/admin` and confirm analytics are updating.

## If Telegram stays on typing

Check the Queue consumer first.

Look for:

- `question_processing_failed`
- provider authentication failures
- Queue claim/wait loops
- Telegram delivery failures
- `student_profile_*_failed`
- `question_completed`

The primary answer path should always complete the question state even if profile or analytics enrichment fails.

## If you see `normalizedQuestion is not defined`

This indicates a regression from the v2.5 modification branch and is not expected in v2.4.1. Do not patch production blindly; restore/redeploy the known v2.4.1 source and inspect the exact version ID in Cloudflare.

## If you see `Cannot read properties of undefined (reading 'find')`

This indicates a profile normalization regression from the original v2.4 branch. v2.4.1 includes safe normalization for missing `learningSignals`. Verify the deployed Worker version before changing storage.

## If the bot says “give me a gap”

That is the burst limiter. Check `BURST_QUESTION_LIMIT` and `BURST_WINDOW_SECONDS`.

## If the bot says today's quota is complete

That is the daily limiter. The default is 20 accepted questions for the current India calendar day.

`/reset` does not reset this counter.

## Rollback

Use the last verified production Worker version in Cloudflare. Do not reuse an edited working directory as a rollback artifact. Keep each released ZIP or source revision immutable once deployed.

## Secret rotation

Rotate secrets at the provider first, then update the Cloudflare Worker secret. Validate the webhook and AI path after rotation.

## D1 problems

D1 analytics failures should not be allowed to block the main student answer path. Check schema initialization and `/admin` first. Raw analytics are subject to automated retention cleanup.
