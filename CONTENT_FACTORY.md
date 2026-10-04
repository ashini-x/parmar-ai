# SawalNewton Content Factory V1.3

V1.3 makes AI optional rather than required for content ingestion.

## Fast Import (recommended)

TXT, CSV, and JSON can be imported with deterministic code. Fast Import does not call Gemini.

This stage:

1. parses the source into structured MCQs;
2. reads supplied answer keys and metadata;
3. keeps English and Hindi versions under the same candidate when both are supplied;
4. infers a topic from a fixed keyword taxonomy when no topic is supplied;
5. defaults unlabelled difficulty to Medium;
6. computes an exact SHA-256 fingerprint from the English question and options;
7. detects exact duplicates against production and staging;
8. stores candidates in the staging queue.

Questions missing Hindi or independently verified answers are kept in `needs_review` and are not auto-published.

## Optional AI

AI extraction is still available for PDFs or messy source material. It is explicitly selected from the admin panel.

AI can also be run later on selected staging candidates with `AI Enhance selected`. That operation is optional and can fail without failing the original import.

AI enhancement can fill or improve:

- Hindi translation
- topic
- difficulty
- explanations
- independent answer check

## Source formats

### Structured TXT

Use `data/content-factory-sample.txt` for the simplest English-only format.

For bilingual import, use `data/content-factory-sample-bilingual.txt` as the template. The parser understands `Hindi:` followed by `HA:` / `HB:` / `HC:` / `HD:`.

### CSV

Use `data/questions-template.csv` as the template. Headers are case-insensitive and several common aliases are accepted.

### JSON

Use `data/questions-template.json` as the template. Either a top-level array or `{ "questions": [...] }` is accepted.

## Important

Only ingest material you are allowed to use. Automation does not grant rights to redistribute third-party exam compilations.

No new D1 migration is required for V1.3. It uses the existing V1.2 content-factory tables.
