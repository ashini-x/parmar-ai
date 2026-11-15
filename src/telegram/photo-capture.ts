import type { Env } from "../config/env";

const CAPTURE_CAPTION = "Current BRɅIN contact image 2.";
const CAPTURE_KEY = "brvin-contact-image";
const CAPTURE_TTL_MS = 30 * 60 * 1000;

export interface TelegramPhotoCandidate {
  file_id?: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export async function captureBrvinContactPhoto(
  env: Env,
  input: {
    senderId?: number;
    chatId: number;
    chatType?: string;
    messageId: number;
    caption: string;
    photos?: TelegramPhotoCandidate[];
  },
  now = Date.now(),
): Promise<boolean> {
  if (env.TELEGRAM_PHOTO_CAPTURE_ENABLED !== "true") return false;

  const ownerId = Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "");
  if (
    !Number.isSafeInteger(ownerId) ||
    ownerId <= 0 ||
    input.senderId !== ownerId ||
    input.chatId !== ownerId ||
    input.chatType !== "private" ||
    input.caption !== CAPTURE_CAPTION ||
    !env.DB
  ) return false;

  const photo = [...(input.photos ?? [])]
    .filter((candidate) => typeof candidate.file_id === "string" && candidate.file_id.length > 0)
    .sort((a, b) => {
      const aSize = a.file_size ?? (a.width ?? 0) * (a.height ?? 0);
      const bSize = b.file_size ?? (b.width ?? 0) * (b.height ?? 0);
      return bSize - aSize;
    })[0];
  if (!photo?.file_id) return false;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS telegram_photo_capture (
      capture_key TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      file_unique_id TEXT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
  ).run();

  await env.DB.prepare(
    "DELETE FROM telegram_photo_capture WHERE expires_at <= ?",
  ).bind(now).run();

  await env.DB.prepare(
    `INSERT INTO telegram_photo_capture
      (capture_key, file_id, file_unique_id, chat_id, message_id, captured_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_key) DO UPDATE SET
       file_id=excluded.file_id,
       file_unique_id=excluded.file_unique_id,
       chat_id=excluded.chat_id,
       message_id=excluded.message_id,
       captured_at=excluded.captured_at,
       expires_at=excluded.expires_at`,
  ).bind(
    CAPTURE_KEY,
    photo.file_id,
    photo.file_unique_id ?? null,
    input.chatId,
    input.messageId,
    now,
    now + CAPTURE_TTL_MS,
  ).run();

  return true;
}
