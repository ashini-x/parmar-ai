import type { Env } from "../config/env";
import { getActiveTelegramBot, getTelegramBotByConnectionId, hasTelegramBotRecords } from "./bot-store";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4_096;

const TELEGRAM_REQUEST_TIMEOUT_MS = 5_000;
const TELEGRAM_MAX_ATTEMPTS = 4;
const TELEGRAM_MAX_RETRY_AFTER_SECONDS = 5;

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
  let token: string | undefined;
  if (botConnectionId) {
    token = (await getTelegramBotByConnectionId(env, botConnectionId))?.token;
  } else {
    const active = await getActiveTelegramBot(env);
    if (active) {
      token = active.token;
    } else if (!(await hasTelegramBotRecords(env))) {
      token = env.TELEGRAM_BOT_TOKEN?.trim();
    }
  }
  if (!token) throw new TelegramError("Telegram bot is not connected.");

  let lastError: TelegramError | null = null;

  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TELEGRAM_REQUEST_TIMEOUT_MS,
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

      if (!error.retryable || attempt >= TELEGRAM_MAX_ATTEMPTS) {
        throw error;
      }

      const retryAfter = Math.min(
        data.parameters?.retry_after ?? 1,
        TELEGRAM_MAX_RETRY_AFTER_SECONDS,
      );
      await sleep(Math.max(250, retryAfter * 1_000));
    } catch (error) {
      const telegramError =
        error instanceof TelegramError
          ? error
          : error instanceof Error && error.name === "AbortError"
            ? new TelegramError(
                `Telegram API timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms.`,
                undefined,
                true,
              )
            : new TelegramError(
                error instanceof Error ? error.message : String(error),
                undefined,
                true,
              );

      lastError = telegramError;

      if (!telegramError.retryable || attempt >= TELEGRAM_MAX_ATTEMPTS) {
        throw telegramError;
      }

      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new TelegramError("Telegram API request failed.", undefined, true);
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
): Promise<TelegramQuizResult> {
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
    explanation: explanation.trim().slice(0, 200),
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

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  replyToMessageId?: number,
  botConnectionId?: string,
): Promise<TelegramMessageResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.trim().slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
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

export async function editTelegramMessage(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  botConnectionId?: string,
): Promise<void> {
  try {
    await telegramApi(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.trim().slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
