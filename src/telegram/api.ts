import type { Env, GeminiImageInput } from "../config/env";
import { MAX_PHOTO_COUNT, MAX_SINGLE_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES } from "../config/env";
import { getActiveTelegramBot, getTelegramBotApiToken, hasTelegramBotRecords } from "./bot-store";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4_096;

const CREATOR_NAME = "BRɅIN";
const CREATOR_TELEGRAM_URL = "tg://resolve?domain=projectbrain&profile";
function limitTelegramMessage(text: string): { text: string } {
  return { text: text.trim().slice(0, TELEGRAM_MAX_MESSAGE_LENGTH) };
}

function limitTelegramPollExplanation(explanation: string): string {
  return explanation.trim().replace(/\s*\n+\s*/gu, " ").slice(0, 200);
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<Record<string, unknown>>>;
}

interface CreatorContactKeyboardMarkup {
  inline_keyboard: Array<Array<{
    text: string;
    url: string;
  }>>;
}

export function buildFatmanModeMarkup(active: boolean): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: active ? "Fatman ON ✓" : "Enter Fatman",
        callback_data: "fatman:enter",
      },
      {
        text: "Exit Fatman",
        callback_data: "fatman:exit",
      },
    ]],
  };
}

export function buildFatmanStartMarkup(): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "Start Fatman", callback_data: "fatman:enter" }]] };
}

export function buildFatmanExitMarkup(): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "Exit Fatman", callback_data: "fatman:exit" }]] };
}

function mergeInlineKeyboard(
  custom: TelegramInlineKeyboardMarkup | undefined,
  creator: CreatorContactKeyboardMarkup | undefined,
): TelegramInlineKeyboardMarkup | CreatorContactKeyboardMarkup | undefined {
  if (!custom) return creator;
  return {
    inline_keyboard: [
      ...custom.inline_keyboard,
      ...(creator?.inline_keyboard ?? []),
    ],
  };
}

function creatorContactMarkup(chatId: number, includeCreatorFooter = true): CreatorContactKeyboardMarkup | undefined {
  if (!includeCreatorFooter || chatId <= 0) return undefined;
  return {
    inline_keyboard: [[{
      text: CREATOR_NAME,
      url: CREATOR_TELEGRAM_URL,
    }]],
  };
}

const TELEGRAM_REQUEST_TIMEOUT_MS = 5_000;
const TELEGRAM_MAX_ATTEMPTS = 4;

/**
 * Telegram's retry_after value is authoritative. Do not cap it to a short
 * local delay: retrying before Telegram's requested time can produce another
 * 429 and consume the remaining attempt budget.
 */
export function getTelegramRetryDelayMs(retryAfterSeconds?: number): number {
  if (
    typeof retryAfterSeconds !== "number" ||
    !Number.isFinite(retryAfterSeconds) ||
    retryAfterSeconds <= 0
  ) {
    return 1_000;
  }

  return Math.max(250, Math.ceil(retryAfterSeconds * 1_000));
}

export interface TelegramMessageResult {
  message_id: number;
}

export interface TelegramQuizResult {
  message_id: number;
  poll_id: string;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export class TelegramError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function telegramApi<T = unknown>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
  botConnectionId?: string,
): Promise<T> {
  const token = await resolveTelegramToken(env, botConnectionId);
  return telegramApiWithToken<T>(token, method, payload);
}

interface TelegramApiRetryOptions {
  timeoutMs?: number;
  maxAttempts?: number;
}

async function telegramApiWithToken<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  options: TelegramApiRetryOptions = {},
): Promise<T> {
  let lastError: TelegramError | null = null;
  const timeoutMs = Math.max(250, options.timeoutMs ?? TELEGRAM_REQUEST_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.min(TELEGRAM_MAX_ATTEMPTS, options.maxAttempts ?? TELEGRAM_MAX_ATTEMPTS));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      const raw = await response.text();
      let data: TelegramApiResponse<T>;

      try {
        data = JSON.parse(raw) as TelegramApiResponse<T>;
      } catch {
        throw new TelegramError(
          `Telegram returned invalid JSON (HTTP ${response.status}).`,
          response.status,
          response.status >= 500,
        );
      }

      if (response.ok && data.ok) {
        return data.result as T;
      }

      const error = new TelegramError(
        data.description ??
          `Telegram API request failed (HTTP ${response.status}).`,
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
      lastError = error;

      if (!error.retryable || attempt >= maxAttempts) {
        throw error;
      }

      await sleep(getTelegramRetryDelayMs(data.parameters?.retry_after));
    } catch (error) {
      const telegramError =
        error instanceof TelegramError
          ? error
          : error instanceof Error && error.name === "AbortError"
            ? new TelegramError(
                `Telegram API timed out after ${timeoutMs}ms.`,
                undefined,
                true,
              )
            : new TelegramError(
                error instanceof Error ? error.message : String(error),
                undefined,
                true,
              );

      lastError = telegramError;

      if (!telegramError.retryable || attempt >= maxAttempts) {
        throw telegramError;
      }

      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new TelegramError("Telegram API request failed.", undefined, true);
}


async function resolveTelegramToken(env: Env, botConnectionId?: string): Promise<string> {
  let token: string | undefined;
  if (botConnectionId) {
    token = (await getTelegramBotApiToken(env, botConnectionId)) ?? undefined;
  } else {
    const active = await getActiveTelegramBot(env);
    if (active) {
      token = active.token;
    } else if (!(await hasTelegramBotRecords(env))) {
      token = env.TELEGRAM_BOT_TOKEN?.trim();
    }
  }
  if (!token) throw new TelegramError("Telegram bot is not connected.");
  return token;
}

interface TelegramFileResult {
  file_path?: string;
  file_size?: number;
}

export class TelegramMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramMediaError";
  }
}

export async function downloadTelegramPhotos(
  env: Env,
  fileIds: string[],
  botConnectionId?: string,
): Promise<GeminiImageInput[]> {
  if (!fileIds.length || fileIds.length > MAX_PHOTO_COUNT) {
    throw new TelegramMediaError(`Send between 1 and ${MAX_PHOTO_COUNT} photos in one doubt.`);
  }

  const token = await resolveTelegramToken(env, botConnectionId);
  const files = await Promise.all(
    fileIds.map((fileId) =>
      telegramApiWithToken<TelegramFileResult>(token, "getFile", { file_id: fileId }),
    ),
  );
  const photos = files.map((file) => {
    const filePath = file.file_path?.trim() ?? "";
    if (!filePath || filePath.includes("..") || !/^[A-Za-z0-9_./-]+$/u.test(filePath)) {
      throw new TelegramMediaError("Telegram could not provide a usable photo file.");
    }
    const fileSize = Number.isSafeInteger(file.file_size) && Number(file.file_size) > 0
      ? Number(file.file_size)
      : undefined;
    return { filePath, fileSize };
  });

  const allSizesKnown = photos.every((photo) => photo.fileSize !== undefined);
  if (allSizesKnown) {
    const advertisedTotal = photos.reduce((total, photo) => total + (photo.fileSize ?? 0), 0);
    if (
      photos.some((photo) => (photo.fileSize ?? 0) > MAX_SINGLE_PHOTO_BYTES) ||
      advertisedTotal > MAX_TOTAL_PHOTO_BYTES
    ) {
      throw new TelegramMediaError("Photos must be 7 MB or smaller each and 12 MB or smaller in total.");
    }

    const controllers: AbortController[] = [];
    try {
      const downloads = photos.map((photo) => {
        const controller = new AbortController();
        controllers.push(controller);
        return downloadTelegramPhotoFile(token, photo.filePath, photo.fileSize!, controller);
      });
      return await Promise.all(downloads);
    } catch (error) {
      controllers.forEach((controller) => controller.abort());
      throw error;
    }
  }

  const images: GeminiImageInput[] = [];
  let totalBytes = 0;
  for (const photo of photos) {
    const maxBytes = Math.min(MAX_SINGLE_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES - totalBytes);
    if (maxBytes <= 0 || (photo.fileSize !== undefined && photo.fileSize > maxBytes)) {
      throw new TelegramMediaError("Photos must be 7 MB or smaller each and 12 MB or smaller in total.");
    }
    const image = await downloadTelegramPhotoFile(token, photo.filePath, maxBytes);
    totalBytes += image.byteLength;
    images.push(image);
  }
  return images;
}

async function downloadTelegramPhotoFile(
  token: string,
  filePath: string,
  maxBytes: number,
  controller = new AbortController(),
): Promise<GeminiImageInput> {
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TelegramError(
        `Telegram photo download failed (HTTP ${response.status}).`,
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new TelegramMediaError("Photos must be 7 MB or smaller each and 12 MB or smaller in total.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new TelegramError("Telegram photo download returned no body.", undefined, true);
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        byteLength += item.value.byteLength;
        if (byteLength > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new TelegramMediaError("Photos must be 7 MB or smaller each and 12 MB or smaller in total.");
        }
        chunks.push(item.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof TelegramMediaError || error instanceof TelegramError) throw error;
      throw new TelegramError("Telegram photo download was interrupted.", undefined, true);
    }

    if (byteLength === 0) throw new TelegramMediaError("Telegram returned an empty photo.");
    const mimeType = resolvePhotoMimeType(response.headers.get("content-type"), filePath);
    if (!mimeType) throw new TelegramMediaError("Use a JPEG, PNG, or WebP photo.");
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { mimeType, data: bytesToBase64(bytes), byteLength };
  } catch (error) {
    if (error instanceof TelegramMediaError || error instanceof TelegramError) throw error;
    throw new TelegramError(
      error instanceof Error && error.name === "AbortError" ? "Telegram photo download timed out." : "Telegram photo download failed.",
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function resolvePhotoMimeType(contentType: string | null, filePath: string): GeminiImageInput["mimeType"] | null {
  const header = contentType?.split(";")[0]?.trim().toLowerCase();
  if (header === "image/jpeg" || header === "image/png" || header === "image/webp") return header;
  if (header && header !== "application/octet-stream" && header !== "binary/octet-stream") return null;
  const extension = filePath.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 24_576;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function sendTelegramQuiz(
  env: Env,
  chatId: number,
  question: string,
  options: string[],
  correctOptionIds: number[],
  explanation: string,
  replyToMessageId?: number,
  botConnectionId?: string,
  includeCreatorFooter = true,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<TelegramQuizResult> {
  const pollExplanation = limitTelegramPollExplanation(explanation);
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  const result = await telegramApi<{
    message_id: number;
    poll?: { id: string };
  }>(env, "sendPoll", {
    chat_id: chatId,
    question: question.trim().slice(0, 300),
    options: options.map((text) => ({ text: text.trim().slice(0, 100) })).slice(0, 12),
    is_anonymous: false,
    type: "quiz",
    allows_multiple_answers: false,
    allows_revoting: false,
    correct_option_ids: [...correctOptionIds].sort((a, b) => a - b),
    explanation: pollExplanation,
    ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
    ...(replyToMessageId ? {
      reply_parameters: {
        message_id: replyToMessageId,
        allow_sending_without_reply: true,
      },
    } : {}),
  }, botConnectionId);
  const pollId = String(result.poll?.id ?? "").trim();
  if (!pollId) throw new TelegramError("Telegram sent the quiz but did not return a poll ID.");
  return { message_id: result.message_id, poll_id: pollId };
}

export async function deleteTelegramMessage(
  env: Env,
  chatId: number,
  messageId: number,
  botConnectionId?: string,
): Promise<void> {
  await telegramApi(env, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  }, botConnectionId);
}

export async function stopTelegramPoll(
  env: Env,
  chatId: number,
  messageId: number,
  botConnectionId?: string,
): Promise<void> {
  await telegramApi(env, "stopPoll", {
    chat_id: chatId,
    message_id: messageId,
  }, botConnectionId);
}

export async function sendTelegramChatAction(
  env: Env,
  chatId: number,
  action: "typing" = "typing",
  botConnectionId?: string,
): Promise<void> {
  await telegramApi(env, "sendChatAction", {
    chat_id: chatId,
    action,
  }, botConnectionId);
}

export async function sendTelegramBusinessMessage(
  env: Env,
  chatId: number,
  replyToMessageId: number,
  businessConnectionId: string,
  text: string,
  botConnectionId?: string,
): Promise<TelegramMessageResult> {
  const message = limitTelegramMessage(text);
  return telegramApi<TelegramMessageResult>(env, "sendMessage", {
    chat_id: chatId,
    business_connection_id: businessConnectionId,
    reply_parameters: {
      message_id: replyToMessageId,
      allow_sending_without_reply: true,
    },
    text: message.text,
    link_preview_options: { is_disabled: true },
  }, botConnectionId);
}

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  replyToMessageId?: number,
  botConnectionId?: string,
  includeCreatorFooter = true,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<TelegramMessageResult> {
  const message = limitTelegramMessage(text);
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: message.text,
    ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
    link_preview_options: { is_disabled: true },
  };

  if (replyToMessageId) {
    payload.reply_parameters = {
      message_id: replyToMessageId,
      allow_sending_without_reply: true,
    };
  }

  return telegramApi<TelegramMessageResult>(env, "sendMessage", payload, botConnectionId);
}

export async function editTelegramMessageReplyMarkup(
  env: Env,
  chatId: number,
  messageId: number,
  replyMarkup: TelegramInlineKeyboardMarkup,
  botConnectionId?: string,
  includeCreatorFooter = true,
): Promise<void> {
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  try {
    await telegramApi(env, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
    }, botConnectionId);
  } catch (error) {
    if (error instanceof TelegramError && error.message.toLowerCase().includes("message is not modified")) return;
    throw error;
  }
}

/**
 * Cosmetic progress edits use one short Telegram attempt. They must never hold
 * answer generation or final delivery behind the normal multi-attempt API retry.
 */
export async function editTelegramProgressMessage(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  botConnectionId?: string,
): Promise<void> {
  const token = await resolveTelegramToken(env, botConnectionId);
  const message = limitTelegramMessage(text);
  try {
    await telegramApiWithToken(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: message.text,
      link_preview_options: { is_disabled: true },
    }, { timeoutMs: 1_000, maxAttempts: 1 });
  } catch (error) {
    if (error instanceof TelegramError && error.message.toLowerCase().includes("message is not modified")) return;
    throw error;
  }
}

export async function editTelegramMessage(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  botConnectionId?: string,
  includeCreatorFooter = true,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  const message = limitTelegramMessage(text);
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  try {
    await telegramApi(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: message.text,
      ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
      link_preview_options: { is_disabled: true },
    }, botConnectionId);
  } catch (error) {
    if (
      error instanceof TelegramError &&
      error.message.toLowerCase().includes("message is not modified")
    ) {
      return;
    }

    throw error;
  }
}

/**
 * Token-bound calls for the short acknowledgement window. The webhook has
 * already authenticated and decrypted this connection, so it can reuse that
 * credential instead of performing another D1 lookup before first feedback.
 */
export async function sendTelegramChatActionWithToken(
  token: string,
  chatId: number,
): Promise<void> {
  await telegramApiWithToken(token, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });
}

export async function deleteTelegramMessageWithToken(
  token: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  await telegramApiWithToken(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

/**
 * Send the prerecorded start greeting as a Telegram voice note. The file is
 * hosted publicly so Telegram can fetch it directly without a multipart
 * upload from the Worker. Silent delivery avoids a second notification after
 * the synchronous welcome text.
 */
export async function sendTelegramVoiceWithToken(
  token: string,
  chatId: number,
  voiceUrl: string,
  includeCreatorFooter = true,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<TelegramMessageResult> {
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  return telegramApiWithToken<TelegramMessageResult>(token, "sendVoice", {
    chat_id: chatId,
    voice: voiceUrl,
    disable_notification: true,
    ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
  });
}

export async function sendTelegramMessageWithToken(
  token: string,
  chatId: number,
  text: string,
  replyToMessageId?: number,
  includeCreatorFooter = true,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<TelegramMessageResult> {
  const message = limitTelegramMessage(text);
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  const combinedMarkup = mergeInlineKeyboard(replyMarkup, creatorMarkup);
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: message.text,
    ...(combinedMarkup ? { reply_markup: combinedMarkup } : {}),
    link_preview_options: { is_disabled: true },
  };
  if (replyToMessageId) {
    payload.reply_parameters = {
      message_id: replyToMessageId,
      allow_sending_without_reply: true,
    };
  }
  return telegramApiWithToken<TelegramMessageResult>(token, "sendMessage", payload);
}

export async function editTelegramMessageWithToken(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  includeCreatorFooter = true,
): Promise<void> {
  const message = limitTelegramMessage(text);
  const creatorMarkup = creatorContactMarkup(chatId, includeCreatorFooter);
  try {
    await telegramApiWithToken(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: message.text,
      ...(creatorMarkup ? { reply_markup: creatorMarkup } : {}),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (error instanceof TelegramError && error.message.toLowerCase().includes("message is not modified")) return;
    throw error;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
