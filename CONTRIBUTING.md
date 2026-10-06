# Contributing

Thank you for contributing to Parmar AI.

## Development principles

- Preserve the primary student response path.
- Prefer small, reviewable changes.
- Do not mix unrelated feature work with infrastructure fixes.
- Treat Durable Object state changes as compatibility-sensitive.
- Treat prompt/schema changes as production code changes.
- Add a regression test for every production bug.
- Never commit secrets or real student data.

## Before opening a pull request

Run:

```bash
npm run check
npm test
npm run format:check
```

Also run the relevant manual cases in `docs/TEST_PLAN.md` for changes affecting Telegram, Queue, profile state, Gemini, limits, or admin analytics.

## Commit/review expectations

A pull request should explain:

- what changed,
- why it changed,
- what behavior is affected,
- what tests were run,
- whether any migration or configuration change is required.

## Security-sensitive changes

Do not submit secrets, credentials, copied production exports, or exploit details in a public issue or pull request. Follow `SECURITY.md`.

## Production discipline

A change is not considered complete until the release documentation reflects the actual deployed behavior.
