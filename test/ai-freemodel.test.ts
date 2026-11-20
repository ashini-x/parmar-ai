import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, ProfileContext } from "../src/config/env";
import {
  ANSWER_PACKET_REQUIRED_KEYS,
  FREE_MODEL_ANSWER_PACKET_SCHEMA,
  generateFreeModelAnswer,
  getFreeModelCooldownStateForTests,
  rankActiveFreeModelModels,
  resetFreeModelCooldowns,
  resetFreeModelStateForTests,
  supportsFreeModelJsonMode,
  type FreeModelModel,
} from "../src/ai/freemodel";

const baseEnv = {
  FREEMODEL_API_KEY: "fm_test_key",
  FREEMODEL_BASE_URL: "https://freemodel.test/v1",
} as unknown as Env;

const profileContext: ProfileContext = {
  profile: {
    version: 2,
    targetExam: "SSC (not specified)",
    recentTopics: [],
    recentSubjects: [],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 0,
    lastUpdatedAt: 0,
  },
  recentTopicHint: "",
  attentionTopicHint: "",
  revisionHint: "",
  recentConversation: [],
};

function answerPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responseMode: "text",
    answer: "The Constitution came into force on 26 January 1950.",
    quizQuestion: "",
    quizOptions: [],
    quizCorrectOptionIds: [],
    quizExplanation: "",
    quizItems: [],
    sscTakeaway: "26 January is observed as Republic Day.",
    answerScope: "ssc_ga_gs",
    subject: "polity",
    topic: "Constitution of India",
    questionMode: "fact",
    examRelevance: "A",
    profileSignal: "neutral",
    nextRevisionTopic: "",
    detectedExam: null,
    timeSensitive: false,
    ...overrides,
  };
}

function catalog(models: FreeModelModel[]): Response {
  return Response.json({ object: "list", data: models });
}

function completion(model: string, body: Record<string, unknown>, usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }): Response {
  return Response.json({
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(body) }, finish_reason: "stop" }],
    usage,
  });
}

const modelA: FreeModelModel = {
  id: "claude-sonnet-5-5",
  type: "chat",
  capabilities: ["json_mode", "reasoning"],
  pricing: { input_per_1k: 0.001, output_per_1k: 0.002 },
};
const modelB: FreeModelModel = {
  id: "claude-opus-5-5",
  type: "chat",
  capabilities: [],
  pricing: { input_per_1k: 0.002, output_per_1k: 0.004 },
};

beforeEach(() => {
  resetFreeModelStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FreeModel Model Arena adapter", () => {
  it("ranks the configured primary first and follows the declared priority list", () => {
    const models = [
      { id: "other-z", type: "chat", capabilities: [] },
      { id: "claude-fable-5-2", type: "chat", capabilities: [] },
      { id: "claude-sonnet-5-5", type: "chat", capabilities: [] },
      { id: "not-chat", type: "embedding", capabilities: [] },
    ] as FreeModelModel[];
    const ranked = rankActiveFreeModelModels(models, "claude-sonnet-5-5");
    expect(ranked.map((model) => model.id)).toEqual([
      "claude-sonnet-5-5",
      "claude-fable-5-2",
      "other-z",
    ]);
  });

  it("derives the exact 17 required keys and enum values from the production schema", () => {
    expect(ANSWER_PACKET_REQUIRED_KEYS).toHaveLength(17);
    expect((FREE_MODEL_ANSWER_PACKET_SCHEMA.required as string[])).toEqual([...ANSWER_PACKET_REQUIRED_KEYS]);
    const properties = FREE_MODEL_ANSWER_PACKET_SCHEMA.properties as Record<string, { enum?: string[] }>;
    expect(properties.responseMode.enum).toEqual(["text", "quiz"]);
    expect(properties.answerScope.enum).toEqual(["ssc_ga_gs", "ssc_support", "out_of_scope"]);
    expect(properties.subject.enum).toContain("current_affairs");
    expect(properties.examRelevance.enum).toEqual(["A", "B", "C", "D"]);
  });

  it("uses the 15-second timeout for an individual model inference request", async () => {
    let inferenceSignal: AbortSignal | undefined;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return Promise.resolve(catalog([modelA]));
      inferenceSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        inferenceSignal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }));

    const pending = generateFreeModelAnswer(baseEnv, {
      question: "Explain Article 17 and its significance.",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelA.id,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(inferenceSignal).toBeDefined();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(inferenceSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: "timeout", modelId: modelA.id });
  });

  it("detects json_mode only when the active model advertises it", () => {
    expect(supportsFreeModelJsonMode(modelA)).toBe(true);
    expect(supportsFreeModelJsonMode(modelB)).toBe(false);
  });

  it("sends response_format only for models advertising json_mode", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return catalog([modelA, modelB]);
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return completion(String(requests.length === 1 ? modelA.id : modelB.id), answerPacket());
    }));

    await generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelA.id,
    });
    await generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelB.id,
    });

    expect(requests[0].response_format).toEqual({ type: "json_object" });
    expect(requests[1]).not.toHaveProperty("response_format");
    expect(requests[0].temperature).toBe(0.1);
    expect(requests[0].max_tokens).toBe(2048);
    expect(requests[0]).not.toHaveProperty("reasoning_effort");
    expect((requests[0].messages as Array<{ content: string }>)[0].content).toContain("You are परमार्थAI");
  });

  it.each([404, 429, 502])("fails over after HTTP %s and records a cooldown", async (status) => {
    let inferenceCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA, modelB]);
      inferenceCalls += 1;
      if (inferenceCalls === 1) return new Response(JSON.stringify({ error: { message: "temporary" } }), { status });
      return completion(modelB.id, answerPacket());
    }));

    const result = await generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: "auto",
    });

    expect(inferenceCalls).toBe(2);
    expect(result.modelUsed).toBe(modelB.id);
    expect(result.failoverModels[0]).toContain(modelA.id);
    expect(getFreeModelCooldownStateForTests().size).toBe(1);
    const cooldown = [...getFreeModelCooldownStateForTests().values()][0];
    expect(cooldown.until).toBeGreaterThan(Date.now());
  });

  it("limits Auto-Router to four curated active models in their declared order", async () => {
    const candidates = [
      { id: "gpt-5.5", type: "chat", capabilities: [] },
      { id: "matilda-cerulean-i", type: "chat", capabilities: [] },
      { id: "claude-sonnet-5-5", type: "chat", capabilities: [] },
      { id: "kimi-k3", type: "chat", capabilities: [] },
      { id: "deepseek-v3.2", type: "chat", capabilities: [] },
      { id: "claude-opus-5-5", type: "chat", capabilities: [] },
    ] as FreeModelModel[];
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return catalog(candidates);
      const body = JSON.parse(String(init?.body)) as { model: string };
      attempted.push(body.model);
      return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 503 });
    }));

    await expect(generateFreeModelAnswer(baseEnv, {
      question: "Explain Fundamental Rights.",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: "auto",
    })).rejects.toMatchObject({ code: "all_models_unavailable" });

    expect(attempted).toEqual([
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "deepseek-v3.2",
      "kimi-k3",
    ]);
  });

  it("stops immediately on HTTP 402 without trying the next model", async () => {
    let inferenceCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA, modelB]);
      inferenceCalls += 1;
      return new Response(JSON.stringify({ error: { message: "insufficient funds" } }), { status: 402 });
    }));

    await expect(generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: "auto",
    })).rejects.toMatchObject({ code: "insufficient_funds", status: 402 });
    expect(inferenceCalls).toBe(1);
    expect(getFreeModelCooldownStateForTests().size).toBe(0);
  });

  it("runs the shared AnswerPacket parser and sanitizer before returning a packet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA]);
      return completion(modelA.id, answerPacket({ sscTakeaway: "📌 SSC Focus: 26 January is observed as Republic Day." }));
    }));

    const result = await generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelA.id,
    });

    expect(result.packet.answer).toContain("📌 SSC Focus:");
    expect(result.packet.sscTakeaway).toBe("26 January is observed as Republic Day.");
    expect((result.packet.answer.match(/📌 SSC Focus:/gu) ?? []).length).toBe(1);
    expect(result.tokens).toEqual({
      promptTokens: 100,
      candidatesTokens: 30,
      thoughtsTokens: 0,
      thoughtsReported: false,
      totalTokens: 130,
    });
    expect(result.estimatedCostUsd).toBe(0.00016);
  });

  it("normalizes an empty answer on a valid multi-item quiz before shared parsing", async () => {
    const quizItems = [
      { question: "Which Article guarantees equality before law?", options: ["Article 14", "Article 19", "Article 21", "Article 32"], correctOptionIds: [0], explanation: "Article 14 guarantees equality before law." },
      { question: "Which Article abolishes untouchability?", options: ["Article 15", "Article 16", "Article 17", "Article 18"], correctOptionIds: [2], explanation: "Article 17 abolishes untouchability." },
      { question: "Which Article protects freedom of speech?", options: ["Article 14", "Article 19", "Article 20", "Article 22"], correctOptionIds: [1], explanation: "Article 19(1)(a) protects freedom of speech and expression." },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA]);
      return completion(modelA.id, answerPacket({
        responseMode: "quiz",
        answer: "",
        questionMode: "mcq",
        quizQuestion: "",
        quizOptions: [],
        quizCorrectOptionIds: [],
        quizExplanation: "",
        quizItems,
      }));
    }));

    const result = await generateFreeModelAnswer(baseEnv, {
      question: "Generate 3 MCQs on Fundamental Rights.",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 3,
      targetModel: modelA.id,
    });

    expect(result.packet.responseMode).toBe("quiz");
    expect(result.packet.quizItems).toHaveLength(3);
    expect(result.packet.answer).toContain("Generated 3 SSC MCQs.");
  });

  it("cools a model for malformed AnswerPacket JSON and fails over", async () => {
    let inferenceCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA, modelB]);
      inferenceCalls += 1;
      if (inferenceCalls === 1) {
        return completion(modelA.id, { responseMode: "text", answer: "Incomplete" });
      }
      return completion(modelB.id, answerPacket());
    }));

    const result = await generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: "auto",
    });

    expect(result.modelUsed).toBe(modelB.id);
    expect(result.failoverModels[0]).toContain("malformed_json");
    expect(getFreeModelCooldownStateForTests().size).toBe(1);
  });

  it("clears only cooldowns for the configured FreeModel endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA]);
      return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 503 });
    }));

    await expect(generateFreeModelAnswer(baseEnv, {
      question: "When did the Constitution of India come into force?",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelA.id,
    })).rejects.toMatchObject({ code: "upstream_error" });

    expect(getFreeModelCooldownStateForTests().size).toBe(1);
    expect(resetFreeModelCooldowns(baseEnv)).toBe(1);
    expect(getFreeModelCooldownStateForTests().size).toBe(0);
  });

  it("keeps out-of-scope normalization in the shared sanitizer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) return catalog([modelA]);
      return completion(modelA.id, answerPacket({ answerScope: "out_of_scope", sscTakeaway: "" }));
    }));

    const result = await generateFreeModelAnswer(baseEnv, {
      question: "Write a Python program to sort a list.",
      userPrompt: "Production-built user prompt.",
      profileContext,
      requestedQuizCount: 1,
      targetModel: modelA.id,
    });

    expect(result.packet.answer).toContain("sirf SSC");
    expect(result.packet.answerScope).toBe("out_of_scope");
  });
});
