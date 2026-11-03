import type { D1Database, DurableObjectNamespace, Queue } from "@cloudflare/workers-types";

export interface AiSearchChunk {
  id?: string;
  text?: string;
  score?: number;
  item?: {
    key?: string;
    metadata?: Record<string, unknown>;
  };
  scoring_details?: {
    vector_score?: number;
    reranking_score?: number;
  };
}

export interface AiSearchItem {
  id: string;
  key: string;
  status: "queued" | "running" | "completed" | "error" | "skipped" | "outdated" | string;
  chunks_count?: number;
  error?: string;
  file_size?: number;
}

export interface AiSearchInstance {
  search(args: {
    query?: string;
    messages?: Array<{ role: "user"; content: string }>;
    ai_search_options?: {
      retrieval?: {
        max_num_results?: number;
        retrieval_type?: "vector" | "keyword" | "hybrid";
      };
    };
  }): Promise<{ chunks?: AiSearchChunk[] }>;
  info(): Promise<Record<string, unknown>>;
  update(args: { indexing_options?: { use_ocr?: boolean }; index_method?: { vector?: boolean; keyword?: boolean } }): Promise<unknown>;
  items: {
    upload(key: string, content: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string, options?: { metadata?: Record<string, string | number | boolean> }): Promise<AiSearchItem>;
    uploadAndPoll(key: string, content: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string, options?: {
      metadata?: Record<string, string | number | boolean>;
      pollIntervalMs?: number;
      timeoutMs?: number;
    }): Promise<AiSearchItem>;
    get(itemId: string): { info(): Promise<AiSearchItem>; download(): Promise<{ filename: string; contentType: string; size: number; body: ReadableStream<Uint8Array> }> };
    list(options?: { page?: number; per_page?: number; status?: string; search?: string; source?: string }): Promise<{ result: AiSearchItem[]; result_info?: { total_count?: number; page?: number; per_page?: number; total_pages?: number } }>;
    delete(itemId: string): Promise<void>;
  };
}

export interface AiSearchNamespace {
  get(name: string): AiSearchInstance;
  create(args: { id: string; indexing_options?: { use_ocr?: boolean }; index_method?: { vector?: boolean; keyword?: boolean } }): Promise<AiSearchInstance>;
  list(): Promise<{ result: Array<{ id: string }> }>;
}

export interface FatmanImportWorkflowParams {
  importId: string;
  task?: "index_chunk" | "cleanup_chunk";
  startPage?: number;
  endPage?: number;
  objectNames?: string[];
}

export interface FatmanImportWorkflowInstance {
  id: string;
  status(): Promise<{ status: string; error?: { message?: string } }>;
}

export interface FatmanImportWorkflowBinding {
  create(options: { id: string; params: FatmanImportWorkflowParams }): Promise<FatmanImportWorkflowInstance>;
  get(id: string): Promise<FatmanImportWorkflowInstance>;
}

export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  APP_VERSION?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_SETUP_SECRET?: string;
  TELEGRAM_BOT_ENCRYPTION_KEY?: string;

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
  AI_BUDGET_USD?: string;
  AI_INPUT_USD_PER_MILLION?: string;
  AI_CACHED_INPUT_USD_PER_MILLION?: string;
  AI_OUTPUT_USD_PER_MILLION?: string;
  ADMIN_DASHBOARD_USER?: string;
  ADMIN_DASHBOARD_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  BOT_OWNER_TELEGRAM_USER_ID?: string;
  ADMIN_TELEGRAM_USER_IDS?: string;
  UNLIMITED_AI_TELEGRAM_USER_IDS?: string;

  DB?: D1Database;
  QUESTION_QUEUE: Queue<QuestionJob>;
  JOB_DEDUPE: DurableObjectNamespace;
  FATMAN_ENABLED?: string;
  FATMAN_DOCUMENT_VERSION?: string;
  FATMAN_MIN_SCORE?: string;
  FATMAN_INSTANCE_NAME?: string;
  FATMAN_EXPECTED_PAGES?: string;
  FATMAN_MONTHLY_QUERY_LIMIT?: string;
  FATMAN_GCS_BUCKET?: string;
  FATMAN_IMPORT?: FatmanImportWorkflowBinding;
  FATMAN_SEARCH?: AiSearchNamespace;
}

export const MAX_QUIZ_BATCH_SIZE = 10;
export const MAX_PHOTO_COUNT = 5;
export const MAX_SINGLE_PHOTO_BYTES = 7 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 12 * 1024 * 1024;
export const DEFAULT_PHOTO_QUESTION = "Please read the attached study image(s) and answer the SSC doubt shown. Match the language of any caption or visible question.";

export interface GeminiImageInput {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  byteLength: number;
}

export interface QuestionJob {
  version: 1 | 2;
  botConnectionId: string;
  updateId: number;
  chatId: number;
  question: string;
  messageId: number;
  requestId: string;
  createdAt: number;
  statusMessageId?: number;
  telegramUserId?: number;
  quizCount?: number;
  fatmanModeSnapshot?: boolean;
}


export interface QuizItem {
  question: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string;
}

export interface AnswerPacket {
  answer: string;
  responseMode: "text" | "quiz";
  sscTakeaway: string;
  answerScope: "ssc_ga_gs" | "ssc_support" | "out_of_scope";
  subject: "history" | "polity" | "geography" | "economy" | "science" | "static_gk" | "current_affairs" | "art_culture" | "other";
  topic: string;
  questionMode: "fact" | "concept" | "comparison" | "statement_trap" | "revision" | "study_plan" | "mcq";
  examRelevance: "A" | "B" | "C" | "D";
  difficulty: "easy" | "medium" | "hard";
  profileSignal: "neutral" | "weak" | "confusion" | "strength";
  profileNote: string;
  nextRevisionTopic: string;
  detectedExam: string | null;
  timeSensitive: boolean;
  quizQuestion: string;
  quizOptions: string[];
  quizCorrectOptionIds: number[];
  quizExplanation: string;
  quizItems?: QuizItem[];
  thinkingLevelUsed?: "LOW" | "MEDIUM" | "HIGH";
  grounded?: boolean;
}

export interface LearningSignal {
  topic: string;
  confusionCount: number;
  weakCount: number;
  lastSeenAt: number;
}

export interface AiUsageRecord {
  attempt: number;
  model: string;
  location: string;
  thinkingLevel: "LOW" | "MEDIUM" | "HIGH";
  grounded: boolean;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  toolUsePromptTokens: number;
  cachedContentTokens: number;
  totalTokens: number;
  estimatedCostMicrousd: number;
  recordedAt: number;
  status: "completed" | "rejected";
}

export interface GeminiGenerationResult {
  packet: AnswerPacket;
  usage: AiUsageRecord[];
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
    version: env.APP_VERSION ?? "2.8.0",
    model: env.GEMINI_MODEL ?? "gemini-3.8-flash",
    location: env.GEMINI_LOCATION ?? "global",
    maxThinkingLevel: normalizeThinkingLevel(env.GEMINI_THINKING_LEVEL),
    maxOutputTokens: parsePositiveInt(env.MAX_OUTPUT_TOKENS, 1_200),
    maxQuestionLength: parsePositiveInt(env.MAX_QUESTION_LENGTH, 4_000),
    dailyQuestionLimit: parsePositiveInt(env.DAILY_QUESTION_LIMIT, 20),
    burstQuestionLimit: parsePositiveInt(env.BURST_QUESTION_LIMIT, 5),
    burstWindowSeconds: parsePositiveInt(env.BURST_WINDOW_SECONDS, 10),
    aiBudgetUsd: parseNonNegativeFloat(env.AI_BUDGET_USD, 0),
    aiInputUsdPerMillion: parseNonNegativeFloat(env.AI_INPUT_USD_PER_MILLION, 0.75),
    aiCachedInputUsdPerMillion: parseNonNegativeFloat(env.AI_CACHED_INPUT_USD_PER_MILLION, 0.075),
    aiOutputUsdPerMillion: parseNonNegativeFloat(env.AI_OUTPUT_USD_PER_MILLION, 3.75),
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

function parseNonNegativeFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
