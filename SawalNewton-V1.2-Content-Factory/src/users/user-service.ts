import type { Env } from "../config/env";
import {
  validateTelegramInitData,
  type TelegramWebAppUser
} from "../telegram/webapp-auth";

export const SUPPORTED_LANGUAGES = ["en", "hi"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export interface UserRow {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
}

export interface UserWithPreference extends UserRow {
  language: Language | null;
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "hi";
}

export async function getOrCreateUser(
  env: Env,
  telegramUser: TelegramWebAppUser
): Promise<UserWithPreference> {
  await env.DB
    .prepare(
      `INSERT INTO users (
        telegram_id,
        username,
        first_name,
        last_seen_at
      )
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id)
      DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_seen_at = CURRENT_TIMESTAMP`
    )
    .bind(
      telegramUser.id,
      telegramUser.username ?? null,
      telegramUser.first_name ?? null
    )
    .run();

  const user = await env.DB
    .prepare(
      `SELECT
        u.id,
        u.telegram_id,
        u.username,
        u.first_name,
        up.language
      FROM users u
      LEFT JOIN user_preferences up
        ON up.user_id = u.id
      WHERE u.telegram_id = ?
      LIMIT 1`
    )
    .bind(telegramUser.id)
    .first<UserWithPreference>();

  if (!user) {
    throw new Error("user_creation_failed");
  }

  return user;
}

export async function setUserLanguage(
  env: Env,
  userId: number,
  language: Language
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO user_preferences (
        user_id,
        language,
        updated_at
      )
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id)
      DO UPDATE SET
        language = excluded.language,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(userId, language)
    .run();
}

export async function authenticateWebAppUser(
  env: Env,
  initData: string
) {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    throw new Error("telegram_bot_token_missing");
  }

  const validated = await validateTelegramInitData(
    initData,
    botToken
  );

  const user = await getOrCreateUser(env, validated.user);

  return { validated, user };
}
