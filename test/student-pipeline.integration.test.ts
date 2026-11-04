import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import type { Env, QuestionJob } from "../src/config/env";
import { markTelegramBotDisconnected, saveTelegramBot } from "../src/telegram/bot-store";

const testEnv = env as unknown as Env;

function toPem(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

async function createTestPrivateKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  return toPem(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
}

async function callJobStore<T>(
  chatId: number,
  body: Record<string, unknown>,
): Promise<T> {
  const id = testEnv.JOB_DEDUPE.idFromName(String(chatId));
  const response = await testEnv.JOB_DEDUPE.get(id).fetch("https://job-store.test/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Job store returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

const answerPacket = {
  answer: "The Battle of Plassey was fought in 1757. The East India Company forces were led by Robert Clive. This victory marked a major turning point in Company power in Bengal.",
  responseMode: "text",
  quizQuestion: "",
  quizOptions: [],
  quizCorrectOptionIds: [],
  quizExplanation: "",
  quizItems: [],
  sscTakeaway: "Battle of Plassey: 1757. Robert Clive led the Company forces.",
  answerScope: "ssc_ga_gs",
  subject: "history",
  topic: "Battle of Plassey",
  questionMode: "concept",
  examRelevance: "A",
  profileSignal: "neutral",
  nextRevisionTopic: "",
  detectedExam: null,
  timeSensitive: false,
};

describe("Phase 3 synthetic student journey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes a Fatman Telegram doubt through retrieval, Gemini, delivery, D1 and student accounting", async () => {
    const chatId = 1_600_000_000_000 + Math.floor(Math.random() * 100_000_000);
    const updateId = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
    const connectionId = `phase-3-e2e-${chatId}`;
    const botToken = `123456:${connectionId}-token`;
    const webhookSecret = `phase-3-secret-${chatId}`;
    const encryptionKey = `phase-3-encryption-${chatId}`;
    const requestId = `phase-3-request-${chatId}`;
    const privateKey = await createTestPrivateKey();
    const queuedJobs: QuestionJob[] = [];
    const telegramCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    const retrievalCalls: Array<{ queries: string[]; pageNumbers?: number[] }> = [];
    let nextTelegramMessageId = 10_000;

    const vertexText = JSON.stringify(answerPacket);
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "phase-3-synthetic-access-token",
          expires_in: 3_600,
          token_type: "Bearer",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (url.includes("aiplatform.googleapis.com")) {
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
          systemInstruction?: { parts?: Array<{ text?: string }> };
          contents?: Array<{ parts?: Array<{ text?: string }> }>;
        };
        expect(requestBody.systemInstruction?.parts?.[0]?.text).toContain("FATMAN BOOK MODE");
        expect(requestBody.contents?.[0]?.parts?.[0]?.text).toContain("page 123");
        expect(requestBody.contents?.[0]?.parts?.[0]?.text).toContain("Battle of Plassey");
        const event = {
          candidates: [{
            content: { parts: [{ text: vertexText }] },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 620,
            candidatesTokenCount: 105,
            thoughtsTokenCount: 30,
            toolUsePromptTokenCount: 0,
            cachedContentTokenCount: 0,
            totalTokenCount: 755,
          },
        };
        return new Response(`data: ${JSON.stringify(event)}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }

      if (url.startsWith("https://api.telegram.org/")) {
        const method = url.split("/").at(-1)?.split("?")[0] ?? "unknown";
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        telegramCalls.push({ method, payload });
        const result = method === "sendMessage"
          ? { message_id: nextTelegramMessageId++ }
          : (method === "editMessageText" || method === "editMessageReplyMarkup")
            ? { message_id: Number(payload.message_id ?? 0) }
            : true;
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected outbound request in synthetic test: ${url}`);
    });
    vi.stubGlobal("fetch", fakeFetch);

    const brvinService = {
      getProjectStatus: async () => ({ ok: true as const, ready: true, authorizedSourceCount: 1 }),
      retrieveProjectContext: async (input: { queries: string[]; pageNumbers?: number[] }) => {
        retrievalCalls.push(input);
        return {
          ok: true as const,
          searchedSources: 1,
          searchCount: 1,
          passages: [{
            id: "phase-3-fatman-page-123",
            bookId: "fatman-legacy-538",
            bookTitle: "Fatman 2nd Edition",
            pdfPage: 123,
            printedPage: "45",
            section: "Battle of Plassey",
            text: "The Battle of Plassey was fought in 1757. Robert Clive led the East India Company forces.",
            score: 0.94,
          }],
          pageImages: [],
        };
      },
    };

    const testEnvWithServices = Object.assign(Object.create(testEnv), {
      ENVIRONMENT: "development",
      TELEGRAM_BOT_ENCRYPTION_KEY: encryptionKey,
      GCP_PROJECT_ID: "phase-3-synthetic-project",
      GCP_CLIENT_EMAIL: "phase-3-synthetic@invalid.example",
      GCP_PRIVATE_KEY: privateKey,
      GCP_PRIVATE_KEY_ID: "phase-3-synthetic-key",
      GEMINI_MODEL: "gemini-3.8-flash",
      GEMINI_LOCATION: "global",
      VERTEX_TIMEOUT_MS: "5000",
      DAILY_QUESTION_LIMIT: "20",
      BRVIN_SERVICE: brvinService,
      QUESTION_QUEUE: {
        send: async (job: QuestionJob) => { queuedJobs.push(job); },
      },
    }) as Env;

    let botSaved = false;
    try {
      await saveTelegramBot(testEnvWithServices, {
        connectionId,
        botId: 900_000_000 + Math.floor(Math.random() * 90_000_000),
        username: "phase3_synthetic_bot",
        firstName: "परमार्थAI Test",
        token: botToken,
        webhookSecret,
        status: "active",
      });
      botSaved = true;

      await callJobStore(chatId, {
        action: "set_fatman_mode",
        botConnectionId: connectionId,
        active: true,
      });

      const webhookContext = createExecutionContext();
      const webhookResponse = await worker.fetch(new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
        },
        body: JSON.stringify({
          update_id: updateId,
          message: {
            message_id: 321,
            chat: { id: chatId, type: "private" },
            from: { id: chatId, is_bot: false, first_name: "Synthetic Student" },
            text: "Explain the contents of page 123 in simple language",
          },
        }),
      }), testEnvWithServices, webhookContext);
      await waitOnExecutionContext(webhookContext);

      expect(webhookResponse.status).toBe(200);
      await expect(webhookResponse.json()).resolves.toMatchObject({ ok: true, queued: true });
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0]).toMatchObject({
        updateId,
        chatId,
        telegramUserId: chatId,
        fatmanModeSnapshot: true,
      });

      const queueMessage = {
        id: `phase-3-queue-${updateId}`,
        body: queuedJobs[0],
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
      };
      const queueContext = createExecutionContext();
      await worker.queue({ messages: [queueMessage] } as unknown as Parameters<typeof worker.queue>[0], testEnvWithServices, queueContext);
      await waitOnExecutionContext(queueContext);

      expect(queueMessage.ack).toHaveBeenCalledTimes(1);
      expect(queueMessage.retry).not.toHaveBeenCalled();
      expect(retrievalCalls).toHaveLength(1);
      expect(retrievalCalls[0].pageNumbers).toEqual([123]);
      expect(retrievalCalls[0].queries.length).toBeGreaterThan(0);

      const deliveredTexts = telegramCalls
        .filter((call) => call.method === "editMessageText" || call.method === "sendMessage")
        .map((call) => String(call.payload.text ?? ""));
      const finalAnswer = deliveredTexts.find((value) => value.includes("Source: Fatman 2nd Edition, PDF p. 123"));
      expect(finalAnswer).toBeTruthy();
      expect(finalAnswer).toContain("Battle of Plassey");
      expect(finalAnswer).toContain("SSC Focus");

      const profile = await callJobStore<{
        profile: { questionCount: number; recentTopics: string[]; recentSubjects: string[] };
      }>(chatId, { action: "get_profile" });
      expect(profile.profile.questionCount).toBe(1);
      expect(profile.profile.recentTopics).toContain("Battle of Plassey");
      expect(profile.profile.recentSubjects).toContain("history");

      const usage = await callJobStore<{
        usage: { dayCount: number; dailyLimit: number };
      }>(chatId, { action: "get_usage", telegramUserId: chatId });
      expect(usage.usage).toMatchObject({ dayCount: 1, dailyLimit: 20 });

      const question = await testEnvWithServices.DB!.prepare(
        "SELECT status, topic, subject, answer_text FROM questions WHERE telegram_user_id=? ORDER BY received_at DESC LIMIT 1",
      ).bind(chatId).first<{
        status: string;
        topic: string | null;
        subject: string | null;
        answer_text: string | null;
      }>();
      expect(question).toMatchObject({
        status: "completed",
        topic: "Battle of Plassey",
        subject: "history",
      });
      expect(question?.answer_text).toContain("Battle of Plassey");
      expect(fakeFetch).toHaveBeenCalled();
    } finally {
      if (botSaved) {
        await markTelegramBotDisconnected(testEnvWithServices, connectionId, "phase-3 synthetic test cleanup").catch(() => undefined);
      }
      vi.unstubAllGlobals();
    }
  });
});
