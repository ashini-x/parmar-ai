import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env, ProfileContext } from "../src/config/env";
import { handleArenaRun } from "../src/ai/arena";
import { resetFreeModelStateForTests } from "../src/ai/freemodel";
import { buildStandardArenaPrompt, buildUserPrompt } from "../src/ai/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
  resetFreeModelStateForTests();
});

const profileContext: ProfileContext = {
  profile: {
    version: 2,
    targetExam: "SSC CGL",
    recentTopics: ["Indian Constitution"],
    recentSubjects: ["polity"],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 3,
    lastUpdatedAt: 0,
  },
  recentTopicHint: "Indian Constitution",
  attentionTopicHint: "",
  revisionHint: "",
  recentConversation: [
    { question: "What is Article 32?", answer: "Article 32 provides the right to constitutional remedies." },
  ],
};

describe("Standard SSC Model Arena prompt parity", () => {
  it("uses the production prompt builder and carries browser conversation turns", () => {
    const env = {
      ENABLE_GOOGLE_SEARCH_GROUNDING: "false",
      GEMINI_THINKING_LEVEL: "HIGH",
    } as unknown as Env;
    const result = buildStandardArenaPrompt(env, "Explain this simply", profileContext);
    const expected = buildUserPrompt("Explain this simply", profileContext, false, false, result.requestedQuizCount);
    expect(result.prompt).toBe(expected);
    expect(result.prompt).toContain("Article 32 provides the right to constitutional remedies.");
    expect(result.clarificationPacket).toBeUndefined();
  });

  it("uses the same Telegram pre-generation clarification for a generic quiz without a topic", () => {
    const env = { ENABLE_GOOGLE_SEARCH_GROUNDING: "false" } as unknown as Env;
    const context: ProfileContext = {
      ...profileContext,
      profile: {
        ...profileContext.profile,
        recentTopics: [],
      },
      recentTopicHint: "",
      recentConversation: [],
    };
    const result = buildStandardArenaPrompt(env, "Give me a quiz", context);
    expect(result.clarificationPacket?.questionMode).toBe("mcq");
    expect(result.clarificationPacket?.answer).toContain("kis topic par chahiye");
  });
});

describe("Standard SSC Model Arena end-to-end timing", () => {
  it("reports Auto-Router wall-clock latency separately from the winning model call", async () => {
    resetFreeModelStateForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return Response.json({
          object: "list",
          data: [{ id: "claude-sonnet-5-5", type: "chat", capabilities: ["json_mode"] }],
        });
      }
      if (url.endsWith("/chat/completions")) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const packet = {
          responseMode: "text",
          answer: "Article 17 abolishes untouchability.",
          quizQuestion: "",
          quizOptions: [],
          quizCorrectOptionIds: [],
          quizExplanation: "",
          quizItems: [],
          sscTakeaway: "Article 17 of the Constitution.",
          answerScope: "ssc_ga_gs",
          subject: "polity",
          topic: "Fundamental Rights",
          questionMode: "fact",
          examRelevance: "A",
          profileSignal: "neutral",
          nextRevisionTopic: "",
          detectedExam: null,
          timeSensitive: false,
        };
        return Response.json({
          object: "chat.completion",
          model: "claude-sonnet-5-5",
          choices: [{ message: { role: "assistant", content: JSON.stringify(packet) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 },
        });
      }
      throw new Error("Unexpected provider request in Arena timing test");
    }));

    const env = {
      ENVIRONMENT: "staging",
      ENABLE_GOOGLE_SEARCH_GROUNDING: "false",
      FREEMODEL_API_KEY: "test-key",
      FREEMODEL_BASE_URL: "https://freemodel.test/v1",
      FREEMODEL_PRIMARY_MODEL: "claude-sonnet-5-5",
      GEMINI_MODEL: "gemini-3.8-flash",
    } as unknown as Env;
    const response = await handleArenaRun(
      env,
      new Request("https://arena-staging.example.workers.dev/admin/api/arena/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What does Article 17 abolish?", targetModel: "auto" }),
      }),
    );
    const body = await response.json() as {
      right: {
        ok: boolean;
        latencyMs: number;
        modelLatencyMs: number;
        routerAndFailoverLatencyMs: number;
      };
    };

    expect(body.right.ok).toBe(true);
    expect(body.right.latencyMs).toBeGreaterThanOrEqual(body.right.modelLatencyMs);
    expect(body.right.routerAndFailoverLatencyMs).toBeGreaterThan(10);
    expect(body.right.latencyMs - body.right.modelLatencyMs).toBeCloseTo(body.right.routerAndFailoverLatencyMs, 0);
  });
});
