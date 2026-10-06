import type {
  DurableObjectStub,
  ExportedHandler,
  ExecutionContext,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";

import { generateGeminiAnswer, GeminiError } from "./ai/gemini";
import type { AnswerPacket, Env, ProfileContext, QuestionJob, StudentProfile, ConversationTurn } from "./config/env";
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
import { recordEvent, recordQuestionResult, recordQuestionStart, recordUserSeen, updateUserIdentity, getAnalyticsConfig, cleanupAnalytics, grantUnlimitedAiAccess, revokeUnlimitedAiAccess, isAdminTelegramUser, hasUnlimitedAiAccess, recordAiUsage, isUserSuspended } from "./analytics/db";
import { adminDashboard, adminOverview, adminUsers, adminUserQuestions, adminUserDetail, adminAiUsage, adminLearning, adminActivity, adminAccess, adminAudit, adminSystem, adminExport, adminAction } from "./admin/dashboard";
import { clearAdminSession, handleAdminLogin, loginHtml, requireAdmin } from "./admin/auth";

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

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface BeginJobResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  statusMessageId?: number;
  notify?: boolean;
  rateLimitReason?: "daily" | "burst";
  unlimited?: boolean;
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

  const begin = await jobStoreRequest<BeginJobResponse>(env, chatId, {
    action: "begin",
    telegramUserId: analyticsUser.telegramUserId,
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

  if (begin.action === "retry_ack") {
    const retryJob: QuestionJob = {
      version: 2,
      updateId,
      chatId,
      question: text,
      messageId,
      requestId,
      createdAt: Date.now(),
      statusMessageId: begin.statusMessageId,
      telegramUserId: analyticsUser.telegramUserId,
    };
    try {
      await env.QUESTION_QUEUE.send(retryJob, { contentType: "json" });
      await jobStoreRequest(env, chatId, { action: "mark_queued", updateId });
      queueAnalytics(ctx, "question_retry_ack", () => recordQuestionStart(env, {
        updateId, requestId, user: analyticsUser, messageId, question: text, receivedAt: Date.now(),
      }));
    } catch (error) {
      logger.error("question_queue_retry_enqueue_failed", {
        requestId,
        updateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(json({ ok: false }, 500), requestId);
    }
    void sendTelegramChatAction(env, chatId, "typing").catch(() => undefined);
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
    telegramUserId: analyticsUser.telegramUserId,
  };

  try {
    await env.QUESTION_QUEUE.send(job, { contentType: "json" });
    await jobStoreRequest(env, chatId, { action: "mark_queued", updateId });
    queueAnalytics(ctx, "question_start", () => recordQuestionStart(env, {
      updateId,
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
      const startedAt = Date.now();
      // Repair analytics asynchronously in case the webhook-side D1 write was interrupted.
      const jobTelegramUserId = job.telegramUserId ?? job.chatId;
      ctx.waitUntil(recordUserSeen(env, { telegramUserId: jobTelegramUserId, chatId: job.chatId }));
      ctx.waitUntil(recordQuestionStart(env, {
        updateId: job.updateId,
        requestId: job.requestId,
        user: { telegramUserId: jobTelegramUserId, chatId: job.chatId },
        messageId: job.messageId,
        question: job.question,
        receivedAt: job.createdAt,
      }));
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
        ctx.waitUntil(recordAiUsage(env, {
          updateId: job.updateId,
          requestId: job.requestId,
          queueAttempt: message.attempts,
          telegramUserId: jobTelegramUserId,
          chatId: job.chatId,
          usage: generation.usage,
        }).catch((usageError) => logger.warn("analytics_ai_usage_failed", { error: usageError instanceof Error ? usageError.message : String(usageError) })));
        await jobStoreRequest(env, job.chatId, {
          action: "set_answer_packet",
          updateId: job.updateId,
          packet,
        });
      }

      let latestProfile = profile;
      if (!claim.record.profileUpdated) {
        try {
          await jobStoreRequest(env, job.chatId, {
            action: "update_profile",
            updateId: job.updateId,
            question: job.question,
            topic: packet.topic,
            subject: packet.subject,
            profileSignal: packet.profileSignal,
            nextRevisionTopic: packet.nextRevisionTopic,
            detectedExam: packet.detectedExam ?? "",
            answerScope: packet.answerScope,
            questionMode: packet.questionMode,
          });
          await jobStoreRequest(env, job.chatId, {
            action: "mark_profile_updated",
            updateId: job.updateId,
          });
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

      await deliverAnswer(env, job, claim.record.statusMessageId, buildAnswerForStudent(packet, latestProfile));
      await jobStoreRequest(env, job.chatId, { action: "complete", updateId: job.updateId });
      const completedAt = Date.now();
      ctx.waitUntil(recordQuestionResult(env, {
        updateId: job.updateId,
        status: packet.answerScope === "out_of_scope" ? "out_of_scope" : "completed",
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
        await deliverAnswer(env, job, claim.record.statusMessageId, userFacingFailure(error));
        await jobStoreRequest(env, job.chatId, { action: "complete", updateId: job.updateId });
        ctx.waitUntil(recordQuestionResult(env, {
          updateId: job.updateId,
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
    "/reset — study profile reset",
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
    { command: "id", description: "Show your Telegram user ID" },
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
    phase: "H",
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
    analyticsConfigured: Boolean(env.DB),
    adminDashboard: Boolean(env.DB && env.ADMIN_DASHBOARD_PASSWORD && env.ADMIN_SESSION_SECRET),
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
        return withRequestId(json({ ok: true, service: "parmar-ai", phase: "H", status: "ssc_queue_vertex_ai_admin" }), requestId);
      }

      if (url.pathname === "/telegram/setup") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
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
        if (url.pathname === "/admin/api/action" && request.method === "POST") return adminAction(env, request);
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
