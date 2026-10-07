import { describe, expect, it } from "vitest";
import { requiresFreshData } from "../src/ai/gemini";
import { getAnalyticsConfig } from "../src/analytics/db";
import { getConfig } from "../src/config/env";
import { isJobLeaseOwned, isValidAnswerPacket, type JobRecord } from "../src/core/job-store";
import { getTelegramEncryptionStatus } from "../src/telegram/bot-store";

const validPacket = {
  answer: "Permanent Settlement was introduced by Lord Cornwallis in 1793.",
  responseMode: "text",
  quizQuestion: "",
  quizOptions: [],
  quizCorrectOptionIds: [],
  quizExplanation: "",
  sscTakeaway: "Remember: Permanent Settlement — 1793 — Cornwallis.",
  answerScope: "ssc_ga_gs",
  subject: "history",
  topic: "Permanent Settlement",
  questionMode: "fact",
  examRelevance: "A",
  difficulty: "easy",
  profileSignal: "neutral",
  profileNote: "",
  nextRevisionTopic: "",
  detectedExam: null,
  timeSensitive: false,
} as const;

describe("production hardening", () => {
  it("uses the v2.6.0 release fallback", () => {
    expect(getConfig({} as any).version).toBe("2.6.1");
  });

  it("defaults raw analytics retention to 30 days", () => {
    expect(getAnalyticsConfig({} as any).retentionDays).toBe(30);
    expect(getAnalyticsConfig({ ANALYTICS_RAW_RETENTION_DAYS: "14" } as any).retentionDays).toBe(14);
  });

  it("requires the dedicated Telegram encryption key in production", async () => {
    const production = await getTelegramEncryptionStatus({
      ENVIRONMENT: "production",
      ADMIN_SESSION_SECRET: "legacy-session-secret",
    } as any);
    expect(production).toEqual({ configured: false, source: "missing" });

    const development = await getTelegramEncryptionStatus({
      ENVIRONMENT: "development",
      ADMIN_SESSION_SECRET: "dev-session-secret",
    } as any);
    expect(development).toEqual({ configured: true, source: "ADMIN_SESSION_SECRET" });
  });

  it("classifies mutable office-holder questions as fresh-data questions", () => {
    expect(requiresFreshData("Who is the RBI Governor?")).toBe(true);
    expect(requiresFreshData("RBI governor?")).toBe(true);
    expect(requiresFreshData("Who is the RBI Governor in 2018?")).toBe(false);
    expect(requiresFreshData("What is the Permanent Settlement?")).toBe(false);
  });

  it("rejects malformed answer packets at the Durable Object boundary", () => {
    expect(isValidAnswerPacket(validPacket)).toBe(true);
    expect(isValidAnswerPacket({ ...validPacket, detectedExam: 123 })).toBe(false);
    expect(isValidAnswerPacket({ ...validPacket, answer: 123 })).toBe(false);
  });

  it("rejects stale or mismatched lease ownership", () => {
    const record = {
      state: "processing",
      activeQueueMessageId: "queue-A",
      leaseVersion: 7,
    } as Pick<JobRecord, "state" | "activeQueueMessageId" | "leaseVersion">;

    expect(isJobLeaseOwned(record, { queueMessageId: "queue-A", leaseVersion: 7 })).toBe(true);
    expect(isJobLeaseOwned(record, { queueMessageId: "queue-B", leaseVersion: 7 })).toBe(false);
    expect(isJobLeaseOwned(record, { queueMessageId: "queue-A", leaseVersion: 6 })).toBe(false);
    expect(isJobLeaseOwned({ ...record, state: "done" }, { queueMessageId: "queue-A", leaseVersion: 7 })).toBe(false);
  });
});
