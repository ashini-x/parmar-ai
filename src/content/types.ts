import type { Language } from "../users/user-service";

export const ALLOWED_SUBJECTS = [
  "Maths",
  "Reasoning",
  "English",
  "GK"
] as const;

export type ContentSubject = (typeof ALLOWED_SUBJECTS)[number];

export const ALLOWED_DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard"
] as const;

export type Difficulty = (typeof ALLOWED_DIFFICULTIES)[number];

export const ANSWER_OPTIONS = ["A", "B", "C", "D"] as const;
export type AnswerOption = (typeof ANSWER_OPTIONS)[number];

export type CandidateStatus =
  | "auto_ready"
  | "needs_review"
  | "duplicate"
  | "approved"
  | "rejected";

export type AnswerVerification =
  | "match"
  | "conflict"
  | "source_missing"
  | "source_only"
  | "ambiguous";

export interface LocalizedQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  explanation: string;
}

export interface AiQuestionCandidate {
  source_question_number: string;
  english: LocalizedQuestion;
  hindi: LocalizedQuestion;
  topic: string;
  difficulty: string;
  source_correct_option: string;
  verified_correct_option: string;
  answer_verification: string;
  confidence: number;
  ambiguity_note: string;
}

export interface ValidatedCandidate extends AiQuestionCandidate {
  exam: string;
  tier: string;
  year: number;
  shift: string;
  subject: ContentSubject;
  fingerprint: string;
  status: CandidateStatus;
}

export interface ContentBatchInput {
  sourceName: string;
  mimeType: string;
  sizeBytes: number;
  sourceSha256: string;
  exam: string;
  tier: string;
  year: number;
  shift: string;
  subject: ContentSubject;
  maxQuestions: number;
}

export interface ContentBatchSummary {
  batchId: number;
  extracted: number;
  autoReady: number;
  needsReview: number;
  duplicates: number;
}
