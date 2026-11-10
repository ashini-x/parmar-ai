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
    keyword_score?: number;
    vector_rank?: number;
    keyword_rank?: number;
    fusion_method?: "rrf" | "max" | string;
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
  metadata?: Record<string, unknown>;
}

export interface AiSearchInstance {
  search(args: {
    query?: string;
    messages?: Array<{ role: "user"; content: string }>;
    ai_search_options?: {
      cache?: {
        enabled?: boolean;
        cache_threshold?: string;
      };
      retrieval?: {
        max_num_results?: number;
        match_threshold?: number;
        retrieval_type?: "vector" | "keyword" | "hybrid";
        keyword_match_mode?: "and" | "or";
        filters?: {
          folder?: string | { $in?: string[]; $gte?: string; $lt?: string };
        };
      };
      reranking?: {
        enabled?: boolean;
        model?: string;
        match_threshold?: number;
      };
    };
  }): Promise<{ chunks?: AiSearchChunk[] }>;
  info(): Promise<Record<string, unknown>>;
  update(args: {
    indexing_options?: { use_ocr?: boolean };
    index_method?: { vector?: boolean; keyword?: boolean };
    custom_metadata?: Array<{ field_name: string; data_type: "text" | "number" | "boolean" | "datetime" }>;
  }): Promise<unknown>;
  items: {
    upload(key: string, content: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string, options?: { metadata?: Record<string, string | number | boolean> }): Promise<AiSearchItem>;
    uploadAndPoll(key: string, content: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string, options?: {
      metadata?: Record<string, string>;
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
  task?: "resume_index" | "index_chunk" | "repair_chunk" | "cleanup_chunk" | "monitor" | "retry_page" | "quality_check" | "release_qa" | "parmarbot_test" | "delete_book" | "delete_vision_output";
  startPage?: number;
  endPage?: number;
  objectNames?: string[];
  pages?: number[];
  runId?: string;
  monitorSequence?: number;
  repairPass?: number;
  page?: number;
  retryAttempt?: number;
}

export interface FatmanImportWorkflowInstance {
  id: string;
  status(): Promise<{ status: string; error?: { message?: string } }>;
}

export interface FatmanImportWorkflowBinding {
  create(options: { id: string; params: FatmanImportWorkflowParams }): Promise<FatmanImportWorkflowInstance>;
  get(id: string): Promise<FatmanImportWorkflowInstance>;
}

export interface BrvinRemotePassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}

export interface BrvinRemotePageImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  byteLength: number;
}

export interface BrvinServiceFailure {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  userMessage?: string;
}

export type BrvinServiceStatusResult =
  | { ok: true; ready: boolean; authorizedSourceCount: number }
  | BrvinServiceFailure;

export type BrvinServiceRetrievalResult =
  | {
      ok: true;
      passages: BrvinRemotePassage[];
      pageImages?: BrvinRemotePageImage[];
      searchedSources: number;
      searchCount: number;
    }
  | BrvinServiceFailure;

export interface BrvinProjectSelector {
  /** Opaque BRVIN project identifier; never an authorisation credential. */
  projectId: string;
}

export interface BrvinAuthorizedProject {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  ready: boolean;
  authorizedSourceCount: number;
}

export type BrvinV2Passage = BrvinRemotePassage;
export type BrvinV2PageImage = BrvinRemotePageImage;

export interface BrvinV2RetrievalInput extends BrvinProjectSelector {
  queries: string[];
  pageNumbers?: number[];
  requestId?: string;
}

export interface BrvinV2RetrievalData {
  passages: BrvinV2Passage[];
  pageImages?: BrvinV2PageImage[];
  searchedSources: number;
  searchCount: number;
}

export type BrvinV2FailureCode =
  | "INVALID_REQUEST"
  | "APPLICATION_NOT_REGISTERED"
  | "APPLICATION_INACTIVE"
  | "ENVIRONMENT_NOT_REGISTERED"
  | "ENVIRONMENT_INACTIVE"
  | "PROJECT_NOT_AUTHORIZED"
  | "PROJECT_INACTIVE"
  | "MONTHLY_LIMIT_REACHED"
  | "RETRIEVAL_FAILED"
  | "BRVIN_UNAVAILABLE";

export interface BrvinV2Success<T> {
  ok: true;
  data: T;
}

export interface BrvinV2Failure {
  ok: false;
  code: BrvinV2FailureCode;
  message: string;
  retryable: boolean;
  userMessage?: string;
  requestId?: string;
}

export type BrvinV2Result<T> = BrvinV2Success<T> | BrvinV2Failure;

export interface BrvinServiceV2Binding {
  listAuthorizedProjectsV2(): Promise<BrvinV2Result<BrvinAuthorizedProject[]>>;
  proveConnectionV2(input: { challengeId: string; nonce: string }): Promise<BrvinV2Result<{
    challengeId: string;
    proof: string;
    ready: boolean;
    authorizedSourceCount: number;
  }>>;
  getProjectStatusV2(input: BrvinProjectSelector): Promise<BrvinV2Result<{
    projectId: string;
    ready: boolean;
    authorizedSourceCount: number;
  }>>;
  retrieveProjectContextV2(input: BrvinV2RetrievalInput): Promise<BrvinV2Result<BrvinV2RetrievalData>>;
}

export interface BrvinServiceBinding extends BrvinServiceV2Binding {
  getProjectStatus(): Promise<BrvinServiceStatusResult>;
  retrieveProjectContext(input: { queries: string[]; pageNumbers?: number[] }): Promise<BrvinServiceRetrievalResult>;
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
  /** Cloudflare account that hosts the private BRVIN retrieval Worker. */
  BRVIN_HOME_ACCOUNT_ID?: string;
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

  BRVIN_SEARCH?: AiSearchNamespace;
  /** Direct search-only binding used by the current-provider M15 shadow baseline. */
  BRVIN_M15_AI_SEARCH?: Pick<AiSearchInstance, "search">;
  /** Separate, upload-capable AI Search instance used only by the second-source M15 staging benchmark. */
  BRVIN_M15_BENCHMARK_AI_SEARCH?: AiSearchInstance;
  /** Dedicated Qdrant collection for the second-source M15 staging benchmark; never production. */
  BRVIN_M15_BENCHMARK_QDRANT_COLLECTION?: string;
  BRVIN_SEARCH_INSTANCE?: string;
  /** Server-side provider selector; M13 supports only cloudflare-ai-search. */
  BRVIN_RETRIEVAL_PROVIDER?: string;
  /** Enables M13 durable corpus writes only in an explicitly configured pilot. */
  BRVIN_CORPUS_MANIFEST_ENABLED?: string;
  /** M14 non-production Vertex embedding region; never set on production Workers. */
  BRVIN_M14_VERTEX_LOCATION?: string;
  /** M14 pilot embedding model ID; defaults in code to gemini-embedding-001. */
  BRVIN_M14_VERTEX_MODEL?: string;
  /** Must match the non-production Qdrant dense vector size. */
  BRVIN_M14_EMBEDDING_DIMENSIONS?: string;
  /** Non-production Qdrant cluster origin; HTTPS only. */
  BRVIN_M14_QDRANT_URL?: string;
  /** Non-production Qdrant API key; keep as a Worker secret. */
  BRVIN_M14_QDRANT_API_KEY?: string;
  /** Isolated M14 collection name. */
  BRVIN_M14_QDRANT_COLLECTION?: string;
  /** Bearer secret required by the isolated M14 staging operator Worker. */
  BRVIN_M14_ADMIN_TOKEN?: string;
  /** Must be explicitly enabled on a staging Worker for the Physics pilot. */
  BRVIN_M14_PILOT_ENABLED?: string;
  /** Separate private GCS bucket for M14 manifests; must not equal the source/OCR bucket. */
  BRVIN_M14_CORPUS_BUCKET?: string;
  /** Local minimum score fallback when AI Search does not return a reranking score. */
  BRVIN_MIN_SCORE?: string;
  /** Per-request vector similarity threshold (0..1) for candidate retrieval. */
  BRVIN_MATCH_THRESHOLD?: string;
  /** Enables Cloudflare AI Search's independent cross-encoder reranker. Defaults to true. */
  BRVIN_RERANKING_ENABLED?: string;
  /** Cloudflare reranking model ID; this ranks evidence and does not generate answers. */
  BRVIN_RERANKING_MODEL?: string;
  /** Minimum reranking score (0..1) retained in BRVIN evidence. */
  BRVIN_RERANKING_MIN_SCORE?: string;
  BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT?: string;
  BRVIN_SERVICE?: BrvinServiceBinding;
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
