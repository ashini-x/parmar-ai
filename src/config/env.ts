import type { D1Database, DurableObjectNamespace, Queue } from "@cloudflare/workers-types";

export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  APP_VERSION?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_SETUP_SECRET?: string;

  GCP_PROJECT_ID?: string;
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  GCP_PRIVATE_KEY_ID?: string;

  GEMINI_MODEL?: string;
  GEMINI_LOCATION?: string;
  /** Maximum allowed thinking level. Code selects LOW/MEDIUM/HIGH adaptively. */
  GEMINI_THINKING_LEVEL?: string;
  ENABLE_GOOGLE_SEARCH_GROUNDING?: string;
  MAX_OUTPUT_TOKENS?: string;
  MAX_QUESTION_LENGTH?: string;
  VERTEX_TIMEOUT_MS?: string;
  DAILY_QUESTION_LIMIT?: string;
  BURST_QUESTION_LIMIT?: string;
  BURST_WINDOW_SECONDS?: string;

  ANALYTICS_RAW_RETENTION_DAYS?: string;
  ADMIN_DASHBOARD_USER?: string;
  ADMIN_DASHBOARD_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;

  DB?: D1Database;
  QUESTION_QUEUE: Queue<QuestionJob>;
  JOB_DEDUPE: DurableObjectNamespace;
}

export interface QuestionJob {
  version: 1 | 2;
  updateId: number;
  chatId: number;
  question: string;
  messageId: number;
  requestId: string;
  createdAt: number;
  statusMessageId?: number;
}


export interface AnswerPacket {
  answer: string;
  sscTakeaway: string;
  answerScope: "ssc_ga_gs" | "ssc_support" | "out_of_scope";
  subject: "history" | "polity" | "geography" | "economy" | "science" | "static_gk" | "current_affairs" | "art_culture" | "other";
  topic: string;
  questionMode: "fact" | "concept" | "comparison" | "statement_trap" | "revision" | "study_plan";
  examRelevance: "A" | "B" | "C" | "D";
  difficulty: "easy" | "medium" | "hard";
  profileSignal: "neutral" | "weak" | "confusion" | "strength";
  profileNote: string;
  nextRevisionTopic: string;
  detectedExam: string | null;
  timeSensitive: boolean;
  thinkingLevelUsed?: "LOW" | "MEDIUM" | "HIGH";
  grounded?: boolean;
}

export interface LearningSignal {
  topic: string;
  confusionCount: number;
  weakCount: number;
  lastSeenAt: number;
}

export interface StudentProfile {
  version: 2;
  targetExam: string;
  recentTopics: string[];
  recentSubjects: string[];
  attentionTopics: string[];
  revisionQueue: string[];
  learningSignals: LearningSignal[];
  questionCount: number;
  lastUpdatedAt: number;
}

export interface ConversationTurn {
  question: string;
  answer: string;
}

export interface ProfileContext {
  profile: StudentProfile;
  recentTopicHint: string;
  attentionTopicHint: string;
  revisionHint: string;
  recentConversation: ConversationTurn[];
}

export function getConfig(env: Env) {
  return {
    environment: env.ENVIRONMENT ?? "development",
    version: env.APP_VERSION ?? "2.4.1",
    model: env.GEMINI_MODEL ?? "gemini-3.8-flash",
    location: env.GEMINI_LOCATION ?? "global",
    maxThinkingLevel: normalizeThinkingLevel(env.GEMINI_THINKING_LEVEL),
    maxOutputTokens: parsePositiveInt(env.MAX_OUTPUT_TOKENS, 1_200),
    maxQuestionLength: parsePositiveInt(env.MAX_QUESTION_LENGTH, 4_000),
    dailyQuestionLimit: parsePositiveInt(env.DAILY_QUESTION_LIMIT, 20),
    burstQuestionLimit: parsePositiveInt(env.BURST_QUESTION_LIMIT, 5),
    burstWindowSeconds: parsePositiveInt(env.BURST_WINDOW_SECONDS, 10),
  } as const;
}

function normalizeThinkingLevel(value: string | undefined): "LOW" | "MEDIUM" | "HIGH" {
  const normalized = (value ?? "HIGH").trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH") {
    return normalized;
  }
  return "HIGH";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
