# SawalNewton Content Factory Prompt

The Worker uses a structured Gemini request to turn a source PDF/TXT/CSV into staged MCQ candidates.

Core rules:

- Extract only questions that appear in the supplied source.
- Never invent a missing option, answer, or question.
- Keep numerical values, formulas, units, dates, names, symbols, and option values unchanged.
- Produce both English and Hindi versions of the same question.
- Classify into SawalNewton's controlled topic taxonomy.
- Estimate Easy/Medium/Hard difficulty.
- Copy the source answer when an answer key is present.
- Independently solve/check each question and compare the answer.
- Mark conflicts or missing source answers for review.
- Return structured JSON.

Auto-ready is a conservative code decision, not a claim that the model is infallible. Candidates still enter staging and require an admin publication action.
