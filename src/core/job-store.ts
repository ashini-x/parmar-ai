import { DurableObject } from "cloudflare:workers";
import type { AnswerPacket, ConversationTurn, Env, LearningSignal, ProfileContext, QuestionJob, StudentProfile } from "../config/env";
import { selectTypingHeartbeatJob } from "./typing-heartbeat";
import { MAX_PHOTO_COUNT, MAX_QUIZ_BATCH_SIZE } from "../config/env";
import { sendTelegramChatAction, sendTelegramMessage } from "../telegram/api";
import { hasUnlimitedAiAccess } from "../analytics/db";
import { LEGACY_TELEGRAM_BOT_CONNECTION_ID, isTelegramBotConnectionActive } from "../telegram/bot-store";
import { getCaptionedPhotoQuestion, PHOTO_CAPTION_REQUIRED_TEXT } from "../telegram/photo-intent";

const TYPING_HEARTBEAT_MS = 4_000;
const TYPING_WAIT_HEARTBEAT_MS = 2_500;
const TYPING_MAX_AGE_MS = 10 * 60 * 1_000;
const JOB_RETENTION_MS = 48 * 60 * 60 * 1_000;
const PENDING_RECOVERY_MS = 45 * 1_000;
const QUEUED_RECOVERY_MS = 2 * 60 * 1_000;
const PROCESSING_LEASE_MS = 5 * 60 * 1_000;
const JOB_MAX_ACTIVE_AGE_MS = 20 * 60 * 1_000;
const RATE_LIMIT_META_KEY = "meta:rate:v2";
const PROFILE_KEY = "profile:v1";
const FATMAN_MODE_PREFIX = "mode:fatman:"
const CONVERSATION_RESET_KEY = "conversation:resetAt";
const PENDING_QUIZ_REQUEST_KEY = "pending:quiz-request";
const PENDING_QUIZ_REQUEST_TTL_MS = 15 * 60 * 1_000;
const PHOTO_ALBUM_SETTLE_MS = 2_500;
const PHOTO_STATUS_TEXT = "📸 Photo received…";
const PHOTO_RATE_LIMIT_TEXT = "Aaj ke liye tumhara question limit complete ho gaya hai. Kal phir continue kar lena. 🙌";
const PHOTO_BURST_LIMIT_TEXT = "Bhai, ek saath bahut saare doubts aa rahe hain. Thoda sa gap do, phir next doubt bhejo. 🙂";
const UNSUPPORTED_VIDEO_NOTICE_KEY = "meta:unsupported-video-notice";
const UNSUPPORTED_VIDEO_NOTICE_INTERVAL_MS = 10_000;

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
  botConnectionId?: string;
  chatId: number;
  telegramUserId?: number;
  question: string;
  messageId: number;
  requestId: string;
  createdAt: number;
  state: JobState;
  statusMessageId?: number;
  activeQueueMessageId?: string;
  processingAt?: number;
  queuedAt?: number;
  leaseVersion: number;
  answer?: string;
  answerPacket?: AnswerPacket;
  profileUpdated?: boolean;
  quizCount?: number;
  photoFileIds?: string[];
  fatmanModeSnapshot?: boolean;
}

interface AckReservation {
  version: 1;
  botConnectionId: string;
  updateId: number;
  chatId: number;
  messageId: number;
  requestId: string;
  createdAt: number;
  statusMessageId?: number;
}

interface PendingAlbumPhoto {
  updateId: number;
  messageId: number;
  fileId: string;
  caption: string;
}

interface PendingPhotoAlbum {
  version: 1;
  state: "collecting" | "queued" | "rejected";
  botConnectionId: string;
  mediaGroupId: string;
  chatId: number;
  telegramUserId: number;
  requestId: string;
  createdAt: number;
  flushAt: number;
  photos: PendingAlbumPhoto[];
  updateIds: number[];
  limitNotified?: boolean;
  fatmanModeSnapshot?: boolean;
}

interface PhotoAlbumStageResponse { action: "staged" | "duplicate" | "too_many" | "closed" | "rejected"; }

interface StoredQuizResultContext {
  pollId: string;
  botConnectionId: string;
  updateId: number;
  createdAt: number;
  question: string;
  selectedAnswer: string;
  correctAnswer: string;
  result: "correct" | "incorrect";
  explanation: string;
  topic: string;
}

interface BeginResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  quizCount?: number;
  fatmanModeSnapshot?: boolean;
  statusMessageId?: number;
  notify?: boolean;
  rateLimitReason?: "daily" | "burst";
  unlimited?: boolean;
}

interface GenericResponse { ok: true; }

export interface ClaimResponse {
  claimed: boolean;
  wait?: boolean;
  retryAfterSeconds?: number;
  leaseVersion?: number;
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

  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: Env) {
    super(ctx, env);
    this.runtimeEnv = env;
  }

  async fetch(request: Request): Promise<Response> {
    const payload = await request.json().catch(() => null);
    if (!isRecord(payload)) return this.json({ ok: false, error: "invalid_internal_payload" }, 400);
    const body = payload;
    const action = String(body.action ?? "");

    switch (action) {
      case "begin": return this.json(await this.beginJob(body));
      case "reserve_ack": return this.json(await this.reserveAck(body));
      case "stage_photo_album": return this.json(await this.stagePhotoAlbum(body));
      case "reject_telegram_video": return this.json(await this.rejectTelegramVideo(body));
      case "save_ack": return this.json(await this.saveAck(body));
      case "mark_queued": return this.json(await this.markQueued(body));
      case "claim": return this.json(await this.claim(body));
      case "set_answer_packet": return this.json(await this.setAnswerPacket(body));
      case "mark_profile_updated": return this.json(await this.markProfileUpdated(body));
      case "complete": return this.json(await this.complete(body));
      case "get_fatman_mode": return this.json({ ok: true, active: await this.getFatmanMode(String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID)) });
      case "set_fatman_mode": return this.json(await this.setFatmanMode(body));
      case "get_profile": return this.json({ ok: true, profile: await this.getProfile() });
      case "get_usage": return this.json({ ok: true, usage: await this.getUsage(positiveNumber(body.telegramUserId)) });
      case "get_conversation": return this.json({ ok: true, recentConversation: await this.getConversation(positiveNumber(body.updateId), String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID), body.fatmanModeSnapshot === true) });
      case "set_pending_quiz": return this.json(await this.setPendingQuiz(body));
      case "consume_pending_quiz": return this.json(await this.consumePendingQuiz());
      case "clear_pending_quiz": return this.json(await this.clearPendingQuiz());
      case "record_quiz_result": return this.json(await this.recordQuizResult(body));
      case "update_profile": return this.json(await this.updateProfile(body));
      case "set_exam": return this.json(await this.setExam(body));
      case "reset_profile": return this.json(await this.resetProfile());
      case "delete_data": return this.json(await this.deleteData());
      case "set_business_connection": return this.json(await this.setBusinessConnection(body));
      case "check_business_connection": return this.json(await this.checkBusinessConnection(body));
      case "claim_business_message": return this.json(await this.claimBusinessMessage(body));
      default: return this.json({ ok: false, error: "unknown_action" }, 400);
    }
  }

  async alarm(): Promise<void> {
    await this.reconcileAlarm();
  }

  private async setBusinessConnection(body: Record<string, unknown>): Promise<GenericResponse> {
    const businessConnectionId = String(body.businessConnectionId ?? "").trim();
    if (!businessConnectionId || businessConnectionId.length > 256) {
      throw new Error("Invalid business connection identifier.");
    }
    await this.ctx.storage.put("business:connection:v1", {
      businessConnectionId,
      enabled: body.enabled === true,
      canReply: body.canReply === true,
    });
    return { ok: true };
  }

  private async checkBusinessConnection(body: Record<string, unknown>): Promise<{ allowed: boolean }> {
    const businessConnectionId = String(body.businessConnectionId ?? "").trim();
    const connection = await this.ctx.storage.get<{ businessConnectionId: string; enabled: boolean; canReply: boolean }>("business:connection:v1");
    return {
      allowed: Boolean(
        connection &&
        connection.businessConnectionId === businessConnectionId &&
        connection.enabled &&
        connection.canReply
      ),
    };
  }

  private async claimBusinessMessage(body: Record<string, unknown>): Promise<{ shouldReply: boolean }> {
    const updateId = positiveNumber(body.updateId);
    if (!updateId) return { shouldReply: false };
    return this.ctx.storage.transaction(async (transaction) => {
      const seen = (await transaction.get<number[]>("business:seen-updates:v1")) ?? [];
      if (seen.includes(updateId)) return { shouldReply: false };
      await transaction.put("business:seen-updates:v1", [...seen.slice(-199), updateId]);
      return { shouldReply: true };
    });
  }


  private async rejectTelegramVideo(body: Record<string, unknown>): Promise<{ notify: boolean }> {
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID).trim();
    const mediaGroupId = String(body.mediaGroupId ?? "").trim();
    const updateId = positiveNumber(body.updateId);
    const chatId = positiveOrNegativeNumber(body.chatId);
    const telegramUserId = positiveNumber(body.telegramUserId);
    const requestId = String(body.requestId ?? "").trim();
    const now = Date.now();
    let changed = false;

    if (mediaGroupId && mediaGroupId.length <= 128) {
      const key = photoAlbumKey(botConnectionId, mediaGroupId);
      changed = await this.ctx.storage.transaction(async (transaction) => {
        const existing = await transaction.get<PendingPhotoAlbum>(key);
        if (existing?.state === "queued") return false;
        if (existing?.state === "rejected") return false;
        const album: PendingPhotoAlbum = existing ?? {
          version: 1,
          state: "rejected",
          botConnectionId,
          mediaGroupId,
          chatId,
          telegramUserId,
          requestId,
          createdAt: now,
          flushAt: now,
          photos: [],
          updateIds: [],
        };
        album.state = "rejected";
        album.photos = [];
        if (!album.updateIds.includes(updateId)) album.updateIds.push(updateId);
        await transaction.put(key, album);
        return true;
      });
      if (changed) await this.reconcileAlarm();
    }

    const lastNoticeAt = await this.ctx.storage.get<number>(UNSUPPORTED_VIDEO_NOTICE_KEY);
    const notify = !Number.isFinite(lastNoticeAt) || now - Number(lastNoticeAt) >= UNSUPPORTED_VIDEO_NOTICE_INTERVAL_MS;
    if (notify) await this.ctx.storage.put(UNSUPPORTED_VIDEO_NOTICE_KEY, now);
    return { notify };
  }

  private async stagePhotoAlbum(body: Record<string, unknown>): Promise<PhotoAlbumStageResponse> {
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID).trim();
    const mediaGroupId = String(body.mediaGroupId ?? "").trim();
    const updateId = positiveNumber(body.updateId);
    const messageId = positiveNumber(body.messageId);
    const fileId = String(body.fileId ?? "").trim();
    const requestId = String(body.requestId ?? "").trim();
    const telegramUserId = positiveNumber(body.telegramUserId);
    const caption = String(body.caption ?? "").trim();
    if (!botConnectionId || !mediaGroupId || mediaGroupId.length > 128 || !fileId || fileId.length > 512 || !requestId) {
      throw new Error("Invalid photo album payload.");
    }

    const now = Date.now();
    const key = photoAlbumKey(botConnectionId, mediaGroupId);
    const result = await this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<PendingPhotoAlbum>(key);
      if (existing?.updateIds.includes(updateId)) return { action: "duplicate" as const };
      if (existing?.state === "rejected") return { action: "rejected" as const };
      if (existing?.state === "queued") {
        if (existing.updateIds.length >= MAX_PHOTO_COUNT) {
          if (existing.limitNotified) return { action: "rejected" as const };
          existing.limitNotified = true;
          await transaction.put(key, existing);
          return { action: "too_many" as const };
        }
        existing.updateIds.push(updateId);
        await transaction.put(key, existing);
        return { action: "closed" as const };
      }
      if (existing && existing.photos.length >= MAX_PHOTO_COUNT) {
        existing.state = "rejected";
        existing.photos = [];
        existing.updateIds.push(updateId);
        existing.limitNotified = true;
        await transaction.put(key, existing);
        return { action: "too_many" as const };
      }

      const album: PendingPhotoAlbum = existing ?? {
        version: 1,
        state: "collecting",
        botConnectionId,
        mediaGroupId,
        chatId: positiveOrNegativeNumber(body.chatId),
        telegramUserId,
        requestId,
        createdAt: now,
        flushAt: now + PHOTO_ALBUM_SETTLE_MS,
        photos: [],
        updateIds: [],
        fatmanModeSnapshot: body.fatmanModeSnapshot === true,
      };
      album.photos.push({ updateId, messageId, fileId, caption });
      album.updateIds.push(updateId);
      album.flushAt = now + PHOTO_ALBUM_SETTLE_MS;
      await transaction.put(key, album);
      return { action: "staged" as const };
    });

    if (result.action === "staged" || result.action === "too_many") await this.reconcileAlarm();
    return result;
  }

  private async ensureTypingAlarm(now = Date.now()): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > now + TYPING_WAIT_HEARTBEAT_MS) {
      await this.ctx.storage.setAlarm(now + TYPING_WAIT_HEARTBEAT_MS);
    }
  }

  private async reconcileAlarm(now = Date.now()): Promise<void> {
    const retentionCutoff = now - JOB_RETENTION_MS;
    const typingCutoff = now - TYPING_MAX_AGE_MS;
    const stalePendingCutoff = now - PENDING_RECOVERY_MS;
    const staleQueuedCutoff = now - QUEUED_RECOVERY_MS;
    const staleProcessingCutoff = now - PROCESSING_LEASE_MS;
    const terminalCutoff = now - JOB_MAX_ACTIVE_AGE_MS;
    const quizResults = await this.ctx.storage.list<StoredQuizResultContext>({ prefix: "quiz-result:" });
    const albums = await this.ctx.storage.list<PendingPhotoAlbum>({ prefix: "photo-album:" });
    const acknowledgements = await this.ctx.storage.list<AckReservation>({ prefix: "ack:" });
    let nextWakeAt: number | null = null;

    for (const [key, acknowledgement] of acknowledgements) {
      const expiresAt = acknowledgement.createdAt + JOB_RETENTION_MS;
      if (expiresAt <= now) {
        await this.ctx.storage.delete(key);
      } else {
        nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, expiresAt);
      }
    }

    for (const [key, result] of quizResults) {
      if (result.createdAt < retentionCutoff) await this.ctx.storage.delete(key);
    }

    for (const [key, album] of albums) {
      if (album.createdAt < retentionCutoff) {
        await this.ctx.storage.delete(key);
        continue;
      }
      nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, album.createdAt + JOB_RETENTION_MS);
      if (album.state !== "collecting") continue;
      if (album.flushAt > now) {
        nextWakeAt = Math.min(nextWakeAt, album.flushAt);
        continue;
      }
      try {
        await this.flushPhotoAlbum(key, album, now);
      } catch {
        album.flushAt = now + 5_000;
        await this.ctx.storage.put(key, album);
        nextWakeAt = Math.min(nextWakeAt, album.flushAt);
      }
    }

    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });
    for (const [key, record] of jobs) {
      if (record.createdAt < retentionCutoff) { await this.ctx.storage.delete(key); continue; }
      nextWakeAt = nextWakeAt === null ? record.createdAt + JOB_RETENTION_MS : Math.min(nextWakeAt, record.createdAt + JOB_RETENTION_MS);
      if (record.state === "done") continue;

      if (record.createdAt < terminalCutoff) {
        record.state = "done";
        record.processingAt = undefined;
        record.queuedAt = undefined;
        record.activeQueueMessageId = undefined;
        record.photoFileIds = undefined;
        await this.ctx.storage.put(key, record);
        continue;
      }

      const enqueue = async () => this.runtimeEnv.QUESTION_QUEUE.send({
        version: 2,
        updateId: record.updateId,
        botConnectionId: record.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
        chatId: record.chatId,
        ...(record.telegramUserId !== undefined ? { telegramUserId: record.telegramUserId } : {}),
        question: record.question,
        messageId: record.messageId,
        requestId: record.requestId,
        createdAt: record.createdAt,
        ...(record.statusMessageId !== undefined ? { statusMessageId: record.statusMessageId } : {}),
        ...(record.quizCount !== undefined ? { quizCount: record.quizCount } : {}),
        ...(record.fatmanModeSnapshot !== undefined ? { fatmanModeSnapshot: record.fatmanModeSnapshot } : {}),
      }, { contentType: "json" });

      if (record.state === "processing") {
        if (record.processingAt && record.processingAt < staleProcessingCutoff) {
          try {
            await enqueue();
            record.state = "queued";
            record.queuedAt = now;
            record.processingAt = undefined;
            record.activeQueueMessageId = undefined;
            await this.ctx.storage.put(key, record);
          } catch { nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, now + 5_000); }
        } else {
          if (record.processingAt) nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, record.processingAt + PROCESSING_LEASE_MS);
        }
        continue;
      }

      if (record.state === "queued") {
        const queuedAt = record.queuedAt ?? record.createdAt;
        if (queuedAt < staleQueuedCutoff) {
          try { await enqueue(); record.queuedAt = now; await this.ctx.storage.put(key, record); }
          catch { nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, now + 5_000); }
        }
        nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, queuedAt + QUEUED_RECOVERY_MS);
        continue;
      }

      if (record.state === "pending") {
        if (record.createdAt < stalePendingCutoff) {
          try { await enqueue(); record.state = "queued"; record.queuedAt = now; await this.ctx.storage.put(key, record); }
          catch { nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, now + 5_000); }
        }
        nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, record.createdAt + PENDING_RECOVERY_MS);
      }
    }

    // Keep typing alive while a question is pending or queued, not only after
    // the Queue consumer claims it. This bridges the webhook-to-Queue handoff.
    // The Durable Object alarm survives both short-lived Worker invocations.
    const typingRecord = selectTypingHeartbeatJob(jobs.values(), now, TYPING_MAX_AGE_MS);
    if (
      typingRecord &&
      await isTelegramBotConnectionActive(
        this.runtimeEnv,
        typingRecord.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
      )
    ) {
      try {
        await sendTelegramChatAction(
          this.runtimeEnv,
          typingRecord.chatId,
          "typing",
          typingRecord.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
        );
      } catch {
        // Typing is cosmetic; never allow a failed chat action to affect the job.
      }
      const heartbeatMs = typingRecord.state === "processing"
        ? TYPING_HEARTBEAT_MS
        : TYPING_WAIT_HEARTBEAT_MS;
      nextWakeAt = Math.min(nextWakeAt ?? Number.POSITIVE_INFINITY, now + heartbeatMs);
    }

    if (nextWakeAt !== null && Number.isFinite(nextWakeAt)) {
      await this.ctx.storage.setAlarm(Math.max(now + 1_000, nextWakeAt));
      return;
    }
    await this.ctx.storage.deleteAlarm();
  }

  private async flushPhotoAlbum(key: string, album: PendingPhotoAlbum, now: number): Promise<void> {
    if (!(await isTelegramBotConnectionActive(this.runtimeEnv, album.botConnectionId))) {
      album.state = "rejected";
      album.photos = [];
      await this.ctx.storage.put(key, album);
      return;
    }

    const photos = [...album.photos].sort((a, b) => a.messageId - b.messageId);
    if (!photos.length) {
      album.state = "rejected";
      await this.ctx.storage.put(key, album);
      return;
    }
    const updateId = Math.min(...photos.map((photo) => photo.updateId));
    const question = getCaptionedPhotoQuestion(photos.map((photo) => photo.caption));
    if (!question) {
      await sendTelegramMessage(
        this.runtimeEnv,
        album.chatId,
        PHOTO_CAPTION_REQUIRED_TEXT,
        photos[0].messageId,
        album.botConnectionId,
      );
      album.state = "rejected";
      album.photos = [];
      album.flushAt = now;
      await this.ctx.storage.put(key, album);
      return;
    }

    const begin = await this.beginJob({
      action: "begin",
      botConnectionId: album.botConnectionId,
      telegramUserId: album.telegramUserId,
      updateId,
      chatId: album.chatId,
      question,
      messageId: photos[0].messageId,
      requestId: album.requestId,
      createdAt: album.createdAt,
      requestedQuizCount: 1,
      fatmanModeSnapshot: album.fatmanModeSnapshot === true,
      photoFileIds: photos.map((photo) => photo.fileId),
    });

    if (begin.action === "rate_limited") {
      album.state = "rejected";
      album.photos = [];
      await this.ctx.storage.put(key, album);
      if (begin.notify) {
        const limitText = begin.rateLimitReason === "daily" ? PHOTO_RATE_LIMIT_TEXT : PHOTO_BURST_LIMIT_TEXT;
        await sendTelegramMessage(this.runtimeEnv, album.chatId, limitText, photos[0].messageId, album.botConnectionId);
      }
      return;
    }

    if (begin.action === "duplicate") {
      album.state = "queued";
      album.photos = [];
      await this.ctx.storage.put(key, album);
      return;
    }

    let statusMessageId = begin.statusMessageId;
    if (!statusMessageId) {
      const status = await sendTelegramMessage(this.runtimeEnv, album.chatId, PHOTO_STATUS_TEXT, photos[0].messageId, album.botConnectionId, false);
      statusMessageId = status.message_id;
      await this.saveAck({ botConnectionId: album.botConnectionId, updateId, statusMessageId });
    }

    const job: QuestionJob = {
      version: 2,
      botConnectionId: album.botConnectionId,
      updateId,
      chatId: album.chatId,
      question,
      messageId: photos[0].messageId,
      requestId: album.requestId,
      createdAt: album.createdAt,
      statusMessageId,
      telegramUserId: album.telegramUserId,
      quizCount: begin.quizCount ?? 1,
      fatmanModeSnapshot: album.fatmanModeSnapshot === true,
    };
    await this.runtimeEnv.QUESTION_QUEUE.send(job, { contentType: "json" });
    await this.markQueued({ botConnectionId: album.botConnectionId, updateId });
    void sendTelegramChatAction(this.runtimeEnv, album.chatId, "typing", album.botConnectionId).catch(() => undefined);

    album.state = "queued";
    album.photos = [];
    album.flushAt = now;
    await this.ctx.storage.put(key, album);
  }

  private async beginJob(body: Record<string, unknown>): Promise<BeginResponse> {
    const job = parseJob(body);
    const botConnectionId = job.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID;
    const key = jobKey(botConnectionId, job.updateId);
    const now = Date.now();
    const telegramUserId = positiveNumber(body.telegramUserId);
    // D1 access checks stay outside the storage transaction. The student's
    // operational quota and job admission are serialized inside it below.
    const unlimited = await hasUnlimitedAiAccess(this.runtimeEnv, telegramUserId, now);
    const dailyLimit = positiveEnv(this.runtimeEnv.DAILY_QUESTION_LIMIT, 20);
    const burstLimit = positiveEnv(this.runtimeEnv.BURST_QUESTION_LIMIT, 5);
    const burstWindowMs = positiveEnv(this.runtimeEnv.BURST_WINDOW_SECONDS, 10) * 1_000;

    const result = await this.ctx.storage.transaction(async (transaction): Promise<BeginResponse> => {
      let existing = await transaction.get<JobRecord>(key);
      if (!existing && botConnectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) {
        const legacyKey = legacyJobKey(job.updateId);
        existing = await transaction.get<JobRecord>(legacyKey);
        if (existing) {
          existing.botConnectionId = botConnectionId;
          await transaction.put(key, existing);
          await transaction.delete(legacyKey);
        }
      }

      if (existing) {
        if (!existing.statusMessageId && job.statusMessageId) {
          existing.statusMessageId = job.statusMessageId;
          await transaction.put(key, existing);
        }
        if (existing.state === "done" || existing.state === "queued" || existing.state === "processing") {
          return { action: "duplicate", statusMessageId: existing.statusMessageId, quizCount: existing.quizCount, fatmanModeSnapshot: existing.fatmanModeSnapshot };
        }
        return { action: "retry_ack", statusMessageId: existing.statusMessageId, quizCount: existing.quizCount, fatmanModeSnapshot: existing.fatmanModeSnapshot };
      }

      const storedRate = await transaction.get<RateMeta>(RATE_LIMIT_META_KEY);
      const rate: RateMeta = storedRate && typeof storedRate.dayKey === "string"
        ? storedRate
        : {
            burstWindowStart: now,
            burstCount: 0,
            dayKey: indiaDayKey(now),
            dayCount: 0,
            lastRateNoticeAt: 0,
          };

      let burstWindowStart = rate.burstWindowStart;
      let burstCount = rate.burstCount;
      if (now - burstWindowStart >= burstWindowMs) {
        burstWindowStart = now;
        burstCount = 0;
      }

      const dayKey = indiaDayKey(now);
      const dayCount = rate.dayKey === dayKey ? rate.dayCount : 0;

      const requestedQuizCountRaw = Number(body.requestedQuizCount ?? 1);
      const requestedQuizCount = Number.isSafeInteger(requestedQuizCountRaw)
        ? Math.max(1, Math.min(MAX_QUIZ_BATCH_SIZE, requestedQuizCountRaw))
        : 1;
      const continuation = body.quizContinuation === true;
      // One Durable Object is keyed by the student's private chat ID. Fatman
      // and normal study mode therefore consume the same daily allowance.
      const usageUnits = continuation ? 0 : requestedQuizCount;
      const dailyLimited = !unlimited && dayCount + usageUnits > dailyLimit;
      const burstLimited = burstCount + usageUnits > burstLimit;

      if (dailyLimited || burstLimited) {
        const shouldNotify = now - rate.lastRateNoticeAt >= burstWindowMs;
        await transaction.put<RateMeta>(RATE_LIMIT_META_KEY, {
          burstWindowStart,
          burstCount,
          dayKey,
          dayCount,
          lastRateNoticeAt: shouldNotify ? now : rate.lastRateNoticeAt,
        });
        return {
          action: "rate_limited",
          notify: shouldNotify,
          rateLimitReason: dailyLimited ? "daily" : "burst",
          unlimited,
          quizCount: requestedQuizCount,
        };
      }

      const record: JobRecord = {
        version: 2,
        updateId: job.updateId,
        botConnectionId,
        chatId: job.chatId,
        telegramUserId,
        question: job.question,
        messageId: job.messageId,
        requestId: job.requestId,
        createdAt: job.createdAt,
        state: "pending",
        leaseVersion: 0,
        ...(job.statusMessageId !== undefined ? { statusMessageId: job.statusMessageId } : {}),
        quizCount: requestedQuizCount,
        ...(job.photoFileIds?.length ? { photoFileIds: job.photoFileIds } : {}),
        ...(job.fatmanModeSnapshot !== undefined ? { fatmanModeSnapshot: job.fatmanModeSnapshot } : {}),
      };

      await transaction.put<RateMeta>(RATE_LIMIT_META_KEY, {
        burstWindowStart,
        burstCount: burstCount + usageUnits,
        dayKey,
        dayCount: unlimited ? dayCount : dayCount + usageUnits,
        lastRateNoticeAt: rate.lastRateNoticeAt,
      });
      await transaction.put(key, record);
      return { action: "new", quizCount: requestedQuizCount };
    });

    if (result.action === "new") await this.ensureTypingAlarm(now);
    return result;
  }

  private async reserveAck(body: Record<string, unknown>): Promise<{
    action: "new" | "existing";
    statusMessageId?: number;
  }> {
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID).trim();
    const updateId = positiveNumber(body.updateId);
    const chatId = positiveOrNegativeNumber(body.chatId);
    const messageId = positiveNumber(body.messageId);
    const requestId = String(body.requestId ?? "").trim();
    if (!botConnectionId || botConnectionId.length > 128 || !requestId || requestId.length > 128) {
      throw new Error("Invalid acknowledgement reservation.");
    }

    const now = Date.now();
    const key = acknowledgementKey(botConnectionId, updateId);
    const result = await this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<AckReservation>(key);
      if (existing && now - existing.createdAt < JOB_RETENTION_MS) {
        return {
          action: "existing" as const,
          ...(existing.statusMessageId ? { statusMessageId: existing.statusMessageId } : {}),
        };
      }

      // Do not create a second acknowledgement for a job written by an older
      // webhook version before acknowledgement reservations were introduced.
      let existingJob = await transaction.get<JobRecord>(jobKey(botConnectionId, updateId));
      if (!existingJob && botConnectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) {
        existingJob = await transaction.get<JobRecord>(legacyJobKey(updateId));
      }
      if (existingJob) {
        return {
          action: "existing" as const,
          ...(existingJob.statusMessageId ? { statusMessageId: existingJob.statusMessageId } : {}),
        };
      }

      const reservation: AckReservation = {
        version: 1,
        botConnectionId,
        updateId,
        chatId,
        messageId,
        requestId,
        createdAt: now,
      };
      await transaction.put(key, reservation);
      return { action: "new" as const };
    });

    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > now + JOB_RETENTION_MS) {
      await this.ctx.storage.setAlarm(now + JOB_RETENTION_MS);
    }
    return result;
  }

  private async saveAck(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const statusMessageId = positiveNumber(body.statusMessageId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (record) {
      record.statusMessageId = statusMessageId;
      await this.ctx.storage.put(key, record);
    }

    const acknowledgementId = acknowledgementKey(botConnectionId, updateId);
    const acknowledgement = await this.ctx.storage.get<AckReservation>(acknowledgementId);
    if (acknowledgement) {
      acknowledgement.statusMessageId = statusMessageId;
      await this.ctx.storage.put(acknowledgementId, acknowledgement);
    }
    return { ok: true };
  }

  private async markQueued(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record || record.state === "done") return { ok: true };
    if (record.state === "pending") {
      record.state = "queued";
      record.queuedAt = Date.now();
    }
    await this.ctx.storage.put(key, record);

    // Hand off the chat action before the webhook stops its own heartbeat.
    // If Queue delivery is slow, the persistent alarm keeps refreshing it.
    await this.ensureTypingAlarm();
    try {
      await sendTelegramChatAction(
        this.runtimeEnv,
        record.chatId,
        "typing",
        record.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
      );
    } catch {
      // This is best-effort UI feedback and must not affect queue admission.
    }
    return { ok: true };
  }

  private async claim(body: Record<string, unknown>): Promise<ClaimResponse> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const queueMessageId = String(body.queueMessageId ?? "").trim();
    if (!queueMessageId) throw new Error("Queue message ID is required.");
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record || record.state === "done") return { claimed: false };
    record.botConnectionId ??= botConnectionId;

    const now = Date.now();
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });
    if ([...jobs.values()].some((candidate) =>
      candidate.updateId !== record.updateId && candidate.state !== "done" && candidate.createdAt <= record.createdAt
    )) return { claimed: false, wait: true, retryAfterSeconds: 10 };

    if (record.state === "processing" && record.activeQueueMessageId !== queueMessageId && record.processingAt && now - record.processingAt < PROCESSING_LEASE_MS) {
      return { claimed: false, wait: true, retryAfterSeconds: 10 };
    }

    record.state = "processing";
    record.activeQueueMessageId = queueMessageId;
    record.processingAt = now;
    record.queuedAt = undefined;
    record.leaseVersion = Math.max(0, Number(record.leaseVersion ?? 0)) + 1;
    await this.ctx.storage.put(key, record);
    return { claimed: true, leaseVersion: record.leaseVersion, record };
  }

  private async setAnswerPacket(body: Record<string, unknown>): Promise<GenericResponse & { stale?: boolean }> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };
    if (!isJobLeaseOwned(record, body)) return { ok: true, stale: true };
    const packet = body.packet as AnswerPacket | undefined;
    if (!isValidAnswerPacket(packet)) throw new Error("Invalid answer packet.");
    record.answerPacket = packet;
    record.answer = packet.answer;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async markProfileUpdated(body: Record<string, unknown>): Promise<GenericResponse & { stale?: boolean }> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };
    if (!isJobLeaseOwned(record, body)) return { ok: true, stale: true };
    record.profileUpdated = true;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async complete(body: Record<string, unknown>): Promise<GenericResponse & { stale?: boolean }> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);
    if (!record) return { ok: true };
    if (!isJobLeaseOwned(record, body)) return { ok: true, stale: true };
    record.state = "done";
    record.processingAt = undefined;
    record.queuedAt = undefined;
    record.activeQueueMessageId = undefined;
    record.photoFileIds = undefined;
    await this.ctx.storage.put(key, record);
    await this.reconcileAlarm();
    return { ok: true };
  }

  private async getConversation(currentUpdateId: number, currentBotConnectionId: string, currentFatmanMode: boolean): Promise<ConversationTurn[]> {
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });
    const quizResults = await this.ctx.storage.list<StoredQuizResultContext>({ prefix: "quiz-result:" });
    const resetAt = (await this.ctx.storage.get<number>(CONVERSATION_RESET_KEY)) ?? 0;

    const completedTurns = [...jobs.values()]
      .filter((record) =>
        !((record.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID) === currentBotConnectionId && record.updateId === currentUpdateId) &&
        record.state === "done" &&
        (record.fatmanModeSnapshot === true) === currentFatmanMode &&
        record.answerPacket &&
        record.answerPacket.answerScope !== "out_of_scope" &&
        record.createdAt > resetAt &&
        typeof record.question === "string" &&
        record.question.trim().length > 0,
      )
      .map((record) => ({
        createdAt: record.createdAt,
        question: clampConversationText(record.question, 650),
        answer: clampConversationText(buildStoredAnswer(record.answerPacket), 1_200),
      }));

    const quizTurns = [...quizResults.values()]
      .filter((result) => result.createdAt > resetAt)
      .map((result) => ({
        createdAt: result.createdAt,
        question: `Quiz result: ${result.topic}: ${result.question}`,
        answer: `Student selected: ${result.selectedAnswer}\nResult: ${result.result}\nCorrect answer: ${result.correctAnswer}\nExplanation: ${result.explanation}`,
      }));

    return [...completedTurns, ...quizTurns]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-12)
      .map(({ question, answer }) => ({ question, answer }));
  }

  private async getFatmanMode(botConnectionId: string): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(FATMAN_MODE_PREFIX + encodeURIComponent(botConnectionId))) === true;
  }

  private async setFatmanMode(body: Record<string, unknown>): Promise<GenericResponse & { active: boolean }> {
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID).trim();
    if (!botConnectionId || botConnectionId.length > 128) throw new Error("Invalid bot connection identifier.");
    const active = body.active === true;
    await this.ctx.storage.put(FATMAN_MODE_PREFIX + encodeURIComponent(botConnectionId), active);
    return { ok: true, active };
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

  private async updateProfile(body: Record<string, unknown>): Promise<GenericResponse & { stale?: boolean }> {
    const updateId = positiveNumber(body.updateId);
    const botConnectionId = String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID);
    const key = await this.resolveJobKey(botConnectionId, updateId);
    const appliedKey = profileAppliedKey(botConnectionId, updateId);
    const legacyAppliedKey = `profile:applied:${updateId}`;
    const now = Date.now();

    // Updating the profile, recording the idempotency marker, and marking the
    // job itself are one atomic operation. Concurrent completed answers cannot
    // overwrite each other's questionCount or apply the same answer twice.
    return this.ctx.storage.transaction(async (transaction): Promise<GenericResponse & { stale?: boolean }> => {
      const record = await transaction.get<JobRecord>(key);
      if (!record) return { ok: true };
      if (!isJobLeaseOwned(record, body)) return { ok: true, stale: true };

      const alreadyApplied = await transaction.get<boolean>(appliedKey) === true ||
        (botConnectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID &&
          await transaction.get<boolean>(legacyAppliedKey) === true);
      if (alreadyApplied) {
        record.profileUpdated = true;
        await transaction.put(key, record);
        return { ok: true };
      }

      const profile = normalizeProfile(await transaction.get<unknown>(PROFILE_KEY));
      const topic = cleanText(String(body.topic ?? ""), 100);
      const subject = cleanText(String(body.subject ?? ""), 40);
      const signal = normalizeProfileSignal(body.profileSignal);
      const nextRevisionTopic = cleanText(String(body.nextRevisionTopic ?? ""), 100);
      const question = cleanText(String(body.question ?? ""), 500);
      const questionMode = cleanText(String(body.questionMode ?? "fact"), 20);
      const detectedExam = cleanExam(String(body.detectedExam ?? ""));
      const answerScope = cleanText(String(body.answerScope ?? "ssc_ga_gs"), 20);

      // Every successfully answered request is counted, including Fatman page
      // explanations and supported-mode redirects. Only SSC-scoped answers
      // contribute topic and learning-signal data.
      profile.questionCount += 1;
      profile.lastUpdatedAt = now;

      if (answerScope !== "out_of_scope") {
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
                lastSeenAt: now,
              }
            : {
                topic,
                confusionCount: evidenceBackedSignal === "confusion" ? 1 : 0,
                weakCount: evidenceBackedSignal === "weak" ? 1 : 0,
                lastSeenAt: now,
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
      }

      record.profileUpdated = true;
      await transaction.put(PROFILE_KEY, profile);
      await transaction.put(appliedKey, true);
      await transaction.put(key, record);
      return { ok: true };
    });
  }

  private ownsLease(record: JobRecord, body: Record<string, unknown>): boolean {
    return isJobLeaseOwned(record, body);
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

  private async deleteData(): Promise<GenericResponse> {
    // Study-data deletion must not reset or revive the student's daily AI quota.
    // Delete all Durable Object state except the independently maintained rate
    // metadata, atomically so a concurrent intake cannot race the preservation.
    await this.ctx.storage.transaction(async (transaction) => {
      const storedEntries = await transaction.list();
      const keysToDelete = [...storedEntries.keys()].filter((key) => key !== RATE_LIMIT_META_KEY);
      if (keysToDelete.length > 0) await transaction.delete(keysToDelete);
    });
    return { ok: true };
  }

  private async setPendingQuiz(body: Record<string, unknown>): Promise<GenericResponse> {
    const countRaw = Number(body.count ?? 1);
    const count = Number.isSafeInteger(countRaw) ? Math.max(1, Math.min(MAX_QUIZ_BATCH_SIZE, countRaw)) : 1;
    await this.ctx.storage.put(PENDING_QUIZ_REQUEST_KEY, { count, createdAt: Date.now() });
    return { ok: true };
  }

  private async consumePendingQuiz(): Promise<{ ok: true; count: number }> {
    const pending = await this.ctx.storage.get<{ count: number; createdAt: number }>(PENDING_QUIZ_REQUEST_KEY);
    if (!pending || !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > PENDING_QUIZ_REQUEST_TTL_MS) {
      await this.ctx.storage.delete(PENDING_QUIZ_REQUEST_KEY);
      return { ok: true, count: 0 };
    }
    await this.ctx.storage.delete(PENDING_QUIZ_REQUEST_KEY);
    return { ok: true, count: Math.max(1, Math.min(MAX_QUIZ_BATCH_SIZE, Number(pending.count) || 1)) };
  }

  private async clearPendingQuiz(): Promise<GenericResponse> {
    await this.ctx.storage.delete(PENDING_QUIZ_REQUEST_KEY);
    return { ok: true };
  }

  private async recordQuizResult(body: Record<string, unknown>): Promise<GenericResponse> {
    const pollId = String(body.pollId ?? "").trim();
    const result = String(body.result ?? "");
    if (!pollId || (result !== "correct" && result !== "incorrect")) throw new Error("Invalid quiz result context.");
    await this.ctx.storage.put<StoredQuizResultContext>(`quiz-result:${pollId}`, {
      pollId,
      botConnectionId: String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID),
      updateId: positiveNumber(body.updateId),
      createdAt: Date.now(),
      question: clampConversationText(String(body.question ?? ""), 650),
      selectedAnswer: clampConversationText(String(body.selectedAnswer ?? "No answer recorded"), 250),
      correctAnswer: clampConversationText(String(body.correctAnswer ?? "Unknown"), 250),
      result,
      explanation: clampConversationText(String(body.explanation ?? ""), 300),
      topic: clampConversationText(String(body.topic ?? "General SSC doubt"), 100),
    });
    return { ok: true };
  }

  private async resetProfile(): Promise<GenericResponse> {
    const now = Date.now();
    await this.ctx.storage.put(PROFILE_KEY, { ...DEFAULT_PROFILE, lastUpdatedAt: now });
    await this.ctx.storage.put(CONVERSATION_RESET_KEY, now);
    await this.ctx.storage.delete(PENDING_QUIZ_REQUEST_KEY);
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

  private async getUsage(telegramUserId: number): Promise<{ dayCount: number; dailyLimit: number; unlimited: boolean }> {
    const now = Date.now();
    const rate = await this.getRateMeta(now);
    const unlimited = await hasUnlimitedAiAccess(this.runtimeEnv, telegramUserId, now);
    const currentDay = indiaDayKey(now);
    return {
      dayCount: rate.dayKey === currentDay ? rate.dayCount : 0,
      dailyLimit: positiveEnv(this.runtimeEnv.DAILY_QUESTION_LIMIT, 20),
      unlimited,
    };
  }

  private async resolveJobKey(botConnectionId: string, updateId: number): Promise<string> {
    const key = jobKey(botConnectionId, updateId);
    if (await this.ctx.storage.get<JobRecord>(key)) return key;
    if (botConnectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) {
      const legacyKey = legacyJobKey(updateId);
      const legacy = await this.ctx.storage.get<JobRecord>(legacyKey);
      if (legacy) {
        legacy.botConnectionId = botConnectionId;
        await this.ctx.storage.put(key, legacy);
        await this.ctx.storage.delete(legacyKey);
      }
    }
    return key;
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
    recentConversation: recentConversation.slice(-12),
  };
}

function buildStoredAnswer(packet?: AnswerPacket): string {
  if (!packet) return "";
  if (packet.responseMode === "quiz") {
    const items = packet.quizItems?.length
      ? packet.quizItems
      : (packet.quizQuestion ? [{
        question: packet.quizQuestion,
        options: packet.quizOptions,
        correctOptionIds: packet.quizCorrectOptionIds,
        explanation: packet.quizExplanation,
      }] : []);
    return `Native quiz${items.length > 1 ? ` batch (${items.length})` : ""} on ${packet.topic || "SSC"}. Questions: ${items.map((item, index) => `${index + 1}. ${item.question}`).join(" | ")}`;
  }
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

interface ParsedQuestionJob extends QuestionJob { photoFileIds?: string[]; }

function parseJob(body: Record<string, unknown>): ParsedQuestionJob {
  const photoIdsValue = body.photoFileIds;
  if (photoIdsValue !== undefined && (
    !Array.isArray(photoIdsValue) ||
    photoIdsValue.length < 1 ||
    photoIdsValue.length > MAX_PHOTO_COUNT ||
    photoIdsValue.some((value) => typeof value !== "string" || !value.trim() || value.length > 512)
  )) throw new Error("Invalid photo IDs.");
  const photoFileIds = Array.isArray(photoIdsValue) ? photoIdsValue.map((value) => String(value).trim()) : undefined;
  const job: ParsedQuestionJob = {
    version: 2,
    botConnectionId: String(body.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID),
    updateId: positiveNumber(body.updateId),
    chatId: positiveOrNegativeNumber(body.chatId),
    ...(body.telegramUserId !== undefined ? { telegramUserId: positiveNumber(body.telegramUserId) } : {}),
    question: String(body.question ?? "").trim(),
    messageId: positiveNumber(body.messageId),
    requestId: String(body.requestId ?? ""),
    createdAt: positiveNumber(body.createdAt),
    ...(body.statusMessageId !== undefined ? { statusMessageId: positiveNumber(body.statusMessageId) } : {}),
    ...(body.quizCount !== undefined ? { quizCount: Math.max(1, Math.min(MAX_QUIZ_BATCH_SIZE, positiveNumber(body.quizCount))) } : {}),
    ...(body.fatmanModeSnapshot !== undefined ? { fatmanModeSnapshot: body.fatmanModeSnapshot === true } : {}),
    ...(photoFileIds ? { photoFileIds } : {}),
  };
  if (!job.question || !job.requestId) throw new Error("Invalid job payload.");
  return job;
}

export function isJobLeaseOwned(
  record: Pick<JobRecord, "state" | "activeQueueMessageId" | "leaseVersion">,
  body: Record<string, unknown>,
): boolean {
  const queueMessageId = String(body.queueMessageId ?? "").trim();
  const leaseVersion = Number(body.leaseVersion);
  return record.state === "processing" &&
    Boolean(queueMessageId) &&
    record.activeQueueMessageId === queueMessageId &&
    Number.isSafeInteger(leaseVersion) &&
    leaseVersion === record.leaseVersion;
}

export function isValidAnswerPacket(value: unknown): value is AnswerPacket {
  if (!isRecord(value)) return false;
  const requiredStrings = ["answer", "responseMode", "quizQuestion", "sscTakeaway", "answerScope", "subject", "topic", "questionMode", "examRelevance", "difficulty", "profileSignal", "profileNote", "nextRevisionTopic", "quizExplanation"];
  if (requiredStrings.some((key) => typeof value[key] !== "string")) return false;
  if (!(value.detectedExam === null || typeof value.detectedExam === "string")) return false;
  if (typeof value.timeSensitive !== "boolean") return false;
  if (!["ssc_ga_gs", "ssc_support", "out_of_scope"].includes(String(value.answerScope))) return false;
  if (!["history", "polity", "geography", "economy", "science", "static_gk", "current_affairs", "art_culture", "other"].includes(String(value.subject))) return false;
  if (!["fact", "concept", "comparison", "statement_trap", "revision", "study_plan", "mcq"].includes(String(value.questionMode))) return false;
  if (!["A", "B", "C", "D"].includes(String(value.examRelevance))) return false;
  if (!["easy", "medium", "hard"].includes(String(value.difficulty))) return false;
  if (!["neutral", "weak", "confusion", "strength"].includes(String(value.profileSignal))) return false;
  if (!["text", "quiz"].includes(String(value.responseMode))) return false;
  if (!Array.isArray(value.quizOptions) || !Array.isArray(value.quizCorrectOptionIds)) return false;
  if (value.quizOptions.some((item) => typeof item !== "string" || item.trim().length === 0)) return false;
  if (value.quizCorrectOptionIds.some((item) => !Number.isSafeInteger(item))) return false;

  if (value.responseMode === "quiz") {
    const rawItems = Array.isArray(value.quizItems) && value.quizItems.length
      ? value.quizItems
      : [{
        question: value.quizQuestion,
        options: value.quizOptions,
        correctOptionIds: value.quizCorrectOptionIds,
        explanation: value.quizExplanation,
      }];

    if (rawItems.length < 1 || rawItems.length > MAX_QUIZ_BATCH_SIZE) return false;
    const first = rawItems[0] as Record<string, unknown>;
    if (
      first.question !== value.quizQuestion ||
      JSON.stringify(first.options) !== JSON.stringify(value.quizOptions) ||
      JSON.stringify(first.correctOptionIds) !== JSON.stringify(value.quizCorrectOptionIds) ||
      first.explanation !== value.quizExplanation
    ) return false;
    for (const raw of rawItems) {
      if (!isRecord(raw)) return false;
      if (typeof raw.question !== "string" || raw.question.trim().length === 0 || raw.question.length > 300) return false;
      if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 12) return false;
      if (raw.options.some((item) => typeof item !== "string" || item.trim().length === 0)) return false;
      if (!Array.isArray(raw.correctOptionIds) || raw.correctOptionIds.length !== 1 || !Number.isSafeInteger(raw.correctOptionIds[0])) return false;
      if (raw.correctOptionIds[0] < 0 || raw.correctOptionIds[0] >= raw.options.length) return false;
      if (typeof raw.explanation !== "string" || raw.explanation.trim().length === 0 || raw.explanation.length > 200) return false;
    }
    return true;
  }

  return (
    value.quizQuestion === "" &&
    value.quizOptions.length === 0 &&
    value.quizCorrectOptionIds.length === 0 &&
    value.quizExplanation === "" &&
    (!Array.isArray(value.quizItems) || value.quizItems.length === 0)
  );
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

function profileAppliedKey(botConnectionId: string, updateId: number): string { return `profile:applied:${encodeURIComponent(botConnectionId)}:${updateId}`; }
function photoAlbumKey(botConnectionId: string, mediaGroupId: string): string { return `photo-album:${encodeURIComponent(botConnectionId)}:${encodeURIComponent(mediaGroupId)}`; }
function jobKey(botConnectionId: string, updateId: number): string { return `job:${botConnectionId}:${updateId}`; }
function acknowledgementKey(botConnectionId: string, updateId: number): string { return `ack:${botConnectionId}:${updateId}`; }
function legacyJobKey(updateId: number): string { return `job:${updateId}`; }
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
