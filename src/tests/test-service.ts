import type { Env } from "../config/env";
import {
  validateTelegramInitData,
  type TelegramWebAppUser,
} from "../telegram/webapp-auth";

interface QuestionRow {
  id: number;
  exam: string;
  tier: string | null;
  year: number | null;
  shift: string | null;
  subject: string;
  topic: string | null;
  difficulty: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

interface UserRow {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
}

interface StartTestResult {
  attemptId: number;
  totalQuestions: number;
  questions: QuestionRow[];
}

async function getOrCreateUser(
  env: Env,
  telegramUser: TelegramWebAppUser,
): Promise<UserRow> {
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
        last_seen_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      telegramUser.id,
      telegramUser.username ?? null,
      telegramUser.first_name ?? null,
    )
    .run();

  const user =
    await env.DB
      .prepare(
        `SELECT
          id,
          telegram_id,
          username,
          first_name
        FROM users
        WHERE telegram_id = ?
        LIMIT 1`,
      )
      .bind(telegramUser.id)
      .first<UserRow>();

  if (!user) {
    throw new Error(
      "user_creation_failed",
    );
  }

  return user;
}

export async function startMathsTest(
  env: Env,
  initData: string,
): Promise<StartTestResult> {
  const botToken =
    env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    throw new Error(
      "telegram_bot_token_missing",
    );
  }

  const validated =
    await validateTelegramInitData(
      initData,
      botToken,
    );

  const user =
    await getOrCreateUser(
      env,
      validated.user,
    );

  const questionResult =
    await env.DB
      .prepare(
        `SELECT
          id,
          exam,
          tier,
          year,
          shift,
          subject,
          topic,
          difficulty,
          question_text,
          option_a,
          option_b,
          option_c,
          option_d
        FROM questions
        WHERE is_active = 1
          AND subject = ?
        ORDER BY RANDOM()
        LIMIT 10`,
      )
      .bind("Maths")
      .all<QuestionRow>();

  const questions =
    questionResult.results;

  if (questions.length < 10) {
    throw new Error(
      `not_enough_questions:${questions.length}`,
    );
  }

  const attemptResult =
    await env.DB
      .prepare(
        `INSERT INTO attempts (
          user_id,
          total_questions
        )
        VALUES (?, ?)`,
      )
      .bind(
        user.id,
        questions.length,
      )
      .run();

  const attemptId =
    attemptResult.meta.last_row_id;

  if (!attemptId) {
    throw new Error(
      "attempt_creation_failed",
    );
  }

  const statements =
    questions.map(
      (question, index) =>
        env.DB
          .prepare(
            `INSERT INTO attempt_questions (
              attempt_id,
              question_id,
              position
            )
            VALUES (?, ?, ?)`,
          )
          .bind(
            attemptId,
            question.id,
            index + 1,
          ),
    );

  await env.DB.batch(
    statements,
  );

  return {
    attemptId,
    totalQuestions:
      questions.length,
    questions,
  };
}
