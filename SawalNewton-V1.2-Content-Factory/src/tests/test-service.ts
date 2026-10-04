import type { Env } from "../config/env";
import {
  authenticateWebAppUser,
  type Language
} from "../users/user-service";

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
  language: Language;
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

function requireLanguage(language: Language | null): Language {
  if (!language) {
    throw new Error("language_not_set");
  }

  return language;
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
  const { user } = await authenticateWebAppUser(env, initData);
  const language = requireLanguage(user.language);

  const questionResult = await env.DB
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
        COALESCE(
          t.question_text,
          q.question_text
        ) AS question_text,
        COALESCE(
          t.option_a,
          q.option_a
        ) AS option_a,
        COALESCE(
          t.option_b,
          q.option_b
        ) AS option_b,
        COALESCE(
          t.option_c,
          q.option_c
        ) AS option_c,
        COALESCE(
          t.option_d,
          q.option_d
        ) AS option_d
      FROM questions q
      LEFT JOIN question_translations t
        ON t.question_id = q.id
        AND t.language = ?
      WHERE q.is_active = 1
        AND q.subject = ?
        AND (
          ? = 'en'
          OR t.id IS NOT NULL
        )
      ORDER BY RANDOM()
      LIMIT ?`
    )
    .bind(
      language,
      "Maths",
      language,
      TEST_QUESTION_COUNT
    )
    .all<QuestionRow>();

  const questions = questionResult.results;

  if (questions.length < TEST_QUESTION_COUNT) {
    throw new Error(
      `not_enough_questions:${questions.length}:${language}`
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
    language,
    questions: questions.map(mapQuestionForClient)
  };
}

export async function submitMathsTest(
  env: Env,
  initData: string,
  attemptId: number,
  answers: SubmittedAnswer[]
): Promise<SubmitResult> {
  const { user } = await authenticateWebAppUser(env, initData);

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
  const answerByQuestionId = new Map<number, string | null>();

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
    const selected =
      answerByQuestionId.get(question.id) ?? null;

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
