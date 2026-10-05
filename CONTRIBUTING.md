# Contributing to Parmar AI

## Rules for this codebase

1. Keep secrets out of Git.
2. Keep the Worker thin: orchestration belongs in services/modules, not one large handler.
3. Add tests for behavior before changing production behavior.
4. Do not commit raw audio/video research material unless its license explicitly permits repository storage.
5. Keep external-provider code behind adapters so Telegram, Gemini, and voice providers can be changed without rewriting the core domain logic.
