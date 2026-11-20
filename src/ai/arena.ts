import type { AnswerPacket, ConversationTurn, Env, ProfileContext, StudentProfile } from "../config/env";
import { formatTelegramHtml, stripTelegramMarkdownMarkers } from "../telegram/formatting";
import { GeminiError, generateGeminiArenaAnswer, buildStandardArenaPrompt } from "./gemini";
import {
  FreeModelError,
  generateFreeModelAnswer,
  getFreeModelModels,
} from "./freemodel";

const MAX_ARENA_QUESTION_CHARS = 4_000;
const MAX_ARENA_HISTORY_TURNS = 8;
const MAX_ARENA_HISTORY_TEXT_CHARS = 4_000;

interface ArenaRunBody {
  question?: unknown;
  recentConversation?: unknown;
  targetModel?: unknown;
}

interface ArenaTokenMetrics {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  thoughtsReported: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * The Arena has no Telegram identity or saved student profile. It uses the
 * production prompt builder with an explicit neutral profile and the browser's
 * ephemeral conversation turns. The production question-generation path is
 * not modified and no profile is written to D1 or a Durable Object.
 */
export function createArenaProfileContext(recentConversation: ConversationTurn[]): ProfileContext {
  const profile: StudentProfile = {
    version: 2,
    targetExam: "SSC (not specified)",
    recentTopics: [],
    recentSubjects: [],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 0,
    lastUpdatedAt: 0,
  };
  return {
    profile,
    recentTopicHint: "",
    attentionTopicHint: "",
    revisionHint: "",
    recentConversation,
  };
}

function normalizeRecentConversation(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_ARENA_HISTORY_TURNS)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const turn = item as Record<string, unknown>;
      if (typeof turn.question !== "string" || typeof turn.answer !== "string") return null;
      const question = turn.question.trim().slice(0, MAX_ARENA_HISTORY_TEXT_CHARS);
      const answer = turn.answer.trim().slice(0, MAX_ARENA_HISTORY_TEXT_CHARS);
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter((turn): turn is ConversationTurn => Boolean(turn));
}

function createTelegramPreview(packet: AnswerPacket) {
  let answer = packet.answer;
  const takeaway = packet.sscTakeaway.trim();
  if (takeaway) {
    const exactBlock = "\n\n📌 SSC Focus: " + takeaway;
    if (answer.endsWith(exactBlock)) {
      answer = answer.slice(0, -exactBlock.length).trimEnd();
    } else {
      const marker = "📌 SSC Focus:";
      const markerAt = answer.lastIndexOf(marker);
      if (markerAt >= 0 && answer.slice(markerAt).includes(takeaway)) {
        answer = answer.slice(0, markerAt).trimEnd();
      } else if (answer.toLowerCase().endsWith(takeaway.toLowerCase())) {
        answer = answer.slice(0, -takeaway.length).trimEnd();
      }
    }
  }

  const quizItems = packet.quizItems?.length
    ? packet.quizItems
    : (packet.quizQuestion ? [{
      question: packet.quizQuestion,
      options: packet.quizOptions,
      correctOptionIds: packet.quizCorrectOptionIds,
      explanation: packet.quizExplanation,
    }] : []);

  return {
    answerHtml: formatTelegramHtml(answer),
    takeawayHtml: takeaway ? formatTelegramHtml("📌 SSC Focus: " + takeaway) : "",
    quizItems: packet.responseMode === "quiz" ? quizItems.map((item) => ({
      question: stripTelegramMarkdownMarkers(item.question).trim().slice(0, 300),
      options: item.options.map((option) => stripTelegramMarkdownMarkers(option).trim().slice(0, 100)),
      correctOptionIds: item.correctOptionIds,
      explanationHtml: formatTelegramHtml(item.explanation),
    })) : [],
  };
}

function emptyTokens(): ArenaTokenMetrics {
  return { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0, thoughtsReported: true };
}

function safeVertexFailure(error: unknown): { code: string; message: string; status: number | null } {
  if (error instanceof GeminiError) {
    if (error.status) {
      return {
        code: "vertex_http_" + error.status,
        message: "Vertex AI generation failed (HTTP " + error.status + ").",
        status: error.status,
      };
    }
    return { code: "vertex_generation_failed", message: "Vertex AI generation did not complete.", status: null };
  }
  return { code: "vertex_generation_failed", message: "Vertex AI generation did not complete.", status: null };
}

function safeFreeModelFailure(error: unknown): { code: string; message: string; status: number | null; cooldownUntil?: number } {
  if (error instanceof FreeModelError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.cooldownUntil ? { cooldownUntil: error.cooldownUntil } : {}),
    };
  }
  return {
    code: "freemodel_generation_failed",
    message: "FreeModel generation did not complete.",
    status: null,
  };
}

async function runVertexSide(
  env: Env,
  question: string,
  profileContext: ProfileContext,
  sharedUserPrompt: string,
): Promise<Record<string, unknown>> {
  const startedAt = performance.now();
  try {
    // Arena-only wrapper over the same Vertex request and AnswerPacket
    // validator; the Telegram production generator and queue are not changed.
    const generation = await generateGeminiArenaAnswer(
      env,
      question,
      profileContext,
      sharedUserPrompt,
    );
    const usage = generation.usage;
    const tokens = usage.reduce<ArenaTokenMetrics>((total, record) => ({
      promptTokens: total.promptTokens + record.promptTokens,
      candidatesTokens: total.candidatesTokens + record.candidatesTokens,
      thoughtsTokens: total.thoughtsTokens + record.thoughtsTokens,
      totalTokens: total.totalTokens + record.totalTokens,
      thoughtsReported: true,
    }), emptyTokens());
    const estimatedCostUsd = usage.reduce(
      (total, record) => total + record.estimatedCostMicrousd / 1_000_000,
      0,
    );
    const lastUsage = usage[usage.length - 1];
    return {
      ok: true,
      packet: generation.packet,
      telegramPreview: createTelegramPreview(generation.packet),
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tokens,
      modelUsed: lastUsage?.model || env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      thinkingEffort: generation.packet.thinkingLevelUsed || lastUsage?.thinkingLevel || "Not reported",
      estimatedCostUsd,
      estimateBasis: "Estimate from the existing Vertex token-rate environment variables; not a Google Cloud invoice amount.",
      attempts: usage.length,
      grounded: Boolean(generation.packet.grounded),
    };
  } catch (error) {
    return {
      ok: false,
      ...safeVertexFailure(error),
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tokens: emptyTokens(),
      modelUsed: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      thinkingEffort: "Unavailable",
      estimatedCostUsd: null,
      estimateBasis: "Unavailable because generation did not complete.",
    };
  }
}

async function runFreeModelSide(
  env: Env,
  question: string,
  prompt: string,
  profileContext: ProfileContext,
  requestedQuizCount: number,
  targetModel: string,
): Promise<Record<string, unknown>> {
  try {
    const result = await generateFreeModelAnswer(env, {
      question,
      userPrompt: prompt,
      profileContext,
      requestedQuizCount,
      targetModel,
    });
    return {
      ok: true,
      packet: result.packet,
      telegramPreview: createTelegramPreview(result.packet),
      latencyMs: result.latencyMs,
      catalogueAndRouterOverheadMs: null,
      tokens: result.tokens,
      modelUsed: result.modelUsed,
      thinkingEffort: result.thinkingEffort,
      estimatedCostUsd: result.estimatedCostUsd,
      estimateBasis: result.estimateBasis,
      jsonMode: result.jsonMode,
      failoverModels: result.failoverModels,
    };
  } catch (error) {
    return {
      ok: false,
      ...safeFreeModelFailure(error),
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tokens: emptyTokens(),
      modelUsed: targetModel === "auto" ? "Auto-Router (no model completed)" : targetModel,
      thinkingEffort: "Unavailable",
      estimatedCostUsd: null,
      estimateBasis: "Unavailable because generation did not complete.",
      failoverModels: [],
    };
  }
}

export async function handleArenaModels(env: Env, forceRefresh = false): Promise<Response> {
  try {
    const result = await getFreeModelModels(env, { forceRefresh });
    return json({
      ok: true,
      ...result,
      cacheTtlMs: 5 * 60_000,
      rankingNote: "Configured priority order, with the configured primary model first; remaining active chat models are ordered alphabetically.",
      forcedRefresh: forceRefresh,
    });
  } catch (error) {
    const failure = safeFreeModelFailure(error);
    return json({ ok: false, error: failure.code, message: failure.message }, failure.status === 401 || failure.status === 403 ? 502 : 503);
  }
}

/**
 * Stateless Arena backend: validates the request, runs both model providers in
 * parallel, and returns the outputs without any D1, KV, DO, Queue or log writes.
 */
export async function handleArenaRun(env: Env, request: Request): Promise<Response> {
  let body: ArenaRunBody;
  try {
    body = await request.json() as ArenaRunBody;
  } catch {
    return json({ ok: false, error: "invalid_json", message: "Request body must be valid JSON." }, 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return json({ ok: false, error: "question_required", message: "Enter an SSC question to compare." }, 400);
  }
  const maxQuestionLength = Math.max(1, Number.parseInt(env.MAX_QUESTION_LENGTH ?? "", 10) || MAX_ARENA_QUESTION_CHARS);
  if (question.length > Math.min(maxQuestionLength, MAX_ARENA_QUESTION_CHARS)) {
    return json({ ok: false, error: "question_too_long", message: "The question exceeds the supported 4,000-character limit." }, 400);
  }

  const targetModel = typeof body.targetModel === "string" && body.targetModel.trim()
    ? body.targetModel.trim().slice(0, 128)
    : "auto";
  const recentConversation = normalizeRecentConversation(body.recentConversation);
  const profileContext = createArenaProfileContext(recentConversation);
  const standardPrompt = buildStandardArenaPrompt(env, question, profileContext);

  // Match Telegram's built-in clarification response for generic MCQ requests
  // with no subject anchor. Neither provider is called for this case.
  if (standardPrompt.clarificationPacket) {
    const packet = standardPrompt.clarificationPacket;
    const noModelCall = {
      ok: true,
      packet,
      telegramPreview: createTelegramPreview(packet),
      latencyMs: 0,
      tokens: emptyTokens(),
      modelUsed: "Not called (Telegram topic clarification)",
      thinkingEffort: "Not applicable",
      estimatedCostUsd: 0,
      estimateBasis: "No LLM call: same topic-clarification short circuit used by Telegram.",
    };
    return json({
      ok: true,
      left: noModelCall,
      right: noModelCall,
      prompt: {
        builder: "production buildUserPrompt()",
        conversationTurns: recentConversation.length,
        requestedQuizCount: standardPrompt.requestedQuizCount,
        requiresVertexGoogleSearchGrounding: false,
        topicClarification: true,
        note: "Both sides use the same pre-generation topic clarification. No model was called.",
      },
      persistence: "stateless",
    });
  }

  const [leftResult, rightResult] = await Promise.allSettled([
    runVertexSide(env, question, profileContext, standardPrompt.prompt),
    runFreeModelSide(
      env,
      question,
      standardPrompt.prompt,
      profileContext,
      standardPrompt.requestedQuizCount,
      targetModel,
    ),
  ]);

  const left = leftResult.status === "fulfilled"
    ? leftResult.value
    : {
      ok: false,
      ...safeVertexFailure(leftResult.reason),
      latencyMs: null,
      tokens: emptyTokens(),
      modelUsed: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      thinkingEffort: "Unavailable",
      estimatedCostUsd: null,
    };
  const right = rightResult.status === "fulfilled"
    ? rightResult.value
    : {
      ok: false,
      ...safeFreeModelFailure(rightResult.reason),
      latencyMs: null,
      tokens: emptyTokens(),
      modelUsed: targetModel,
      thinkingEffort: "Unavailable",
      estimatedCostUsd: null,
    };

  // The production prompt builder is reused once for the candidate request.
  // The Vertex generator computes the same production conditions internally.
  return json({
    ok: true,
    left,
    right,
    prompt: {
      builder: "production buildUserPrompt()",
      conversationTurns: recentConversation.length,
      requestedQuizCount: standardPrompt.requestedQuizCount,
      requiresVertexGoogleSearchGrounding: standardPrompt.requiresGrounding,
      note: standardPrompt.requiresGrounding
        ? "Both models receive identical prompt text. Vertex may additionally invoke its configured Google Search grounding; no equivalent FreeModel search tool is attached."
        : "Both models receive identical production-built prompt text.",
    },
    persistence: "stateless",
  });
}
