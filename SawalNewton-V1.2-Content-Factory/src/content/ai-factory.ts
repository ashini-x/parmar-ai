import type { Env } from "../config/env";
import type { AiQuestionCandidate, ContentBatchInput, ContentSubject } from "./types";

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const REQUEST_TIMEOUT_MS = 25_000;

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
          {
            parts: [{ text: prompt }]
          },
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

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
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
        `gemini_invalid_json_response:${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error?.message ?? `gemini_http_${response.status}`
      );
    }

    const text = extractGeminiText(data);
    if (!text) {
      throw new Error("gemini_empty_response");
    }

    const parsed = JSON.parse(cleanJsonText(text)) as {
      questions?: AiQuestionCandidate[];
    };

    if (!Array.isArray(parsed.questions)) {
      throw new Error("gemini_questions_missing");
    }

    return parsed.questions.slice(0, input.maxQuestions);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `gemini_timeout_after_${REQUEST_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
