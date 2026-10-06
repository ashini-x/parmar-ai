import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { AnswerPacket, ConversationTurn, Env, LearningSignal, ProfileContext, QuestionJob, StudentProfile } from "../config/env";
import { sendTelegramChatAction } from "../telegram/api";

const TYPING_HEARTBEAT_MS = 4_000;
const TYPING_MAX_AGE_MS = 30 * 60 * 1_000;
const JOB_RETENTION_MS = 48 * 60 * 60 * 1_000;
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const RATE_LIMIT_META_KEY = "meta:rate:v2";
const PROFILE_KEY = "profile:v1";
const CONVERSATION_RESET_KEY = "conversation:resetAt";

interface RateMeta {
  burstWindowStart: number;
  burstCount: number;
  dayKey: string;
  dayCount: number;
  lastRateNoticeAt: number;
}

type JobState = "pending" | "queued" | "processing" | "done";

export interface JobRecord {
  version: 2;
  updateId: number;
  chatId: number;
  question: string;
  messageId: number;
  requestId: string;
  createdAt: number;
  state: JobState;
  statusMessageId?: number;
  activeQueueMessageId?: string;
  processingAt?: number;
  answer?: string;
  answerPacket?: AnswerPacket;
  profileUpdated?: boolean;
}

interface BeginResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  statusMessageId?: number;
  notify?: boolean;
  rateLimitReason?: "daily" | "burst";
}

interface GenericResponse { ok: true; }

export interface ClaimResponse {
  claimed: boolean;
  wait?: boolean;
  retryAfterSeconds?: number;
  record?: JobRecord;
}

const DEFAULT_PROFILE: StudentProfile = {
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

export class JobDedupe extends DurableObject {
  private readonly runtimeEnv: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.runtimeEnv = env;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");

    switch (action) {
      case "begin": return this.json(await this.beginJob(body));
      case "save_ack": return this.json(await this.saveAck(body));
      case "mark_queued": return this.json(await this.markQueued(body));
      case "claim": return this.json(await this.claim(body));
      case "set_answer_packet": return this.json(await this.setAnswerPacket(body));
      case "mark_profile_updated": return this.json(await this.markProfileUpdated(body));
      case "complete": return this.json(await this.complete(body));
      case "get_profile": return this.json({ ok: true, profile: await this.getProfile() });
      case "get_usage": return this.json({ ok: true, usage: await this.getUsage() });
      case "get_conversation": return this.json({ ok: true, recentConversation: await this.getConversation(positiveNumber(body.updateId)) });
      case "update_profile": return this.json(await this.updateProfile(body));
      case "set_exam": return this.json(await this.setExam(body));
      case "reset_profile": return this.json(await this.resetProfile());
      default: return this.json({ ok: false, error: "unknown_action" }, 400);
    }
  }

  async alarm(): Promise<void> {
    await this.reconcileAlarm();
  }

  private async ensureTypingAlarm(now = Date.now()): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > now + TYPING_HEARTBEAT_MS) {
      await this.ctx.storage.setAlarm(now + TYPING_HEARTBEAT_MS);
    }
  }

  private async reconcileAlarm(now = Date.now()): Promise<void> {
    const retentionCutoff = now - JOB_RETENTION_MS;
    const typingCutoff = now - TYPING_MAX_AGE_MS;
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });

    let hasActiveRecentJob = false;
    let nextCleanupAt: number | null = null;
    let chatId: number | undefined;

    for (const [key, record] of jobs) {
      if (record.createdAt < retentionCutoff) {
        await this.ctx.storage.delete(key);
        continue;
      }

      const cleanupAt = record.createdAt + JOB_RETENTION_MS;
      nextCleanupAt = nextCleanupAt === null ? cleanupAt : Math.min(nextCleanupAt, cleanupAt);

      if (record.state !== "done" && record.createdAt >= typingCutoff) {
        hasActiveRecentJob = true;
        chatId = record.chatId;
      }
    }

    // Recover accepted jobs that never made it from the webhook into the Queue.
    // Queue delivery is durable; this alarm closes the small gap between accepting
    // the Telegram update and persisting the queued state. Duplicate Queue messages
    // are safe because claim() is idempotent per Telegram update ID.
    for (const record of jobs.values()) {
      if (record.state !== "pending" || record.createdAt < typingCutoff) continue;
      try {
        await this.runtimeEnv.QUESTION_QUEUE.send({
          version: 2,
          updateId: record.updateId,
          chatId: record.chatId,
          question: record.question,
          messageId: record.messageId,
          requestId: record.requestId,
          createdAt: record.createdAt,
          ...(record.statusMessageId !== undefined ? { statusMessageId: record.statusMessageId } : {}),
        }, { contentType: "json" });
        record.state = "queued";
        await this.ctx.storage.put(jobKey(record.updateId), record);
      } catch {
        // Retry on the next alarm/webhook delivery.
      }
    }

    if (hasActiveRecentJob && chatId !== undefined) {
      try {
        await sendTelegramChatAction(this.runtimeEnv, chatId, "typing");
      } catch {
        // Best effort: Telegram may rate-limit chat actions during spikes.
      }
      await this.ctx.storage.setAlarm(now + TYPING_HEARTBEAT_MS);
      return;
    }

    if (nextCleanupAt !== null) {
      await this.ctx.storage.setAlarm(Math.max(now + 1_000, nextCleanupAt));
      return;
    }

    await this.ctx.storage.deleteAlarm();
  }

  private async beginJob(body: Record<string, unknown>): Promise<BeginResponse> {
    const job = parseJob(body);
    const key = jobKey(job.updateId);
    const existing = await this.ctx.storage.get<JobRecord>(key);

    if (existing) {
      if (existing.state === "done" || existing.state === "queued" || existing.state === "processing") {
        return { action: "duplicate", statusMessageId: existing.statusMessageId };
      }
      return { action: "retry_ack", statusMessageId: existing.statusMessageId };
    }

    const now = Date.now();
    const rate = await this.getRateMeta(now);
    const dailyLimit = positiveEnv(this.runtimeEnv.DAILY_QUESTION_LIMIT, 20);
    const burstLimit = positiveEnv(this.runtimeEnv.BURST_QUESTION_LIMIT, 5);
    const burstWindowMs = positiveEnv(this.runtimeEnv.BURST_WINDOW_SECONDS, 10) * 1_000;

    let burstWindowStart = rate.burstWindowStart;
    let burstCount = rate.burstCount;
    if (now - burstWindowStart >= burstWindowMs) {
      burstWindowStart = now;
      burstCount = 0;
    }

    const dayKey = indiaDayKey(now);
    const dayCount = rate.dayKey === dayKey ? rate.dayCount : 0;

    if (dayCount >= dailyLimit || burstCount >= burstLimit) {
      const shouldNotify = now - rate.lastRateNoticeAt >= burstWindowMs;
      await this.ctx.storage.put<RateMeta>(RATE_LIMIT_META_KEY, {
        burstWindowStart,
        burstCount,
        dayKey,
        dayCount,
        lastRateNoticeAt: shouldNotify ? now : rate.lastRateNoticeAt,
      });
      return {
        action: "rate_limited",
        notify: shouldNotify,
        rateLimitReason: dayCount >= dailyLimit ? "daily" : "burst",
      };
    }

    await this.ctx.storage.put<RateMeta>(RATE_LIMIT_META_KEY, {
      burstWindowStart,
      burstCount: burstCount + 1,
      dayKey,
      dayCount: dayCount + 1,
      lastRateNoticeAt: rate.lastRateNoticeAt,
    });

    const record: JobRecord = {
      version: 2,
      updateId: job.updateId,
      chatId: job.chatId,
      question: job.question,
      messageId: job.messageId,
      requestId: job.requestId,
      createdAt: job.createdAt,
      state: "pending",
    };

    await this.ctx.storage.put(key, record);
    await this.ensureTypingAlarm(now);
    return { action: "new" };
  }

  private async saveAck(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const statusMessageId = positiveNumber(body.statusMessageId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };

    record.statusMessageId = statusMessageId;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async markQueued(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record || record.state === "done") return { ok: true };
    if (record.state === "pending") record.state = "queued";
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async claim(body: Record<string, unknown>): Promise<ClaimResponse> {
    const updateId = positiveNumber(body.updateId);
    const queueMessageId = String(body.queueMessageId ?? "");
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { claimed: false };
    if (record.state === "done") return { claimed: false };

    const now = Date.now();
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });

    // Serialize AI processing per chat. This keeps answers in the same order
    // for a student even though the Queue may process multiple chats in parallel.
    const olderActiveJob = [...jobs.values()].some((candidate) =>
      candidate.updateId !== record.updateId &&
      candidate.state !== "done" &&
      candidate.createdAt <= record.createdAt,
    );

    if (olderActiveJob) {
      return { claimed: false, wait: true, retryAfterSeconds: 30 };
    }

    if (
      record.state === "processing" &&
      record.activeQueueMessageId !== queueMessageId &&
      record.processingAt &&
      now - record.processingAt < PROCESSING_LEASE_MS
    ) {
      return { claimed: false, wait: true, retryAfterSeconds: 30 };
    }

    record.state = "processing";
    record.activeQueueMessageId = queueMessageId;
    record.processingAt = now;
    await this.ctx.storage.put(key, record);
    return { claimed: true, record };
  }

  private async setAnswerPacket(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };

    const packet = body.packet as AnswerPacket | undefined;
    if (!packet || typeof packet.answer !== "string") {
      throw new Error("Invalid answer packet.");
    }

    record.answerPacket = packet;
    record.answer = packet.answer;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async markProfileUpdated(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };
    record.profileUpdated = true;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async complete(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };

    record.state = "done";
    record.processingAt = undefined;
    record.activeQueueMessageId = undefined;
    await this.ctx.storage.put(key, record);
    await this.reconcileAlarm();
    return { ok: true };
  }

  private async getConversation(currentUpdateId: number): Promise<ConversationTurn[]> {
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });
    const resetAt = (await this.ctx.storage.get<number>(CONVERSATION_RESET_KEY)) ?? 0;
    const completed = [...jobs.values()]
      .filter((record) =>
        record.updateId !== currentUpdateId &&
        record.state === "done" &&
        record.answerPacket &&
        record.answerPacket.answerScope !== "out_of_scope" &&
        record.createdAt > resetAt &&
        typeof record.question === "string" &&
        record.question.trim().length > 0,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .reverse();

    return completed.map((record) => ({
      question: clampConversationText(record.question, 650),
      answer: clampConversationText(buildStoredAnswer(record.answerPacket), 1_200),
    }));
  }

  private async getProfile(): Promise<StudentProfile> {
    const stored = await this.ctx.storage.get<unknown>(PROFILE_KEY);
    if (!stored) return { ...DEFAULT_PROFILE, recentTopics: [], recentSubjects: [], attentionTopics: [], revisionQueue: [], learningSignals: [] };

    const normalized = normalizeProfile(stored);
    if (profileNeedsMigration(stored, normalized)) {
      await this.ctx.storage.put(PROFILE_KEY, normalized);
    }
    return normalized;
  }

  private async updateProfile(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const appliedKey = `profile:applied:${updateId}`;
    if (await this.ctx.storage.get<boolean>(appliedKey)) return { ok: true };

    const profile = await this.getProfile();
    const topic = cleanText(String(body.topic ?? ""), 100);
    const subject = cleanText(String(body.subject ?? ""), 40);
    const signal = normalizeProfileSignal(body.profileSignal);
    const nextRevisionTopic = cleanText(String(body.nextRevisionTopic ?? ""), 100);
    const question = cleanText(String(body.question ?? ""), 500);
    const questionMode = cleanText(String(body.questionMode ?? "fact"), 20);
    const detectedExam = cleanExam(String(body.detectedExam ?? ""));
    const answerScope = cleanText(String(body.answerScope ?? "ssc_ga_gs"), 20);

    if (answerScope === "out_of_scope") return { ok: true };

    profile.questionCount += 1;
    profile.lastUpdatedAt = Date.now();

    if (detectedExam) profile.targetExam = detectedExam;

    const validTopic = Boolean(topic && topic !== "General SSC doubt");
    if (validTopic) {
      profile.recentTopics = [topic, ...profile.recentTopics.filter((item) => item.toLowerCase() !== topic.toLowerCase())].slice(0, 10);
    }
    if (subject) {
      profile.recentSubjects = [subject, ...profile.recentSubjects.filter((item) => item.toLowerCase() !== subject.toLowerCase())].slice(0, 6);
    }

    const confusionEvidence = signal === "confusion" && isExplicitConfusionQuestion(question);
    const weaknessEvidence = signal === "weak" && isExplicitWeaknessQuestion(question);
    const evidenceBackedSignal = (confusionEvidence || weaknessEvidence) ? signal : "neutral";

    if (validTopic && (evidenceBackedSignal === "confusion" || evidenceBackedSignal === "weak")) {
      const normalized = topic.toLowerCase();
      const existingSignal = profile.learningSignals.find((item) => item.topic.toLowerCase() === normalized);
      const nextSignal: LearningSignal = existingSignal
        ? {
            ...existingSignal,
            topic,
            confusionCount: existingSignal.confusionCount + (evidenceBackedSignal === "confusion" ? 1 : 0),
            weakCount: existingSignal.weakCount + (evidenceBackedSignal === "weak" ? 1 : 0),
            lastSeenAt: Date.now(),
          }
        : {
            topic,
            confusionCount: evidenceBackedSignal === "confusion" ? 1 : 0,
            weakCount: evidenceBackedSignal === "weak" ? 1 : 0,
            lastSeenAt: Date.now(),
          };

      profile.learningSignals = [
        nextSignal,
        ...profile.learningSignals.filter((item) => item.topic.toLowerCase() !== normalized),
      ].slice(0, 12);

      const totalEvidence = nextSignal.confusionCount + nextSignal.weakCount;
      if (totalEvidence >= 2) {
        profile.attentionTopics = [topic, ...profile.attentionTopics.filter((item) => item.toLowerCase() !== normalized)].slice(0, 6);
      }
    }

    const revisionTopic = validTopic && (evidenceBackedSignal === "confusion" || evidenceBackedSignal === "weak" || questionMode === "revision")
      ? topic
      : questionMode === "revision" && nextRevisionTopic
        ? nextRevisionTopic
        : "";

    if (revisionTopic) {
      profile.revisionQueue = [revisionTopic, ...profile.revisionQueue.filter((item) => item.toLowerCase() !== revisionTopic.toLowerCase())].slice(0, 6);
    }

    await this.ctx.storage.put(PROFILE_KEY, profile);
    await this.ctx.storage.put(appliedKey, true);
    return { ok: true };
  }

  private async setExam(body: Record<string, unknown>): Promise<GenericResponse> {
    const exam = cleanExam(String(body.exam ?? ""));
    if (!exam) throw new Error("Exam is empty.");
    const profile = await this.getProfile();
    profile.targetExam = exam;
    profile.lastUpdatedAt = Date.now();
    await this.ctx.storage.put(PROFILE_KEY, profile);
    return { ok: true };
  }

  private async resetProfile(): Promise<GenericResponse> {
    const now = Date.now();
    await this.ctx.storage.put(PROFILE_KEY, { ...DEFAULT_PROFILE, lastUpdatedAt: now });
    await this.ctx.storage.put(CONVERSATION_RESET_KEY, now);
    return { ok: true };
  }

  private async getRateMeta(now: number): Promise<RateMeta> {
    const existing = await this.ctx.storage.get<RateMeta>(RATE_LIMIT_META_KEY);
    if (existing && typeof existing.dayKey === "string") return existing;
    return {
      burstWindowStart: now,
      burstCount: 0,
      dayKey: indiaDayKey(now),
      dayCount: 0,
      lastRateNoticeAt: 0,
    };
  }

  private async getUsage(): Promise<{ dayCount: number; dailyLimit: number }> {
    const now = Date.now();
    const rate = await this.getRateMeta(now);
    const currentDay = indiaDayKey(now);
    return {
      dayCount: rate.dayKey === currentDay ? rate.dayCount : 0,
      dailyLimit: positiveEnv(this.runtimeEnv.DAILY_QUESTION_LIMIT, 20),
    };
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

export function buildProfileContext(profile: StudentProfile, recentConversation: ConversationTurn[] = []): ProfileContext {
  return {
    profile,
    recentTopicHint: profile.recentTopics.slice(0, 6).join(", "),
    attentionTopicHint: profile.attentionTopics.slice(0, 5).join(", "),
    revisionHint: profile.revisionQueue.slice(0, 5).join(", "),
    recentConversation: recentConversation.slice(-6),
  };
}

function buildStoredAnswer(packet?: AnswerPacket): string {
  if (!packet) return "";
  const takeaway = packet.sscTakeaway?.trim();
  return takeaway ? `${packet.answer.trim()}
SSC Focus: ${takeaway}` : packet.answer.trim();
}

function clampConversationText(value: string, maxLength: number): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, "\t").trim();
  if (normalized.length <= maxLength) return normalized;
  const cut = normalized.lastIndexOf(" ", maxLength);
  return normalized.slice(0, cut > maxLength * 0.7 ? cut : maxLength).trim() + "…";
}

function parseJob(body: Record<string, unknown>): QuestionJob {
  const job: QuestionJob = {
    version: 2,
    updateId: positiveNumber(body.updateId),
    chatId: positiveOrNegativeNumber(body.chatId),
    question: String(body.question ?? "").trim(),
    messageId: positiveNumber(body.messageId),
    requestId: String(body.requestId ?? ""),
    createdAt: positiveNumber(body.createdAt),
    ...(body.statusMessageId !== undefined ? { statusMessageId: positiveNumber(body.statusMessageId) } : {}),
  };
  if (!job.question || !job.requestId) throw new Error("Invalid job payload.");
  return job;
}

function normalizeProfileSignal(value: unknown): "neutral" | "weak" | "confusion" | "strength" {
  const normalized = cleanText(String(value ?? "neutral"), 20).toLowerCase();
  if (normalized === "weak" || normalized === "confusion" || normalized === "strength") return normalized;
  return "neutral";
}

function isExplicitConfusionQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const markers = [
    "confused", "confuse", "confusing", "confusion", "dono same", "difference samajh",
    "samajh nahi aa", "samajh nahi aata", "samajh nahi", "clear nahi", "mix ho raha",
    "mix up", "ulta ho raha", "dono mein", "dono me", "कन्फ्यूज", "समझ नहीं", "दोनों में",
  ];
  return markers.some((marker) => q.includes(marker));
}

function isExplicitWeaknessQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const markers = [
    "mujhe nahi aata", "mujhe ye nahi aata", "weak hoon", "weak hu", "bar bar galat",
    "baar baar galat", "mistake hoti", "galti hoti", "bhool jata", "bhool jaata",
    "yaad nahi rehta", "yaad nahi rahta", "struggle hota", "struggle ho raha",
    "problem hoti", "dikkat hoti", "कमजोर",
  ];
  return markers.some((marker) => q.includes(marker));
}


export function normalizeProfile(profile: unknown): StudentProfile {
  const source = isRecord(profile) ? profile : {};
  const version = Number(source.version);
  const targetExam = cleanExamLike(source.targetExam) || "SSC (not specified)";
  const recentTopics = normalizeStringArray(source.recentTopics, 10);
  const recentSubjects = normalizeStringArray(source.recentSubjects, 6);
  const legacyAttention = normalizeStringArray(source.attentionTopics, 6);
  const revisionQueue = normalizeStringArray(source.revisionQueue, 6);
  const lastUpdatedAt = safeNonNegativeInteger(source.lastUpdatedAt);

  let learningSignals = normalizeLearningSignals(source.learningSignals);
  let attentionTopics = legacyAttention;

  // v1 profiles had attention topics but no evidence counters. Treat each legacy
  // attention topic as one historical signal and require one more explicit signal
  // before it becomes a persistent attention area under v2 rules.
  if ((version < 2 || !Array.isArray(source.learningSignals)) && learningSignals.length === 0 && legacyAttention.length > 0) {
    learningSignals = legacyAttention.map((topic) => ({
      topic,
      confusionCount: 1,
      weakCount: 0,
      lastSeenAt: lastUpdatedAt,
    }));
    attentionTopics = [];
  }

  return {
    version: 2,
    targetExam,
    recentTopics,
    recentSubjects,
    attentionTopics: dedupeCaseInsensitive(attentionTopics).slice(0, 6),
    revisionQueue,
    learningSignals,
    questionCount: safeNonNegativeInteger(source.questionCount),
    lastUpdatedAt,
  };
}

function profileNeedsMigration(raw: unknown, normalized: StudentProfile): boolean {
  if (!isRecord(raw)) return true;
  if (raw.version !== 2 || !Array.isArray(raw.learningSignals)) return true;
  if (!Array.isArray(raw.recentTopics) || !Array.isArray(raw.recentSubjects) || !Array.isArray(raw.attentionTopics) || !Array.isArray(raw.revisionQueue)) return true;
  return JSON.stringify(raw) !== JSON.stringify(normalized);
}

function normalizeLearningSignals(value: unknown): LearningSignal[] {
  if (!Array.isArray(value)) return [];
  const result: LearningSignal[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const topic = cleanText(String(item.topic ?? ""), 100);
    if (!topic || topic === "General SSC doubt") continue;
    const normalized = topic.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      topic,
      confusionCount: safeNonNegativeInteger(item.confusionCount),
      weakCount: safeNonNegativeInteger(item.weakCount),
      lastSeenAt: safeNonNegativeInteger(item.lastSeenAt),
    });
    if (result.length >= 12) break;
  }
  return result;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeCaseInsensitive(value.map((item) => cleanText(String(item ?? ""), 100)).filter(Boolean)).slice(0, limit);
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function safeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function cleanExamLike(value: unknown): string {
  const cleaned = cleanText(String(value ?? ""), 60);
  if (!cleaned) return "";
  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jobKey(updateId: number): string { return `job:${updateId}`; }
function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Expected a positive safe integer.");
  return parsed;
}
function positiveOrNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed === 0) throw new Error("Expected a safe integer chat ID.");
  return parsed;
}
function positiveEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function cleanText(value: string, maxLength: number): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function indiaDayKey(timestamp: number): string {
  // India has no DST. Shift UTC by +05:30 and use UTC calendar fields.
  const shifted = new Date(timestamp + 330 * 60 * 1_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function cleanExam(value: string): string {
  const cleaned = cleanText(value, 60);
  if (!cleaned) return "";
  return /^ssc\b/i.test(cleaned) ? cleaned : `SSC ${cleaned}`;
}
