import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env, QuestionJob } from "../config/env";

const JOB_RETENTION_MS = 48 * 60 * 60 * 1_000;
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const RATE_LIMIT_META_KEY = "meta:rate";

interface RateMeta {
  burstWindowStart: number;
  burstCount: number;
  dayKey: number;
  dayCount: number;
  lastRateNoticeAt: number;
}

type JobState = "pending" | "queued" | "processing" | "done";

interface JobRecord {
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
}

interface BeginResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack" | "enqueue";
  statusMessageId?: number;
  notify?: boolean;
}

interface GenericResponse {
  ok: true;
}

interface ClaimResponse {
  claimed: boolean;
  record?: JobRecord;
}


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
      case "begin":
        return this.json(await this.beginJob(body));
      case "save_ack":
        return this.json(await this.saveAck(body));
      case "mark_queued":
        return this.json(await this.markQueued(body));
      case "claim":
        return this.json(await this.claim(body));
      case "set_answer":
        return this.json(await this.setAnswer(body));
      case "complete":
        return this.json(await this.complete(body));
      default:
        return this.json({ ok: false, error: "unknown_action" }, 400);
    }
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    const jobs = await this.ctx.storage.list<JobRecord>({ prefix: "job:" });

    let remaining = false;

    for (const [key, record] of jobs) {
      if (record.createdAt < cutoff) {
        await this.ctx.storage.delete(key);
      } else {
        remaining = true;
      }
    }

    if (remaining) {
      await this.ctx.storage.setAlarm(Date.now() + JOB_RETENTION_MS);
    }
  }

  private async beginJob(body: Record<string, unknown>): Promise<BeginResponse> {
    const job = parseJob(body);
    const key = jobKey(job.updateId);
    const existing = await this.ctx.storage.get<JobRecord>(key);

    if (existing) {
      if (existing.state === "done" || existing.state === "queued" || existing.state === "processing") {
        return { action: "duplicate", statusMessageId: existing.statusMessageId };
      }

      if (existing.state === "pending" && existing.statusMessageId) {
        return { action: "enqueue", statusMessageId: existing.statusMessageId };
      }

      return { action: "retry_ack" };
    }

    const now = Date.now();
    const rate = await this.getRateMeta(now);
    const dailyLimit = positiveEnv(this.runtimeEnv.DAILY_QUESTION_LIMIT, 100);
    const burstLimit = positiveEnv(this.runtimeEnv.BURST_QUESTION_LIMIT, 5);
    const burstWindowMs = positiveEnv(this.runtimeEnv.BURST_WINDOW_SECONDS, 10) * 1_000;

    let burstWindowStart = rate.burstWindowStart;
    let burstCount = rate.burstCount;

    if (now - burstWindowStart >= burstWindowMs) {
      burstWindowStart = now;
      burstCount = 0;
    }

    const dayKey = Math.floor(now / 86_400_000);
    let dayCount = rate.dayKey === dayKey ? rate.dayCount : 0;

    if (dayCount >= dailyLimit) {
      const shouldNotify = now - rate.lastRateNoticeAt >= burstWindowMs;
      await this.ctx.storage.put<RateMeta>(RATE_LIMIT_META_KEY, {
        burstWindowStart,
        burstCount,
        dayKey,
        dayCount,
        lastRateNoticeAt: shouldNotify ? now : rate.lastRateNoticeAt,
      });
      return { action: "rate_limited", notify: shouldNotify };
    }

    if (burstCount >= burstLimit) {
      const shouldNotify = now - rate.lastRateNoticeAt >= burstWindowMs;
      await this.ctx.storage.put<RateMeta>(RATE_LIMIT_META_KEY, {
        burstWindowStart,
        burstCount,
        dayKey,
        dayCount,
        lastRateNoticeAt: shouldNotify ? now : rate.lastRateNoticeAt,
      });
      return { action: "rate_limited", notify: shouldNotify };
    }

    burstCount += 1;
    dayCount += 1;

    await this.ctx.storage.put<RateMeta>(RATE_LIMIT_META_KEY, {
      burstWindowStart,
      burstCount,
      dayKey,
      dayCount,
      lastRateNoticeAt: rate.lastRateNoticeAt,
    });

    const record: JobRecord = {
      updateId: job.updateId,
      chatId: job.chatId,
      question: job.question,
      messageId: job.messageId,
      requestId: job.requestId,
      createdAt: job.createdAt,
      state: "pending",
    };

    await this.ctx.storage.put(key, record);

    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) {
      await this.ctx.storage.setAlarm(now + JOB_RETENTION_MS);
    }

    return { action: "new" };
  }

  private async saveAck(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const statusMessageId = positiveNumber(body.statusMessageId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);

    if (!record) {
      return { ok: true };
    }

    record.statusMessageId = statusMessageId;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async markQueued(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);

    if (!record) {
      return { ok: true };
    }

    if (record.state !== "done") {
      record.state = "queued";
      await this.ctx.storage.put(key, record);
    }

    return { ok: true };
  }

  private async claim(body: Record<string, unknown>): Promise<ClaimResponse> {
    const updateId = positiveNumber(body.updateId);
    const queueMessageId = String(body.queueMessageId ?? "");
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);

    if (!record) {
      return { claimed: false };
    }

    if (record.state === "done") {
      return { claimed: false };
    }

    const now = Date.now();

    if (
      record.state === "processing" &&
      record.activeQueueMessageId !== queueMessageId &&
      record.processingAt &&
      now - record.processingAt < PROCESSING_LEASE_MS
    ) {
      return { claimed: false };
    }

    record.state = "processing";
    record.activeQueueMessageId = queueMessageId;
    record.processingAt = now;
    await this.ctx.storage.put(key, record);

    return { claimed: true, record };
  }

  private async setAnswer(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const answer = String(body.answer ?? "").trim();
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);

    if (!record) {
      return { ok: true };
    }

    record.answer = answer;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async complete(body: Record<string, unknown>): Promise<GenericResponse> {
    const updateId = positiveNumber(body.updateId);
    const key = jobKey(updateId);
    const record = await this.ctx.storage.get<JobRecord>(key);

    if (!record) {
      return { ok: true };
    }

    record.state = "done";
    record.processingAt = undefined;
    record.activeQueueMessageId = undefined;
    await this.ctx.storage.put(key, record);
    return { ok: true };
  }

  private async getRateMeta(now: number): Promise<RateMeta> {
    const existing = await this.ctx.storage.get<RateMeta>(RATE_LIMIT_META_KEY);
    if (existing) {
      return existing;
    }

    return {
      burstWindowStart: now,
      burstCount: 0,
      dayKey: Math.floor(now / 86_400_000),
      dayCount: 0,
      lastRateNoticeAt: 0,
    };
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

export type { JobRecord, ClaimResponse, BeginResponse };

function parseJob(body: Record<string, unknown>): QuestionJob {
  const job: QuestionJob = {
    version: 1,
    updateId: positiveNumber(body.updateId),
    chatId: positiveOrNegativeNumber(body.chatId),
    question: String(body.question ?? "").trim(),
    messageId: positiveNumber(body.messageId),
    requestId: String(body.requestId ?? ""),
    createdAt: positiveNumber(body.createdAt),
    ...(body.statusMessageId !== undefined
      ? { statusMessageId: positiveNumber(body.statusMessageId) }
      : {}),
  };

  if (!job.question || !job.requestId) {
    throw new Error("Invalid job payload.");
  }

  return job;
}

function jobKey(updateId: number): string {
  return `job:${updateId}`;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive safe integer.");
  }
  return parsed;
}

function positiveOrNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    throw new Error("Expected a safe integer chat ID.");
  }
  return parsed;
}

function positiveEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
