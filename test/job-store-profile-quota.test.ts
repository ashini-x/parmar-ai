import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";

const testEnv = env as unknown as Env;

function createStudentStore() {
  const chatId = 1_500_000_000_000 + Math.floor(Math.random() * 500_000_000);
  const botConnectionId = `quota-test-${chatId}`;
  const stub = testEnv.JOB_DEDUPE.get(testEnv.JOB_DEDUPE.idFromName(String(chatId)));

  async function call<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const response = await stub.fetch("https://job-store.test/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Job store returned HTTP ${response.status}: ${await response.text()}`);
    }
    return await response.json() as T;
  }

  return { chatId, botConnectionId, call };
}

describe("shared per-student question tracking", () => {
  it("preserves the daily question limit after /delete_data clears all study state", async () => {
    const { chatId, botConnectionId, call } = createStudentStore();

    for (let index = 1; index <= 20; index += 1) {
      const result = await call<{ action: string }>({
        action: "begin",
        botConnectionId,
        updateId: index,
        chatId,
        telegramUserId: chatId,
        question: `Question before data deletion ${index}`,
        messageId: index,
        requestId: `delete-data-quota-${chatId}-${index}`,
        createdAt: Date.now(),
        requestedQuizCount: 1,
        fatmanModeSnapshot: index % 2 === 0,
      });
      expect(result.action).toBe("new");
    }

    await call({ action: "set_exam", exam: "SSC CGL" });
    await call({ action: "set_fatman_mode", botConnectionId, active: true });

    const beforeDeletion = await call<{
      usage: { dayCount: number; dailyLimit: number; unlimited: boolean };
    }>({ action: "get_usage", telegramUserId: chatId });
    expect(beforeDeletion.usage.dayCount).toBe(20);

    await call({ action: "delete_data" });

    const clearedProfile = await call<{ profile: {
      questionCount: number;
      targetExam: string;
      recentTopics: string[];
    } }>({ action: "get_profile" });
    expect(clearedProfile.profile.questionCount).toBe(0);
    expect(clearedProfile.profile.targetExam).toBe("SSC (not specified)");
    expect(clearedProfile.profile.recentTopics).toEqual([]);

    const clearedMode = await call<{ active: boolean }>({
      action: "get_fatman_mode",
      botConnectionId,
    });
    expect(clearedMode.active).toBe(false);

    const afterDeletion = await call<{
      usage: { dayCount: number; dailyLimit: number; unlimited: boolean };
    }>({ action: "get_usage", telegramUserId: chatId });
    expect(afterDeletion.usage).toEqual({
      dayCount: 20,
      dailyLimit: 20,
      unlimited: false,
    });

    const twentyFirst = await call<{
      action: string;
      rateLimitReason?: string;
    }>({
      action: "begin",
      botConnectionId,
      updateId: 21,
      chatId,
      telegramUserId: chatId,
      question: "Question after deleting stored data",
      messageId: 21,
      requestId: `delete-data-quota-${chatId}-21`,
      createdAt: Date.now(),
      requestedQuizCount: 1,
      fatmanModeSnapshot: false,
    });
    expect(twentyFirst).toMatchObject({
      action: "rate_limited",
      rateLimitReason: "daily",
    });
  });

  it("uses one 20-question daily allowance across Fatman and normal mode", async () => {
    const { chatId, botConnectionId, call } = createStudentStore();

    for (let index = 1; index <= 20; index += 1) {
      const result = await call<{ action: string }>({
        action: "begin",
        botConnectionId,
        updateId: index,
        chatId,
        telegramUserId: chatId,
        question: `Student question ${index}`,
        messageId: index,
        requestId: `daily-quota-${chatId}-${index}`,
        createdAt: Date.now(),
        requestedQuizCount: 1,
        fatmanModeSnapshot: index % 2 === 0,
      });

      expect(result.action).toBe("new");
    }

    const usage = await call<{
      usage: { dayCount: number; dailyLimit: number; unlimited: boolean };
    }>({ action: "get_usage", telegramUserId: chatId });

    expect(usage.usage).toEqual({
      dayCount: 20,
      dailyLimit: 20,
      unlimited: false,
    });

    const twentyFirst = await call<{
      action: string;
      rateLimitReason?: string;
    }>({
      action: "begin",
      botConnectionId,
      updateId: 21,
      chatId,
      telegramUserId: chatId,
      question: "Question number twenty-one",
      messageId: 21,
      requestId: `daily-quota-${chatId}-21`,
      createdAt: Date.now(),
      requestedQuizCount: 1,
      fatmanModeSnapshot: true,
    });

    expect(twentyFirst).toMatchObject({
      action: "rate_limited",
      rateLimitReason: "daily",
    });
  });

  it("updates one student profile from a Fatman-mode question exactly once", async () => {
    const { chatId, botConnectionId, call } = createStudentStore();
    const updateId = 101;
    const queueMessageId = `fatman-queue-${chatId}`;

    const begun = await call<{ action: string }>({
      action: "begin",
      botConnectionId,
      updateId,
      chatId,
      telegramUserId: chatId,
      question: "Please explain what is on page 310 in simple language.",
      messageId: 1,
      requestId: `fatman-profile-${chatId}`,
      createdAt: Date.now(),
      requestedQuizCount: 1,
      fatmanModeSnapshot: true,
    });
    expect(begun.action).toBe("new");

    const claim = await call<{
      claimed: boolean;
      leaseVersion?: number;
    }>({
      action: "claim",
      botConnectionId,
      updateId,
      queueMessageId,
    });
    expect(claim.claimed).toBe(true);
    expect(claim.leaseVersion).toBeDefined();

    const profileUpdate = {
      action: "update_profile",
      botConnectionId,
      updateId,
      queueMessageId,
      leaseVersion: claim.leaseVersion,
      question: "Please explain what is on page 310 in simple language.",
      topic: "Important Reports",
      subject: "economy",
      profileSignal: "neutral",
      nextRevisionTopic: "",
      detectedExam: "SSC CGL",
      answerScope: "ssc_ga_gs",
      questionMode: "concept",
    };

    await call(profileUpdate);
    await call(profileUpdate);
    await call({
      action: "complete",
      botConnectionId,
      updateId,
      queueMessageId,
      leaseVersion: claim.leaseVersion,
    });

    const result = await call<{ profile: {
      questionCount: number;
      targetExam: string;
      recentTopics: string[];
      recentSubjects: string[];
    } }>({ action: "get_profile" });

    expect(result.profile.questionCount).toBe(1);
    expect(result.profile.targetExam).toBe("SSC CGL");
    expect(result.profile.recentTopics).toContain("Important Reports");
    expect(result.profile.recentSubjects).toContain("economy");

    // A second successfully answered Fatman question is still tracked even
    // when it is outside the SSC topic profile. It must not pollute study topics.
    const secondUpdateId = updateId + 1;
    const secondQueueId = `fatman-out-of-scope-${chatId}`;
    await call({
      action: "begin",
      botConnectionId,
      updateId: secondUpdateId,
      chatId,
      telegramUserId: chatId,
      question: "Explain this unrelated page section.",
      messageId: 2,
      requestId: `fatman-profile-out-of-scope-${chatId}`,
      createdAt: Date.now(),
      requestedQuizCount: 1,
      fatmanModeSnapshot: true,
    });
    const secondClaim = await call<{ claimed: boolean; leaseVersion?: number }>({
      action: "claim",
      botConnectionId,
      updateId: secondUpdateId,
      queueMessageId: secondQueueId,
    });
    expect(secondClaim.claimed).toBe(true);
    const outOfScopeUpdate = {
      action: "update_profile",
      botConnectionId,
      updateId: secondUpdateId,
      queueMessageId: secondQueueId,
      leaseVersion: secondClaim.leaseVersion,
      question: "Explain this unrelated page section.",
      topic: "Unrelated",
      subject: "other",
      profileSignal: "neutral",
      nextRevisionTopic: "",
      detectedExam: "",
      answerScope: "out_of_scope",
      questionMode: "concept",
    };
    await call(outOfScopeUpdate);
    await call(outOfScopeUpdate);

    const afterSecond = await call<{ profile: {
      questionCount: number;
      recentTopics: string[];
      recentSubjects: string[];
    } }>({ action: "get_profile" });
    expect(afterSecond.profile.questionCount).toBe(2);
    expect(afterSecond.profile.recentTopics).toEqual(["Important Reports"]);
    expect(afterSecond.profile.recentSubjects).toEqual(["economy"]);
  });
});
