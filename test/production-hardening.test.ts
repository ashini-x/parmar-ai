import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLikelyMcqTopicReply, isMcqRequest, parseRequestedMcqCount, requiresFreshData, requiresMcqTopicClarification } from "../src/ai/gemini";
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
  quizItems: [],
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
  it("accepts a valid native quiz packet", () => {
    const quizPacket = {
      ...validPacket,
      responseMode: "quiz",
      questionMode: "mcq",
      answer: "Correct answer: Lord Cornwallis",
      quizQuestion: "Who introduced the Permanent Settlement?",
      quizOptions: ["Lord Cornwallis", "Lord Wellesley", "Lord Dalhousie", "Warren Hastings"],
      quizCorrectOptionIds: [0],
      quizExplanation: "Permanent Settlement was introduced by Lord Cornwallis in 1793.",
      quizItems: [{
        question: "Who introduced the Permanent Settlement?",
        options: ["Lord Cornwallis", "Lord Wellesley", "Lord Dalhousie", "Warren Hastings"],
        correctOptionIds: [0],
        explanation: "Permanent Settlement was introduced by Lord Cornwallis in 1793.",
      }],
    } as const;
    expect(isValidAnswerPacket(quizPacket)).toBe(true);
    expect(isValidAnswerPacket({ ...quizPacket, quizCorrectOptionIds: [9] })).toBe(false);
    expect(isValidAnswerPacket({ ...quizPacket, quizExplanation: "x".repeat(201) })).toBe(false);
    expect(isValidAnswerPacket({
      ...quizPacket,
      quizItems: Array.from({ length: 11 }, () => quizPacket.quizItems[0]),
    })).toBe(false);
  });

  it("uses the current 2.8.0 release fallback", () => {
    expect(getConfig({} as any).version).toBe("2.8.0");
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

  it("supports bounded multi-MCQ requests and safe topic continuation", () => {
    expect(isMcqRequest("5 MCQs on Polity")).toBe(true);
    expect(parseRequestedMcqCount("5 MCQs on Polity")).toBe(5);
    expect(parseRequestedMcqCount("give me 10 quizzes on History")).toBe(10);
    expect(parseRequestedMcqCount("11 MCQs on Polity")).toBe(11);
    expect(isMcqRequest("What is an MCQ?")).toBe(false);
    expect(isLikelyMcqTopicReply("Fundamental Rights")).toBe(true);
    expect(isLikelyMcqTopicReply("why is Article 32 important?")).toBe(false);

    const emptyContext = {
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
    } as any;

    expect(requiresMcqTopicClarification("5 MCQs", emptyContext)).toBe(true);
    expect(requiresMcqTopicClarification("5 MCQs on Polity", emptyContext)).toBe(false);
  });

  it("does not send a second bot message after a native quiz vote", () => {
    const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    const start = source.indexOf("async function handleTelegramPollAnswer");
    const end = source.indexOf("function startTypingHeartbeat", start);
    const handler = source.slice(start, end);
    expect(handler).toContain("record_quiz_result");
    expect(handler).not.toContain("sendTelegramMessage(");
  });

  it("cleans up partial native quiz batches", () => {
    const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    expect(source).toContain("for (const delivered of deliveredQuizzes.reverse())");
    expect(source).toContain("await deleteQuizSession(env, delivered.pollId)");
    expect(source).toContain("buildQuizDeliveryFailureAnswer()");
  });

  it("protects the native quiz delivery path when D1 session persistence fails", () => {
    const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    expect(source).toContain("await stopTelegramPoll(");
    expect(source).toContain("await deleteTelegramMessage(");
    expect(source).toContain("buildQuizDeliveryFailureAnswer()");
  });

  it("does not invent an MCQ topic for a fresh generic quiz request", () => {
    const emptyContext = {
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
    } as any;

    const anchoredContext = {
      ...emptyContext,
      profile: {
        ...emptyContext.profile,
        recentTopics: ["Fundamental Rights"],
        questionCount: 1,
      },
    };

    expect(requiresMcqTopicClarification("mcq", emptyContext)).toBe(true);
    expect(requiresMcqTopicClarification("quiz", emptyContext)).toBe(true);
    expect(requiresMcqTopicClarification("give me an mcq", emptyContext)).toBe(true);
    expect(requiresMcqTopicClarification("mcq on Fundamental Rights", emptyContext)).toBe(false);
    expect(requiresMcqTopicClarification("mcq", anchoredContext)).toBe(false);
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
