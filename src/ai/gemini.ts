import type { Env } from "../config/env";

const GEMINI_MODEL = "gemini-3.8-flash";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/*
 * Keep each attempt reasonably short because this function currently
 * runs inside Cloudflare waitUntil(), which has a 30-second post-response
 * execution window.
 */
const REQUEST_TIMEOUT_MS = 7_500;
const MAX_ATTEMPTS = 3;

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 2_500;

export class GeminiError extends Error {
  status?: number;
  retryable: boolean;

  constructor(
    message: string,
    status?: number,
    retryable = false,
  ) {
    super(message);

    this.name = "GeminiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function generateGeminiAnswer(
  env: Env,
  question: string,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new GeminiError(
      "Gemini API key is not configured.",
    );
  }

  let lastError: GeminiError | null = null;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const result = await requestGemini(
        apiKey,
        question,
      );

      return result;
    } catch (error) {
      const geminiError =
        toGeminiError(error);

      lastError = geminiError;

      if (
        !geminiError.retryable ||
        attempt >= MAX_ATTEMPTS
      ) {
        throw geminiError;
      }

      const delay =
        getRetryDelay(
          attempt,
          geminiError.retryAfterMs,
        );

      await sleep(delay);
    }
  }

  throw (
    lastError ??
    new GeminiError(
      "Gemini request failed.",
    )
  );
}

interface GeminiRequestError {
  message?: string;
  status?: string;
  code?: number;
  details?: Array<{
    "@type"?: string;
    retryDelay?: string;
  }>;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;

  error?: GeminiRequestError;
}

async function requestGemini(
  apiKey: string,
  question: string,
): Promise<string> {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      GEMINI_ENDPOINT,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",
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
- Use English for common exam and academic terminology when that sounds natural.
- Do not force awkward translations.
- Match the language of the student's question whenever practical.

ANSWER QUALITY:
- Be factually accurate.
- Give the direct answer first.
- Explain the concept simply.
- Prioritize facts that matter for SSC/Railway examinations.
- Identify an important exam trap or common confusion when useful.
- Give a memory trick only when genuinely useful.
- Never invent facts.
- Never pretend uncertainty is certainty.
- If a question is ambiguous, clearly say what is ambiguous.
- Do not turn a simple question into an unnecessarily long lecture.

STYLE FOR PHASE C:
- This is the generic SSC/Railway intelligence layer.
- Do NOT imitate Parmar Sir's individual voice, phrases, pauses or speaking style yet.
- Sound like a highly effective competitive-exam teacher.
- Be conversational, clear and confident.
- Avoid textbook-like writing.

FORMAT:
- Direct answer.
- Short explanation.
- Exam-relevant takeaway when useful.
- Prefer short paragraphs.
- No markdown tables.
- No unnecessary introduction.
- No "As an AI..." language.
`,
              },
            ],
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: question,
                },
              ],
            },
          ],

          generationConfig: {
            thinkingConfig: {
              thinkingLevel: "medium",
            },

            maxOutputTokens: 800,
          },
        }),

        signal: controller.signal,
      },
    );

    const retryAfterMs =
      parseRetryAfterHeader(
        response.headers.get(
          "retry-after",
        ),
      );

    const raw =
      await response.text();

    let data: GeminiApiResponse;

    try {
      data =
        JSON.parse(
          raw,
        ) as GeminiApiResponse;
    } catch {
      throw new GeminiError(
        `Gemini returned invalid JSON (HTTP ${response.status}).`,
        response.status,
        isRetryableStatus(
          response.status,
        ),
      );
    }

    if (!response.ok) {
      const apiMessage =
        data.error?.message ??
        `Gemini request failed with HTTP ${response.status}.`;

      const retryable =
        isRetryableGeminiError(
          response.status,
          data.error,
        );

      throw new GeminiError(
        apiMessage,
        response.status,
        retryable,
      );
    }

    const answer =
      extractGeminiText(data);

    if (!answer) {
      throw new GeminiError(
        "Gemini returned no usable text response.",
        response.status,
        false,
      );
    }

    return normalizeAnswer(
      answer,
    );
  } catch (error) {
    if (
      error instanceof GeminiError
    ) {
      /*
       * Preserve the Retry-After information
       * when possible.
       */
      if (
        !error.retryable
      ) {
        throw error;
      }

      throw error;
    }

    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new GeminiError(
        `Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        undefined,
        true,
      );
    }

    throw new GeminiError(
      error instanceof Error
        ? error.message
        : String(error),
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiText(
  data: GeminiApiResponse,
): string | null {
  const candidates =
    data.candidates;

  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }

  const firstCandidate =
    candidates[0];

  const parts =
    firstCandidate?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return null;
  }

  const textParts =
    parts
      .map(
        (part) =>
          part?.text,
      )
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
          "string",
      );

  const answer =
    textParts
      .join("")
      .trim();

  return answer || null;
}

function isRetryableStatus(
  status: number,
): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

function isRetryableGeminiError(
  status: number,
  error?: GeminiRequestError,
): boolean {
  if (
    !isRetryableStatus(status)
  ) {
    return false;
  }

  /*
   * A daily quota exhaustion will not be fixed by
   * retrying three times immediately.
   */
  const message =
    `${error?.status ?? ""} ${
      error?.message ?? ""
    }`.toLowerCase();

  const looksLikeDailyQuota =
    message.includes(
      "quota_exceeded",
    ) ||
    message.includes(
      "daily quota",
    ) ||
    message.includes(
      "per day",
    ) ||
    message.includes(
      "requests per day",
    ) ||
    message.includes(
      "tokens per day",
    );

  if (
    looksLikeDailyQuota
  ) {
    return false;
  }

  return true;
}

function toGeminiError(
  error: unknown,
): GeminiError {
  if (
    error instanceof GeminiError
  ) {
    return error;
  }

  if (
    error instanceof Error &&
    error.name === "AbortError"
  ) {
    return new GeminiError(
      `Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
      undefined,
      true,
    );
  }

  return new GeminiError(
    error instanceof Error
      ? error.message
      : String(error),
    undefined,
    true,
  );
}

function getRetryDelay(
  attempt: number,
  retryAfterMs?: number,
): number {
  if (
    typeof retryAfterMs ===
      "number" &&
    Number.isFinite(
      retryAfterMs,
    )
  ) {
    return Math.min(
      retryAfterMs,
      MAX_RETRY_DELAY_MS,
    );
  }

  const exponential =
    INITIAL_RETRY_DELAY_MS *
    2 ** (attempt - 1);

  /*
   * Small jitter prevents synchronized retries.
   */
  const jitter =
    Math.floor(
      Math.random() * 250,
    );

  return Math.min(
    exponential + jitter,
    MAX_RETRY_DELAY_MS,
  );
}

function parseRetryAfterHeader(
  value: string | null,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds =
    Number(value);

  if (
    Number.isFinite(
      seconds,
    ) &&
    seconds >= 0
  ) {
    return seconds * 1000;
  }

  return undefined;
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function normalizeAnswer(
  answer: string,
): string {
  return answer
    .replace(
      /\r\n/g,
      "\n",
    )
    .replace(
      /\n{3,}/g,
      "\n\n",
    )
    .trim();
}
