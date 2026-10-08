# Prompt Assets

**Classification: Proprietary application material**

Prompting is part of Parmar AI's application logic and intellectual property. Production prompt behavior is implemented primarily under src/ai/; this directory is reserved for controlled fixtures, evaluation material, documentation, and other prompt assets that are explicitly approved for repository publication.

The current AI behavior baseline is **v2.8.0**.

## Current prompt-contract principles

Parmar's prompt and response-contract layer is designed to preserve the distinction between:

- ordinary SSC doubts;
- follow-up/simplification requests;
- current/time-sensitive factual questions;
- student-supplied MCQs;
- generated native Telegram quizzes;
- multi-MCQ requests.

### Native MCQ rules

The current prompt contract requires:

1. **A quiz must have a topic anchor.** The anchor may come from the current student request, a recent stored SSC topic, or the immediately preceding exchange when Parmar asked the student to choose a quiz topic.
2. **Do not invent a topic for a generic request.** A bare mcq, quiz, test me, or equivalent request without a topic is clarified before the Gemini call.
3. **Preserve the requested quantity.** A request for multiple MCQs produces the requested number of independent quiz items, bounded at 10.
4. **Use native Telegram quiz delivery semantics.** Each generated item is independently deliverable as a Telegram quiz with a defined correct option and compact explanation.
5. **Do not create duplicate user-facing result messages.** Telegram's native quiz result surface is sufficient after a student votes.
6. **Persist quiz outcomes for follow-up context.** A later question can refer back to the exact answered quiz, including the selected answer, result, correct answer, and explanation.

The application validates the returned structured packet before delivery; prompt instructions are not treated as a substitute for runtime validation.

See [../docs/AI_PIPELINE.md](../docs/AI_PIPELINE.md) and [../docs/TEST_PLAN.md](../docs/TEST_PLAN.md) for the authoritative engineering behavior.

## Controlled assets

Acceptable content includes:

- synthetic prompt fixtures;
- redacted evaluation cases;
- prompt documentation;
- authorized test cases;
- sanitized examples that reveal no private student data.

## Never add

Do not commit:

- secrets, credentials, tokens, or provider private configuration;
- unpublished student conversations;
- private evaluation or benchmark datasets;
- confidential provider instructions;
- copied or unauthorized third-party prompt systems;
- copyrighted source material without redistribution rights;
- internal-only scoring data;
- production exports containing identifiable student information.

## Intellectual property

Prompts, answer-policy rules, evaluation fixtures, prompt engineering, semantic classification rules, and associated application behavior created for Parmar AI are proprietary project materials unless a file explicitly states otherwise.

Do not reproduce, adapt, publish, sell, train competing models or systems on, or incorporate these materials into another product without written permission.

The repository [LICENSE](../LICENSE) and [AI_USAGE_POLICY.md](../AI_USAGE_POLICY.md) define the controlling restrictions.