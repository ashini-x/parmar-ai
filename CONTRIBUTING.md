# Contributing

**Parmar AI is proprietary software.**

The public repository is primarily for controlled source inspection, transparency, and authorized development. It is not an unrestricted open-source contribution project.

## Before contributing

Do not submit code, prompts, datasets, screenshots, student exports, or operational material unless the project owner has expressly invited the contribution.

## Authorized changes

An authorized change should explain:

- what changed;
- why it changed;
- affected behavior;
- tests performed;
- deployment/configuration requirements;
- security or data implications.

## Engineering standard

- Preserve the primary student response path.
- Prefer small, reviewable changes.
- Add a regression test for production bugs.
- Treat Durable Object and D1 changes as compatibility-sensitive.
- Treat prompt/schema changes as production code changes.
- Never commit secrets or real student data.

## Validation

Run the relevant repository checks before approval, including type-checking, tests, and format validation when configured.

For production-impacting changes, run the relevant manual scenarios in docs/TEST_PLAN.md.

## Intellectual property

Submitting a change does not by itself grant the submitter a right to use, redistribute, commercialize, or republish Parmar AI source or documentation.

Authorized contributors may be required to execute a separate intellectual-property or contribution agreement.

See LICENSE and TRADEMARKS.md.
