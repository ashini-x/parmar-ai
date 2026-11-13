import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";

const testEnv = env as unknown as Env;

async function jobStoreRequest<T>(chatId: number, body: Record<string, unknown>): Promise<T> {
  const id = testEnv.JOB_DEDUPE.idFromName(String(chatId));
  const stub = testEnv.JOB_DEDUPE.get(id);
  const response = await stub.fetch("https://job-store/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Job store returned HTTP ${response.status}.`);
  return (await response.json()) as T;
}

function uniqueId(): number {
  return Date.now() * 10 + Math.floor(Math.random() * 10);
}

describe("Phase 2 student accounting", () => {
  it("serializes concurrent admissions at 10 questions and preserves the count after data deletion", async () => {
    const chatId = uniqueId();
    const baseUpdateId = uniqueId();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        jobStoreRequest<{ action: string }>(chatId, {
          action: "begin",
          botConnectionId: "phase-2-quota-test",
          telegramUserId: chatId,
          updateId: baseUpdateId + index,
          chatId,
          question: `Fatman page explanation ${index + 1}`,
          messageId: index + 1,
          requestId: `phase-2-quota-${chatId}-${index}`,
          createdAt: Date.now() + index,
          requestedQuizCount: 1,
          fatmanModeSnapshot: true,
        }),
      ),
    );

    expect(results.filter((result) => result.action === "new")).toHaveLength(10);
    expect(results.filter((result) => result.action === "rate_limited")).toHaveLength(15);

    await jobStoreRequest(chatId, { action: "delete_data" });
    const usage = await jobStoreRequest<{ usage: { dayCount: number; dailyLimit: number } }>(chatId, {
      action: "get_usage",
      telegramUserId: chatId,
    });
    expect(usage.usage.dayCount).toBe(10);
    expect(usage.usage.dailyLimit).toBe(10);

    const afterDeletion = await jobStoreRequest<{ action: string }>(chatId, {
      action: "begin",
      botConnectionId: "phase-2-quota-test",
      telegramUserId: chatId,
      updateId: baseUpdateId + 100,
      chatId,
      question: "One more Fatman question",
      messageId: 100,
      requestId: `phase-2-after-delete-${chatId}`,
      createdAt: Date.now(),
      requestedQuizCount: 1,
      fatmanModeSnapshot: true,
    });
    expect(afterDeletion.action).toBe("rate_limited");
  });

  it("counts Fatman answers once and isolates profile idempotency by bot connection", async () => {
    const chatId = uniqueId();
    const updateId = uniqueId();

    async function answerForBot(botConnectionId: string, queueMessageId: string, answerScope: string) {
      const begin = await jobStoreRequest<{ action: string }>(chatId, {
        action: "begin",
        botConnectionId,
        telegramUserId: chatId,
        updateId,
        chatId,
        question: "Explain what is on this Fatman page in simple language",
        messageId: 1,
        requestId: `phase-2-profile-${botConnectionId}-${chatId}`,
        createdAt: Date.now(),
        requestedQuizCount: 1,
        fatmanModeSnapshot: true,
      });
      expect(begin.action).toBe("new");

      const claim = await jobStoreRequest<{ claimed: boolean; leaseVersion: number }>(chatId, {
        action: "claim",
        botConnectionId,
        updateId,
        queueMessageId,
      });
      expect(claim.claimed).toBe(true);

      const profileUpdate = {
        action: "update_profile",
        botConnectionId,
        updateId,
        queueMessageId,
        leaseVersion: claim.leaseVersion,
        question: "Explain what is on this Fatman page in simple language",
        topic: answerScope === "out_of_scope" ? "" : "Fundamental Rights",
        subject: answerScope === "out_of_scope" ? "other" : "polity",
        profileSignal: "neutral",
        nextRevisionTopic: "",
        detectedExam: "",
        answerScope,
        questionMode: "concept",
      };

      await jobStoreRequest(chatId, profileUpdate);
      // A queue retry or duplicate profile action must not increment twice.
      await jobStoreRequest(chatId, profileUpdate);

      await jobStoreRequest(chatId, {
        action: "complete",
        botConnectionId,
        updateId,
        queueMessageId,
        leaseVersion: claim.leaseVersion,
      });
    }

    await answerForBot("phase-2-bot-a", "phase-2-queue-a", "out_of_scope");
    // Telegram update IDs are scoped to the bot. The replacement bot may
    // legitimately reuse the same update ID without losing a student's count.
    await answerForBot("phase-2-bot-b", "phase-2-queue-b", "ssc_ga_gs");

    const result = await jobStoreRequest<{ profile: { questionCount: number; recentTopics: string[] } }>(chatId, {
      action: "get_profile",
    });
    expect(result.profile.questionCount).toBe(2);
    expect(result.profile.recentTopics).toContain("Fundamental Rights");
  });
});
