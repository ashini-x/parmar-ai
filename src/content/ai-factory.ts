import type { Env } from "../config/env";
import type { AiQuestionCandidate, ContentBatchInput, ContentSubject } from "./types";

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite"
] as const;

const GEMINI_ENDPOINT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS_PER_MODEL = 2;
const TRANSIENT_STATUS_CODES = new Set([
  408,
  429,
  500,
  502,
  503,
  504
]);

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

const TOPIC_TAXONOMY: Record<ContentSubject, string[]> = {
  Maths: [
    "Number System",
    "Percentage",
    "Ratio",
    "Average",
    "Profit and Loss",
    "Simple Interest",
    "Compound Interest",
    "Time and Work",
    "Pipes and Cisterns",
    "Time and Distance",
    "Boat and Stream",
    "Algebra",
    "Geometry",
    "Mensuration",
    "Trigonometry",
    "Data Interpretation",
    "Mixture and Alligation",
    "Partnership",
    "Probability",
    "Statistics",
    "Other"
  ],
  Reasoning: [
    "Analogy",
    "Classification",
    "Series",
    "Coding-Decoding",
    "Blood Relation",
    "Direction Sense",
    "Ranking",
    "Syllogism",
    "Venn Diagram",
    "Statement and Conclusion",
    "Calendar",
    "Clock",
    "Non-Verbal Reasoning",
    "Missing Number",
    "Puzzle",
    "Other"
  ],
  English: [
    "Vocabulary",
    "Synonyms-Antonyms",
    "One Word Substitution",
    "Idioms and Phrases",
    "Spelling",
    "Grammar",
    "Error Detection",
    "Sentence Improvement",
    "Cloze Test",
    "Fill in the Blanks",
    "Reading Comprehension",
    "Active Passive",
    "Direct Indirect",
    "Para Jumble",
    "Other"
  ],
  GK: [
    "History",
    "Geography",
    "Polity",
    "Economy",
    "Physics",
    "Chemistry",
    "Biology",
    "Environment",
    "Static GK",
    "Current Affairs",
    "Art and Culture",
    "Science and Technology",
    "Other"
  ]
};

function responseSchemaFor(subject: ContentSubject) {
  return {
    type: "OBJECT",
    properties: {
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            source_question_number: { type: "STRING" },
            english: {
              type: "OBJECT",
              properties: {
                question_text: { type: "STRING" },
                option_a: { type: "STRING" },
                option_b: { type: "STRING" },
                option_c: { type: "STRING" },
                option_d: { type: "STRING" },
                explanation: { type: "STRING" }
              },
              required: [
                "question_text",
                "option_a",
                "option_b",
                "option_c",
                "option_d",
                "explanation"
              ]
            },
            hindi: {
              type: "OBJECT",
              properties: {
                question_text: { type: "STRING" },
                option_a: { type: "STRING" },
                option_b: { type: "STRING" },
                option_c: { type: "STRING" },
                option_d: { type: "STRING" },
                explanation: { type: "STRING" }
              },
              required: [
                "question_text",
                "option_a",
                "option_b",
                "option_c",
                "option_d",
                "explanation"
              ]
            },
            topic: {
              type: "STRING",
              description: `Choose exactly one topic from: ${TOPIC_TAXONOMY[subject].join(", ")}`
            },
            difficulty: {
              type: "STRING",
              description: "Exactly one of Easy, Medium, Hard"
            },
            source_correct_option: {
              type: "STRING",
              description: "A, B, C, D, or empty string when no answer key is present"
            },
            verified_correct_option: {
              type: "STRING",
              description: "A, B, C, or D after independently checking the answer"
            },
            answer_verification: {
              type: "STRING",
              description: "Exactly one of match, conflict, source_missing, ambiguous"
            },
            confidence: {
              type: "NUMBER",
              description: "Confidence from 0 to 1"
            },
            ambiguity_note: { type: "STRING" }
          },
          required: [
            "source_question_number",
            "english",
            "hindi",
            "topic",
            "difficulty",
            "source_correct_option",
            "verified_correct_option",
            "answer_verification",
            "confidence",
            "ambiguity_note"
          ]
        }
      }
    },
    required: ["questions"]
  };
}

function extractGeminiText(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}


async function sleepWithJitter(
  baseMs: number
): Promise<void> {
  const jitter = Math.floor(Math.random() * 500);
  await new Promise((resolve) =>
    setTimeout(resolve, baseMs + jitter)
  );
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  return trimmed;
}

export async function extractQuestionsWithGemini(
  env: Env,
  input: ContentBatchInput,
  source:
    | { kind: "pdf"; base64: string }
    | { kind: "text"; text: string }
): Promise<AiQuestionCandidate[]> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("gemini_api_key_missing");
  }

  const topicList = TOPIC_TAXONOMY[input.subject].join(", ");
  const prompt = `
You are SawalNewton's production content-ingestion engine for Indian competitive exams.

Extract ONLY multiple-choice questions that actually exist in the supplied source.
Do not invent questions, options, answer keys, explanations, or metadata.
Return at most ${input.maxQuestions} questions.

SOURCE METADATA
Exam: ${input.exam}
Tier: ${input.tier}
Year: ${input.year}
Shift: ${input.shift || "Not supplied"}
Subject: ${input.subject}

ALLOWED TOPICS
${topicList}

EXTRACTION
- Identify complete four-option MCQs only.
- Preserve all numbers, units, dates, names, symbols, formulas, and option values.
- Keep the original meaning intact.
- If an answer key is present, copy the source answer into source_correct_option.
- Independently solve/check the question and put the result in verified_correct_option.
- If source answer and independent answer differ, set answer_verification to "conflict".
- If no source answer exists, use source_correct_option="" and answer_verification="source_missing".
- If the question is ambiguous, set answer_verification="ambiguous" and explain why in ambiguity_note.
- If the same question appears more than once, return it only once.

BILINGUAL OUTPUT
- Produce a clean English version and a natural exam-style Hindi version of the SAME question.
- If the source is Hindi-only, translate faithfully into English as well.
- Do not alter numbers, formulas, units, option values, variable names, or proper nouns.
- Options must contain option text only, without "A.", "B.", etc.
- Provide concise explanations in both English and Hindi.
- Do not add outside facts.

CLASSIFICATION
- topic must be exactly one of the allowed topics.
- difficulty must be exactly Easy, Medium, or Hard.

QUALITY
Be conservative. A candidate will be auto-ready only if later code finds a complete bilingual question, a matching source/independent answer, high confidence, and no duplicate fingerprint.
`.trim();

  const contents =
    source.kind === "pdf"
      ? [
          { parts: [{ text: prompt }] },
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: source.base64
                }
              }
            ]
          }
        ]
      : [
          {
            parts: [
              {
                text: `${prompt}\n\nSOURCE TEXT\n${source.text}`
              }
            ]
          }
        ];

  let lastTransientError = "gemini_unavailable";

  for (const model of GEMINI_MODELS) {
    const endpoint =
      `${GEMINI_ENDPOINT_BASE}/${model}:generateContent`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: responseSchemaFor(input.subject),
              temperature: 0.1,
              maxOutputTokens: Math.min(
                16_000,
                Math.max(4_000, input.maxQuestions * 650)
              )
            }
          }),
          signal: controller.signal
        });

        const raw = await response.text();

        let data: GeminiResponse;
        try {
          data = JSON.parse(raw) as GeminiResponse;
        } catch {
          throw new Error(
            `gemini_invalid_json_response:${response.status}:${model}`
          );
        }

        if (!response.ok) {
          const message =
            data.error?.message ?? `gemini_http_${response.status}`;

          if (TRANSIENT_STATUS_CODES.has(response.status)) {
            lastTransientError =
              `gemini_transient_${response.status}:${model}:${message}`;
          } else {
            throw new Error(
              `gemini_http_${response.status}:${model}:${message}`
            );
          }
        } else {
          const text = extractGeminiText(data);
          if (!text) {
            throw new Error(`gemini_empty_response:${model}`);
          }

          let parsed: {
            questions?: AiQuestionCandidate[];
          };

          try {
            parsed = JSON.parse(
              cleanJsonText(text)
            ) as {
              questions?: AiQuestionCandidate[];
            };
          } catch {
            throw new Error(
              `gemini_invalid_structured_json:${model}`
            );
          }

          if (!Array.isArray(parsed.questions)) {
            throw new Error(
              `gemini_questions_missing:${model}`
            );
          }

          return parsed.questions.slice(
            0,
            input.maxQuestions
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          lastTransientError =
            `gemini_timeout_after_${REQUEST_TIMEOUT_MS}ms:${model}`;
        } else if (
          error instanceof Error &&
          !error.message.startsWith("gemini_transient_")
        ) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < MAX_ATTEMPTS_PER_MODEL) {
        const baseDelay = 1000 * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay + jitter)
        );
      }
    }
  }

  throw new Error(
    `gemini_all_models_unavailable:${lastTransientError}`
  );
}

export interface CandidateForEnhancement {
  english: AiQuestionCandidate["english"];
  hindi: AiQuestionCandidate["hindi"];
  topic: string;
  difficulty: string;
  source_correct_option: string;
  verified_correct_option: string;
  answer_verification: string;
  confidence: number;
  ambiguity_note: string;
  subject: ContentSubject;
}

const AI_ENHANCE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash"
] as const;

const ENHANCE_TIMEOUT_MS = 45_000;
const ENHANCE_MAX_ATTEMPTS = 2;

function enhancementSchema(subject: ContentSubject) {
  return {
    type: "OBJECT",
    properties: {
      english: {
        type: "OBJECT",
        properties: {
          question_text: { type: "STRING" },
          option_a: { type: "STRING" },
          option_b: { type: "STRING" },
          option_c: { type: "STRING" },
          option_d: { type: "STRING" },
          explanation: { type: "STRING" }
        },
        required: [
          "question_text",
          "option_a",
          "option_b",
          "option_c",
          "option_d",
          "explanation"
        ]
      },
      hindi: {
        type: "OBJECT",
        properties: {
          question_text: { type: "STRING" },
          option_a: { type: "STRING" },
          option_b: { type: "STRING" },
          option_c: { type: "STRING" },
          option_d: { type: "STRING" },
          explanation: { type: "STRING" }
        },
        required: [
          "question_text",
          "option_a",
          "option_b",
          "option_c",
          "option_d",
          "explanation"
        ]
      },
      topic: { type: "STRING" },
      difficulty: { type: "STRING" },
      verified_correct_option: { type: "STRING" },
      answer_verification: { type: "STRING" },
      confidence: { type: "NUMBER" },
      ambiguity_note: { type: "STRING" }
    },
    required: [
      "english",
      "hindi",
      "topic",
      "difficulty",
      "verified_correct_option",
      "answer_verification",
      "confidence",
      "ambiguity_note"
    ]
  };
}

function cleanGeminiJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  return trimmed;
}

export async function enhanceCandidateWithGemini(
  env: Env,
  candidate: CandidateForEnhancement
): Promise<AiQuestionCandidate> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("gemini_api_key_missing");

  const topicList = TOPIC_TAXONOMY[candidate.subject].join(", ");
  const prompt = `
You are an optional quality/enrichment service for SawalNewton.
Do not invent a new question. Work only with the supplied candidate.

GOALS
1. Preserve the English question and options exactly unless correcting obvious formatting only.
2. Produce a natural, exam-style Hindi translation of the SAME question.
3. Preserve numbers, formulas, units, variable names, option values, dates, and proper nouns.
4. Independently solve/check the question and return verified_correct_option as A, B, C, or D.
5. Compare the verified answer with the source answer.
6. Choose exactly one topic from the allowed list.
7. Choose exactly one difficulty: Easy, Medium, Hard.
8. Give concise explanations in both languages.
9. Be conservative. If anything is ambiguous, lower confidence and explain it.

ALLOWED TOPICS
${topicList}

CURRENT CANDIDATE
English question: ${candidate.english.question_text}
A: ${candidate.english.option_a}
B: ${candidate.english.option_b}
C: ${candidate.english.option_c}
D: ${candidate.english.option_d}
Existing English explanation: ${candidate.english.explanation}

Existing Hindi question: ${candidate.hindi.question_text}
A: ${candidate.hindi.option_a}
B: ${candidate.hindi.option_b}
C: ${candidate.hindi.option_c}
D: ${candidate.hindi.option_d}
Existing Hindi explanation: ${candidate.hindi.explanation}

Source answer: ${candidate.source_correct_option || "not supplied"}
Existing verified answer: ${candidate.verified_correct_option || "not supplied"}
Existing topic: ${candidate.topic}
Existing difficulty: ${candidate.difficulty}

Return structured JSON only.
`.trim();

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: enhancementSchema(candidate.subject),
      temperature: 0.05,
      maxOutputTokens: 4000
    }
  };

  let lastError = "gemini_enhancement_unavailable";

  for (const model of AI_ENHANCE_MODELS) {
    const endpoint = `${GEMINI_ENDPOINT_BASE}/${model}:generateContent`;

    for (let attempt = 1; attempt <= ENHANCE_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        const raw = await response.text();
        let data: GeminiResponse;
        try {
          data = JSON.parse(raw) as GeminiResponse;
        } catch {
          throw new Error(`gemini_invalid_json_response:${response.status}:${model}`);
        }

        if (!response.ok) {
          const message = data.error?.message ?? `gemini_http_${response.status}`;
          if (TRANSIENT_STATUS_CODES.has(response.status)) {
            lastError = `gemini_transient_${response.status}:${model}:${message}`;
          } else {
            throw new Error(`gemini_http_${response.status}:${model}:${message}`);
          }
        } else {
          const text = extractGeminiText(data);
          if (!text) throw new Error(`gemini_empty_response:${model}`);

          const parsed = JSON.parse(cleanGeminiJson(text)) as AiQuestionCandidate;
          return parsed;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          lastError = `gemini_timeout_after_${ENHANCE_TIMEOUT_MS}ms:${model}`;
        } else if (
          error instanceof Error &&
          !error.message.startsWith("gemini_transient_")
        ) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < ENHANCE_MAX_ATTEMPTS) {
        const delay = 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`gemini_enhancement_unavailable:${lastError}`);
}
