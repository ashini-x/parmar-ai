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
import { extractQuestionsWithGemini, enhanceCandidateWithGemini } from "./ai-factory";
import { parseStructuredSource } from "./deterministic-parser";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_QUESTIONS_PER_RUN = 100;

type ContentIngestMode = "deterministic" | "ai";

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function questionFingerprint(english: {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}): Promise<string> {
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

function isAnswerOption(value: string): value is AnswerOption {
  return (ANSWER_OPTIONS as readonly string[]).includes(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validLocalizedQuestion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d"
  ].every((key) => hasText(record[key]));
}

function validateCandidateShape(
  candidate: any,
  input: ContentBatchInput
): string | null {
  if (!candidate || typeof candidate !== "object") return "candidate_invalid";
  if (!hasText(candidate.source_question_number)) return "source_question_number_missing";
  if (!validLocalizedQuestion(candidate.english)) return "english_missing";

  if (candidate.hindi !== undefined && candidate.hindi !== null && typeof candidate.hindi !== "object") {
    return "hindi_invalid";
  }

  if (!hasText(candidate.topic)) return "topic_missing";
  if (!hasText(candidate.difficulty)) return "difficulty_missing";

  if (typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1) {
    return "confidence_invalid";
  }

  if (!isAnswerOption(candidate.source_correct_option) && candidate.source_correct_option !== "") {
    return "source_answer_invalid";
  }

  if (!isAnswerOption(candidate.verified_correct_option) && candidate.verified_correct_option !== "") {
    return "verified_answer_invalid";
  }

  if (![
    "match",
    "conflict",
    "source_missing",
    "source_only",
    "ambiguous"
  ].includes(candidate.answer_verification)) {
    return "answer_verification_invalid";
  }

  if (!ALLOWED_SUBJECTS.includes(input.subject)) return "subject_invalid";
  if (!ALLOWED_DIFFICULTIES.includes(candidate.difficulty)) return "difficulty_invalid";

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
       INNER JOIN questions q ON q.id = f.question_id
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
  if (duplicateQuestionId !== null || duplicateCandidateId !== null) return "duplicate";

  const bilingual =
    validLocalizedQuestion(candidate.english) &&
    validLocalizedQuestion(candidate.hindi);

  const answerMatches =
    candidate.answer_verification === "match" &&
    candidate.source_correct_option === candidate.verified_correct_option &&
    isAnswerOption(candidate.verified_correct_option);

  return bilingual && answerMatches && candidate.confidence >= 0.9
    ? "auto_ready"
    : "needs_review";
}

function asSubject(value: string): ContentSubject {
  if (!ALLOWED_SUBJECTS.includes(value as ContentSubject)) {
    throw new Error("unsupported_subject");
  }
  return value as ContentSubject;
}

function clampMaxQuestions(value: number): number {
  if (!Number.isInteger(value)) return 20;
  return Math.min(MAX_QUESTIONS_PER_RUN, Math.max(1, value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function createOrReuseBatch(
  env: Env,
  input: ContentBatchInput
): Promise<number> {
  const existing = await env.DB
    .prepare(
      `SELECT id, status
       FROM content_batches
       WHERE source_sha256 = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .bind(input.sourceSha256)
    .first<{ id: number; status: string }>();

  if (existing && existing.status !== "failed") {
    throw new Error(`source_already_processed:${existing.id}`);
  }

  if (existing && existing.status === "failed") {
    await env.DB.batch([
      env.DB
        .prepare(`DELETE FROM content_candidates WHERE batch_id = ?`)
        .bind(existing.id),
      env.DB
        .prepare(
          `UPDATE content_batches
           SET source_name = ?,
               mime_type = ?,
               size_bytes = ?,
               exam = ?,
               tier = ?,
               year = ?,
               shift = ?,
               subject = ?,
               max_questions = ?,
               status = 'processing',
               extracted_count = 0,
               auto_ready_count = 0,
               needs_review_count = 0,
               duplicate_count = 0,
               error_message = NULL,
               finished_at = NULL
           WHERE id = ?`
        )
        .bind(
          input.sourceName,
          input.mimeType,
          input.sizeBytes,
          input.exam,
          input.tier,
          input.year,
          input.shift,
          input.subject,
          input.maxQuestions,
          existing.id
        )
    ]);
    return existing.id;
  }

  const result = await env.DB
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
      input.sourceName,
      input.mimeType,
      input.sizeBytes,
      input.sourceSha256,
      input.exam,
      input.tier,
      input.year,
      input.shift,
      input.subject,
      input.maxQuestions
    )
    .run();

  const batchId = result.meta.last_row_id;
  if (!batchId) throw new Error("content_batch_creation_failed");
  return batchId;
}

async function insertCandidate(
  env: Env,
  batchId: number,
  sequence: number,
  input: ContentBatchInput,
  candidate: any,
  errorMessage: string | null = null
): Promise<CandidateStatus> {
  const shapeError = errorMessage ?? validateCandidateShape(candidate, input);

  const english = candidate?.english ?? {};
  const hindi = candidate?.hindi ?? {};
  let fingerprint = "";
  let duplicateQuestionId: number | null = null;
  let duplicateCandidateId: number | null = null;

  if (validLocalizedQuestion(english)) {
    fingerprint = await questionFingerprint(english);
    duplicateQuestionId = await existingQuestionByFingerprint(env, fingerprint);
    duplicateCandidateId = await existingCandidateByFingerprint(env, fingerprint);
  }

  const safeCandidate = {
    source_question_number: String(candidate?.source_question_number ?? sequence),
    topic: String(candidate?.topic ?? "Other"),
    difficulty: String(candidate?.difficulty ?? "Medium"),
    english,
    hindi,
    source_correct_option: String(candidate?.source_correct_option ?? ""),
    verified_correct_option: String(candidate?.verified_correct_option ?? ""),
    answer_verification: String(candidate?.answer_verification ?? "ambiguous"),
    confidence: typeof candidate?.confidence === "number" ? candidate.confidence : 0,
    ambiguity_note: String(candidate?.ambiguity_note ?? "")
  };

  const validated = {
    ...safeCandidate,
    exam: input.exam,
    tier: input.tier,
    year: input.year,
    shift: input.shift,
    subject: input.subject,
    fingerprint,
    status: "needs_review"
  } as ValidatedCandidate;

  const status =
    shapeError || !fingerprint
      ? "needs_review"
      : chooseStatus(validated, duplicateQuestionId, duplicateCandidateId);

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
        error_message,
        raw_ai_json
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`
    )
    .bind(
      batchId,
      sequence,
      safeCandidate.source_question_number,
      input.exam,
      input.tier,
      input.year,
      input.shift,
      input.subject,
      safeCandidate.topic,
      safeCandidate.difficulty,
      String(english.question_text ?? ""),
      String(english.option_a ?? ""),
      String(english.option_b ?? ""),
      String(english.option_c ?? ""),
      String(english.option_d ?? ""),
      String(english.explanation ?? ""),
      String(hindi.question_text ?? ""),
      String(hindi.option_a ?? ""),
      String(hindi.option_b ?? ""),
      String(hindi.option_c ?? ""),
      String(hindi.option_d ?? ""),
      String(hindi.explanation ?? ""),
      safeCandidate.source_correct_option || null,
      safeCandidate.verified_correct_option || null,
      safeCandidate.answer_verification,
      safeCandidate.confidence,
      `${safeCandidate.ambiguity_note}${shapeError ? ` ${shapeError}` : ""}`.trim() || null,
      fingerprint || null,
      status,
      duplicateQuestionId,
      duplicateCandidateId,
      errorMessage,
      JSON.stringify(candidate ?? {})
    )
    .run();

  return status;
}

async function completeBatch(
  env: Env,
  batchId: number,
  extracted: number,
  autoReady: number,
  needsReview: number,
  duplicates: number
): Promise<void> {
  await env.DB
    .prepare(
      `UPDATE content_batches
       SET status = 'completed',
           extracted_count = ?,
           auto_ready_count = ?,
           needs_review_count = ?,
           duplicate_count = ?,
           error_message = NULL,
           finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(extracted, autoReady, needsReview, duplicates, batchId)
    .run();
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
    mode?: ContentIngestMode;
  }
): Promise<ContentBatchSummary> {
  const bytes = await input.file.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("empty_file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`file_too_large:${MAX_UPLOAD_BYTES}`);
  }

  const mimeType = input.file.type || "application/octet-stream";
  const normalizedName = input.file.name.toLowerCase();
  const isJson = mimeType === "application/json" || normalizedName.endsWith(".json");
  const isCsv = mimeType === "text/csv" || normalizedName.endsWith(".csv");
  const isText = mimeType === "text/plain" || normalizedName.endsWith(".txt");
  const isPdf = mimeType === "application/pdf" || normalizedName.endsWith(".pdf");

  if (!isJson && !isCsv && !isText && !isPdf) {
    throw new Error("unsupported_file_type");
  }

  const mode = input.mode ?? "deterministic";
  if (mode === "deterministic" && isPdf) {
    throw new Error("pdf_requires_ai_mode");
  }
  if (mode === "ai" && !isPdf && !isJson && !isCsv && !isText) {
    throw new Error("unsupported_ai_source_type");
  }

  const sourceSha256 = await sha256Hex(bytes);
  const subject = asSubject(input.subject);
  const maxQuestions = clampMaxQuestions(input.maxQuestions);

  const batchInput: ContentBatchInput = {
    sourceName: input.sourceName.trim().slice(0, 240) || input.file.name,
    mimeType,
    sizeBytes: bytes.byteLength,
    sourceSha256,
    exam: input.exam.trim().slice(0, 120),
    tier: input.tier.trim().slice(0, 120),
    year: input.year,
    shift: input.shift.trim().slice(0, 120),
    subject,
    maxQuestions
  };

  if (
    !batchInput.exam ||
    !Number.isInteger(batchInput.year) ||
    batchInput.year < 2016 ||
    batchInput.year > 2026
  ) {
    throw new Error("invalid_exam_metadata");
  }

  const batchId = await createOrReuseBatch(env, batchInput);

  try {
    const textSource = new TextDecoder().decode(bytes).slice(0, 1_500_000);
    let candidates: any[];

    if (mode === "deterministic") {
      candidates = parseStructuredSource(textSource, mimeType, batchInput);
    } else {
      const source = isPdf
        ? { kind: "pdf" as const, base64: arrayBufferToBase64(bytes) }
        : { kind: "text" as const, text: textSource };
      candidates = await extractQuestionsWithGemini(env, batchInput, source);
    }

    if (!candidates.length) {
      throw new Error(
        mode === "deterministic"
          ? "no_questions_detected:use_structured_txt_csv_or_json_format"
          : "no_questions_extracted"
      );
    }

    let autoReady = 0;
    let needsReview = 0;
    let duplicates = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const status = await insertCandidate(
        env,
        batchId,
        index + 1,
        batchInput,
        candidates[index]
      );

      if (status === "auto_ready") autoReady += 1;
      else if (status === "duplicate") duplicates += 1;
      else needsReview += 1;
    }

    await completeBatch(
      env,
      batchId,
      candidates.length,
      autoReady,
      needsReview,
      duplicates
    );

    return {
      batchId,
      extracted: candidates.length,
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
        error instanceof Error ? error.message : String(error),
        batchId
      )
      .run();
    throw error;
  }
}

export async function listCandidates(env: Env, status: string | null, limit = 100) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const base = `
    SELECT
      id, batch_id, sequence_no, source_question_number,
      exam, tier, year, shift, subject, topic, difficulty,
      english_question, english_option_a, english_option_b,
      english_option_c, english_option_d, english_explanation,
      hindi_question, hindi_option_a, hindi_option_b,
      hindi_option_c, hindi_option_d, hindi_explanation,
      source_correct_option, verified_correct_option,
      answer_verification, confidence, ambiguity_note,
      fingerprint, status, duplicate_question_id,
      duplicate_candidate_id, error_message, created_at
    FROM content_candidates`;

  const allowed = new Set([
    "auto_ready",
    "needs_review",
    "duplicate",
    "approved",
    "rejected"
  ]);

  if (status && allowed.has(status)) {
    return env.DB
      .prepare(`${base} WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .bind(status, safeLimit)
      .all();
  }

  return env.DB
    .prepare(`${base} ORDER BY id DESC LIMIT ?`)
    .bind(safeLimit)
    .all();
}

export async function listBatches(env: Env, limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  return env.DB
    .prepare(
      `SELECT
        id, source_name, mime_type, size_bytes,
        exam, tier, year, shift, subject, max_questions,
        status, extracted_count, auto_ready_count,
        needs_review_count, duplicate_count, error_message,
        created_at, finished_at
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
  const safeLimit = Math.min(10_000, Math.max(1, Number(limit) || 5000));
  const questions = await env.DB
    .prepare(
      `SELECT id, question_text, option_a, option_b, option_c, option_d
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

    if (existing && existing.question_id !== question.id) {
      duplicates += 1;
      continue;
    }

    await env.DB
      .prepare(
        `INSERT INTO question_fingerprints (question_id, fingerprint)
         VALUES (?, ?)
         ON CONFLICT(question_id)
         DO UPDATE SET fingerprint = excluded.fingerprint`
      )
      .bind(question.id, fingerprint)
      .run();

    added += 1;
  }

  return { processed: questions.results.length, added, duplicates };
}

export async function enhanceCandidatesWithGemini(
  env: Env,
  candidateIds: number[]
): Promise<{ enhanced: number; failed: number }> {
  const uniqueIds = Array.from(
    new Set(
      candidateIds.filter(
        (id) => Number.isInteger(id) && id > 0
      )
    )
  ).slice(0, 25);

  if (!uniqueIds.length) throw new Error("no_candidate_ids");

  let enhanced = 0;
  let failed = 0;

  for (const candidateId of uniqueIds) {
    try {
      const row = await env.DB
        .prepare(
          `SELECT *
           FROM content_candidates
           WHERE id = ?
           LIMIT 1`
        )
        .bind(candidateId)
        .first<Record<string, unknown>>();

      if (!row) {
        failed += 1;
        continue;
      }

      const enhancedCandidate = await enhanceCandidateWithGemini(env, {
        english: {
          question_text: String(row.english_question ?? ""),
          option_a: String(row.english_option_a ?? ""),
          option_b: String(row.english_option_b ?? ""),
          option_c: String(row.english_option_c ?? ""),
          option_d: String(row.english_option_d ?? ""),
          explanation: String(row.english_explanation ?? "")
        },
        hindi: {
          question_text: String(row.hindi_question ?? ""),
          option_a: String(row.hindi_option_a ?? ""),
          option_b: String(row.hindi_option_b ?? ""),
          option_c: String(row.hindi_option_c ?? ""),
          option_d: String(row.hindi_option_d ?? ""),
          explanation: String(row.hindi_explanation ?? "")
        },
        topic: String(row.topic ?? "Other"),
        difficulty: String(row.difficulty ?? "Medium"),
        source_correct_option: String(row.source_correct_option ?? ""),
        verified_correct_option: String(row.verified_correct_option ?? ""),
        answer_verification: String(row.answer_verification ?? "ambiguous"),
        ambiguity_note: String(row.ambiguity_note ?? ""),
        confidence: Number(row.confidence ?? 0),
        subject: String(row.subject ?? "Maths") as ContentSubject
      });

      const fingerprint = await questionFingerprint(enhancedCandidate.english);
      const duplicateQuestionId = await existingQuestionByFingerprint(env, fingerprint);
      const duplicateCandidateId = await existingCandidateByFingerprint(env, fingerprint);

      const validationError = validateCandidateShape(
        enhancedCandidate,
        {
          sourceName: "",
          mimeType: "text/plain",
          sizeBytes: 0,
          sourceSha256: "",
          exam: String(row.exam ?? ""),
          tier: String(row.tier ?? ""),
          year: Number(row.year),
          shift: String(row.shift ?? ""),
          subject: String(row.subject ?? "Maths") as ContentSubject,
          maxQuestions: 1
        }
      );

      const candidateStatus = validationError
        ? "needs_review"
        : chooseStatus(
            {
              ...enhancedCandidate,
              exam: String(row.exam ?? ""),
              tier: String(row.tier ?? ""),
              year: Number(row.year),
              shift: String(row.shift ?? ""),
              subject: String(row.subject ?? "Maths") as ContentSubject,
              fingerprint,
              status: "needs_review"
            } as ValidatedCandidate,
            duplicateQuestionId,
            duplicateCandidateId
          );

      await env.DB
        .prepare(
          `UPDATE content_candidates
           SET topic = ?,
               difficulty = ?,
               english_question = ?,
               english_option_a = ?,
               english_option_b = ?,
               english_option_c = ?,
               english_option_d = ?,
               english_explanation = ?,
               hindi_question = ?,
               hindi_option_a = ?,
               hindi_option_b = ?,
               hindi_option_c = ?,
               hindi_option_d = ?,
               hindi_explanation = ?,
               source_correct_option = ?,
               verified_correct_option = ?,
               answer_verification = ?,
               confidence = ?,
               ambiguity_note = ?,
               fingerprint = ?,
               status = ?,
               duplicate_question_id = ?,
               duplicate_candidate_id = ?,
               error_message = NULL,
               raw_ai_json = ?
           WHERE id = ?`
        )
        .bind(
          enhancedCandidate.topic,
          enhancedCandidate.difficulty,
          enhancedCandidate.english.question_text,
          enhancedCandidate.english.option_a,
          enhancedCandidate.english.option_b,
          enhancedCandidate.english.option_c,
          enhancedCandidate.english.option_d,
          enhancedCandidate.english.explanation,
          enhancedCandidate.hindi.question_text,
          enhancedCandidate.hindi.option_a,
          enhancedCandidate.hindi.option_b,
          enhancedCandidate.hindi.option_c,
          enhancedCandidate.hindi.option_d,
          enhancedCandidate.hindi.explanation,
          enhancedCandidate.source_correct_option || null,
          enhancedCandidate.verified_correct_option || null,
          enhancedCandidate.answer_verification,
          enhancedCandidate.confidence,
          enhancedCandidate.ambiguity_note || null,
          fingerprint,
          candidateStatus,
          duplicateQuestionId,
          duplicateCandidateId,
          JSON.stringify(enhancedCandidate),
          candidateId
        )
        .run();

      enhanced += 1;
    } catch (error) {
      await env.DB
        .prepare(
          `UPDATE content_candidates
           SET error_message = ?
           WHERE id = ?`
        )
        .bind(
          error instanceof Error ? error.message : String(error),
          candidateId
        )
        .run();
      failed += 1;
    }
  }

  return { enhanced, failed };
}

export async function approveCandidates(
  env: Env,
  candidateIds: number[]
): Promise<{ approved: number; duplicates: number; failed: number }> {
  const uniqueIds = Array.from(
    new Set(
      candidateIds.filter(
        (id) => Number.isInteger(id) && id > 0
      )
    )
  );

  if (uniqueIds.length === 0) throw new Error("no_candidate_ids");
  if (uniqueIds.length > 100) throw new Error("too_many_candidates");

  let approved = 0;
  let duplicates = 0;
  let failed = 0;

  for (const candidateId of uniqueIds) {
    try {
      const candidate = await env.DB
        .prepare(
          `SELECT c.*, b.source_name
           FROM content_candidates c
           INNER JOIN content_batches b ON b.id = c.batch_id
           WHERE c.id = ?
           LIMIT 1`
        )
        .bind(candidateId)
        .first<Record<string, unknown>>();

      if (!candidate) {
        failed += 1;
        continue;
      }

      if (candidate.status === "approved") {
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
          (value) => value === null || value === undefined || String(value).trim() === ""
        ) ||
        !isAnswerOption(String(candidate.verified_correct_option))
      ) {
        failed += 1;
        continue;
      }

      const duplicate = await existingQuestionByFingerprint(
        env,
        String(candidate.fingerprint ?? "")
      );

      if (duplicate !== null) {
        await env.DB
          .prepare(
            `UPDATE content_candidates
             SET status = 'duplicate', duplicate_question_id = ?
             WHERE id = ?`
          )
          .bind(duplicate, candidateId)
          .run();
        duplicates += 1;
        continue;
      }

      const questionResult = await env.DB
        .prepare(
          `INSERT INTO questions (
            exam, tier, year, shift, subject, topic, difficulty,
            question_text, option_a, option_b, option_c, option_d,
            correct_option, explanation, source, is_active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(
          String(candidate.exam),
          String(candidate.tier ?? ""),
          Number(candidate.year),
          String(candidate.shift ?? ""),
          String(candidate.subject),
          String(candidate.topic ?? "Other"),
          String(candidate.difficulty ?? "Medium"),
          String(candidate.english_question),
          String(candidate.english_option_a),
          String(candidate.english_option_b),
          String(candidate.english_option_c),
          String(candidate.english_option_d),
          String(candidate.verified_correct_option),
          String(candidate.english_explanation ?? ""),
          String(candidate.source_name)
        )
        .run();

      const questionId = questionResult.meta.last_row_id;
      if (!questionId) throw new Error("question_insert_failed");

      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO question_fingerprints (question_id, fingerprint)
             VALUES (?, ?)`
          )
          .bind(questionId, String(candidate.fingerprint)),
        env.DB
          .prepare(
            `INSERT INTO question_translations (
              question_id, language, question_text,
              option_a, option_b, option_c, option_d,
              explanation, translation_status
            )
            VALUES (?, 'en', ?, ?, ?, ?, ?, ?, 'canonical')
            ON CONFLICT(question_id, language)
            DO UPDATE SET
              question_text = excluded.question_text,
              option_a = excluded.option_a,
              option_b = excluded.option_b,
              option_c = excluded.option_c,
              option_d = excluded.option_d,
              explanation = excluded.explanation,
              translation_status = excluded.translation_status`
          )
          .bind(
            questionId,
            String(candidate.english_question),
            String(candidate.english_option_a),
            String(candidate.english_option_b),
            String(candidate.english_option_c),
            String(candidate.english_option_d),
            String(candidate.english_explanation ?? "")
          ),
        env.DB
          .prepare(
            `INSERT INTO question_translations (
              question_id, language, question_text,
              option_a, option_b, option_c, option_d,
              explanation, translation_status
            )
            VALUES (?, 'hi', ?, ?, ?, ?, ?, ?, 'ai_verified')
            ON CONFLICT(question_id, language)
            DO UPDATE SET
              question_text = excluded.question_text,
              option_a = excluded.option_a,
              option_b = excluded.option_b,
              option_c = excluded.option_c,
              option_d = excluded.option_d,
              explanation = excluded.explanation,
              translation_status = excluded.translation_status`
          )
          .bind(
            questionId,
            String(candidate.hindi_question),
            String(candidate.hindi_option_a),
            String(candidate.hindi_option_b),
            String(candidate.hindi_option_c),
            String(candidate.hindi_option_d),
            String(candidate.hindi_explanation ?? "")
          ),
        env.DB
          .prepare(
            `UPDATE content_candidates
             SET status = 'approved', error_message = NULL
             WHERE id = ?`
          )
          .bind(candidateId)
      ]);

      approved += 1;
    } catch (error) {
      await env.DB
        .prepare(`UPDATE content_candidates SET error_message = ? WHERE id = ?`)
        .bind(error instanceof Error ? error.message : String(error), candidateId)
        .run();
      failed += 1;
    }
  }

  return { approved, duplicates, failed };
}
