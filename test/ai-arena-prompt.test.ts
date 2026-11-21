import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env, ProfileContext } from "../src/config/env";
import { invalidateGoogleAccessToken } from "../src/auth/google";
import { handleArenaRun, handleArenaJudge } from "../src/ai/arena";
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


describe("Standard SSC Model Arena blind Gemini judge", () => {
  async function createPrivateKeyPem(): Promise<string> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    let binary = "";
    for (const byte of new Uint8Array(der)) binary += String.fromCharCode(byte);
    return [
      "-----BEGIN PRIVATE KEY-----",
      btoa(binary),
      "-----END PRIVATE KEY-----",
    ].join("\n");
  }

  it("judges anonymized full AnswerPackets and maps the blind winner back to the correct side", async () => {
    const privateKey = await createPrivateKeyPem();
    const vertexPacket = {
      responseMode: "text",
      answer: "Article 17 of the Constitution abolishes untouchability.",
      quizQuestion: "",
      quizOptions: [],
      quizCorrectOptionIds: [],
      quizExplanation: "",
      quizItems: [],
      sscTakeaway: "Article 17 abolishes untouchability.",
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
    const freeModelPacket = {
      ...vertexPacket,
      answer: "Article 17 protects the right to freedom of speech.",
      sscTakeaway: "Article 17 is about freedom of speech.",
    };
    const judgeOutput = {
      criteria: {
        accuracy: { a: 10, b: 2, comparison: "Candidate A correctly identifies Article 17; Candidate B confuses it with Article 19." },
        relevance: { a: 10, b: 7, comparison: "A directly answers the question." },
        completeness: { a: 9, b: 7, comparison: "Both are concise; A supplies the required fact." },
        sscFit: { a: 10, b: 8, comparison: "A is a reliable SSC polity fact." },
        clarity: { a: 9, b: 9, comparison: "Both are clear one-line answers." },
        format: { a: 10, b: 10, comparison: "Both packets satisfy the expected structure." },
      },
      summary: "Candidate A wins because it gives the correct constitutional provision; Candidate B states a different right.",
      confidence: "high",
      strengthsA: ["Correctly identifies the constitutional provision."],
      weaknessesA: [],
      strengthsB: ["Concise and readable."],
      weaknessesB: ["Attributes freedom of speech to the wrong article."],
      decisiveFactors: ["Factual accuracy is the highest-weight category and Candidate B confuses Articles 17 and 19."],
    };

    let judgeRequest: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return Response.json({ access_token: "arena-judge-access-token", expires_in: 3600 });
      }
      if (url.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: "claude-sonnet-5-5", type: "chat", capabilities: ["json_mode"] }],
        });
      }
      if (url.endsWith("/chat/completions")) {
        return Response.json({
          object: "chat.completion",
          model: "claude-sonnet-5-5",
          choices: [{ message: { role: "assistant", content: JSON.stringify(freeModelPacket) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 35, total_tokens: 135 },
        });
      }
      if (url.includes(":generateContent")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const instruction = String(((body.systemInstruction as { parts?: Array<{ text?: string }> }).parts ?? [])[0]?.text ?? "");
        if (instruction.includes("independent blind evaluator")) {
          judgeRequest = body;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Response.json({
            candidates: [{
              content: { parts: [{ text: JSON.stringify(judgeOutput) }] },
              finishReason: "STOP",
            }],
            usageMetadata: {
              promptTokenCount: 1_500,
              candidatesTokenCount: 350,
              thoughtsTokenCount: 200,
              totalTokenCount: 2_050,
            },
          });
        }
        return Response.json({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(vertexPacket) }] },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 1_200,
            candidatesTokenCount: 55,
            thoughtsTokenCount: 40,
            totalTokenCount: 1_295,
          },
        });
      }
      throw new Error("Unexpected request in blind judge test: " + url);
    }));

    const env = {
      ENVIRONMENT: "staging",
      ENABLE_GOOGLE_SEARCH_GROUNDING: "false",
      GCP_PROJECT_ID: "arena-test-project",
      GCP_CLIENT_EMAIL: "arena-test@example.iam.gserviceaccount.com",
      GCP_PRIVATE_KEY: privateKey,
      GEMINI_MODEL: "gemini-3.8-flash",
      GEMINI_LOCATION: "global",
      FREEMODEL_API_KEY: "test-key",
      FREEMODEL_BASE_URL: "https://freemodel.test/v1",
      FREEMODEL_PRIMARY_MODEL: "claude-sonnet-5-5",
    } as unknown as Env;

    try {
      const response = await handleArenaRun(
        env,
        new Request("https://arena-staging.example.workers.dev/admin/api/arena/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: "What does Article 17 of the Constitution abolish?",
            recentConversation: profileContext.recentConversation,
            targetModel: "claude-sonnet-5-5",
          }),
        }),
      );
      const body = await response.json() as {
        left: { ok: boolean; packet?: { answer?: string } };
        right: { ok: boolean; packet?: { answer?: string } };
        judge?: unknown;
      };

      expect(body.left.ok).toBe(true);
      expect(body.right.ok).toBe(true);
      expect(body).not.toHaveProperty("judge");
      expect(judgeRequest).toBeNull();

      // The generation call above warms the module token cache. Clear it to
      // exercise the judge's cold OAuth path and its separate timing budget.
      invalidateGoogleAccessToken("arena-judge-access-token");
      const judgeResponse = await handleArenaJudge(
        env,
        new Request("https://arena-staging.example.workers.dev/admin/api/arena/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: "What does Article 17 of the Constitution abolish?",
            recentConversation: profileContext.recentConversation,
            leftPacket: body.left.packet,
            rightPacket: body.right.packet,
          }),
        }),
      );
      const judged = await judgeResponse.json() as {
        ok: boolean;
        judge: {
          ok: boolean;
          mode: string;
          winner: string;
          model: string;
          overallScores: { left: number; right: number };
          summary: string;
          criteria: Array<{ key: string; leftScore: number; rightScore: number; comparison: string }>;
          tokens: { totalTokens: number };
          estimatedCostUsd: number;
          latencyMs: number;
          timings: { authenticationMs: number; inferenceMs: number; totalMs: number };
        };
        persistence: string;
      };
      expect(judgeResponse.status).toBe(200);
      expect(judged.persistence).toBe("stateless");
      expect(judgeRequest).not.toBeNull();
      const judge = judged.judge;
      const judgeBody = judgeRequest as unknown as Record<string, unknown>;
      const judgeText = String((((judgeBody.contents as Array<{ parts: Array<{ text: string }> }>)[0]).parts)[0].text);
      expect(judgeText).toContain("What does Article 17 of the Constitution abolish?");
      expect(judgeText).toContain("studentFacingSystemInstruction");
      expect(judgeText).toContain("BOT AND BRɅIN IDENTITY");
      expect(judgeText).toContain("sharedStudentPrompt");
      expect(judgeText).toContain("recentConversation");
      expect(judgeText).toContain("answerPacket");
      expect(judgeText).not.toContain("claude-sonnet-5-5");
      expect(judgeText).not.toContain("modelUsed");
      expect(judgeText).not.toContain("latencyMs");
      expect(judgeText).not.toContain("estimatedCostUsd");

      const inputJson = JSON.parse(judgeText.slice(judgeText.indexOf("{"))) as {
        candidateA: { answerPacket: Record<string, unknown> & { answer: string } };
        candidateB: { answerPacket: Record<string, unknown> & { answer: string } };
      };
      for (const candidate of [inputJson.candidateA, inputJson.candidateB]) {
        expect(candidate.answerPacket).not.toHaveProperty("thinkingLevelUsed");
        expect(candidate.answerPacket).not.toHaveProperty("grounded");
        expect(candidate.answerPacket).not.toHaveProperty("modelUsed");
        expect(candidate.answerPacket).not.toHaveProperty("provider");
      }
      const candidateAIsLeft = inputJson.candidateA.answerPacket.answer === body.left.packet?.answer;
      const candidateAIsRight = inputJson.candidateA.answerPacket.answer === body.right.packet?.answer;
      expect(candidateAIsLeft || candidateAIsRight).toBe(true);
      expect(candidateAIsLeft && candidateAIsRight).toBe(false);
      const expectedWinner = candidateAIsLeft ? "left" : "right";
      expect(judge.ok).toBe(true);
      expect(judge.mode).toBe("blind");
      expect(judge.model).toBe("gemini-3.8-flash");
      expect(judge.winner).toBe(expectedWinner);
      const expectedWinnerLabel = expectedWinner === "left" ? "Left" : "Right";
      const expectedLoserLabel = expectedWinner === "left" ? "Right" : "Left";
      expect(judge.summary).toContain(expectedWinnerLabel + " wins");
      expect(judge.summary).toContain(expectedLoserLabel);
      expect(judge.criteria[0].comparison).toContain(expectedWinnerLabel);
      expect(judge.criteria[0].comparison).toContain(expectedLoserLabel);
      expect(judge.overallScores[expectedWinner]).toBeGreaterThan(judge.overallScores[expectedWinner === "left" ? "right" : "left"]);
      expect(judge.criteria).toHaveLength(6);
      expect(judge.tokens.totalTokens).toBe(2_050);
      expect(judge.estimatedCostUsd).toBeCloseTo(0.0031875, 8);
      expect(judge.timings.authenticationMs).toBeGreaterThan(0);
      expect(judge.timings.inferenceMs).toBeGreaterThan(0);
      expect(judge.timings.totalMs).toBeGreaterThanOrEqual(judge.timings.authenticationMs);
      expect(judge.timings.totalMs).toBeGreaterThanOrEqual(judge.timings.inferenceMs);
      expect(judge.latencyMs).toBeCloseTo(judge.timings.totalMs, 0);
    } finally {
      invalidateGoogleAccessToken("arena-judge-access-token");
    }
  });
});
