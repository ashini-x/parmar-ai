import type { AnswerPacket, Env, ProfileContext } from "../config/env";
import { GoogleAuthError, getGoogleAccessToken } from "../auth/google";
import { getConfig } from "../config/env";

const DEFAULT_LOCATION = "global";
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_INTERNAL_ATTEMPTS = 3;
const MAX_ANSWER_CHARS = 3_900;

const SYSTEM_INSTRUCTION = `You are Parmar AI's SSC-focused exam mentor.

Your job is NOT to behave like a general-purpose chatbot. You are designed for students preparing for SSC exams, especially SSC General Awareness / General Studies, Static GK, History, Polity, Geography, Economy, Science, Art & Culture and exam-relevant current affairs.

Core philosophy:
- SSC-first: answer what helps the student score in SSC, not what merely makes the answer long.
- Factual-first: most answers should be concise, memory-friendly and exam-oriented. Give only the minimum concept needed to understand or retain the fact.
- Exam relevance matters: distinguish must-know facts from low-priority background.
- Do not turn a simple SSC fact into a lecture.
- For comparisons, focus on the distinctions SSC students commonly confuse.
- For statement/MCQ questions, identify the trap and explain why the correct choice wins.
- If the student's doubt reveals confusion, quietly use that signal to improve their future revision guidance.
- Use the student's stored study context when it genuinely helps. Never reveal that you have an internal profile or hidden memory system.
- Do not flatter the student or pretend to know things that the profile does not support.

Scope:
- Primarily SSC GA/GS/static-GK style preparation. Short supporting concepts are allowed when they help an SSC fact.
- If the user asks for Quant, Reasoning, Coding, programming, generic life advice, entertainment, or other unrelated content, politely say that Parmar AI is currently focused on SSC GA/GS doubts.
- Do not answer an unrelated request merely because it is easy.
- Current-affairs caution: never pretend to have live verification. For time-sensitive facts that you cannot confidently establish, say so briefly instead of inventing details.

Language:
- Match the student's language naturally.
- Hindi/Hinglish questions should normally receive Hindi/Hinglish with standard English exam terminology where useful.
- English questions should normally receive English.
- Assamese or mixed-language questions may be answered in that language when practical.

Answer style:
- Direct answer first.
- Then a compact explanation only if useful.
- Use short bullets instead of dense paragraphs.
- No markdown tables.
- Avoid generic openings such as "Sure" or "Let's understand".
- Never invent citations or claim browsing/verification that did not occur.

Personalization:
- Use recent topics to connect related doubts.
- Use attention topics to avoid repeating weak areas blindly and to suggest targeted revision when appropriate.
- Use the target exam when it is known.
- A single question is not enough to label a student weak; only treat repeated confusion or explicit uncertainty as an attention signal.

Return ONLY JSON matching the supplied response schema. Do not wrap it in markdown fences.`;

export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";


const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING", description: "The final concise answer suitable for Telegram." },
    sscTakeaway: { type: "STRING", description: "One compact SSC-specific takeaway; empty string when unnecessary." },
    answerScope: {
      type: "STRING",
      enum: ["ssc_ga_gs", "ssc_support", "out_of_scope"],
      description: "Whether the question belongs to the supported SSC scope.",
    },
    subject: {
      type: "STRING",
      enum: ["history", "polity", "geography", "economy", "science", "static_gk", "current_affairs", "art_culture", "other"],
    },
    topic: { type: "STRING", description: "The smallest useful SSC study topic label." },
    questionMode: {
      type: "STRING",
      enum: ["fact", "concept", "comparison", "statement_trap", "revision", "study_plan"],
    },
    examRelevance: { type: "STRING", enum: ["A", "B", "C", "D"] },
    difficulty: { type: "STRING", enum: ["easy", "medium", "hard"] },
    profileSignal: {
      type: "STRING",
      enum: ["neutral", "weak", "confusion", "strength"],
    },
    profileNote: { type: "STRING", description: "Compact internal note about the student's learning signal. Do not address the student directly." },
    nextRevisionTopic: { type: "STRING", description: "One useful next revision topic, or empty string." },
    detectedExam: { type: "STRING", nullable: true, description: "Detected SSC target such as SSC CGL, otherwise null." },
    timeSensitive: { type: "BOOLEAN", description: "Whether the answer depends on changing/current information." },
  },
  required: [
    "answer",
    "sscTakeaway",
    "answerScope",
    "subject",
    "topic",
    "questionMode",
    "examRelevance",
    "difficulty",
    "profileSignal",
    "profileNote",
    "nextRevisionTopic",
    "detectedExam",
    "timeSensitive",
  ],
  propertyOrdering: [
    "answer",
    "sscTakeaway",
    "answerScope",
    "subject",
    "topic",
    "questionMode",
    "examRelevance",
    "difficulty",
    "profileSignal",
    "profileNote",
    "nextRevisionTopic",
    "detectedExam",
    "timeSensitive",
  ],
};

export class GeminiError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.retryable = retryable;
  }
}

interface GeminiRequestError {
  message?: string;
  status?: string;
  code?: number;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: GeminiRequestError;
}

export async function generateGeminiAnswer(
  env: Env,
  question: string,
  profile: ProfileContext,
): Promise<AnswerPacket> {
  const projectId = env.GCP_PROJECT_ID?.trim();
  const normalizedQuestion = question.trim();

  if (!projectId) throw new GeminiError("Google Cloud project ID is not configured.");
  if (!env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim()) {
    throw new GeminiError("Google Cloud service account credentials are not configured.");
  }
  if (!normalizedQuestion) throw new GeminiError("Question is empty.");

  const maxQuestionLength = positiveInt(env.MAX_QUESTION_LENGTH, 4_000);
  if (normalizedQuestion.length > maxQuestionLength) {
    throw new GeminiError(
      `Question is too long. Maximum supported length is ${maxQuestionLength} characters.`,
    );
  }

  const location = env.GEMINI_LOCATION?.trim() || DEFAULT_LOCATION;
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const thinkingLevel = selectThinkingLevel(normalizedQuestion, getConfig(env).maxThinkingLevel);

  let lastError: GeminiError | null = null;

  for (let attempt = 1; attempt <= MAX_INTERNAL_ATTEMPTS; attempt += 1) {
    try {
      return await requestVertexGemini(env, endpoint, normalizedQuestion, profile, thinkingLevel);
    } catch (error) {
      const geminiError = toGeminiError(error);
      lastError = geminiError;

      if (!geminiError.retryable || attempt >= MAX_INTERNAL_ATTEMPTS) {
        throw geminiError;
      }

      await sleep(800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
  }

  throw lastError ?? new GeminiError("Gemini request failed.", undefined, true);
}

async function requestVertexGemini(
  env: Env,
  endpoint: string,
  question: string,
  profileContext: ProfileContext,
  thinkingLevel: ThinkingLevel,
): Promise<AnswerPacket> {
  let accessToken: string;

  try {
    accessToken = await getGoogleAccessToken(env);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw new GeminiError(error.message, error.status, error.retryable);
    }
    throw error;
  }

  const controller = new AbortController();
  const timeoutMs = positiveInt(env.VERTEX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildUserPrompt(question, profileContext),
              },
            ],
          },
        ],
        generationConfig: {
          thinkingConfig: { thinkingLevel },
          maxOutputTokens: positiveInt(env.MAX_OUTPUT_TOKENS, 1_200),
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: GeminiApiResponse;

    try {
      data = JSON.parse(raw) as GeminiApiResponse;
    } catch {
      throw new GeminiError(
        `Vertex AI returned invalid JSON (HTTP ${response.status}).`,
        response.status,
        isRetryableStatus(response.status),
      );
    }

    if (!response.ok) {
      const message =
        data.error?.message ??
        `Vertex AI request failed with HTTP ${response.status}.`;
      throw new GeminiError(
        message,
        response.status,
        isRetryableGeminiError(response.status, data.error),
      );
    }

    const rawModelText = extractGeminiText(data) ?? "";
    const packet = parseAnswerPacket(rawModelText);
    return sanitizeAnswerPacket(packet);
  } catch (error) {
    if (error instanceof GeminiError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiError(
        `Vertex AI request timed out after ${timeoutMs}ms.`,
        undefined,
        true,
      );
    }

    throw new GeminiError(
      error instanceof Error ? error.message : String(error),
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildUserPrompt(question: string, context: ProfileContext): string {
  const profile = context.profile;
  return [
    "STUDENT CONTEXT (use quietly; never mention the storage system):",
    `Target exam: ${profile.targetExam}`,
    `Recent topics: ${context.recentTopicHint || "none yet"}`,
    `Attention topics: ${context.attentionTopicHint || "none yet"}`,
    `Revision queue: ${context.revisionHint || "none yet"}`,
    "",
    "STUDENT'S NEW QUESTION:",
    question,
    "",
    "Before answering, decide whether this is genuinely useful for SSC GA/GS preparation. Keep the final answer proportional to the question. Only make a learning-profile update when there is meaningful evidence.",
  ].join("\n");
}

function parseAnswerPacket(rawText: string): AnswerPacket {
  const jsonText = rawText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");

  let parsed: Partial<AnswerPacket>;
  try {
    parsed = JSON.parse(jsonText) as Partial<AnswerPacket>;
  } catch {
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(jsonText.slice(firstBrace, lastBrace + 1)) as Partial<AnswerPacket>;
      } catch {
        parsed = {};
      }
    } else {
      parsed = {};
    }

    if (!parsed.answer) {
      // Structured output is expected. Keeping a safe plain-text fallback prevents
      // a formatting failure from turning into an unnecessary user-facing outage.
      return {
      answer: normalizeAnswer(rawText),
      sscTakeaway: "",
      answerScope: "ssc_ga_gs",
      subject: "other",
      topic: "General SSC doubt",
      questionMode: "fact",
      examRelevance: "B",
      difficulty: "medium",
      profileSignal: "neutral",
      profileNote: "",
      nextRevisionTopic: "",
      detectedExam: null,
        timeSensitive: false,
      };
    }
  }

  return {
    answer: String(parsed.answer ?? "").trim(),
    sscTakeaway: String(parsed.sscTakeaway ?? "").trim(),
    answerScope: normalizeEnum(parsed.answerScope, ["ssc_ga_gs", "ssc_support", "out_of_scope"], "ssc_ga_gs"),
    subject: normalizeEnum(parsed.subject, ["history", "polity", "geography", "economy", "science", "static_gk", "current_affairs", "art_culture", "other"], "other"),
    topic: cleanTopic(String(parsed.topic ?? "General SSC doubt")),
    questionMode: normalizeEnum(parsed.questionMode, ["fact", "concept", "comparison", "statement_trap", "revision", "study_plan"], "fact"),
    examRelevance: normalizeEnum(parsed.examRelevance, ["A", "B", "C", "D"], "B"),
    difficulty: normalizeEnum(parsed.difficulty, ["easy", "medium", "hard"], "medium"),
    profileSignal: normalizeEnum(parsed.profileSignal, ["neutral", "weak", "confusion", "strength"], "neutral"),
    profileNote: clampText(String(parsed.profileNote ?? ""), 180),
    nextRevisionTopic: cleanTopic(String(parsed.nextRevisionTopic ?? ""), true),
    detectedExam: parsed.detectedExam == null ? null : cleanExam(String(parsed.detectedExam)),
    timeSensitive: Boolean(parsed.timeSensitive),
  };
}

function sanitizeAnswerPacket(packet: AnswerPacket): AnswerPacket {
  let answer = normalizeAnswer(packet.answer);

  if (!answer) {
    throw new GeminiError("Vertex AI returned no usable answer text.", undefined, true);
  }

  if (packet.answerScope === "out_of_scope") {
    answer = "Main abhi sirf SSC ke General Awareness / General Studies, Static GK aur exam-focused factual doubts ke liye hoon. Is topic ko SSC angle se bhejo, main usi perspective se help karunga. 📚";
  }

  if (packet.timeSensitive && looksLiveCurrentQuestion(answer)) {
    answer = `${answer}\n\n⚠️ Current fact ko live verify karna zaroori hai; main yahan live source verification claim nahi kar raha hoon.`;
  }

  if (packet.sscTakeaway && packet.answerScope !== "out_of_scope") {
    answer = `${answer}\n\n📌 SSC Focus: ${packet.sscTakeaway}`;
  }

  return {
    ...packet,
    answer: clampAnswer(answer),
    sscTakeaway: clampText(packet.sscTakeaway, 240),
  };
}

function looksLiveCurrentQuestion(answer: string): boolean {
  return /\b(today|current|latest|now|present|2026|2027|currently)\b/i.test(answer);
}

function clampAnswer(answer: string): string {
  if (answer.length <= MAX_ANSWER_CHARS) return answer;
  const cut = answer.lastIndexOf("\n", MAX_ANSWER_CHARS);
  const fallback = answer.lastIndexOf(" ", MAX_ANSWER_CHARS);
  const splitAt = cut > 2_500 ? cut : fallback > 2_500 ? fallback : MAX_ANSWER_CHARS;
  return `${answer.slice(0, splitAt).trim()}\n\n[Answer shortened for Telegram.]`;
}

function normalizeAnswer(answer: string): string {
  return answer
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanTopic(value: string, allowEmpty = false): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned && !allowEmpty) return "General SSC doubt";
  return cleaned.slice(0, 100);
}

function cleanExam(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 60);
}

function clampText(value: string, maxLength: number): string {
  const clean = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, maxLength);
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = String(value ?? "") as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

function selectThinkingLevel(question: string, cap: ThinkingLevel): ThinkingLevel {
  const q = question.toLowerCase();
  const complexSignals = [
    "why", "explain", "compare", "difference", "differentiate", "reason", "incorrect", "correct", "statement", "assertion", "confused", "between", "trap", "eliminate", "option", "options", "chronology", "sequence", "cause", "effect", "how did", "why did", "which statement",
  ];
  const directFactSignals = [
    "who is", "who was", "when was", "which year", "in which year", "where is", "where was", "capital of", "founder of", "founded by", "author of", "called as", "known as",
  ];

  if (q.length <= 150 && directFactSignals.some((signal) => q.includes(signal))) {
    return minThinking("LOW", cap);
  }

  if (complexSignals.some((signal) => q.includes(signal)) || q.length > 500) {
    return cap;
  }

  return minThinking("MEDIUM", cap);
}

function minThinking(requested: ThinkingLevel, cap: ThinkingLevel): ThinkingLevel {
  const rank: Record<ThinkingLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return rank[requested] <= rank[cap] ? requested : cap;
}

function isRetryableGeminiError(status: number, error?: GeminiRequestError): boolean {
  if (status === 401 || status === 403 || status === 400 || status === 404) return false;
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("resource exhausted") || message.includes("temporarily unavailable");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function extractGeminiText(data: GeminiApiResponse): string | null {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => part.text)
    .filter((value): value is string => typeof value === "string")
    .join("")
    .trim();
  return text || null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toGeminiError(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  return new GeminiError(error instanceof Error ? error.message : String(error), undefined, true);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
