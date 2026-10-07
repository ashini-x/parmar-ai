import type {
  DurableObjectStub,
   ExecutionContext,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";

import { generateGeminiAnswer, GeminiError, isLikelyMcqTopicReply, isMcqRequest, parseRequestedMcqCount } from "./ai/gemini";
import type { AnswerPacket, Env, ProfileContext, QuestionJob, StudentProfile, ConversationTurn, QuizItem } from "./config/env";
import { MAX_QUIZ_BATCH_SIZE } from "./config/env";
import { getConfig } from "./config/env";
import { JobDedupe, buildProfileContext, type ClaimResponse, type JobRecord } from "./core/job-store";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramChatAction,
  sendTelegramMessage,
  sendTelegramQuiz,
  stopTelegramPoll,
  TelegramError,
} from "./telegram/api";
import { internalServerError, json, methodNotAllowed, notFound } from "./http/response";
import { answerQuizSession, createQuizSession, deleteQuizSession, getQuizSession, recordEvent, recordQuestionResult, recordQuestionStart, recordUserSeen, updateUserIdentity, getAnalyticsConfig, cleanupAnalytics, grantUnlimitedAiAccess, revokeUnlimitedAiAccess, isAdminTelegramUser, hasUnlimitedAiAccess, recordAiUsage, isUserSuspended, deleteUserData } from "./analytics/db";
import { adminDashboard, adminOverview, adminUsers, adminUserQuestions, adminUserDetail, adminAiUsage, adminLearning, adminActivity, adminAccess, adminAudit, adminSystem, adminExport, adminAction, adminTelegram } from "./admin/dashboard";
import { clearAdminSession, handleAdminLogin, loginHtml, requireAdmin } from "./admin/auth";
import { LEGACY_TELEGRAM_BOT_CONNECTION_ID, findTelegramBotByWebhookSecret, getActiveTelegramBot, hasTelegramBotRecords, isTelegramBotConnectionActive } from "./telegram/bot-store";

const QUEUE_MAX_RETRIES = 10;
const STATUS_TEXT = "✅ Sawal mil gaya. Soch raha hoon... 🤔";
const RATE_LIMIT_TEXT = "Bhai, ek saath bahut saare doubts aa rahe hain. Thoda sa gap do, phir next doubt bhejo. 🙂";
const DAILY_LIMIT_TEXT = "Aaj ke liye tumhara question limit complete ho gaya hai. Kal phir continue kar lena. 🙌";
const FINAL_FAILURE_TEXT = "Bhai, is waqt answer complete nahi ho paaya. Tumhara sawal retry hua hai; same doubt dobara bhejna. 🙏";
const PROFILE_EMPTY_TEXT = "Abhi main tumhare questions se tumhari SSC preparation profile bana raha hoon. Thode aur doubts bhejo, phir main bata paunga ki kis topic par revision priority honi chahiye. 📚";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number; type?: string };
  from?: { id?: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string };
  text?: string;
}

interface TelegramPollAnswer {
  poll_id?: string;
  user?: { id?: number; is_bot?: boolean };
  option_ids?: number[];
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  poll_answer?: TelegramPollAnswer;
}

interface BeginJobResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  quizCount?: number;
  statusMessageId?: number;
  notify?: boolean;
  rateLimitReason?: "daily" | "burst";
  unlimited?: boolean;
}

function isSameOriginAdminRequest(request: Request, origin: string): boolean {
  const supplied = request.headers.get("Origin");
  if (!supplied) return false;
  return safeEqual(supplied, origin);
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

function buildAnalyticsUser(message: TelegramMessage, chatId: number) {
  const from = message.from;
  return {
    telegramUserId: isSafeInteger(from?.id) ? from!.id! : chatId,
    chatId,
    username: from?.username,
    firstName: from?.first_name,
    lastName: from?.last_name,
    isBot: Boolean(from?.is_bot),
  };
}

function queueAnalytics(ctx: ExecutionContext, label: string, task: () => Promise<void>): void {
  ctx.waitUntil(task().catch((error) => logger.warn(`analytics_${label}_failed`, { error: error instanceof Error ? error.message : String(error) })));
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

async function handleTelegramWebhook(request: Request, env: Env, requestId: string, ctx: ExecutionContext): Promise<Response> {
  const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")?.trim() ?? "";
  if (!receivedSecret) {
    logger.warn("telegram_webhook_unauthorized", { requestId });
    return withRequestId(json({ ok: false, error: "UNAUTHORIZED" }, 401), requestId);
  }

  let bot = await findTelegramBotByWebhookSecret(env, receivedSecret);
  if (!bot) {
    const active = await getActiveTelegramBot(env);
    if (!active && env.TELEGRAM_WEBHOOK_SECRET && safeEqual(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
      bot = {
        connectionId: LEGACY_TELEGRAM_BOT_CONNECTION_ID,
        botId: 0,
        username: null,
        firstName: null,
        token: env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
        webhookSecret: receivedSecret,
        status: "active",
        connectedAt: 0,
        lastVerifiedAt: null,
        disconnectedAt: null,
      };
    }
  }

  if (!bot?.token) {
    logger.warn("telegram_webhook_unauthorized", { requestId });
    return withRequestId(json({ ok: false, error: "UNAUTHORIZED" }, 401), requestId);
  }

  if (bot.status !== "active" || !(await isTelegramBotConnectionActive(env, bot.connectionId))) {
    logger.info("telegram_webhook_from_inactive_bot_ignored", {
      requestId,
      botConnectionId: bot.connectionId,
    });
    return withRequestId(json({ ok: true, ignored: "inactive_bot" }), requestId);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return withRequestId(json({ ok: false, error: "INVALID_JSON" }, 400), requestId);
  }

  if (update.poll_answer) {
    await handleTelegramPollAnswer(update.poll_answer, env, requestId);
    return withRequestId(json({ ok: true, pollAnswer: true }), requestId);
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

  const analyticsUser = buildAnalyticsUser(message!, chatId);
  queueAnalytics(ctx, "user_seen", () => recordUserSeen(env, analyticsUser));

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
    queueAnalytics(ctx, "start", () => recordEvent(env, "start", analyticsUser));
    await bestEffortTelegram("start", () => sendTelegramMessage(env, chatId, buildStartText()));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isHelp(text)) {
    queueAnalytics(ctx, "help", () => recordEvent(env, "help", analyticsUser));
    await bestEffortTelegram("help", () => sendTelegramMessage(env, chatId, buildHelpText()));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (/^\/id$/i.test(text)) {
    queueAnalytics(ctx, "id", () => recordEvent(env, "id_view", analyticsUser));
    await bestEffortTelegram("id", () => sendTelegramMessage(env, chatId, `Tumhara Telegram User ID: ${analyticsUser.telegramUserId}`));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isDeleteMyData(text)) {
    const deletion = await deleteUserData(env, analyticsUser.telegramUserId);
    if (deletion.chatId !== null) {
      const id = env.JOB_DEDUPE.idFromName(String(deletion.chatId));
      await env.JOB_DEDUPE.get(id).fetch("https://job-store/internal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_data" }),
      });
    }
    await bestEffortTelegram("delete_data", () => sendTelegramMessage(env, chatId, "Tumhari Parmar AI ki stored study data aur history delete kar di gayi hai. Ab fresh start hoga. 🗑️"));
    return withRequestId(json({ ok: true, deleted: true }), requestId);
  }

  if (isReset(text)) {
    await jobStoreRequest(env, chatId, { action: "reset_profile" });
    queueAnalytics(ctx, "reset", () => recordEvent(env, "reset", analyticsUser));
    await bestEffortTelegram("reset", () => sendTelegramMessage(env, chatId, "Theek hai. Tumhari Parmar SSC study profile reset kar di. Ab fresh tracking se shuru karte hain. 📚"));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isAdminTelegramUser(env, analyticsUser.telegramUserId)) {
    const grantMatch = text.match(/^\/grant(?:_unlimited)?\s+(\d+)$/i);
    if (grantMatch) {
      const targetId = Number(grantMatch[1]);
      if (!Number.isSafeInteger(targetId) || targetId <= 0) {
        await bestEffortTelegram("admin_grant_invalid", () => sendTelegramMessage(env, chatId, "Valid Telegram User ID bhejo."));
      } else {
        try {
          await grantUnlimitedAiAccess(env, targetId, analyticsUser.telegramUserId);
          await recordEvent(env, "admin_unlimited_ai_granted", analyticsUser, { targetTelegramUserId: targetId });
          await bestEffortTelegram("admin_grant", () => sendTelegramMessage(env, chatId, `✅ Unlimited daily AI access granted to Telegram ID ${targetId}.`));
        } catch (error) {
          logger.error("admin_unlimited_ai_grant_failed", { requestId, targetTelegramUserId: targetId, error: error instanceof Error ? error.message : String(error) });
          await bestEffortTelegram("admin_grant_failed", () => sendTelegramMessage(env, chatId, "Access change nahi ho paaya. D1/admin configuration check karo. 🙏"));
        }
      }
      return withRequestId(json({ ok: true }), requestId);
    }

    const revokeMatch = text.match(/^\/revoke(?:_unlimited)?\s+(\d+)$/i);
    if (revokeMatch) {
      const targetId = Number(revokeMatch[1]);
      if (targetId === analyticsUser.telegramUserId || Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "") === targetId) {
        await bestEffortTelegram("admin_revoke_protected", () => sendTelegramMessage(env, chatId, "Owner/admin access protected hai; ise Telegram command se revoke nahi kiya ja sakta."));
      } else {
        try {
          await revokeUnlimitedAiAccess(env, targetId);
          await recordEvent(env, "admin_unlimited_ai_revoked", analyticsUser, { targetTelegramUserId: targetId });
          await bestEffortTelegram("admin_revoke", () => sendTelegramMessage(env, chatId, `✅ Unlimited daily AI access revoked for Telegram ID ${targetId}.`));
        } catch (error) {
          logger.error("admin_unlimited_ai_revoke_failed", { requestId, targetTelegramUserId: targetId, error: error instanceof Error ? error.message : String(error) });
          await bestEffortTelegram("admin_revoke_failed", () => sendTelegramMessage(env, chatId, "Access change nahi ho paaya. D1/admin configuration check karo. 🙏"));
        }
      }
      return withRequestId(json({ ok: true }), requestId);
    }

    const statusMatch = text.match(/^\/unlimited(?:_status)?\s+(\d+)$/i);
    if (statusMatch) {
      const targetId = Number(statusMatch[1]);
      const unlimited = await hasUnlimitedAiAccess(env, targetId);
      await bestEffortTelegram("admin_unlimited_status", () => sendTelegramMessage(env, chatId, unlimited ? `♾️ Telegram ID ${targetId} has unlimited daily AI access.` : `🔒 Telegram ID ${targetId} is on the normal daily limit.`));
      return withRequestId(json({ ok: true }), requestId);
    }
  }

  if (/^\/exam$/i.test(text)) {
    queueAnalytics(ctx, "exam_help", () => recordEvent(env, "exam_help", analyticsUser));
    await bestEffortTelegram("exam_help", () => sendTelegramMessage(env, chatId, "Target exam choose karo:\n/exam cgl\n/exam chsl\n/exam cpo\n/exam mts\n/exam gd\n/exam steno", messageId));
    return withRequestId(json({ ok: true }), requestId);
  }

  const examCommand = parseExamCommand(text);
  if (examCommand) {
    await jobStoreRequest(env, chatId, { action: "set_exam", exam: examCommand });
    queueAnalytics(ctx, "exam_set", () => updateUserIdentity(env, { ...analyticsUser, targetExam: examCommand }).then(() => recordEvent(env, "exam_set", analyticsUser, { exam: examCommand })));
    await bestEffortTelegram("exam_set", () => sendTelegramMessage(env, chatId, `Target exam set: ${examCommand}. Ab mere answers aur revision priorities isi SSC target ko dhyan mein rakhenge. 🎯`));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isProfileCommand(text)) {
    queueAnalytics(ctx, "profile", () => recordEvent(env, "profile_view", analyticsUser));
    const [profile, usage] = await Promise.all([getStudentProfile(env, chatId), getStudentUsage(env, chatId, analyticsUser.telegramUserId)]);
    await bestEffortTelegram("profile", () => sendTelegramMessage(env, chatId, buildProfileText(profile, usage)));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isStudyPlanQuery(text)) {
    queueAnalytics(ctx, "study_plan", () => recordEvent(env, "study_plan", analyticsUser));
    const profile = await getStudentProfile(env, chatId);
    await bestEffortTelegram("study_plan", () => sendTelegramMessage(env, chatId, buildStudyPlanText(profile), messageId));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (await isUserSuspended(env, analyticsUser.telegramUserId)) {
    queueAnalytics(ctx, "suspended_user", () => recordEvent(env, "suspended_user_blocked", analyticsUser));
    await bestEffortTelegram("suspended_user", () => sendTelegramMessage(env, chatId, "Abhi tumhara Parmar AI access temporarily paused hai. Admin se contact karo. 🙏", messageId));
    return withRequestId(json({ ok: true, suspended: true }), requestId);
  }

  const mcqRequest = isMcqRequest(text);
  const parsedQuizCount = mcqRequest ? parseRequestedMcqCount(text) : 1;

  if (mcqRequest && parsedQuizCount > MAX_QUIZ_BATCH_SIZE) {
    await bestEffortTelegram("quiz_batch_too_large", () =>
      sendTelegramMessage(
        env,
        chatId,
        `Ek batch mein maximum ${MAX_QUIZ_BATCH_SIZE} MCQs bhej sakta hoon. 🙂`,
        messageId,
        bot.connectionId,
      ),
    );
    return withRequestId(json({ ok: true, rejected: "quiz_batch_too_large" }), requestId);
  }

  if (mcqRequest) {
    await jobStoreRequest(env, chatId, { action: "clear_pending_quiz" }).catch(() => undefined);
  }

  let quizContinuationCount = 0;
  if (!mcqRequest && isLikelyMcqTopicReply(text)) {
    const pending = await jobStoreRequest<{ ok: true; count: number }>(
      env,
      chatId,
      { action: "consume_pending_quiz" },
    ).catch(() => ({ ok: true, count: 0 }));
    quizContinuationCount = pending.count;
  } else if (!mcqRequest) {
    await jobStoreRequest(env, chatId, { action: "clear_pending_quiz" }).catch(() => undefined);
  }

  const effectiveQuizCount = quizContinuationCount || parsedQuizCount;
  const begin = await jobStoreRequest<BeginJobResponse>(env, chatId, {
    action: "begin",
    botConnectionId: bot.connectionId,
    telegramUserId: analyticsUser.telegramUserId,
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
    requestedQuizCount: effectiveQuizCount,
    quizContinuation: quizContinuationCount > 0,
  });

  if (begin.action === "duplicate") {
    return withRequestId(json({ ok: true, duplicate: true }), requestId);
  }

  if (begin.action === "retry_ack") {
    const retryJob: QuestionJob = {
      version: 2,
      botConnectionId: bot.connectionId,
      updateId,
      chatId,
      question: text,
      messageId,
      requestId,
      createdAt: Date.now(),
      statusMessageId: begin.statusMessageId,
      telegramUserId: analyticsUser.telegramUserId,
      quizCount: begin.quizCount,
    };
    try {
      await env.QUESTION_QUEUE.send(retryJob, { contentType: "json" });
      await jobStoreRequest(env, chatId, { action: "mark_queued", botConnectionId: bot.connectionId, updateId });
      queueAnalytics(ctx, "question_retry_ack", () => recordQuestionStart(env, {
        updateId, botConnectionId: bot.connectionId, requestId, user: analyticsUser, messageId, question: text, receivedAt: Date.now(),
      }));
    } catch (error) {
      logger.error("question_queue_retry_enqueue_failed", {
        requestId,
        updateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(json({ ok: false }, 500), requestId);
    }
    void sendTelegramChatAction(env, chatId, "typing", bot.connectionId).catch(() => undefined);
    return withRequestId(json({ ok: true, queued: true, recovered: true }), requestId);
  }

  if (begin.action === "rate_limited") {
    if (begin.notify) {
      const isDailyLimit = begin.rateLimitReason === "daily";
      queueAnalytics(ctx, "rate_limit", () =>
        recordEvent(env, isDailyLimit ? "daily_limit_reached" : "burst_limit_reached", analyticsUser, { updateId }),
      );
      await bestEffortTelegram(
        "rate_limit",
        () => sendTelegramMessage(env, chatId, isDailyLimit ? DAILY_LIMIT_TEXT : RATE_LIMIT_TEXT, messageId),
      );
    }
    return withRequestId(json({ ok: true, rateLimited: true, rateLimitReason: begin.rateLimitReason }), requestId);
  }

  let statusMessageId = begin.statusMessageId;
  if (!statusMessageId) {
    try {
      const status = await sendTelegramMessage(env, chatId, STATUS_TEXT, messageId, bot.connectionId);
      statusMessageId = status.message_id;
      await jobStoreRequest(env, chatId, { action: "save_ack", botConnectionId: bot.connectionId, updateId, statusMessageId });
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

  void sendTelegramChatAction(env, chatId, "typing", bot.connectionId).catch((error) => {
    logger.warn("telegram_initial_typing_failed", {
      requestId,
      updateId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const job: QuestionJob = {
    version: 2,
    botConnectionId: bot.connectionId,
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
    statusMessageId,
    telegramUserId: analyticsUser.telegramUserId,
    quizCount: effectiveQuizCount,
  };

  try {
    await env.QUESTION_QUEUE.send(job, { contentType: "json" });
    await jobStoreRequest(env, chatId, { action: "mark_queued", botConnectionId: bot.connectionId, updateId });
    queueAnalytics(ctx, "question_start", () => recordQuestionStart(env, {
      updateId,
      botConnectionId: bot.connectionId,
      requestId,
      user: analyticsUser,
      messageId,
      question: text,
      receivedAt: Date.now(),
    }));
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

async function handleQuestionBatch(batch: MessageBatch<QuestionJob>, env: Env, ctx: ExecutionContext): Promise<void> {
  for (const message of batch.messages) {
    const rawJob = message.body;
    const job = {
      ...rawJob,
      botConnectionId: rawJob.botConnectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
    };
    if (!isValidQuestionJob(job)) {
      logger.error("invalid_question_job", { queueMessageId: message.id });
      message.ack();
      continue;
    }

    if (!(await isTelegramBotConnectionActive(env, job.botConnectionId))) {
      ctx.waitUntil(recordQuestionResult(env, {
        updateId: job.updateId,
        botConnectionId: job.botConnectionId,
        status: "cancelled",
        completedAt: Date.now(),
        attempts: message.attempts,
        errorMessage: "telegram_bot_disconnected",
      }).catch(() => undefined));
      message.ack();
      continue;
    }

    const claim = await jobStoreRequest<ClaimResponse>(env, job.chatId, {
      action: "claim",
      botConnectionId: job.botConnectionId,
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

    if (!(await isTelegramBotConnectionActive(env, job.botConnectionId))) {
      message.ack();
      continue;
    }

    const stopTypingHeartbeat = startTypingHeartbeat(env, job.chatId, job.requestId, job.botConnectionId);
    try {
      const startedAt = Date.now();
      const jobTelegramUserId = job.telegramUserId ?? job.chatId;
      ctx.waitUntil(recordUserSeen(env, { telegramUserId: jobTelegramUserId, chatId: job.chatId }));
      await recordQuestionStart(env, {
        updateId: job.updateId,
        botConnectionId: job.botConnectionId,
        requestId: job.requestId,
        user: { telegramUserId: jobTelegramUserId, chatId: job.chatId },
        messageId: job.messageId,
        question: job.question,
        receivedAt: job.createdAt,
      });
      await recordQuestionResult(env, { updateId: job.updateId, botConnectionId: job.botConnectionId, status: "processing", startedAt });
      let profile: StudentProfile;
      try {
        profile = await getStudentProfile(env, job.chatId);
      } catch (profileReadError) {
        logger.error("student_profile_read_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error: profileReadError instanceof Error ? profileReadError.message : String(profileReadError),
        });
        profile = {
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
      }

      let recentConversation: ConversationTurn[] = [];
      try {
        const conversationResult = await jobStoreRequest<{ ok: true; recentConversation: ConversationTurn[] }>(env, job.chatId, {
          action: "get_conversation",
          botConnectionId: job.botConnectionId,
          updateId: job.updateId,
        });
        recentConversation = Array.isArray(conversationResult.recentConversation) ? conversationResult.recentConversation : [];
      } catch (conversationError) {
        logger.warn("student_conversation_read_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error: conversationError instanceof Error ? conversationError.message : String(conversationError),
        });
      }

      let packet = claim.record.answerPacket;

      if (!packet) {
        const generation = await generateGeminiAnswer(
          env,
          job.question,
          buildProfileContext(profile, recentConversation),
        );
        packet = generation.packet;
        if (packet.questionMode === "mcq" && packet.responseMode === "text" && !(packet.quizItems?.length)) {
          await jobStoreRequest(env, job.chatId, {
            action: "set_pending_quiz",
            count: job.quizCount ?? 1,
          }).catch((error) => {
            logger.warn("pending_quiz_store_failed", {
              requestId: job.requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
        ctx.waitUntil(recordAiUsage(env, {
          updateId: job.updateId,
          botConnectionId: job.botConnectionId,
          requestId: job.requestId,
          queueAttempt: message.attempts,
          telegramUserId: jobTelegramUserId,
          chatId: job.chatId,
          usage: generation.usage,
        }).catch((usageError) => logger.warn("analytics_ai_usage_failed", { error: usageError instanceof Error ? usageError.message : String(usageError) })));
        const packetWrite = await jobStoreRequest<{ ok: true; stale?: boolean }>(env, job.chatId, {
          action: "set_answer_packet",
          botConnectionId: job.botConnectionId,
          updateId: job.updateId,
          queueMessageId: message.id,
          leaseVersion: claim.leaseVersion,
          packet,
        });
        if (packetWrite.stale) {
          message.ack();
          continue;
        }
      }

      let latestProfile = profile;
      if (!claim.record.profileUpdated) {
        try {
          const profileWrite = await jobStoreRequest<{ ok: true; stale?: boolean }>(env, job.chatId, {
            action: "update_profile",
            botConnectionId: job.botConnectionId,
            updateId: job.updateId,
            queueMessageId: message.id,
            leaseVersion: claim.leaseVersion,
            question: job.question,
            topic: packet.topic,
            subject: packet.subject,
            profileSignal: packet.profileSignal,
            nextRevisionTopic: packet.nextRevisionTopic,
            detectedExam: packet.detectedExam ?? "",
            answerScope: packet.answerScope,
            questionMode: packet.questionMode,
          });
          if (profileWrite.stale) {
            message.ack();
            continue;
          }
          const profileMark = await jobStoreRequest<{ ok: true; stale?: boolean }>(env, job.chatId, {
            action: "mark_profile_updated",
            botConnectionId: job.botConnectionId,
            updateId: job.updateId,
            queueMessageId: message.id,
            leaseVersion: claim.leaseVersion,
          });
          if (profileMark.stale) {
            message.ack();
            continue;
          }
          latestProfile = await getStudentProfile(env, job.chatId);
          if (packet.profileSignal === "confusion" || packet.profileSignal === "weak") {
            ctx.waitUntil(recordEvent(env, "learning_signal_detected", { telegramUserId: jobTelegramUserId, chatId: job.chatId }, {
              topic: packet.topic,
              profileSignal: packet.profileSignal,
              nextRevisionTopic: packet.nextRevisionTopic || packet.topic,
              updateId: job.updateId,
            }));
          }
        } catch (profileError) {
          logger.error("student_profile_update_failed", {
            requestId: job.requestId,
            updateId: job.updateId,
            error: profileError instanceof Error ? profileError.message : String(profileError),
          });
          // Profile intelligence must never prevent a valid answer from reaching the student.
        }
      }

      if (!(await isTelegramBotConnectionActive(env, job.botConnectionId))) {
        await completeCancelledJob(env, job, message.id, claim.leaseVersion);
        message.ack();
        continue;
      }
      let statusMessageHandled = false;
      let questionDeliveryFailed = false;
      if (packet.responseMode === "quiz") {
        const quizItems = getQuizItems(packet);
        const expectedQuizCount = job.quizCount ?? 1;

        if (quizItems.length !== expectedQuizCount) {
          throw new GeminiError(
            `Quiz batch size mismatch: expected ${expectedQuizCount}, received ${quizItems.length}.`,
            undefined,
            true,
          );
        }

        const deliveredQuizzes: Array<{ pollId: string; messageId: number }> = [];

        try {
          for (const item of quizItems) {
            const quiz = await sendTelegramQuiz(
              env,
              job.chatId,
              item.question,
              item.options,
              item.correctOptionIds,
              item.explanation,
              job.messageId,
              job.botConnectionId,
            );

            deliveredQuizzes.push({
              pollId: quiz.poll_id,
              messageId: quiz.message_id,
            });

            await createQuizSession(env, {
              pollId: quiz.poll_id,
              botConnectionId: job.botConnectionId,
              telegramUserId: jobTelegramUserId,
              chatId: job.chatId,
              updateId: job.updateId,
              messageId: quiz.message_id,
              questionText: item.question,
              options: item.options,
              correctOptionIds: item.correctOptionIds,
              explanation: item.explanation,
              topic: packet.topic,
              subject: packet.subject,
              difficulty: packet.difficulty,
            });
          }
        } catch (quizDeliveryError) {
          questionDeliveryFailed = true;

          logger.error("quiz_batch_delivery_failed", {
            requestId: job.requestId,
            updateId: job.updateId,
            quizCount: quizItems.length,
            deliveredCount: deliveredQuizzes.length,
            error: quizDeliveryError instanceof Error ? quizDeliveryError.message : String(quizDeliveryError),
          });

          for (const delivered of deliveredQuizzes.reverse()) {
            await deleteTelegramMessage(
              env,
              job.chatId,
              delivered.messageId,
              job.botConnectionId,
            ).catch(async () => {
              await stopTelegramPoll(
                env,
                job.chatId,
                delivered.messageId,
                job.botConnectionId,
              ).catch(() => undefined);
            });
            await deleteQuizSession(env, delivered.pollId).catch(() => undefined);
          }

          await deliverAnswer(
            env,
            job,
            claim.record.statusMessageId,
            buildQuizDeliveryFailureAnswer(),
          );
          statusMessageHandled = true;
        }

        if (!statusMessageHandled && claim.record.statusMessageId) {
          await deleteTelegramMessage(
            env,
            job.chatId,
            claim.record.statusMessageId,
            job.botConnectionId,
          ).catch(() => undefined);
        }
      } else {
        await deliverAnswer(
          env,
          job,
          claim.record.statusMessageId,
          buildAnswerForStudent(packet, latestProfile),
        );
        statusMessageHandled = true;
      }
      const completion = await jobStoreRequest<{ ok: true; stale?: boolean }>(env, job.chatId, {
        action: "complete",
        botConnectionId: job.botConnectionId,
        updateId: job.updateId,
        queueMessageId: message.id,
        leaseVersion: claim.leaseVersion,
      });
      if (completion.stale) {
        message.ack();
        continue;
      }
      const completedAt = Date.now();
      ctx.waitUntil(recordQuestionResult(env, {
        updateId: job.updateId,
        botConnectionId: job.botConnectionId,
        status: questionDeliveryFailed
          ? "delivery_failed"
          : (packet.answerScope === "out_of_scope" ? "out_of_scope" : "completed"),
        startedAt,
        completedAt,
        latencyMs: completedAt - job.createdAt,
        attempts: message.attempts,
        packet,
        thinkingLevel: packet.thinkingLevelUsed,
        grounded: packet.grounded,
      }).catch((error) => logger.warn("analytics_question_result_failed", { error: error instanceof Error ? error.message : String(error) })));

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
      if (error instanceof GeminiError && error.usageRecords.length) {
        ctx.waitUntil(recordAiUsage(env, {
          updateId: job.updateId,
          botConnectionId: job.botConnectionId,
          requestId: job.requestId,
          queueAttempt: message.attempts,
          telegramUserId: job.telegramUserId ?? job.chatId,
          chatId: job.chatId,
          usage: error.usageRecords,
        }).catch((usageError) => logger.warn("analytics_failed_ai_usage_failed", { error: usageError instanceof Error ? usageError.message : String(usageError) })));
      }

      if (retryable && message.attempts < QUEUE_MAX_RETRIES) {
        message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
        continue;
      }

      try {
        if (!(await isTelegramBotConnectionActive(env, job.botConnectionId))) {
          await completeCancelledJob(env, job, message.id, claim.leaseVersion);
          message.ack();
          continue;
        }
        await deliverAnswer(env, job, claim.record.statusMessageId, userFacingFailure(error));
        const completion = await jobStoreRequest<{ ok: true; stale?: boolean }>(env, job.chatId, {
          action: "complete",
          botConnectionId: job.botConnectionId,
          updateId: job.updateId,
          queueMessageId: message.id,
          leaseVersion: claim.leaseVersion,
        });
        if (completion.stale) {
          message.ack();
          continue;
        }
        ctx.waitUntil(recordQuestionResult(env, {
          updateId: job.updateId,
          botConnectionId: job.botConnectionId,
          status: "failed",
          completedAt: Date.now(),
          attempts: message.attempts,
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch((analyticsError) => logger.warn("analytics_question_failure_failed", { error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError) })));
        message.ack();
      } catch (deliveryError) {
        logger.error("final_failure_delivery_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
        });
        message.retry({ delaySeconds: Math.min(300, queueRetryDelay(message.attempts)) });
      }
    } finally {
      stopTypingHeartbeat();
    }
  }
}

async function handleTelegramPollAnswer(
  pollAnswer: TelegramPollAnswer,
  env: Env,
  requestId: string,
): Promise<void> {
  const pollId = pollAnswer.poll_id?.trim() ?? "";
  const telegramUserId = pollAnswer.user?.id;
  const selectedOptionIds = Array.isArray(pollAnswer.option_ids)
    ? pollAnswer.option_ids.filter((id): id is number => Number.isSafeInteger(id) && id >= 0 && id <= 11)
    : [];

  if (!pollId || !isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    logger.warn("telegram_quiz_answer_invalid", { requestId, pollId });
    return;
  }

  const session = await getQuizSession(env, pollId);
  if (!session) {
    logger.info("telegram_quiz_answer_unmatched", { requestId, pollId });
    return;
  }

  if (session.telegramUserId !== telegramUserId) {
    logger.warn("telegram_quiz_answer_wrong_user", { requestId, pollId, telegramUserId });
    return;
  }

  const answered = await answerQuizSession(env, pollId, telegramUserId, selectedOptionIds);
  if (!answered.changed || !answered.session) return;

  const correct = answered.session.result === "correct";
  const correctAnswers = answered.session.correctOptionIds
    .map((id) => answered.session?.options[id])
    .filter((value): value is string => Boolean(value));
  const selectedAnswers = answered.session.selectedOptionIds
    .map((id) => answered.session?.options[id])
    .filter((value): value is string => Boolean(value));

  await jobStoreRequest(env, answered.session.chatId, {
    action: "record_quiz_result",
    botConnectionId: answered.session.botConnectionId,
    pollId,
    updateId: answered.session.updateId,
    question: answered.session.questionText,
    selectedAnswer: selectedAnswers.join(", ") || "No answer recorded",
    correctAnswer: correctAnswers.join(", ") || "Unknown",
    result: correct ? "correct" : "incorrect",
    explanation: answered.session.explanation,
    topic: answered.session.topic ?? "General SSC doubt",
  }).catch((error) => {
    logger.warn("quiz_result_context_failed", {
      requestId,
      pollId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Telegram's native quiz UI already presents the result/explanation. Parmar
  // deliberately sends no second bot message after a student vote.
  await recordEvent(env, "quiz_answered", {
    telegramUserId,
    chatId: answered.session.chatId,
  }, {
    updateId: answered.session.updateId,
    pollId,
    topic: answered.session.topic,
    subject: answered.session.subject,
    result: answered.session.result,
    selectedOptionIds: answered.session.selectedOptionIds,
    correctOptionIds: answered.session.correctOptionIds,
  }).catch((error) => {
    logger.warn("quiz_answer_event_failed", { requestId, pollId, error: error instanceof Error ? error.message : String(error) });
  });
}

function startTypingHeartbeat(env: Env, chatId: number, requestId: string, botConnectionId: string): () => void {
  let stopped = false;

  const sendHeartbeat = (): void => {
    if (stopped) return;
    void sendTelegramChatAction(env, chatId, "typing", botConnectionId).catch((error) => {
      if (!stopped) {
        logger.warn("telegram_typing_heartbeat_failed", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  // Telegram expires a chat action after 5 seconds or less, so refresh it
  // well before expiry while the Queue job remains actively owned.
  sendHeartbeat();
  const interval = setInterval(sendHeartbeat, 3_000);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

async function completeCancelledJob(
  env: Env,
  job: QuestionJob,
  queueMessageId: string,
  leaseVersion?: number,
): Promise<void> {
  await jobStoreRequest(env, job.chatId, {
    action: "complete",
    botConnectionId: job.botConnectionId,
    updateId: job.updateId,
    queueMessageId,
    ...(leaseVersion !== undefined ? { leaseVersion } : {}),
  });
  await recordQuestionResult(env, {
    updateId: job.updateId,
    botConnectionId: job.botConnectionId,
    status: "cancelled",
    completedAt: Date.now(),
    attempts: 0,
    errorMessage: "telegram_bot_disconnected",
  });
}

function buildQuizDeliveryFailureAnswer(): string {
  return "Quiz abhi safely deliver nahi ho paaya. Please wahi request dobara bhejo. 🙏";
}

function getQuizItems(packet: AnswerPacket): QuizItem[] {
  if (packet.quizItems?.length) return packet.quizItems;
  if (
    packet.quizQuestion &&
    packet.quizOptions.length >= 2 &&
    packet.quizCorrectOptionIds.length === 1 &&
    packet.quizExplanation
  ) {
    return [{
      question: packet.quizQuestion,
      options: packet.quizOptions,
      correctOptionIds: packet.quizCorrectOptionIds,
      explanation: packet.quizExplanation,
    }];
  }
  return [];
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
      await editTelegramMessage(env, job.chatId, statusMessageId, answer, job.botConnectionId);
      return;
    } catch (error) {
      if (!isMessageEditTerminalError(error)) throw error;
    }
  }
  await sendTelegramMessage(env, job.chatId, answer, job.messageId, job.botConnectionId);
}

async function getStudentProfile(env: Env, chatId: number): Promise<StudentProfile> {
  const response = await jobStoreRequest<{ ok: true; profile: StudentProfile }>(env, chatId, { action: "get_profile" });
  return response.profile;
}

async function getStudentUsage(env: Env, chatId: number, telegramUserId: number): Promise<{ dayCount: number; dailyLimit: number; unlimited: boolean }> {
  const response = await jobStoreRequest<{ ok: true; usage: { dayCount: number; dailyLimit: number; unlimited: boolean } }>(env, chatId, { action: "get_usage", telegramUserId });
  return response.usage;
}

function buildStartText(): string {
  return [
    "So Hello Everyone, umeed karta hoon aap sabhi thik honge!",
    "",
    "Parmar AI abhi SSC-focused study companion hai—especially GA/GS, History, Polity, Geography, Economy, Science, Static GK aur exam-oriented factual doubts ke liye. 📚",
    "",
    "Doubt bhejo. Main sirf answer nahi dunga; zarurat padne par bataunga ki SSC ke liye kya yaad rakhna hai aur kya next revise karna useful hoga.\nDaily AI questions: 20 per student.",
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
    "/reset — study profile reset\n/delete-my-data — delete your stored study data",
    "/help — ye help",
    "",
    "Normal SSC GA/GS doubt seedha bhejo.\nDaily AI questions: 20.",
  ].join("\n");
}

function buildProfileText(profile: StudentProfile, usage: { dayCount: number; dailyLimit: number; unlimited: boolean }): string {
  if (profile.questionCount === 0) return PROFILE_EMPTY_TEXT;

  const recent = profile.recentTopics.slice(0, 5);
  const attention = profile.attentionTopics.slice(0, 5);
  const revision = profile.revisionQueue.slice(0, 5);
  const signals = profile.learningSignals
    .filter((item) => item.confusionCount + item.weakCount > 0)
    .sort((a, b) => (b.confusionCount + b.weakCount) - (a.confusionCount + a.weakCount))
    .slice(0, 3);

  return [
    "📚 Tumhari Parmar SSC Profile",
    `Target: ${profile.targetExam}`,
    `Questions tracked: ${profile.questionCount}`,
    `Today: ${usage.unlimited ? "Unlimited AI access" : `${usage.dayCount}/${usage.dailyLimit} questions`}`,
    "",
    `Recent focus: ${recent.length ? recent.join(" • ") : "abhi nahi"}`,
    `Attention areas: ${attention.length ? attention.join(" • ") : "abhi koi clear weak area nahi"}`,
    `Revision queue: ${revision.length ? revision.join(" → ") : "abhi build ho rahi hai"}`,
    `Learning signals: ${signals.length ? signals.map((item) => `${item.topic} (${item.confusionCount + item.weakCount})`).join(" • ") : "abhi enough evidence nahi"}`,
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
function isDeleteMyData(text: string): boolean { return /^\/(?:delete_data|delete_my_data|delete-my-data)$/i.test(text); }
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
    { command: "delete_data", description: "Delete your stored Parmar data" },
    { command: "help", description: "Show help" },
    { command: "id", description: "Show your Telegram user ID" },
  ];
}

async function telegramSetup(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.TELEGRAM_SETUP_SECRET) {
    return withRequestId(json({ ok: false, error: "telegram_setup_not_configured" }, 500), requestId);
  }
  const supplied = request.headers.get("X-Setup-Secret") ?? "";
  if (!supplied || !safeEqual(supplied, env.TELEGRAM_SETUP_SECRET)) {
    return withRequestId(json({ ok: false, error: "unauthorized" }, 401), requestId);
  }

  const activeBot = await getActiveTelegramBot(env);
  const hasBotRecords = await hasTelegramBotRecords(env);
  const token = activeBot?.token ?? (!hasBotRecords ? env.TELEGRAM_BOT_TOKEN?.trim() : undefined);
  const webhookSecret = activeBot?.webhookSecret ?? (!hasBotRecords ? env.TELEGRAM_WEBHOOK_SECRET?.trim() : undefined);
  if (!token || !webhookSecret) {
    return withRequestId(json({ ok: false, error: "telegram_configuration_missing" }, 500), requestId);
  }

  const url = new URL(request.url);
  const webhookUrl = url.origin + "/telegram/webhook";
  const webhookResult = await telegramSetupMethod(env, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "poll_answer"],
    drop_pending_updates: false,
    max_connections: 100,
    botTokenOverride: token,
  });

  const commandsResult = await telegramSetupMethod(env, "setMyCommands", {
    commands: buildSetupCommands(),
    botTokenOverride: token,
  });

  logger.info("telegram_webhook_setup", {
    requestId,
    webhookUrl,
    botConnectionId: activeBot?.connectionId ?? LEGACY_TELEGRAM_BOT_CONNECTION_ID,
  });
  return withRequestId(json({
    ok: true,
    configured: true,
    commandsConfigured: Boolean(commandsResult),
    botUsername: activeBot?.username ?? null,
  }), requestId);
}

async function telegramSetupMethod(env: Env, method: string, payload: Record<string, unknown>): Promise<unknown> {
  const botTokenOverride = typeof payload.botTokenOverride === "string" ? payload.botTokenOverride : undefined;
  const requestPayload = { ...payload };
  delete requestPayload.botTokenOverride;

  const activeBot = await getActiveTelegramBot(env);
  const token = botTokenOverride ?? activeBot?.token ?? env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new TelegramError("Telegram bot is not configured.");

  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  const raw = await response.text();
  let data: { ok: boolean; result?: unknown; description?: string };
  try { data = JSON.parse(raw) as { ok: boolean; result?: unknown; description?: string }; }
  catch { throw new TelegramError("Telegram returned invalid JSON (HTTP " + response.status + ").", response.status); }
  if (!response.ok || !data.ok) throw new TelegramError(data.description ?? ("Telegram request failed (HTTP " + response.status + ")."), response.status, response.status >= 500 || response.status === 429);
  return data.result;
}

async function buildHealth(_env: Env) {
  return {
    ok: true,
    status: "healthy",
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
  return false;
}

function queueRetryDelay(attempt: number): number {
  const base = Math.min(300, 15 * 2 ** Math.max(0, attempt - 1));
  return Math.min(300, base + Math.floor(Math.random() * 7));
}

function isValidQuestionJob(job: unknown): job is QuestionJob {
  if (!job || typeof job !== "object") return false;
  const candidate = job as Record<string, unknown>;
  const quizCount = candidate.quizCount === undefined ? 1 : Number(candidate.quizCount);
  return (
    (candidate.version === 1 || candidate.version === 2) &&
    typeof candidate.botConnectionId === "string" &&
    candidate.botConnectionId.trim().length > 0 &&
    isSafeInteger(candidate.updateId) &&
    isSafeInteger(candidate.chatId) &&
    isSafeInteger(candidate.messageId) &&
    typeof candidate.question === "string" &&
    candidate.question.trim().length > 0 &&
    typeof candidate.requestId === "string" &&
    Number.isSafeInteger(quizCount) &&
    quizCount >= 1 &&
    quizCount <= MAX_QUIZ_BATCH_SIZE
  );
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

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return withRequestId(json(await buildHealth(env)), requestId);
      }

      if (url.pathname === "/") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return withRequestId(json({ ok: true, service: "parmar-ai", phase: "H", status: "ssc_queue_vertex_ai_admin" }), requestId);
      }

      if (url.pathname === "/telegram/setup") {
        if (request.method !== "POST") return withRequestId(methodNotAllowed(["POST"]), requestId);
        return telegramSetup(request, env, requestId);
      }

      if (url.pathname === "/telegram/webhook") {
        if (request.method !== "POST") return withRequestId(methodNotAllowed(["POST"]), requestId);
        return handleTelegramWebhook(request, env, requestId, _ctx);
      }

      if (url.pathname === "/admin/login") {
        if (request.method === "GET") return new Response(loginHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        if (request.method === "POST") return handleAdminLogin(request, env);
        return withRequestId(methodNotAllowed(["GET", "POST"]), requestId);
      }

      if (url.pathname === "/admin/logout") {
        if (request.method !== "POST") return withRequestId(methodNotAllowed(["POST"]), requestId);
        return clearAdminSession();
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        if (!(await requireAdmin(request, env))) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        return adminDashboard(env);
      }

      if (url.pathname.startsWith("/admin/api/")) {
        if (!(await requireAdmin(request, env))) return withRequestId(json({ ok: false, error: "unauthorized" }, 401), requestId);
        if (url.pathname === "/admin/api/telegram" && request.method === "GET") return adminTelegram(env);
        if (url.pathname === "/admin/api/overview" && request.method === "GET") return adminOverview(env);
        if (url.pathname === "/admin/api/users" && request.method === "GET") return adminUsers(env, request);
        if (url.pathname === "/admin/api/questions" && request.method === "GET") return adminUserQuestions(env, request);
        if (url.pathname === "/admin/api/user" && request.method === "GET") return adminUserDetail(env, request);
        if (url.pathname === "/admin/api/ai-usage" && request.method === "GET") return adminAiUsage(env, request);
        if (url.pathname === "/admin/api/learning" && request.method === "GET") return adminLearning(env);
        if (url.pathname === "/admin/api/activity" && request.method === "GET") return adminActivity(env, request);
        if (url.pathname === "/admin/api/access" && request.method === "GET") return adminAccess(env);
        if (url.pathname === "/admin/api/audit" && request.method === "GET") return adminAudit(env, request);
        if (url.pathname === "/admin/api/system" && request.method === "GET") return adminSystem(env);
        if (url.pathname === "/admin/api/export" && request.method === "GET") return adminExport(env, request);
        if (url.pathname === "/admin/api/action" && request.method === "POST") {
          if (!isSameOriginAdminRequest(request, url.origin)) return withRequestId(json({ ok: false, error: "csrf_origin_rejected" }, 403), requestId);
          return adminAction(env, request);
        }
        return withRequestId(notFound(), requestId);
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

  async queue(batch: MessageBatch<QuestionJob>, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleQuestionBatch(batch, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await cleanupAnalytics(env, getAnalyticsConfig(env).retentionDays);
    } catch (error) {
      logger.warn("analytics_cleanup_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  },
};

export default worker;
export { JobDedupe };
