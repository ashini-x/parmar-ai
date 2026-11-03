import type {
  DurableObjectStub,
   ExecutionContext,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";

import { generateGeminiAnswer, GeminiError, isLikelyMcqTopicReply, isMcqRequest, parseRequestedMcqCount, type PartialAnswerHandler } from "./ai/gemini";
import type { AnswerPacket, Env, ProfileContext, QuestionJob, StudentProfile, ConversationTurn, QuizItem } from "./config/env";
import { DEFAULT_PHOTO_QUESTION, MAX_PHOTO_COUNT, MAX_QUIZ_BATCH_SIZE } from "./config/env";
import { getConfig } from "./config/env";
import { JobDedupe, buildProfileContext, type ClaimResponse, type JobRecord } from "./core/job-store";
import { buildFatmanRetrievalQuery, formatFatmanCitations, isFatmanReady, retrieveFatmanContext, FatmanRetrievalError } from "./fatman/retrieval";
import { logger } from "./core/logger";
import { createTelegramProgressUpdater, TELEGRAM_PROGRESS_LABELS } from "./telegram/progress";
import { parseFatmanModeAction, parseFatmanModeCommand, resolveFatmanModeTarget } from "./telegram/fatman-mode";
import { buildTelegramWebhookSetupPayload } from "./telegram/webhook-config";
import { PHOTO_CAPTION_REQUIRED_TEXT } from "./telegram/photo-intent";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  deleteTelegramMessage,
  editTelegramMessage,
  editTelegramMessageReplyMarkup,
  sendTelegramChatAction,
  sendTelegramMessage,
  sendTelegramBusinessMessage,
  sendTelegramQuiz,
  stopTelegramPoll,
  telegramApi,
  TelegramError,
  TelegramMediaError,
  downloadTelegramPhotos,
  buildFatmanModeMarkup,
} from "./telegram/api";
import { internalServerError, json, methodNotAllowed, notFound } from "./http/response";
import { answerQuizSession, createQuizSession, deleteQuizSession, getQuizSession, recordEvent, recordQuestionResult, recordQuestionStart, recordUserSeen, updateUserIdentity, getAnalyticsConfig, cleanupAnalytics, ensureAnalyticsSchema, getLatestFatmanReleaseQaRun, grantUnlimitedAiAccess, revokeUnlimitedAiAccess, isAdminTelegramUser, hasUnlimitedAiAccess, recordAiUsage, isUserSuspended, deleteUserData } from "./analytics/db";
import { adminDashboard, adminOverview, adminUsers, adminUserQuestions, adminUserDetail, adminAiUsage, adminLearning, adminActivity, adminAccess, adminAudit, adminSystem, adminExport, adminAction, adminTelegram } from "./admin/dashboard";
import { clearAdminSession, handleAdminLogin, loginHtml, requireAdmin } from "./admin/auth";
import { disableFatmanIndex, fatmanAdminPage, fatmanIndexStatus, finalizeFatmanIndex, prepareFatmanIndex, previewFatmanIndex, testFatmanVision, uploadFatmanPage } from "./fatman/admin";
import { fatmanMonitorPage, fatmanMonitorStatus } from "./fatman/monitor";
import { fatmanReleaseQaStatus, triggerFatmanReleaseQa } from "./fatman/qa-admin";
import { completeFatmanUpload, fatmanUploadStatus, resumeFatmanImport, startFatmanUpload, uploadFatmanChunk } from "./fatman/import";
export { FatmanImportWorkflow } from "./fatman/workflow";
import { LEGACY_TELEGRAM_BOT_CONNECTION_ID, findTelegramBotByWebhookSecret, getActiveTelegramBot, hasTelegramBotRecords, isTelegramBotConnectionActive } from "./telegram/bot-store";

const QUEUE_MAX_RETRIES = 10;
const STATUS_TEXT = "Thinking…";
const BOT_BRAND_NAME = "परमार्थAI (𝘗𝘢𝘳𝘮𝘢𝘳𝘵𝘩𝘈𝘐)";
const RATE_LIMIT_TEXT = "Bhai, ek saath bahut saare doubts aa rahe hain. Thoda sa gap do, phir next doubt bhejo. 🙂";
const DAILY_LIMIT_TEXT = "Aaj ke liye tumhara question limit complete ho gaya hai. Kal phir continue kar lena. 🙌";
const FINAL_FAILURE_TEXT = "Bhai, is waqt answer complete nahi ho paaya. Tumhara sawal retry hua hai; same doubt dobara bhejna. 🙏";
const PROFILE_EMPTY_TEXT = "Abhi main tumhare questions se tumhari SSC preparation profile bana raha hoon. Thode aur doubts bhejo, phir main bata paunga ki kis topic par revision priority honi chahiye. 📚";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number; type?: string };
  from?: { id?: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string };
  sender_business_bot?: { id?: number };
  business_connection_id?: string;
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: Array<{ file_id?: string; width?: number; height?: number; file_size?: number }>;
  video?: unknown;
  video_note?: unknown;
  animation?: unknown;
  document?: { mime_type?: string };
}

interface TelegramCallbackQuery {
  id?: string;
  from?: { id?: number };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramPollAnswer {
  poll_id?: string;
  user?: { id?: number; is_bot?: boolean };
  option_ids?: number[];
}

interface TelegramBusinessConnection {
  id?: string;
  user?: { id?: number };
  is_enabled?: boolean;
  rights?: { can_reply?: boolean };
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  poll_answer?: TelegramPollAnswer;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramMessage;
}

interface PhotoAlbumStageResponse { action: "staged" | "duplicate" | "too_many" | "closed" | "rejected"; }

interface BeginJobResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack";
  quizCount?: number;
  fatmanModeSnapshot?: boolean;
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

function getBusinessOwnerStore(env: Env, ownerTelegramUserId: number): DurableObjectStub {
  const id = env.JOB_DEDUPE.idFromName(`business-owner:${ownerTelegramUserId}`);
  return env.JOB_DEDUPE.get(id);
}

async function businessOwnerStoreRequest<T>(env: Env, ownerTelegramUserId: number, body: Record<string, unknown>): Promise<T> {
  const response = await getBusinessOwnerStore(env, ownerTelegramUserId).fetch("https://business-owner/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Business owner store returned HTTP ${response.status}.`);
  return (await response.json()) as T;
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

const BUSINESS_AUTO_REPLY_TEXT = "Hi, thanks for reaching out. I am परमार्थAI, and my creator is not online right now.\n\nPlease send an email regarding your query to idoctorprojects@gmail.com";

async function handleTelegramBusinessConnection(
  connection: TelegramBusinessConnection,
  env: Env,
  botConnectionId: string,
  requestId: string,
): Promise<void> {
  const ownerTelegramUserId = Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "");
  if (!Number.isSafeInteger(ownerTelegramUserId) || ownerTelegramUserId <= 0) {
    logger.warn("telegram_business_owner_id_not_configured", { requestId, botConnectionId });
    return;
  }

  if (!connection.id || connection.user?.id !== ownerTelegramUserId) {
    logger.warn("telegram_business_connection_rejected", { requestId, botConnectionId });
    return;
  }

  await businessOwnerStoreRequest(env, ownerTelegramUserId, {
    action: "set_business_connection",
    businessConnectionId: connection.id,
    enabled: connection.is_enabled === true,
    canReply: connection.rights?.can_reply === true,
  });
  logger.info("telegram_business_connection_updated", {
    requestId,
    botConnectionId,
    enabled: connection.is_enabled === true,
    canReply: connection.rights?.can_reply === true,
  });
}

async function handleTelegramBusinessMessage(
  message: TelegramMessage,
  updateIdValue: number | undefined,
  env: Env,
  botConnectionId: string,
  requestId: string,
): Promise<void> {
  const ownerTelegramUserId = Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "");
  if (!Number.isSafeInteger(ownerTelegramUserId) || ownerTelegramUserId <= 0) {
    logger.warn("telegram_business_owner_id_not_configured", { requestId, botConnectionId });
    return;
  }

  const chatId = message.chat?.id;
  const messageId = message.message_id;
  const updateId = updateIdValue;
  const businessConnectionId = message.business_connection_id?.trim();
  if (
    message.chat?.type !== "private" ||
    typeof chatId !== "number" ||
    !Number.isSafeInteger(chatId) ||
    typeof messageId !== "number" ||
    !Number.isSafeInteger(messageId) ||
    typeof updateId !== "number" ||
    !Number.isSafeInteger(updateId) ||
    !businessConnectionId ||
    message.from?.is_bot ||
    message.sender_business_bot ||
    message.from?.id === ownerTelegramUserId
  ) return;

  const connection = await businessOwnerStoreRequest<{ allowed: boolean }>(env, ownerTelegramUserId, {
    action: "check_business_connection",
    businessConnectionId,
  });
  if (!connection.allowed) return;

  const claim = await businessOwnerStoreRequest<{ shouldReply: boolean }>(env, ownerTelegramUserId, {
    action: "claim_business_message",
    updateId,
  });
  if (!claim.shouldReply) return;

  await sendTelegramBusinessMessage(
    env,
    chatId,
    messageId,
    businessConnectionId,
    BUSINESS_AUTO_REPLY_TEXT,
    botConnectionId,
  );
}

async function handleFatmanModeCallback(
  callback: TelegramCallbackQuery,
  env: Env,
  botConnectionId: string,
  requestId: string,
): Promise<void> {
  const callbackId = callback.id?.trim();
  if (!callbackId) return;
  let answered = false;
  const answerCallback = async (text: string, showAlert = false) => {
    await telegramApi(env, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
      show_alert: showAlert,
    }, botConnectionId);
    answered = true;
  };

  try {
    const chatId = callback.message?.chat?.id;
    const senderId = callback.from?.id;
    const action = parseFatmanModeAction(callback.data);
    if (
      !action ||
      !isSafeInteger(chatId) ||
      callback.message?.chat?.type !== "private" ||
      !isSafeInteger(senderId) ||
      senderId !== chatId
    ) {
      await answerCallback("This control is only available in your private chat.", true);
      return;
    }

    const current = await jobStoreRequest<{ ok: true; active: boolean }>(env, chatId, { action: "get_fatman_mode", botConnectionId });
    const active = resolveFatmanModeTarget(action, current.active);
    // Exiting must remain possible even if the book index becomes unavailable.
    if (active && !current.active && !(await isFatmanReady(env))) {
      await answerCallback("Fatman mode is not available yet.", true);
      return;
    }

    await jobStoreRequest(env, chatId, { action: "set_fatman_mode", botConnectionId, active });
    await answerCallback(
      active
        ? (current.active ? "Fatman mode is already on." : "Fatman mode on.")
        : (current.active ? "Fatman mode off." : "Fatman mode is already off."),
    );

    if (isSafeInteger(callback.message?.message_id)) {
      try {
        await editTelegramMessageReplyMarkup(
          env,
          chatId,
          callback.message!.message_id!,
          buildFatmanModeMarkup(active),
          botConnectionId,
        );
      } catch (error) {
        logger.warn("fatman_mode_keyboard_refresh_failed", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await sendTelegramMessage(
      env,
      chatId,
      active
        ? "✅ Fatman Mode is ON. New doubts will use the book and page citations."
        : "✅ Fatman Mode is OFF. New doubts will use the usual SSC study mode.",
      undefined,
      botConnectionId,
      true,
    );
  } catch (error) {
    logger.warn("fatman_mode_callback_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!answered) {
      await answerCallback("Could not change Fatman mode. Please try again.", true).catch(() => undefined);
    }
  }
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

  if (update.callback_query) {
    await handleFatmanModeCallback(update.callback_query, env, bot.connectionId, requestId);
    return withRequestId(json({ ok: true, callbackQuery: true }), requestId);
  }

  if (update.business_connection) {
    await handleTelegramBusinessConnection(update.business_connection, env, bot.connectionId, requestId);
    return withRequestId(json({ ok: true, businessConnection: true }), requestId);
  }

  if (update.business_message) {
    await handleTelegramBusinessMessage(update.business_message, update.update_id, env, bot.connectionId, requestId);
    return withRequestId(json({ ok: true, businessMessage: true }), requestId);
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

  const text = (message?.text ?? message?.caption ?? "").trim();
  const photoFileId = getTelegramPhotoFileId(message?.photo);
  const questionText = text || (photoFileId ? DEFAULT_PHOTO_QUESTION : "");
  if (chatType && chatType !== "private") {
    await bestEffortTelegram("group_scope", () =>
      sendTelegramMessage(env, chatId, `${BOT_BRAND_NAME} abhi private chat mein SSC doubts ke liye optimized hai. Mujhe DM karke doubt bhejo. 📚`, messageId),
    );
    return withRequestId(json({ ok: true, rejected: "private_chat_only" }), requestId);
  }

  const analyticsUser = buildAnalyticsUser(message!, chatId);
  queueAnalytics(ctx, "user_seen", () => recordUserSeen(env, analyticsUser));

  if (isTelegramVideoMessage(message)) {
    const notice = await jobStoreRequest<{ notify: boolean }>(env, chatId, {
      action: "reject_telegram_video",
      botConnectionId: bot.connectionId,
      mediaGroupId: message?.media_group_id,
      updateId,
      chatId,
      telegramUserId: analyticsUser.telegramUserId,
      requestId,
    });
    if (notice.notify) {
      await bestEffortTelegram("video_not_supported", () => sendTelegramMessage(
        env,
        chatId,
        `${BOT_BRAND_NAME} sirf photos support karta hai, videos process nahi karta. SSC doubt ke liye ek photo ya maximum 5 photos ka album bhejo. 📸`,
        messageId,
        bot.connectionId,
      ));
    }
    return withRequestId(json({ ok: true, rejected: "video_not_supported" }), requestId);
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
    photoCount: photoFileId ? 1 : 0,
  });

  if (!text && !photoFileId) {
    await bestEffortTelegram("non_text", () =>
      sendTelegramMessage(env, chatId, "Abhi main text ya photo SSC GA/GS doubts handle kar raha hoon. 📚", messageId),
    );
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isStart(text)) {
    queueAnalytics(ctx, "start", () => recordEvent(env, "start", analyticsUser));
    ctx.waitUntil(bestEffortTelegram("start_menu_sync", () => syncTelegramCommandMenu(env, bot.connectionId)));
    await bestEffortTelegram("start", () => sendTelegramMessage(env, chatId, buildStartText()));
    return withRequestId(json({ ok: true }), requestId);
  }

  if (isHelp(text)) {
    queueAnalytics(ctx, "help", () => recordEvent(env, "help", analyticsUser));
    ctx.waitUntil(bestEffortTelegram("help_menu_sync", () => syncTelegramCommandMenu(env, bot.connectionId)));
    const mode = await jobStoreRequest<{ ok: true; active: boolean }>(env, chatId, { action: "get_fatman_mode", botConnectionId: bot.connectionId }).catch(() => ({ ok: true as const, active: false }));
    const fatmanReady = await isFatmanReady(env);
    const callbackWebhookReady = fatmanReady
      ? await syncTelegramWebhookForCallbacks(request, env, bot, requestId)
      : false;
    const markup = fatmanReady && callbackWebhookReady ? buildFatmanModeMarkup(mode.active) : undefined;
    const helpText = buildHelpText() + (
      !fatmanReady
        ? "\n\nFatman Mode is currently unavailable. You can still use /fatman off to leave the mode."
        : callbackWebhookReady
          ? "\n\nUse the buttons below or /fatman on and /fatman off to switch book mode."
          : "\n\nButton sync failed. Use /fatman on or /fatman off as a backup."
    );
    await bestEffortTelegram("help", () => sendTelegramMessage(env, chatId, helpText, undefined, bot.connectionId, true, markup));
    return withRequestId(json({ ok: true }), requestId);
  }

  const fatmanCommand = parseFatmanModeCommand(text);
  if (fatmanCommand) {
    const current = await jobStoreRequest<{ ok: true; active: boolean }>(env, chatId, {
      action: "get_fatman_mode",
      botConnectionId: bot.connectionId,
    });
    const desiredActive = fatmanCommand === "on" ? true : fatmanCommand === "off" ? false : current.active;
    if (desiredActive && !current.active && !(await isFatmanReady(env))) {
      await bestEffortTelegram("fatman_command_unavailable", () => sendTelegramMessage(
        env,
        chatId,
        "Fatman Mode is not available right now. Usual study mode is still active.",
        messageId,
        bot.connectionId,
      ));
      return withRequestId(json({ ok: true, fatmanUnavailable: true }), requestId);
    }
    await jobStoreRequest(env, chatId, {
      action: "set_fatman_mode",
      botConnectionId: bot.connectionId,
      active: desiredActive,
    });
    const ready = desiredActive ? await isFatmanReady(env) : false;
    const commandText = desiredActive
      ? (current.active ? "Fatman Mode is already ON." : "✅ Fatman Mode is ON. New doubts will use the book and page citations.")
      : (current.active ? "✅ Fatman Mode is OFF. New doubts will use the usual SSC study mode." : "Fatman Mode is already OFF.");
    await bestEffortTelegram("fatman_command", () => sendTelegramMessage(
      env,
      chatId,
      commandText,
      messageId,
      bot.connectionId,
      true,
      ready ? buildFatmanModeMarkup(desiredActive) : undefined,
    ));
    return withRequestId(json({ ok: true, fatmanMode: desiredActive }), requestId);
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
    await bestEffortTelegram("delete_data", () => sendTelegramMessage(env, chatId, `Tumhari ${BOT_BRAND_NAME} ki stored study data aur history delete kar di gayi hai. Ab fresh start hoga. 🗑️`));
    return withRequestId(json({ ok: true, deleted: true }), requestId);
  }

  if (isReset(text)) {
    await jobStoreRequest(env, chatId, { action: "reset_profile" });
    queueAnalytics(ctx, "reset", () => recordEvent(env, "reset", analyticsUser));
    await bestEffortTelegram("reset", () => sendTelegramMessage(env, chatId, `Theek hai. Tumhari ${BOT_BRAND_NAME} study profile reset kar di. Ab fresh tracking se shuru karte hain. 📚`));
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
    await bestEffortTelegram("suspended_user", () => sendTelegramMessage(env, chatId, `Abhi tumhara ${BOT_BRAND_NAME} access temporarily paused hai. Admin se contact karo. 🙏`, messageId));
    return withRequestId(json({ ok: true, suspended: true }), requestId);
  }

  const fatmanState = await jobStoreRequest<{ ok: true; active: boolean }>(env, chatId, { action: "get_fatman_mode", botConnectionId: bot.connectionId });
  const fatmanModeSnapshot = fatmanState.active === true;
  if (fatmanModeSnapshot && !(await isFatmanReady(env))) {
    await jobStoreRequest(env, chatId, { action: "set_fatman_mode", botConnectionId: bot.connectionId, active: false }).catch(() => undefined);
    await bestEffortTelegram("fatman_unavailable", () => sendTelegramMessage(env, chatId, "Fatman mode is temporarily unavailable. Use /help to return to the usual study mode.", messageId, bot.connectionId));
    return withRequestId(json({ ok: true, fatmanUnavailable: true }), requestId);
  }

  if (photoFileId && message?.media_group_id?.trim()) {
    await jobStoreRequest(env, chatId, { action: "clear_pending_quiz" }).catch(() => undefined);
    const staged = await jobStoreRequest<PhotoAlbumStageResponse>(env, chatId, {
      action: "stage_photo_album",
      botConnectionId: bot.connectionId,
      mediaGroupId: message.media_group_id.trim(),
      telegramUserId: analyticsUser.telegramUserId,
      updateId,
      chatId,
      messageId,
      fileId: photoFileId,
      caption: text,
      requestId,
      fatmanModeSnapshot,
    });
    if (staged.action === "too_many") {
      await bestEffortTelegram("photo_album_too_many", () => sendTelegramMessage(
        env,
        chatId,
        `Ek doubt ke saath maximum ${MAX_PHOTO_COUNT} photos bhejo. Photos ka limit paar ho gaya hai; doubt ko 5 ya usse kam photos ke saath bhejo. 🙂`,
        messageId,
        bot.connectionId,
      ));
      return withRequestId(json({ ok: true, rejected: "photo_album_too_many" }), requestId);
    }
    if (staged.action === "staged" || staged.action === "duplicate" || staged.action === "rejected") {
      return withRequestId(json({ ok: true, photoAlbum: staged.action }), requestId);
    }
    // A very late item in an already-flushed album is still answered as a
    // standalone photo instead of being dropped.
  }

  // An image without a caption has no defined task. Ask for the student's
  // intent instead of spending a vision request trying to guess it.
  if (photoFileId && !text) {
    await bestEffortTelegram("photo_caption_required", () => sendTelegramMessage(
      env,
      chatId,
      PHOTO_CAPTION_REQUIRED_TEXT,
      messageId,
      bot.connectionId,
    ));
    return withRequestId(json({ ok: true, rejected: "photo_caption_required" }), requestId);
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
    question: questionText,
    messageId,
    requestId,
    createdAt: Date.now(),
    ...(photoFileId ? { photoFileIds: [photoFileId] } : {}),
    requestedQuizCount: effectiveQuizCount,
    quizContinuation: quizContinuationCount > 0,
    fatmanModeSnapshot,
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
      question: questionText,
      messageId,
      requestId,
      createdAt: Date.now(),
      statusMessageId: begin.statusMessageId,
      telegramUserId: analyticsUser.telegramUserId,
      quizCount: begin.quizCount,
      fatmanModeSnapshot: begin.fatmanModeSnapshot === true,
    };
    try {
      await env.QUESTION_QUEUE.send(retryJob, { contentType: "json" });
      await jobStoreRequest(env, chatId, { action: "mark_queued", botConnectionId: bot.connectionId, updateId });
      queueAnalytics(ctx, "question_retry_ack", () => recordQuestionStart(env, {
        updateId, botConnectionId: bot.connectionId, requestId, user: analyticsUser, messageId, question: questionText, receivedAt: Date.now(),
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
      const status = await sendTelegramMessage(env, chatId, STATUS_TEXT, messageId, bot.connectionId, false);
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
    question: questionText,
    messageId,
    requestId,
    createdAt: Date.now(),
    statusMessageId,
    telegramUserId: analyticsUser.telegramUserId,
    quizCount: effectiveQuizCount,
    fatmanModeSnapshot,
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
      question: questionText,
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
    let updatePartialAnswer: PartialAnswerHandler | undefined;
    try {
      const startedAt = Date.now();
      updatePartialAnswer = claim.record.statusMessageId
        ? createTelegramPartialAnswerUpdater(env, job, claim.record.statusMessageId)
        : undefined;
      await updatePartialAnswer?.setStatus?.(
        message.attempts > 1 ? TELEGRAM_PROGRESS_LABELS.resuming : TELEGRAM_PROGRESS_LABELS.understanding,
      );
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
          fatmanModeSnapshot: (claim.record.fatmanModeSnapshot ?? job.fatmanModeSnapshot) === true,
        });
        recentConversation = Array.isArray(conversationResult.recentConversation) ? conversationResult.recentConversation : [];
      } catch (conversationError) {
        logger.warn("student_conversation_read_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error: conversationError instanceof Error ? conversationError.message : String(conversationError),
        });
      }

      const fatmanMode = (claim.record.fatmanModeSnapshot ?? job.fatmanModeSnapshot) === true;
      let packet = claim.record.answerPacket;

      if (!packet) {
        if (claim.record.photoFileIds?.length) {
          await updatePartialAnswer?.setStatus?.(TELEGRAM_PROGRESS_LABELS.readingImage);
        }
        const images = claim.record.photoFileIds?.length
          ? await downloadTelegramPhotos(env, claim.record.photoFileIds, job.botConnectionId)
          : [];
        if (images.length) {
          await updatePartialAnswer?.setStatus?.(TELEGRAM_PROGRESS_LABELS.analyzingImage);
        }
        let generation: Awaited<ReturnType<typeof generateGeminiAnswer>> | undefined;
        if (fatmanMode && job.question === DEFAULT_PHOTO_QUESTION && images.length > 0) {
          packet = makeFatmanNoticePacket("Photo mil gaya. Fatman mein sahi page dhoondhne ke liye photo ke saath apna sawaal ya ek keyword bhi likho.");
        } else if (fatmanMode) {
          await updatePartialAnswer?.setStatus?.(TELEGRAM_PROGRESS_LABELS.checkingFatman);
          if (!(await isFatmanReady(env))) {
            packet = makeFatmanNoticePacket("Fatman mode abhi available nahi hai. /help se usual study mode mein wapas aa jao.");
          } else {
            await updatePartialAnswer?.setStatus?.(TELEGRAM_PROGRESS_LABELS.searchingFatman);
            let bookContext: Awaited<ReturnType<typeof retrieveFatmanContext>> | undefined;
            try {
              bookContext = await retrieveFatmanContext(env, buildFatmanRetrievalQuery(job.question, recentConversation));
            } catch (error) {
              if (error instanceof FatmanRetrievalError && !error.retryable) {
                packet = makeFatmanNoticePacket(error.userMessage ?? "Fatman pages abhi available nahi hain. /help se usual study mode mein wapas aa jao.");
              } else {
                throw error;
              }
            }
            if (!packet && bookContext && !bookContext.passages.length) {
              packet = makeFatmanNoticePacket("Fatman ki scanned pages mein is sawaal ka relevant hissa nahi mila. Ek keyword, chapter ka naam, ya photo ke saath caption bhejo.");
            }
            if (!packet && bookContext) {
              await updatePartialAnswer?.setStatus?.(TELEGRAM_PROGRESS_LABELS.checkingBookPages);
              generation = await generateGeminiAnswer(
                env,
                job.question,
                buildProfileContext(profile, recentConversation),
                images,
                updatePartialAnswer,
                bookContext,
              );
              packet = generation.packet;
              const citations = formatFatmanCitations(bookContext.passages, job.question, packet.answer);
              packet.answer = appendFatmanCitations(packet.answer, citations);
              packet.sscTakeaway = "";
              packet.profileSignal = "neutral";
              packet.profileNote = "";
              packet.nextRevisionTopic = "";
            }
          }
        } else {
          await updatePartialAnswer?.setStatus?.(
            isMcqRequest(job.question)
              ? TELEGRAM_PROGRESS_LABELS.preparingQuiz
              : images.length
                ? TELEGRAM_PROGRESS_LABELS.preparingAnswer
                : TELEGRAM_PROGRESS_LABELS.preparingAnswer,
          );
          generation = await generateGeminiAnswer(
            env,
            job.question,
            buildProfileContext(profile, recentConversation),
            images,
            updatePartialAnswer,
          );
          packet = generation.packet;
        }
        if (!packet) {
          throw new GeminiError("Question generation did not produce an answer packet.", undefined, true);
        }
        if (!fatmanMode && packet.questionMode === "mcq" && packet.responseMode === "text" && !(packet.quizItems?.length)) {
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
        if (generation?.usage.length) {
          ctx.waitUntil(recordAiUsage(env, {
            updateId: job.updateId,
            botConnectionId: job.botConnectionId,
            requestId: job.requestId,
            queueAttempt: message.attempts,
            telegramUserId: jobTelegramUserId,
            chatId: job.chatId,
            usage: generation.usage,
          }).catch((usageError) => logger.warn("analytics_ai_usage_failed", { error: usageError instanceof Error ? usageError.message : String(usageError) })));
        }
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
      if (!fatmanMode && !claim.record.profileUpdated) {
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
      // Stop the status cycle and await any in-flight edit before the final
      // answer or quiz replaces/deletes this same Telegram message.
      await updatePartialAnswer?.stop?.();
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
            ).catch((error) => {
              logger.warn("quiz_poll_cleanup_delete_failed", {
                requestId: job.requestId,
                pollId: delivered.pollId,
                messageId: delivered.messageId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            await deleteQuizSession(env, delivered.pollId).catch((error) => {
              logger.warn("quiz_session_cleanup_delete_failed", {
                requestId: job.requestId,
                pollId: delivered.pollId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
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
          buildAnswerForStudent(packet, latestProfile, !fatmanMode),
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
      await updatePartialAnswer?.stop?.();
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
      await updatePartialAnswer?.stop?.();
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

function buildAnswerForStudent(packet: AnswerPacket, profile: StudentProfile, personalize = true): string {
  let answer = packet.answer.trim();
  if (!personalize) return answer.slice(0, 3_900);

  // Make the personalization visible only when it is genuinely helpful.
  const isRepeatedArea = packet.topic && profile.recentTopics.some((topic) => topic.toLowerCase() === packet.topic.toLowerCase());
  const isAttentionArea = profile.attentionTopics.some((topic) => topic.toLowerCase() === packet.topic.toLowerCase());

  if (isAttentionArea && packet.profileSignal !== "neutral" && packet.answerScope !== "out_of_scope") {
    answer += `\n\n🎯 Tumhare liye focus: ${packet.nextRevisionTopic || packet.topic} ko ek baar aur revise kar lena.`;
  } else if (isRepeatedArea && packet.questionMode === "comparison") {
    answer += "\n\n🧠 Isko pichhle related topic ke saath pair mein yaad rakho. SSC mein confusion yahin hota hai.";
  }

  return answer.slice(0, 3_900);
}

function createTelegramPartialAnswerUpdater(
  env: Env,
  job: QuestionJob,
  statusMessageId: number,
): PartialAnswerHandler {
  return createTelegramProgressUpdater(async (text) => {
    try {
      await editTelegramMessage(env, job.chatId, statusMessageId, text, job.botConnectionId, false);
    } catch (error) {
      logger.warn("telegram_partial_answer_stream_failed", {
        requestId: job.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
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
    "Chalo, sawaal lao, seedha point pe aate hain!",
  ].join("\n");
}
function makeFatmanNoticePacket(answer: string): AnswerPacket {
  return {
    answer,
    responseMode: "text",
    sscTakeaway: "",
    answerScope: "ssc_support",
    subject: "other",
    topic: "General SSC doubt",
    questionMode: "fact",
    examRelevance: "B",
    difficulty: "medium",
    profileSignal: "neutral",
    profileNote: "",
    nextRevisionTopic: "",
    detectedExam: null,
    timeSensitive: false,
    quizQuestion: "",
    quizOptions: [],
    quizCorrectOptionIds: [],
    quizExplanation: "",
  };
}

function appendFatmanCitations(answer: string, citations: string): string {
  const cleanAnswer = answer
    .replace(/\n{0,2}(?:source|sources)\s*:\s*fatman[^\n]*/giu, "")
    .trim()
    .slice(0, 3_450);
  return citations ? cleanAnswer + "\n\n" + citations : cleanAnswer;
}

function buildHelpText(): string {
  return [
    "Set your SSC target exam /exam",
    "View your SSC study profile /profile",
    "Reset your study profile /reset",
    "Delete your study data /delete_data",
    "Fatman book mode /fatman on /fatman off",
  ].join("\n\n");
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
    `📚 Tumhari ${BOT_BRAND_NAME} Study Profile`,
    `Target: ${profile.targetExam}`,
    `Questions tracked: ${profile.questionCount}`,
    `Today: ${usage.unlimited ? "Unlimited AI access" : `${usage.dayCount}/${usage.dailyLimit} questions`}`,
    "",
    `Recent focus: ${recent.length ? recent.join(" • ") : "abhi nahi"}`,
    `Attention areas: ${attention.length ? attention.join(" • ") : "abhi koi clear weak area nahi"}`,
    `Revision queue: ${revision.length ? revision.join(" → ") : "abhi build ho rahi hai"}`,
    `Learning signals: ${signals.length ? signals.map((item) => `${item.topic} (${item.confusionCount + item.weakCount})`).join(" • ") : "abhi enough evidence nahi"}`,
    "",
    `Ye profile sirf tumhare ${BOT_BRAND_NAME} questions se banti hai.`,
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
    `Reason: ${BOT_BRAND_NAME} tumhare recent doubts aur repeated attention areas ko priority de raha hai, random syllabus dump nahi.`,
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
    { command: "help", description: "Show help and commands" },
  ];
}

function syncTelegramCommandMenu(env: Env, botConnectionId: string): Promise<unknown> {
  return telegramApi(env, "setMyCommands", { commands: buildSetupCommands() }, botConnectionId);
}

async function syncTelegramWebhookForCallbacks(
  request: Request,
  env: Env,
  bot: { token: string; webhookSecret: string },
  requestId: string,
): Promise<boolean> {
  try {
    const webhookUrl = new URL(request.url).origin + "/telegram/webhook";
    const result = await telegramSetupMethod(
      env,
      "setWebhook",
      buildTelegramWebhookSetupPayload(webhookUrl, bot.webhookSecret, bot.token),
    );
    return result === true;
  } catch (error) {
    logger.warn("telegram_callback_webhook_sync_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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
  const webhookResult = await telegramSetupMethod(
    env,
    "setWebhook",
    buildTelegramWebhookSetupPayload(webhookUrl, webhookSecret, token),
  );

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
  if (error instanceof TelegramMediaError) return "Photo process nahi ho paayi. JPEG, PNG ya WebP bhejo; har photo 7 MB tak aur poora album 12 MB tak ho sakta hai. 🙏";
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

function isTelegramVideoMessage(message: TelegramMessage | undefined): boolean {
  return Boolean(
    message?.video ||
    message?.video_note ||
    message?.animation ||
    message?.document?.mime_type?.toLowerCase().startsWith("video/"),
  );
}

function getTelegramPhotoFileId(photos: TelegramMessage["photo"]): string | undefined {
  if (!Array.isArray(photos)) return undefined;
  const largest = [...photos]
    .filter((photo) => typeof photo?.file_id === "string" && photo.file_id.trim())
    .sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)))[0];
  return largest?.file_id?.trim();
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

function creatorContactPage(): Response {
  const creatorEmail = "idoctorprojects@gmail.com";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f5f5f2">
  <meta name="robots" content="noindex,nofollow">
  <title>iDoctor Projects</title>
  <script src="https://telegram.org/js/telegram-web-app.js?64"></script>
  <style>
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f2;color:#171717;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
    *{box-sizing:border-box}
    body{margin:0;min-height:100svh;display:grid;place-items:center;padding:max(28px,env(safe-area-inset-top)) 22px max(28px,env(safe-area-inset-bottom));background:radial-gradient(ellipse at 50% 0%,#fff 0%,#f5f5f2 62%,#eeefec 100%)}
    main{display:flex;width:min(100%,410px);flex-direction:column;align-items:center;text-align:center}
    .trust-badge{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;gap:13px;min-height:66px;max-width:100%;margin:0 0 38px;padding:9px 20px 9px 11px;border:1px solid #ffffffd9;border-radius:999px;background:#ffffffb5;box-shadow:0 10px 30px #25251f10,0 2px 5px #25251f08;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:surface-breathe 5.8s ease-in-out infinite}
    .trust-badge::before{position:absolute;z-index:2;top:-45%;bottom:-45%;left:-43%;width:44%;content:"";pointer-events:none;background:linear-gradient(105deg,transparent 0%,#ffffff26 28%,#ffffffd1 50%,#ffffff40 70%,transparent 100%);filter:blur(2px);transform:translateX(0);animation:badge-shimmer 5.6s ease-in-out infinite}
    .avatars{position:relative;z-index:1;display:flex;flex:none;align-items:center;padding-left:2px}
    .avatar{display:grid;width:43px;height:43px;place-items:center;overflow:hidden;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 7px #24241f20}
    .avatar+.avatar{margin-left:-13px}
    .avatar svg{width:26px;height:26px}
    .avatar-one{background:linear-gradient(145deg,#d9e8ed,#b9cbd1)}
    .avatar-two{background:linear-gradient(145deg,#ead9d3,#d7b9ad)}
    .avatar-three{background:linear-gradient(145deg,#e2dff0,#c9c4dd)}
    .trust-copy{position:relative;z-index:1;white-space:nowrap;background:linear-gradient(100deg,#78afcb 0%,#aaa2c0 38%,#d995a7 70%,#e99583 100%);background-clip:text;-webkit-background-clip:text;color:transparent;font-size:14px;font-weight:630;letter-spacing:-.025em}
    h1{margin:0;font-size:36px;font-weight:620;letter-spacing:-.055em;line-height:1.08}
    .intro{margin:10px 0 28px;color:#777772;font-size:15px;line-height:1.5;letter-spacing:-.01em}
    .contact-button{display:flex;width:min(100%,280px);min-height:58px;align-items:center;justify-content:center;gap:12px;padding:0 22px;border:1px solid #171717;border-radius:999px;background:#171717;color:#fff;font:600 16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.015em;box-shadow:0 8px 20px #1717171a;cursor:pointer;transition:transform .15s ease,background .15s ease}
    .contact-button:hover{background:#2b2b29}
    .contact-button:active{transform:scale(.985)}
    .contact-button:focus-visible,.email-copy:focus-visible{outline:3px solid #6b8cff;outline-offset:4px}
    .gmail-icon{width:25px;height:25px;flex:none}
    .contact-details{width:min(100%,340px);margin-top:25px;padding:22px 20px 18px;border:1px solid #ffffffdc;border-radius:23px;background:#ffffffa8;box-shadow:0 16px 42px #25251f0d;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
    .contact-details[hidden]{display:none}
    .email-label{margin:0 0 12px;color:#777772;font-size:14px;font-weight:520}
    .email-copy{display:flex;width:100%;min-height:52px;align-items:center;justify-content:space-between;gap:8px;padding:0 11px;border:1px solid #17171712;border-radius:15px;background:#ffffffc9;color:#171717;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
    .email-copy:active{background:#f5f5f2}
    .email-address{flex:none;white-space:nowrap;overflow-wrap:normal;font-size:clamp(11px,3.8vw,13px);letter-spacing:-.02em}
    .copy-hint{display:grid;width:18px;height:18px;flex:none;place-items:center;color:#8a8a84}.copy-hint svg{display:block;width:17px;height:17px}.copy-hint svg[hidden]{display:none}
    .copy-status{min-height:18px;margin:10px 0 0;color:#85857f;font-size:12px;line-height:1.5}
    @keyframes badge-shimmer{0%,18%{transform:translateX(0);opacity:0}22%{opacity:.9}58%{transform:translateX(330%);opacity:.85}68%,100%{transform:translateX(330%);opacity:0}}
    @keyframes surface-breathe{0%,100%{box-shadow:0 10px 30px #25251f10,0 2px 5px #25251f08}50%{box-shadow:0 12px 34px #25251f12,0 2px 6px #25251f09}}
    @media(max-width:360px){.trust-badge{gap:9px;padding-right:14px}.avatar{width:39px;height:39px}.avatar+.avatar{margin-left:-12px}.trust-copy{font-size:13px}}
    @media(prefers-reduced-motion:reduce){.trust-badge,.trust-badge::before{animation:none}.contact-button{transition:none}}
  </style>
</head>
<body>
  <main>
    <div class="trust-badge" aria-label="Trusted by 115,000 users">
      <div class="avatars" aria-hidden="true">
        <span class="avatar avatar-one"><svg viewBox="0 0 32 32"><circle cx="16" cy="11" r="6" fill="#806d67"/><path d="M5 29c.8-7.2 4.7-11 11-11s10.2 3.8 11 11" fill="#a88b80"/></svg></span>
        <span class="avatar avatar-two"><svg viewBox="0 0 32 32"><circle cx="16" cy="11" r="6" fill="#8c5f4e"/><path d="M5 29c.8-7.2 4.7-11 11-11s10.2 3.8 11 11" fill="#bd8570"/></svg></span>
        <span class="avatar avatar-three"><svg viewBox="0 0 32 32"><circle cx="16" cy="11" r="6" fill="#625d72"/><path d="M5 29c.8-7.2 4.7-11 11-11s10.2 3.8 11 11" fill="#89849b"/></svg></span>
      </div>
      <span class="trust-copy">Trusted by 115k users</span>
    </div>
    <h1>iDoctor Projects</h1>
    <p class="intro">Have a question? We’re listening.</p>
    <button class="contact-button" id="contact-toggle" type="button" aria-expanded="false" aria-controls="email-contact">
      <svg class="gmail-icon" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M8 14v22" fill="none" stroke="#4285f4" stroke-linecap="round" stroke-width="4"/>
        <path d="M40 14v22" fill="none" stroke="#34a853" stroke-linecap="round" stroke-width="4"/>
        <path d="M8 14 24 27 40 14" fill="none" stroke="#ea4335" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"/>
        <path d="m8 36 10-9" fill="none" stroke="#fbbc04" stroke-linecap="round" stroke-width="4"/>
        <path d="m40 36-10-9" fill="none" stroke="#ea4335" stroke-linecap="round" stroke-width="4"/>
      </svg>
      <span>Contact</span>
    </button>
    <section class="contact-details" id="email-contact" hidden aria-labelledby="email-title">
      <p class="email-label" id="email-title">Send an email to</p>
      <button class="email-copy" id="copy-email" type="button" aria-label="Copy ${creatorEmail}">
        <span class="email-address">${creatorEmail}</span><span class="copy-hint" aria-hidden="true"><svg id="copy-icon" viewBox="0 0 20 20"><rect x="6" y="6" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 4V3.5A1.5 1.5 0 0 0 11.5 2h-8A1.5 1.5 0 0 0 2 3.5v8A1.5 1.5 0 0 0 3.5 13H4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><svg id="copied-icon" viewBox="0 0 20 20" hidden><path d="m3.5 10.5 4.2 4.2L16.5 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></span>
      </button>
      <p class="copy-status" id="copy-status" aria-live="polite"></p>
    </section>
  </main>
  <script>
    const email = "${creatorEmail}";
    const contactToggle = document.getElementById("contact-toggle");
    const contactDetails = document.getElementById("email-contact");
    const copyEmailButton = document.getElementById("copy-email");
    const copyIcon = document.getElementById("copy-icon");
    const copiedIcon = document.getElementById("copied-icon");
    const copyStatus = document.getElementById("copy-status");

    contactToggle.addEventListener("click", () => {
      const isExpanded = contactToggle.getAttribute("aria-expanded") === "true";
      contactToggle.setAttribute("aria-expanded", String(!isExpanded));
      contactDetails.hidden = isExpanded;
    });

    function fallbackCopyEmail() {
      const field = document.createElement("textarea");
      field.value = email;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    }

    copyEmailButton.addEventListener("click", async () => {
      try {
        try {
          await navigator.clipboard.writeText(email);
        } catch {
          if (!fallbackCopyEmail()) throw new Error("Clipboard unavailable");
        }
        copyIcon.hidden = true;
        copiedIcon.hidden = false;
        copyStatus.textContent = "Copied to clipboard.";
        window.setTimeout(() => {
          copiedIcon.hidden = true;
          copyIcon.hidden = false;
        }, 1100);
      } catch {
        copyStatus.textContent = "Copy didn’t work. Press and hold the address to copy it.";
      }
    });

    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/contact") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        return withRequestId(creatorContactPage(), requestId);
      }

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

      if (url.pathname === "/admin/fatman") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        if (!(await requireAdmin(request, env))) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        return fatmanAdminPage();
      }

      if (url.pathname === "/admin/fatman/monitor") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        if (!(await requireAdmin(request, env))) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        return fatmanMonitorPage();
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        if (request.method !== "GET") return withRequestId(methodNotAllowed(["GET"]), requestId);
        if (!(await requireAdmin(request, env))) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        return adminDashboard(env);
      }

      if (url.pathname.startsWith("/admin/api/")) {
        if (!(await requireAdmin(request, env))) return withRequestId(json({ ok: false, error: "unauthorized" }, 401), requestId);
        if (url.pathname === "/admin/api/fatman/monitor" && request.method === "GET") return fatmanMonitorStatus(env);
        if (url.pathname === "/admin/api/fatman/qa" && request.method === "GET") return fatmanReleaseQaStatus(env);
        if (url.pathname === "/admin/api/fatman/status" && request.method === "GET") return fatmanIndexStatus(env);
        if (url.pathname === "/admin/api/fatman/upload/status" && request.method === "GET") return fatmanUploadStatus(env, url.searchParams.get("id"));
        if (request.method === "POST" && url.pathname.startsWith("/admin/api/fatman/")) {
          if (!isSameOriginAdminRequest(request, url.origin)) return withRequestId(json({ ok: false, error: "csrf_origin_rejected" }, 403), requestId);
          if (url.pathname === "/admin/api/fatman/qa") return triggerFatmanReleaseQa(env);
          if (url.pathname === "/admin/api/fatman/vision/test") return testFatmanVision(env);
          if (url.pathname === "/admin/api/fatman/upload/start") return startFatmanUpload(env, request);
          const uploadChunkMatch = url.pathname.match(/^\/admin\/api\/fatman\/upload\/([a-f0-9-]+)\/chunk$/i);
          if (uploadChunkMatch) return uploadFatmanChunk(env, request, uploadChunkMatch[1]);
          const uploadResumeMatch = url.pathname.match(/^\/admin\/api\/fatman\/upload\/([a-f0-9-]+)\/resume$/i);
          if (uploadResumeMatch) return resumeFatmanImport(env, uploadResumeMatch[1]);
          const uploadCompleteMatch = url.pathname.match(/^\/admin\/api\/fatman\/upload\/([a-f0-9-]+)\/complete$/i);
          if (uploadCompleteMatch) return completeFatmanUpload(env, uploadCompleteMatch[1]);
          if (url.pathname === "/admin/api/fatman/prepare") return prepareFatmanIndex(env);
          if (url.pathname === "/admin/api/fatman/preview") return previewFatmanIndex(env, request);
          if (url.pathname === "/admin/api/fatman/finalize") return finalizeFatmanIndex(env, request);
          if (url.pathname === "/admin/api/fatman/disable") return disableFatmanIndex(env);
          const pagePrefix = "/admin/api/fatman/page/";
          if (url.pathname.startsWith(pagePrefix)) {
            const pageNumber = Number(url.pathname.slice(pagePrefix.length));
            return uploadFatmanPage(env, request, pageNumber);
          }
        }
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

    try {
      if (
        !env.DB ||
        !env.FATMAN_IMPORT ||
        env.FATMAN_ENABLED?.trim().toLowerCase() !== "true" ||
        !env.FATMAN_DOCUMENT_VERSION?.trim()
      ) return;

      await ensureAnalyticsSchema(env);
      const importJob = await env.DB.prepare(
        "SELECT id, status, expected_size, uploaded_bytes, indexed_pages FROM fatman_import_jobs ORDER BY updated_at DESC LIMIT 1"
      ).first<{
        id: string;
        status: string;
        expected_size: number;
        uploaded_bytes: number;
        indexed_pages: number;
      }>();
      if (
        !importJob ||
        importJob.status !== "completed" ||
        Number(importJob.uploaded_bytes) !== Number(importJob.expected_size) ||
        Number(importJob.indexed_pages) !== 538
      ) return;

      const now = Date.now();
      const latest = await getLatestFatmanReleaseQaRun(env);
      if (latest && latest.documentVersion === env.FATMAN_DOCUMENT_VERSION.trim()) {
        const age = now - latest.startedAt;
        if (latest.status === "running" && age < 60 * 60 * 1_000) return;
        if (latest.status !== "running" && age < 20 * 60 * 60 * 1_000) return;
      }

      const day = new Date(now).toISOString().slice(0, 10).replace(/-/gu, "");
      await env.FATMAN_IMPORT.create({
        id: "fatman-qa-" + day,
        params: {
          task: "release_qa",
          importId: importJob.id,
          runId: day,
        },
      });
      logger.info("fatman_scheduled_release_qa_started", {
        importId: importJob.id,
        documentVersion: env.FATMAN_DOCUMENT_VERSION.trim(),
      });
    } catch (error) {
      logger.warn("fatman_scheduled_release_qa_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

export default worker;
export { JobDedupe };
