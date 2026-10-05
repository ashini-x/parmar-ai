import type {
  DurableObjectStub,
  ExportedHandler,
  ExecutionContext,
  MessageBatch,
} from "@cloudflare/workers-types";

import { generateGeminiAnswer, GeminiError } from "./ai/gemini";
import type { AnswerPacket, Env, ProfileContext, QuestionJob, StudentProfile } from "./config/env";
import { getConfig } from "./config/env";
import { JobDedupe, buildProfileContext, type ClaimResponse, type JobRecord } from "./core/job-store";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  editTelegramMessage,
  sendTelegramChatAction,
  sendTelegramMessage,
  TelegramError,
} from "./telegram/api";
import { internalServerError, json, methodNotAllowed, notFound } from "./http/response";

const QUEUE_MAX_RETRIES = 10;
const STATUS_TEXT = "✅ Sawal mil gaya. Soch raha hoon... 🤔";
const RATE_LIMIT_TEXT = "Bhai, ek saath bahut saare doubts aa rahe hain. Thoda sa gap do, phir next doubt bhejo. 🙂";
const DAILY_LIMIT_TEXT = "Aaj ke liye tumhara question limit complete ho gaya hai. Kal phir continue kar lena. 🙌";
const FINAL_FAILURE_TEXT = "Bhai, is waqt answer complete nahi ho paaya. Tumhara sawal retry hua hai; same doubt dobara bhejna. 🙏";
const PROFILE_EMPTY_TEXT = "Abhi main tumhare questions se tumhari SSC preparation profile bana raha hoon. Thode aur doubts bhejo, phir main bata paunga ki kis topic par revision priority honi chahiye. 📚";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number; type?: string };
  text?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface BeginJobResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  statusMessageId?: number;
  notify?: boolean;
}

function withRequestId(response: Response, requestId: string): Response {
  return addRequestId(response, requestId);
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) result |= aBytes[i] ^ bBytes[i];
  return result === 0;
}

function getJobStore(env: Env, chatId: number): DurableObjectStub {
  const id = env.JOB_DEDUPE.idFromName(String(chatId));
  return env.JOB_DEDUPE.get(id);
}

async function jobStoreRequest<T>(env: Env, chatId: number, body: Record<string, unknown>): Promise<T> {
  const response = await getJobStore(env, chatId).fetch("https://job-store/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Job store returned HTTP ${response.status}.`);
  return (await response.json()) as T;
}

async function handleTelegramWebhook(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return withRequestId(json({ ok: false, error: "telegram_not_configured" }, 500), requestId);
  }

  const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!receivedSecret || !safeEqual(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    logger.warn("telegram_webhook_unauthorized", { requestId });
    return withRequestId(json({ ok: false, error: "UNAUTHORIZED" }, 401), requestId);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return withRequestId(json({ ok: false, error: "INVALID_JSON" }, 400), requestId);
  }

  const updateId = update.update_id;
  const message = update.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const chatType = message?.chat?.type;

  if (!isSafeInteger(updateId) || !isSafeInteger(chatId) || !isSafeInteger(messageId)) {
    return withRequestId(json({ ok: true }), requestId);
  }

  const text = message?.text?.trim() ?? "";
  if (chatType && chatType !== "private") {
    await bestEffortTelegram("group_scope", () =>
      sendTelegramMessage(env, chatId, "Parmar AI abhi private chat mein SSC doubts ke liye optimized hai. Mujhe DM karke doubt bhejo. 📚", messageId),
    );
    return withRequestId(json({ ok: true, rejected: "private_chat_only" }), requestId);
  }

  const maxQuestionLength = positiveIntEnv(env.MAX_QUESTION_LENGTH, 4_000);

  if (text.length > maxQuestionLength) {
    await bestEffortTelegram("too_long", () =>
      sendTelegramMessage(env, chatId, `Question thoda chhota bhejo. Maximum ${maxQuestionLength} characters hain. 🙂`, messageId),
    );
    return withRequestId(json({ ok: true, rejected: "question_too_long" }), requestId);
  }

  logger.info("telegram_message_received", {
    requestId,
    updateId,
    chatId: String(chatId),
    textLength: text.length,
  });

  if (!text) {
    await bestEffortTelegram("non_text", () =>
      sendTelegramMessage(env, chatId, "Abhi main text SSC GA/GS doubts handle kar raha hoon. 📚", messageId),
    );
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isStart(text)) {
    await bestEffortTelegram("start", () => sendTelegramMessage(env, chatId, buildStartText()));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isHelp(text)) {
    await bestEffortTelegram("help", () => sendTelegramMessage(env, chatId, buildHelpText()));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isReset(text)) {
    await jobStoreRequest(env, chatId, { action: "reset_profile" });
    await bestEffortTelegram("reset", () => sendTelegramMessage(env, chatId, "Theek hai. Tumhari Parmar SSC study profile reset kar di. Ab fresh tracking se shuru karte hain. 📚"));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (/^\/exam$/i.test(text)) {
    await bestEffortTelegram("exam_help", () => sendTelegramMessage(env, chatId, "Target exam choose karo:\n/exam cgl\n/exam chsl\n/exam cpo\n/exam mts\n/exam gd\n/exam steno", messageId));
    return withRequestId(json({ ok: true }), requestId);
  }

  const examCommand = parseExamCommand(text);
  if (examCommand) {
    await jobStoreRequest(env, chatId, { action: "set_exam", exam: examCommand });
    await bestEffortTelegram("exam_set", () => sendTelegramMessage(env, chatId, `Target exam set: ${examCommand}. Ab mere answers aur revision priorities isi SSC target ko dhyan mein rakhenge. 🎯`));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isProfileCommand(text)) {
    const profile = await getStudentProfile(env, chatId);
    await bestEffortTelegram("profile", () => sendTelegramMessage(env, chatId, buildProfileText(profile)));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isStudyPlanQuery(text)) {
    const profile = await getStudentProfile(env, chatId);
    await bestEffortTelegram("study_plan", () => sendTelegramMessage(env, chatId, buildStudyPlanText(profile), messageId));
    return withRequestId(json({ ok: true }), requestId);
  }

  const begin = await jobStoreRequest<BeginJobResponse>(env, chatId, {
    action: "begin",
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
  });

  if (begin.action === "duplicate") {
    return withRequestId(json({ ok: true, duplicate: true }), requestId);
  }

  if (begin.action === "rate_limited") {
    if (begin.notify) {
      await bestEffortTelegram("rate_limit", () => sendTelegramMessage(env, chatId, RATE_LIMIT_TEXT, messageId));
    }
    return withRequestId(json({ ok: true, rateLimited: true }), requestId);
  }

  let statusMessageId = begin.statusMessageId;
  if (!statusMessageId) {
    try {
      const status = await sendTelegramMessage(env, chatId, STATUS_TEXT, messageId);
      statusMessageId = status.message_id;
      await jobStoreRequest(env, chatId, { action: "save_ack", updateId, statusMessageId });
    } catch (error) {
      // Do not enqueue a job that the user was not acknowledged for. Telegram will retry
      // the webhook while this update remains pending, and the Durable Object preserves state.
      logger.error("telegram_ack_failed", {
        requestId,
        updateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(json({ ok: false }, 500), requestId);
    }
  }

  void sendTelegramChatAction(env, chatId, "typing").catch((error) => {
    logger.warn("telegram_initial_typing_failed", {
      requestId,
      updateId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const job: QuestionJob = {
    version: 2,
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
    statusMessageId,
  };

  try {
    await env.QUESTION_QUEUE.send(job, { contentType: "json" });
  } catch (error) {
    logger.error("question_queue_enqueue_failed", {
      requestId,
      updateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return withRequestId(json({ ok: false }, 500), requestId);
  }

  // The state remains pending until the Queue consumer claims it. If the Worker dies
  // between the Queue send and a state update, the durable job is still present and the
  // Queue message itself is durable. Claim is idempotent.
  return withRequestId(json({ ok: true, queued: true }), requestId);
}

async function handleQuestionBatch(batch: MessageBatch<QuestionJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    if (!isValidQuestionJob(job)) {
      logger.error("invalid_question_job", { queueMessageId: message.id });
      message.ack();
      continue;
    }

    const claim = await jobStoreRequest<ClaimResponse>(env, job.chatId, {
      action: "claim",
      updateId: job.updateId,
      queueMessageId: message.id,
    });

    if (!claim.claimed || !claim.record) {
      if (claim.wait) {
        message.retry({ delaySeconds: claim.retryAfterSeconds ?? 5 });
      } else {
        message.ack();
      }
      continue;
    }

    try {
      const profile = await getStudentProfile(env, job.chatId);
      let packet = claim.record.answerPacket;

      if (!packet) {
        packet = await generateGeminiAnswer(env, job.question, buildProfileContext(profile));
        await jobStoreRequest(env, job.chatId, {
          action: "set_answer_packet",
          updateId: job.updateId,
          packet,
        });
      }

      if (!claim.record.profileUpdated) {
        await jobStoreRequest(env, job.chatId, {
          action: "update_profile",
          updateId: job.updateId,
          topic: packet.topic,
          subject: packet.subject,
          profileSignal: packet.profileSignal,
          nextRevisionTopic: packet.nextRevisionTopic,
          detectedExam: packet.detectedExam ?? "",
          answerScope: packet.answerScope,
        });
        await jobStoreRequest(env, job.chatId, {
          action: "mark_profile_updated",
          updateId: job.updateId,
        });
      }

      await deliverAnswer(env, job, claim.record.statusMessageId, buildAnswerForStudent(packet, profile));
      await jobStoreRequest(env, job.chatId, { action: "complete", updateId: job.updateId });

      logger.info("question_completed", {
        requestId: job.requestId,
        updateId: job.updateId,
        queueMessageId: message.id,
        answerLength: packet.answer.length,
        attempts: message.attempts,
      });
      message.ack();
    } catch (error) {
      const retryable = isRetryableJobError(error);
      logger.error("question_processing_failed", {
        requestId: job.requestId,
        updateId: job.updateId,
        queueMessageId: message.id,
        attempts: message.attempts,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      });

      if (retryable && message.attempts < QUEUE_MAX_RETRIES) {
        message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
        continue;
      }

      try {
        await deliverAnswer(env, job, claim.record.statusMessageId, userFacingFailure(error));
        await jobStoreRequest(env, job.chatId, { action: "complete", updateId: job.updateId });
        message.ack();
      } catch (deliveryError) {
        logger.error("final_failure_delivery_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
        });
        message.retry({ delaySeconds: Math.min(300, queueRetryDelay(message.attempts)) });
      }
    }
  }
}

function buildAnswerForStudent(packet: AnswerPacket, profile: StudentProfile): string {
  let answer = packet.answer.trim();

  // Make the personalization visible only when it is genuinely helpful.
  const isRepeatedArea = packet.topic && profile.recentTopics.some((topic) => topic.toLowerCase() === packet.topic.toLowerCase());
  const isAttentionArea = profile.attentionTopics.some((topic) => topic.toLowerCase() === packet.topic.toLowerCase());

  if (isAttentionArea && packet.profileSignal !== "neutral" && packet.answerScope !== "out_of_scope") {
    answer += `\n\n🎯 Tumhare liye focus: ${packet.nextRevisionTopic || packet.topic} ko ek baar aur revise kar lena.`;
  } else if (isRepeatedArea && packet.questionMode === "comparison") {
    answer += "\n\n🧠 Isko pichhle related topic ke saath pair mein yaad rakho—SSC mein confusion yahin hota hai.";
  }

  return answer.slice(0, 3_900);
}

async function deliverAnswer(env: Env, job: QuestionJob, statusMessageId: number | undefined, answer: string): Promise<void> {
  if (statusMessageId) {
    try {
      await editTelegramMessage(env, job.chatId, statusMessageId, answer);
      return;
    } catch (error) {
      if (!isMessageEditTerminalError(error)) throw error;
    }
  }
  await sendTelegramMessage(env, job.chatId, answer, job.messageId);
}

async function getStudentProfile(env: Env, chatId: number): Promise<StudentProfile> {
  const response = await jobStoreRequest<{ ok: true; profile: StudentProfile }>(env, chatId, { action: "get_profile" });
  return response.profile;
}

function buildStartText(): string {
  return [
    "So Hello Everyone, umeed karta hoon aap sabhi thik honge!",
    "",
    "Parmar AI abhi SSC-focused study companion hai—especially GA/GS, History, Polity, Geography, Economy, Science, Static GK aur exam-oriented factual doubts ke liye. 📚",
    "",
    "Doubt bhejo. Main sirf answer nahi dunga; zarurat padne par bataunga ki SSC ke liye kya yaad rakhna hai aur kya next revise karna useful hoga.",
    "",
    "/exam cgl — target exam set karo",
    "/profile — tumhari study profile",
    "/help — commands",
  ].join("\n");
}

function buildHelpText(): string {
  return [
    "Parmar AI — SSC-focused commands",
    "",
    "/exam cgl — target exam set",
    "/profile — recent topics, attention areas aur revision queue",
    "/reset — study profile reset",
    "/help — ye help",
    "",
    "Normal SSC GA/GS doubt seedha bhejo.",
  ].join("\n");
}

function buildProfileText(profile: StudentProfile): string {
  if (profile.questionCount === 0) return PROFILE_EMPTY_TEXT;

  const recent = profile.recentTopics.slice(0, 5);
  const attention = profile.attentionTopics.slice(0, 5);
  const revision = profile.revisionQueue.slice(0, 5);

  return [
    "📚 Tumhari Parmar SSC Profile",
    `Target: ${profile.targetExam}`,
    `Questions tracked: ${profile.questionCount}`,
    "",
    `Recent focus: ${recent.length ? recent.join(" • ") : "abhi nahi"}`,
    `Attention areas: ${attention.length ? attention.join(" • ") : "abhi koi clear weak area nahi"}`,
    `Revision queue: ${revision.length ? revision.join(" → ") : "abhi build ho rahi hai"}`,
    "",
    "Ye profile sirf tumhare Parmar AI questions se banti hai.",
  ].join("\n");
}

function buildStudyPlanText(profile: StudentProfile): string {
  if (profile.questionCount === 0) return PROFILE_EMPTY_TEXT;

  const priorities = dedupe([
    ...profile.attentionTopics.slice(0, 3),
    ...profile.revisionQueue.slice(0, 3),
    ...profile.recentTopics.slice(0, 2),
  ]).slice(0, 5);

  if (!priorities.length) return "Abhi enough signals nahi bane hain. Kuch aur SSC doubts bhejo; main tumhari preparation ke pattern se priority list build karunga. 📚";

  return [
    "🎯 SSC ke liye abhi ye padhna sabse useful rahega:",
    ...priorities.map((topic, index) => `${index + 1}. ${topic}`),
    "",
    "Reason: Parmar AI tumhare recent doubts aur repeated attention areas ko priority de raha hai—random syllabus dump nahi.",
  ].join("\n");
}

function isStart(text: string): boolean { return /^\/start(?:\s|$)/i.test(text); }
function isHelp(text: string): boolean { return /^\/(?:help|commands)(?:\s|$)/i.test(text); }
function isReset(text: string): boolean { return /^\/(?:reset|forget)$/i.test(text); }
function isProfileCommand(text: string): boolean { return /^\/(?:profile|progress|me)$/i.test(text); }
function isStudyPlanQuery(text: string): boolean {
  const q = text.toLowerCase();
  return ["what should i study", "what should i read", "what to study", "next kya padhu", "kya padhna chahiye", "kya padhu", "mera weak", "weak topic", "revision", "revision priority", "study priority"].some((marker) => q.includes(marker));
}

function parseExamCommand(text: string): string | null {
  const match = text.match(/^\/exam\s+(.+)$/i);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();
  const map: Record<string, string> = {
    cgl: "SSC CGL",
    chsl: "SSC CHSL",
    cpo: "SSC CPO",
    mts: "SSC MTS",
    gd: "SSC GD",
    steno: "SSC Stenographer",
    stenographer: "SSC Stenographer",
    je: "SSC JE",
    jht: "SSC JHT",
    "selection post": "SSC Selection Post",
  };
  return map[raw] ?? (raw.startsWith("ssc ") ? titleCaseExam(raw) : `SSC ${titleCaseExam(raw)}`);
}

function titleCaseExam(value: string): string {
  return value.split(/\s+/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function buildSetupCommands() {
  return [
    { command: "start", description: "Start Parmar AI" },
    { command: "exam", description: "Set your SSC target exam" },
    { command: "profile", description: "View your SSC study profile" },
    { command: "reset", description: "Reset your study profile" },
    { command: "help", description: "Show help" },
  ];
}

async function telegramSetup(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_SETUP_SECRET) {
    return withRequestId(json({ ok: false, error: "telegram_configuration_missing" }, 500), requestId);
  }
  const url = new URL(request.url);
  const supplied = url.searchParams.get("key");
  if (!supplied || !safeEqual(supplied, env.TELEGRAM_SETUP_SECRET)) {
    return withRequestId(json({ ok: false, error: "unauthorized" }, 401), requestId);
  }

  const webhookUrl = `${url.origin}/telegram/webhook`;
  const webhookResult = await telegramSetupMethod(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
    max_connections: 100,
  });

  const commandsResult = await telegramSetupMethod(env, "setMyCommands", {
    commands: buildSetupCommands(),
  });

  logger.info("telegram_webhook_setup", { requestId, webhookUrl });
  return withRequestId(json({ ok: true, webhook: webhookUrl, webhookResult, commandsResult }), requestId);
}

async function telegramSetupMethod(env: Env, method: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new TelegramError("Telegram bot token is not configured.");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data: { ok: boolean; result?: unknown; description?: string };
  try { data = JSON.parse(raw) as { ok: boolean; result?: unknown; description?: string }; }
  catch { throw new TelegramError(`Telegram returned invalid JSON (HTTP ${response.status}).`, response.status); }
  if (!response.ok || !data.ok) throw new TelegramError(data.description ?? `Telegram request failed (HTTP ${response.status}).`, response.status, response.status >= 500 || response.status === 429);
  return data.result;
}

function buildHealth(env: Env) {
  const config = getConfig(env);
  return {
    ok: true,
    service: "parmar-ai",
    phase: "E",
    environment: config.environment,
    version: config.version,
    telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET),
    vertexAiConfigured: Boolean(env.GCP_PROJECT_ID && env.GCP_CLIENT_EMAIL && env.GCP_PRIVATE_KEY),
    queueConfigured: Boolean(env.QUESTION_QUEUE),
    jobStoreConfigured: Boolean(env.JOB_DEDUPE),
    model: config.model,
    location: config.location,
    thinkingPolicy: `ADAPTIVE (max ${config.maxThinkingLevel})`,
    sscScope: "SSC GA/GS + exam-focused factual preparation",
    studentProfile: true,
  };
}

async function bestEffortTelegram<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); }
  catch (error) {
    logger.warn(`telegram_${label}_failed`, { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function isMessageEditTerminalError(error: unknown): boolean {
  if (!(error instanceof TelegramError)) return false;
  const message = error.message.toLowerCase();
  return error.status === 400 && (
    message.includes("message to edit not found") ||
    message.includes("message can't be edited") ||
    message.includes("message identifier is not specified")
  );
}

function userFacingFailure(error: unknown): string {
  if (error instanceof GeminiError) {
    if (error.status === 401 || error.status === 403) return "AI service ki authentication/configuration mein problem aa gayi hai. Team isse check kar rahi hai. 🙏";
    if (error.status === 429) return "AI service par abhi bahut load hai. Tumhara doubt save hai; system retry kar raha hai. 🙏";
  }
  return FINAL_FAILURE_TEXT;
}

function isRetryableJobError(error: unknown): boolean {
  if (error instanceof GeminiError) return error.retryable;
  if (error instanceof TelegramError) return error.retryable;
  return true;
}

function queueRetryDelay(attempt: number): number {
  const base = Math.min(300, 15 * 2 ** Math.max(0, attempt - 1));
  return Math.min(300, base + Math.floor(Math.random() * 7));
}

function isValidQuestionJob(job: unknown): job is QuestionJob {
  if (!job || typeof job !== "object") return false;
  const candidate = job as Record<string, unknown>;
  return ((candidate.version === 1 || candidate.version === 2) && isSafeInteger(candidate.updateId) && isSafeInteger(candidate.chatId) && isSafeInteger(candidate.messageId) && typeof candidate.question === "string" && candidate.question.trim().length > 0 && typeof candidate.requestId === "string");
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function positiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

const worker: ExportedHandler<Env, QuestionJob> = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return withRequestId(json(buildHealth(env)), requestId);
      }

      if (url.pathname === "/") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return withRequestId(json({ ok: true, service: "parmar-ai", phase: "E", status: "ssc_queue_vertex_ai" }), requestId);
      }

      if (url.pathname === "/telegram/setup") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return telegramSetup(request, env, requestId);
      }

      if (url.pathname === "/telegram/webhook") {
        if (request.method !== "POST") return withRequestId(methodNotAllowed(["POST"]), requestId);
        return handleTelegramWebhook(request, env, requestId);
      }

      return withRequestId(notFound(), requestId);
    } catch (error) {
      logger.error("unhandled_request_error", {
        requestId,
        route: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(internalServerError(), requestId);
    }
  },

  async queue(batch: MessageBatch<QuestionJob>, env: Env): Promise<void> {
    await handleQuestionBatch(batch, env);
  },
};

export default worker;
export { JobDedupe };
