import type { Env } from "../config/env";
import {
  validateTelegramInitData,
  type TelegramWebAppUser
} from "../telegram/webapp-auth";

export const TEST_DURATION_SECONDS = 5 * 60;
export const TEST_QUESTION_COUNT = 10;

const VALID_OPTIONS = new Set(["A", "B", "C", "D"]);

type QuestionRow = {
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
};

type UserRow = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
};

type AttemptRow = {
  id: number;
  user_id: number;
  started_at: string;
  finished_at: string | null;
  total_questions: number;
};

type AssignedQuestionRow = QuestionRow & {
  position: number;
  correct_option: string;
};

type StartTestResult = {
  attemptId: number;
  startedAt: string;
  durationSeconds: number;
  totalQuestions: number;
  questions: QuestionRow[];
};

type SubmitResult = {
  attemptId: number;
  score: number;
  totalQuestions: number;
  correct: number;
  wrong: number;
  unanswered: number;
  timeTakenSeconds: number;
  timedOut: boolean;
};

export type SubmittedAnswer = {
  questionId: number;
  selectedOption: string | null;
};

async function getOrCreateUser(
  env: Env,
  telegramUser: TelegramWebAppUser
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
        id,
        telegram_id,
        username,
        first_name
      FROM users
      WHERE telegram_id = ?
      LIMIT 1`
    )
    .bind(telegramUser.id)
    .first<UserRow>();

  if (!user) {
    throw new Error("user_creation_failed");
  }

  return user;
}

function mapQuestionForClient(
  question: QuestionRow
): QuestionRow {
  return question;
}

export async function startMathsTest(
  env: Env,
  initData: string
): Promise<StartTestResult> {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    throw new Error("telegram_bot_token_missing");
  }

  const validated = await validateTelegramInitData(
    initData,
    botToken
  );

  const user = await getOrCreateUser(env, validated.user);

  const questionResult = await env.DB
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
      LIMIT ?`
    )
    .bind("Maths", TEST_QUESTION_COUNT)
    .all<QuestionRow>();

  const questions = questionResult.results;

  if (questions.length < TEST_QUESTION_COUNT) {
    throw new Error(
      `not_enough_questions:${questions.length}`
    );
  }

  const attemptResult = await env.DB
    .prepare(
      `INSERT INTO attempts (
        user_id,
        total_questions
      )
      VALUES (?, ?)`
    )
    .bind(user.id, questions.length)
    .run();

  const attemptId = attemptResult.meta.last_row_id;

  if (!attemptId) {
    throw new Error("attempt_creation_failed");
  }

  const statements = questions.map((question, index) =>
    env.DB
      .prepare(
        `INSERT INTO attempt_questions (
          attempt_id,
          question_id,
          position
        )
        VALUES (?, ?, ?)`
      )
      .bind(attemptId, question.id, index + 1)
  );

  await env.DB.batch(statements);

  const attempt = await env.DB
    .prepare(
      `SELECT
        started_at
      FROM attempts
      WHERE id = ?
      LIMIT 1`
    )
    .bind(attemptId)
    .first<{ started_at: string }>();

  if (!attempt) {
    throw new Error("attempt_fetch_failed");
  }

  return {
    attemptId,
    startedAt: `${attempt.started_at.replace(" ", "T")}Z`,
    durationSeconds: TEST_DURATION_SECONDS,
    totalQuestions: questions.length,
    questions: questions.map(mapQuestionForClient)
  };
}

export async function submitMathsTest(
  env: Env,
  initData: string,
  attemptId: number,
  answers: SubmittedAnswer[]
): Promise<SubmitResult> {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    throw new Error("telegram_bot_token_missing");
  }

  const validated = await validateTelegramInitData(
    initData,
    botToken
  );

  const user = await getOrCreateUser(env, validated.user);

  const attempt = await env.DB
    .prepare(
      `SELECT
        id,
        user_id,
        started_at,
        finished_at,
        total_questions
      FROM attempts
      WHERE id = ?
        AND user_id = ?
      LIMIT 1`
    )
    .bind(attemptId, user.id)
    .first<AttemptRow>();

  if (!attempt) {
    throw new Error("attempt_not_found");
  }

  if (attempt.finished_at) {
    throw new Error("attempt_already_finished");
  }

  if (!Array.isArray(answers) || answers.length > TEST_QUESTION_COUNT) {
    throw new Error("invalid_answers");
  }

  const assigned = await env.DB
    .prepare(
      `SELECT
        q.id,
        q.exam,
        q.tier,
        q.year,
        q.shift,
        q.subject,
        q.topic,
        q.difficulty,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.correct_option,
        aq.position
      FROM attempt_questions aq
      INNER JOIN questions q
        ON q.id = aq.question_id
      WHERE aq.attempt_id = ?
      ORDER BY aq.position ASC`
    )
    .bind(attemptId)
    .all<AssignedQuestionRow>();

  if (assigned.results.length !== attempt.total_questions) {
    throw new Error("attempt_questions_invalid");
  }

  const assignedById = new Map<number, AssignedQuestionRow>();

  for (const question of assigned.results) {
    assignedById.set(question.id, question);
  }

  const seen = new Set<number>();
  const answerByQuestionId = new Map<
    number,
    string | null
  >();

  for (const answer of answers) {
    if (!Number.isInteger(answer.questionId)) {
      throw new Error("invalid_question_id");
    }

    if (seen.has(answer.questionId)) {
      throw new Error("duplicate_question_answer");
    }

    if (!assignedById.has(answer.questionId)) {
      throw new Error("question_not_in_attempt");
    }

    seen.add(answer.questionId);

    if (
      answer.selectedOption !== null &&
      !VALID_OPTIONS.has(answer.selectedOption)
    ) {
      throw new Error("invalid_selected_option");
    }

    answerByQuestionId.set(
      answer.questionId,
      answer.selectedOption
    );
  }

  const now = new Date().toISOString();
  const startedAt = new Date(
    attempt.started_at.replace(" ", "T") + "Z"
  ).getTime();

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt) / 1000)
  );

  const timedOut =
    elapsedSeconds > TEST_DURATION_SECONDS + 15;

  let correct = 0;
  let answered = 0;

  const updateStatements = assigned.results.map((question) => {
    const selected = answerByQuestionId.get(question.id) ?? null;

    if (selected !== null) {
      answered += 1;
      if (selected === question.correct_option) {
        correct += 1;
      }
    }

    return env.DB
      .prepare(
        `UPDATE attempt_questions
        SET selected_option = ?,
            answered_at = ?
        WHERE attempt_id = ?
          AND question_id = ?`
      )
      .bind(
        selected,
        selected === null ? null : now,
        attemptId,
        question.id
      );
  });

  const wrong = Math.max(0, answered - correct);
  const unanswered = Math.max(
    0,
    assigned.results.length - answered
  );

  updateStatements.push(
    env.DB
      .prepare(
        `UPDATE attempts
        SET finished_at = ?,
            score = ?,
            time_taken_seconds = ?
        WHERE id = ?`
      )
      .bind(
        now,
        correct,
        elapsedSeconds,
        attemptId
      )
  );

  await env.DB.batch(updateStatements);

  return {
    attemptId,
    score: correct,
    totalQuestions: assigned.results.length,
    correct,
    wrong,
    unanswered,
    timeTakenSeconds: elapsedSeconds,
    timedOut
  };
}
