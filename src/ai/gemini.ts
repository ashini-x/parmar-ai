import type { Env } from "../config/env";

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const REQUEST_TIMEOUT_MS = 25_000;

export class GeminiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export async function generateGeminiAnswer(
  env: Env,
  question: string,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new GeminiError("Gemini API key is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `You are the core answering engine for Parmar SSC Doubts.

Your job is to answer questions from SSC, Railway and other Indian competitive-exam aspirants.

LANGUAGE:
- Answer in natural Hindi/Hinglish.
- Use English for common exam/academic terminology when that sounds natural.
- Do not force awkward translations.
- Match the language of the student's question when practical.

ANSWER QUALITY:
- Be factually accurate.
- Be concise but sufficiently explanatory.
- Prioritize exam-relevant facts.
- Clearly distinguish the direct answer from supporting explanation.
- Mention a common confusion or exam trap only when useful.
- Use a memory trick only when it genuinely helps.
- Never invent facts.
- When a question is ambiguous, explicitly state the ambiguity instead of guessing.
- For time-sensitive/current information, be careful about whether the information may have changed.

STYLE FOR THIS PHASE:
- This is NOT the Parmar voice/style imitation layer yet.
- Do not imitate any particular person's speech patterns.
- Write as a highly effective SSC/Railway teacher.
- Sound conversational, clear and confident.
- Do not write like a formal encyclopedia.

FORMAT:
- Start with the direct answer.
- Then explain it in simple terms.
- End with a short exam takeaway when useful.
- Prefer short paragraphs.
- No preamble about being an AI.
- No markdown tables.
- No citations unless they are specifically requested.
`,
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: question }],
          },
        ],
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: "medium",
          },
        },
      }),
      signal: controller.signal,
    });

    const raw = await response.text();

    let data: unknown;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new GeminiError(
        `Gemini returned a non-JSON response (HTTP ${response.status}).`,
        response.status,
      );
    }

    if (!response.ok) {
      const apiMessage = extractGeminiErrorMessage(data);

      throw new GeminiError(
        apiMessage ||
          `Gemini request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    const answer = extractGeminiText(data);

    if (!answer) {
      throw new GeminiError(
        "Gemini returned no usable text response.",
        response.status,
      );
    }

    return normalizeAnswer(answer);
  } catch (error) {
    if (error instanceof GeminiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiError("Gemini request timed out.");
    }

    throw new GeminiError(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiText(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const candidates = data["candidates"];

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const firstCandidate = candidates[0];

  if (!isRecord(firstCandidate)) {
    return null;
  }

  const content = firstCandidate["content"];

  if (!isRecord(content)) {
    return null;
  }

  const parts = content["parts"];

  if (!Array.isArray(parts)) {
    return null;
  }

  const textParts = parts
    .filter(isRecord)
    .map((part) => part["text"])
    .filter((value): value is string => typeof value === "string");

  const text = textParts.join("").trim();

  return text || null;
}

function extractGeminiErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const error = data["error"];

  if (!isRecord(error)) {
    return null;
  }

  const message = error["message"];

  return typeof message === "string" ? message : null;
}

function normalizeAnswer(answer: string): string {
  return answer
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
