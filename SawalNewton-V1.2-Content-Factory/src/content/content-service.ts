import type { Env } from "../config/env";
import {
  ALLOWED_DIFFICULTIES,
  ALLOWED_SUBJECTS,
  ANSWER_OPTIONS,
  type AnswerOption,
  type CandidateStatus,
  type ContentBatchInput,
  type ContentBatchSummary,
  type ContentSubject,
  type ValidatedCandidate
} from "./types";
import { extractQuestionsWithGemini } from "./ai-factory";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_QUESTIONS_PER_RUN = 25;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256Hex(
  bytes: ArrayBuffer
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function questionFingerprint(
  english: {
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
  }
): Promise<string> {
  const canonical = [
    english.question_text,
    english.option_a,
    english.option_b,
    english.option_c,
    english.option_d
  ]
    .map(normalize)
    .join("\n");

  const encoded = new TextEncoder().encode(canonical);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);

  return sha256Hex(buffer);
}

function isAnswerOption(
  value: string
): value is AnswerOption {
  return (
    ANSWER_OPTIONS as readonly string[]
  ).includes(value);
}

function hasText(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function validLocalizedQuestion(
  value: unknown
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return [
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "explanation"
  ].every((key) => hasText(record[key]));
}

function validateCandidateShape(
  candidate: any,
  input: ContentBatchInput
): string | null {
  if (
    !candidate ||
    typeof candidate !== "object"
  ) {
    return "candidate_invalid";
  }

  if (!hasText(candidate.source_question_number)) {
    return "source_question_number_missing";
  }

  if (!validLocalizedQuestion(candidate.english)) {
    return "english_missing";
  }

  if (!validLocalizedQuestion(candidate.hindi)) {
    return "hindi_missing";
  }

  if (!hasText(candidate.topic)) {
    return "topic_missing";
  }

  if (!hasText(candidate.difficulty)) {
    return "difficulty_missing";
  }

  if (
    typeof candidate.confidence !== "number" ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return "confidence_invalid";
  }

  if (
    !isAnswerOption(candidate.source_correct_option) &&
    candidate.source_correct_option !== ""
  ) {
    return "source_answer_invalid";
  }

  if (
    !isAnswerOption(
      candidate.verified_correct_option
    )
  ) {
    return "verified_answer_invalid";
  }

  if (
    ![
      "match",
      "conflict",
      "source_missing",
      "ambiguous"
    ].includes(candidate.answer_verification)
  ) {
    return "answer_verification_invalid";
  }

  if (
    !ALLOWED_SUBJECTS.includes(
      input.subject
    )
  ) {
    return "subject_invalid";
  }

  if (
    !ALLOWED_DIFFICULTIES.includes(
      candidate.difficulty
    )
  ) {
    return "difficulty_invalid";
  }

  return null;
}

async function existingQuestionByFingerprint(
  env: Env,
  fingerprint: string
): Promise<number | null> {
  if (!fingerprint) return null;

  const row = await env.DB
    .prepare(
      `SELECT q.id
       FROM question_fingerprints f
       INNER JOIN questions q
         ON q.id = f.question_id
       WHERE f.fingerprint = ?
       LIMIT 1`
    )
    .bind(fingerprint)
    .first<{ id: number }>();

  return row?.id ?? null;
}

async function existingCandidateByFingerprint(
  env: Env,
  fingerprint: string
): Promise<number | null> {
  if (!fingerprint) return null;

  const row = await env.DB
    .prepare(
      `SELECT id
       FROM content_candidates
       WHERE fingerprint = ?
         AND status != 'rejected'
       LIMIT 1`
    )
    .bind(fingerprint)
    .first<{ id: number }>();

  return row?.id ?? null;
}

function chooseStatus(
  candidate: ValidatedCandidate,
  duplicateQuestionId: number | null,
  duplicateCandidateId: number | null
): CandidateStatus {
  if (
    duplicateQuestionId !== null ||
    duplicateCandidateId !== null
  ) {
    return "duplicate";
  }

  const answerMatches =
    candidate.answer_verification === "match" &&
    candidate.source_correct_option ===
      candidate.verified_correct_option;

  const highConfidence =
    candidate.confidence >= 0.9;

  return answerMatches && highConfidence
    ? "auto_ready"
    : "needs_review";
}

function asSubject(
  value: string
): ContentSubject {
  if (
    !ALLOWED_SUBJECTS.includes(
      value as ContentSubject
    )
  ) {
    throw new Error(
      "unsupported_subject"
    );
  }

  return value as ContentSubject;
}

function clampMaxQuestions(
  value: number
): number {
  if (!Number.isInteger(value)) {
    return 20;
  }

  return Math.min(
    MAX_QUESTIONS_PER_RUN,
    Math.max(1, value)
  );
}

function arrayBufferToBase64(
  buffer: ArrayBuffer
): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        i + chunkSize
      )
    );
  }

  return btoa(binary);
}

export async function processContentUpload(
  env: Env,
  input: {
    sourceName: string;
    exam: string;
    tier: string;
    year: number;
    shift: string;
    subject: string;
    maxQuestions: number;
    file: File;
  }
): Promise<ContentBatchSummary> {
  const bytes =
    await input.file.arrayBuffer();

  if (bytes.byteLength === 0) {
    throw new Error("empty_file");
  }

  if (
    bytes.byteLength >
    MAX_UPLOAD_BYTES
  ) {
    throw new Error(
      `file_too_large:${MAX_UPLOAD_BYTES}`
    );
  }

  const mimeType =
    input.file.type ||
    "application/octet-stream";

  const allowedMime = new Set([
    "application/pdf",
    "text/plain",
    "text/csv"
  ]);

  if (!allowedMime.has(mimeType)) {
    throw new Error(
      "unsupported_file_type"
    );
  }

  const sourceSha256 =
    await sha256Hex(bytes);

  const subject =
    asSubject(input.subject);

  const maxQuestions =
    clampMaxQuestions(
      input.maxQuestions
    );

  const batchInput: ContentBatchInput = {
    sourceName:
      input.sourceName.trim().slice(0, 240) ||
      input.file.name,
    mimeType,
    sizeBytes: bytes.byteLength,
    sourceSha256,
    exam:
      input.exam.trim().slice(0, 120),
    tier:
      input.tier.trim().slice(0, 120),
    year: input.year,
    shift:
      input.shift.trim().slice(0, 120),
    subject,
    maxQuestions
  };

  if (
    !batchInput.exam ||
    !Number.isInteger(batchInput.year) ||
    batchInput.year < 2016 ||
    batchInput.year > 2026
  ) {
    throw new Error(
      "invalid_exam_metadata"
    );
  }

  if (
    !Number.isInteger(batchInput.maxQuestions) ||
    batchInput.maxQuestions < 1
  ) {
    throw new Error(
      "invalid_max_questions"
    );
  }

  const existingBatch =
    await env.DB
      .prepare(
        `SELECT id
         FROM content_batches
         WHERE source_sha256 = ?
         LIMIT 1`
      )
      .bind(sourceSha256)
      .first<{ id: number }>();

  if (existingBatch) {
    throw new Error(
      `source_already_processed:${existingBatch.id}`
    );
  }

  const result =
    await env.DB
      .prepare(
        `INSERT INTO content_batches (
          source_name,
          mime_type,
          size_bytes,
          source_sha256,
          exam,
          tier,
          year,
          shift,
          subject,
          max_questions,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')`
      )
      .bind(
        batchInput.sourceName,
        batchInput.mimeType,
        batchInput.sizeBytes,
        batchInput.sourceSha256,
        batchInput.exam,
        batchInput.tier,
        batchInput.year,
        batchInput.shift,
        batchInput.subject,
        batchInput.maxQuestions
      )
      .run();

  const batchId =
    result.meta.last_row_id;

  if (!batchId) {
    throw new Error(
      "content_batch_creation_failed"
    );
  }

  try {
    const source =
      mimeType === "application/pdf"
        ? {
            kind: "pdf" as const,
            base64:
              arrayBufferToBase64(bytes)
          }
        : {
            kind: "text" as const,
            text:
              new TextDecoder()
                .decode(bytes)
                .slice(0, 750_000)
          };

    const aiCandidates =
      await extractQuestionsWithGemini(
        env,
        batchInput,
        source
      );

    let autoReady = 0;
    let needsReview = 0;
    let duplicates = 0;

    for (
      let index = 0;
      index < aiCandidates.length;
      index += 1
    ) {
      const candidate =
        aiCandidates[index] as any;

      const shapeError =
        validateCandidateShape(
          candidate,
          batchInput
        );

      if (shapeError) {
        await insertCandidateFailure(
          env,
          batchId,
          index + 1,
          batchInput,
          candidate,
          shapeError
        );
        needsReview += 1;
        continue;
      }

      const fingerprint =
        await questionFingerprint(
          candidate.english
        );

      const duplicateQuestionId =
        await existingQuestionByFingerprint(
          env,
          fingerprint
        );

      const duplicateCandidateId =
        await existingCandidateByFingerprint(
          env,
          fingerprint
        );

      const validated:
        ValidatedCandidate = {
        ...candidate,
        exam: batchInput.exam,
        tier: batchInput.tier,
        year: batchInput.year,
        shift: batchInput.shift,
        subject: batchInput.subject,
        fingerprint,
        status: "needs_review"
      };

      const status =
        chooseStatus(
          validated,
          duplicateQuestionId,
          duplicateCandidateId
        );

      await env.DB
        .prepare(
          `INSERT INTO content_candidates (
            batch_id,
            sequence_no,
            source_question_number,
            exam,
            tier,
            year,
            shift,
            subject,
            topic,
            difficulty,
            english_question,
            english_option_a,
            english_option_b,
            english_option_c,
            english_option_d,
            english_explanation,
            hindi_question,
            hindi_option_a,
            hindi_option_b,
            hindi_option_c,
            hindi_option_d,
            hindi_explanation,
            source_correct_option,
            verified_correct_option,
            answer_verification,
            confidence,
            ambiguity_note,
            fingerprint,
            status,
            duplicate_question_id,
            duplicate_candidate_id,
            raw_ai_json
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )`
        )
        .bind(
          batchId,
          index + 1,
          candidate.source_question_number,
          batchInput.exam,
          batchInput.tier,
          batchInput.year,
          batchInput.shift,
          batchInput.subject,
          candidate.topic,
          candidate.difficulty,
          candidate.english.question_text,
          candidate.english.option_a,
          candidate.english.option_b,
          candidate.english.option_c,
          candidate.english.option_d,
          candidate.english.explanation,
          candidate.hindi.question_text,
          candidate.hindi.option_a,
          candidate.hindi.option_b,
          candidate.hindi.option_c,
          candidate.hindi.option_d,
          candidate.hindi.explanation,
          candidate.source_correct_option || null,
          candidate.verified_correct_option,
          candidate.answer_verification,
          candidate.confidence,
          candidate.ambiguity_note || null,
          fingerprint,
          status,
          duplicateQuestionId,
          duplicateCandidateId,
          JSON.stringify(candidate)
        )
        .run();

      if (status === "auto_ready") {
        autoReady += 1;
      } else if (status === "duplicate") {
        duplicates += 1;
      } else {
        needsReview += 1;
      }
    }

    await env.DB
      .prepare(
        `UPDATE content_batches
         SET status = 'completed',
             extracted_count = ?,
             auto_ready_count = ?,
             needs_review_count = ?,
             duplicate_count = ?,
             finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        aiCandidates.length,
        autoReady,
        needsReview,
        duplicates,
        batchId
      )
      .run();

    return {
      batchId,
      extracted: aiCandidates.length,
      autoReady,
      needsReview,
      duplicates
    };
  } catch (error) {
    await env.DB
      .prepare(
        `UPDATE content_batches
         SET status = 'failed',
             error_message = ?,
             finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        error instanceof Error
          ? error.message
          : String(error),
        batchId
      )
      .run();

    throw error;
  }
}

async function insertCandidateFailure(
  env: Env,
  batchId: number,
  sequence: number,
  input: ContentBatchInput,
  candidate: any,
  errorMessage: string
): Promise<void> {
  const english =
    candidate?.english ?? {};
  const hindi =
    candidate?.hindi ?? {};

  await env.DB
    .prepare(
      `INSERT INTO content_candidates (
        batch_id,
        sequence_no,
        source_question_number,
        exam,
        tier,
        year,
        shift,
        subject,
        topic,
        difficulty,
        english_question,
        english_option_a,
        english_option_b,
        english_option_c,
        english_option_d,
        english_explanation,
        hindi_question,
        hindi_option_a,
        hindi_option_b,
        hindi_option_c,
        hindi_option_d,
        hindi_explanation,
        answer_verification,
        confidence,
        ambiguity_note,
        status,
        error_message,
        raw_ai_json
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )`
    )
    .bind(
      batchId,
      sequence,
      String(
        candidate?.source_question_number ??
          sequence
      ),
      input.exam,
      input.tier,
      input.year,
      input.shift,
      input.subject,
      String(
        candidate?.topic ??
          "Other"
      ),
      String(
        candidate?.difficulty ??
          "Medium"
      ),
      String(
        english.question_text ?? ""
      ),
      String(
        english.option_a ?? ""
      ),
      String(
        english.option_b ?? ""
      ),
      String(
        english.option_c ?? ""
      ),
      String(
        english.option_d ?? ""
      ),
      String(
        english.explanation ?? ""
      ),
      String(
        hindi.question_text ?? ""
      ),
      String(
        hindi.option_a ?? ""
      ),
      String(
        hindi.option_b ?? ""
      ),
      String(
        hindi.option_c ?? ""
      ),
      String(
        hindi.option_d ?? ""
      ),
      String(
        hindi.explanation ?? ""
      ),
      String(
        candidate?.answer_verification ??
          "ambiguous"
      ),
      typeof candidate?.confidence ===
        "number"
        ? candidate.confidence
        : 0,
      `${String(candidate?.ambiguity_note ?? "")} ${errorMessage}`.trim(),
      "needs_review",
      errorMessage,
      JSON.stringify(
        candidate ?? {}
      )
    )
    .run();
}

export async function listCandidates(
  env: Env,
  status: string | null,
  limit = 100
) {
  const safeLimit = Math.min(
    200,
    Math.max(
      1,
      Number(limit) || 100
    )
  );

  const base = `
    SELECT
      id,
      batch_id,
      sequence_no,
      source_question_number,
      exam,
      tier,
      year,
      shift,
      subject,
      topic,
      difficulty,
      english_question,
      english_option_a,
      english_option_b,
      english_option_c,
      english_option_d,
      english_explanation,
      hindi_question,
      hindi_option_a,
      hindi_option_b,
      hindi_option_c,
      hindi_option_d,
      hindi_explanation,
      source_correct_option,
      verified_correct_option,
      answer_verification,
      confidence,
      ambiguity_note,
      fingerprint,
      status,
      duplicate_question_id,
      duplicate_candidate_id,
      error_message,
      created_at
    FROM content_candidates
  `;

  const allowed =
    new Set([
      "auto_ready",
      "needs_review",
      "duplicate",
      "approved",
      "rejected"
    ]);

  if (status && allowed.has(status)) {
    return env.DB
      .prepare(
        `${base}
         WHERE status = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(status, safeLimit)
      .all();
  }

  return env.DB
    .prepare(
      `${base}
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all();
}

export async function listBatches(
  env: Env,
  limit = 50
) {
  const safeLimit = Math.min(
    100,
    Math.max(
      1,
      Number(limit) || 50
    )
  );

  return env.DB
    .prepare(
      `SELECT
        id,
        source_name,
        mime_type,
        size_bytes,
        exam,
        tier,
        year,
        shift,
        subject,
        max_questions,
        status,
        extracted_count,
        auto_ready_count,
        needs_review_count,
        duplicate_count,
        error_message,
        created_at,
        finished_at
       FROM content_batches
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all();
}


export async function backfillQuestionFingerprints(
  env: Env,
  limit = 5000
): Promise<{ processed: number; added: number; duplicates: number }> {
  const safeLimit = Math.min(
    10_000,
    Math.max(1, Number(limit) || 5_000)
  );

  const questions = await env.DB
    .prepare(
      `SELECT
        id,
        question_text,
        option_a,
        option_b,
        option_c,
        option_d
       FROM questions
       WHERE is_active = 1
       ORDER BY id ASC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all<{
      id: number;
      question_text: string;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
    }>();

  let added = 0;
  let duplicates = 0;

  for (const question of questions.results) {
    const fingerprint = await questionFingerprint(question);

    const existing = await env.DB
      .prepare(
        `SELECT question_id
         FROM question_fingerprints
         WHERE fingerprint = ?
         LIMIT 1`
      )
      .bind(fingerprint)
      .first<{ question_id: number }>();

    if (
      existing &&
      existing.question_id !== question.id
    ) {
      duplicates += 1;
      continue;
    }

    await env.DB
      .prepare(
        `INSERT INTO question_fingerprints (
          question_id,
          fingerprint
        )
        VALUES (?, ?)
        ON CONFLICT(question_id)
        DO UPDATE SET
          fingerprint = excluded.fingerprint`
      )
      .bind(
        question.id,
        fingerprint
      )
      .run();

    added += 1;
  }

  return {
    processed: questions.results.length,
    added,
    duplicates
  };
}

export async function approveCandidates(
  env: Env,
  candidateIds: number[]
): Promise<{
  approved: number;
  duplicates: number;
  failed: number;
}> {
  const uniqueIds = Array.from(
    new Set(
      candidateIds.filter(
        (id) =>
          Number.isInteger(id) &&
          id > 0
      )
    )
  );

  if (uniqueIds.length === 0) {
    throw new Error(
      "no_candidate_ids"
    );
  }

  if (uniqueIds.length > 100) {
    throw new Error(
      "too_many_candidates"
    );
  }

  let approved = 0;
  let duplicates = 0;
  let failed = 0;

  for (const candidateId of uniqueIds) {
    try {
      const candidate =
        await env.DB
          .prepare(
            `SELECT
              c.*,
              b.source_name
             FROM content_candidates c
             INNER JOIN content_batches b
               ON b.id = c.batch_id
             WHERE c.id = ?
             LIMIT 1`
          )
          .bind(candidateId)
          .first<Record<string, unknown>>();

      if (!candidate) {
        failed += 1;
        continue;
      }

      if (
        candidate.status ===
        "approved"
      ) {
        approved += 1;
        continue;
      }

      const requiredCandidateFields = [
        candidate.fingerprint,
        candidate.english_question,
        candidate.english_option_a,
        candidate.english_option_b,
        candidate.english_option_c,
        candidate.english_option_d,
        candidate.hindi_question,
        candidate.hindi_option_a,
        candidate.hindi_option_b,
        candidate.hindi_option_c,
        candidate.hindi_option_d,
        candidate.verified_correct_option
      ];

      if (
        requiredCandidateFields.some(
          (value) =>
            value === null ||
            value === undefined ||
            String(value).trim() === ""
        ) ||
        !isAnswerOption(
          String(candidate.verified_correct_option)
        )
      ) {
        failed += 1;
        continue;
      }

      const duplicate =
        await existingQuestionByFingerprint(
          env,
          String(
            candidate.fingerprint ?? ""
          )
        );

      if (duplicate !== null) {
        await env.DB
          .prepare(
            `UPDATE content_candidates
             SET status = 'duplicate',
                 duplicate_question_id = ?
             WHERE id = ?`
          )
          .bind(
            duplicate,
            candidateId
          )
          .run();

        duplicates += 1;
        continue;
      }

      const questionResult =
        await env.DB
          .prepare(
            `INSERT INTO questions (
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
              option_d,
              correct_option,
              explanation,
              source,
              is_active,
              fingerprint
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, 1, ?
            )`
          )
          .bind(
            String(candidate.exam),
            String(
              candidate.tier ?? ""
            ),
            Number(
              candidate.year
            ),
            String(
              candidate.shift ?? ""
            ),
            String(candidate.subject),
            String(
              candidate.topic ??
                "Other"
            ),
            String(
              candidate.difficulty ??
                "Medium"
            ),
            String(
              candidate.english_question
            ),
            String(
              candidate.english_option_a
            ),
            String(
              candidate.english_option_b
            ),
            String(
              candidate.english_option_c
            ),
            String(
              candidate.english_option_d
            ),
            String(
              candidate.verified_correct_option
            ),
            String(
              candidate.english_explanation ??
                ""
            ),
            String(
              candidate.source_name
            )
          )
          .run();

      const questionId =
        questionResult.meta
          .last_row_id;

      if (!questionId) {
        throw new Error(
          "question_insert_failed"
        );
      }

      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO question_fingerprints (
              question_id,
              fingerprint
            )
            VALUES (?, ?)`
          )
          .bind(
            questionId,
            String(candidate.fingerprint)
          ),
        env.DB
          .prepare(
            `INSERT INTO question_translations (
              question_id,
              language,
              question_text,
              option_a,
              option_b,
              option_c,
              option_d,
              explanation,
              translation_status
            )
            VALUES (
              ?, 'hi', ?, ?, ?, ?, ?, ?,
              'ai_verified'
            )
            ON CONFLICT(
              question_id,
              language
            )
            DO UPDATE SET
              question_text =
                excluded.question_text,
              option_a =
                excluded.option_a,
              option_b =
                excluded.option_b,
              option_c =
                excluded.option_c,
              option_d =
                excluded.option_d,
              explanation =
                excluded.explanation,
              translation_status =
                excluded.translation_status`
          )
          .bind(
            questionId,
            String(
              candidate.hindi_question
            ),
            String(
              candidate.hindi_option_a
            ),
            String(
              candidate.hindi_option_b
            ),
            String(
              candidate.hindi_option_c
            ),
            String(
              candidate.hindi_option_d
            ),
            String(
              candidate.hindi_explanation ??
                ""
            )
          ),
        env.DB
          .prepare(
            `UPDATE content_candidates
             SET status = 'approved'
             WHERE id = ?`
          )
          .bind(candidateId)
      ]);

      approved += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    approved,
    duplicates,
    failed
  };
}
