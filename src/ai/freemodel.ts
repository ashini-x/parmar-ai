import type { AnswerPacket, Env, ProfileContext } from "../config/env";
import {
  parseAnswerPacket,
  sanitizeAnswerPacket,
  SYSTEM_INSTRUCTION,
} from "./gemini";

const DEFAULT_BASE_URL = "https://freemodel.in/v1";
const DEFAULT_PRIMARY_MODEL = "claude-sonnet-5-5";
const CATALOG_TTL_MS = 5 * 60_000;
const MODEL_MAINTENANCE_COOLDOWN_MS = 10 * 60_000;
const TRANSIENT_COOLDOWN_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_COMPLETION_TOKENS = 2_048;

export const PREFERRED_MODEL_ORDER = [
  "claude-fable-5-2",
  "claude-opus-5-5",
  "gpt-6-astra",
  "claude-sonnet-5-5",
  "gemini-4-carbon",
  "claude-fable-5-1",
  "deepseek-v3.2",
  "kimi-k3",
  "qwen-3-max",
] as const;

export const ANSWER_PACKET_REQUIRED_KEYS = [
  "responseMode",
  "answer",
  "quizQuestion",
  "quizOptions",
  "quizCorrectOptionIds",
  "quizExplanation",
  "quizItems",
  "sscTakeaway",
  "answerScope",
  "subject",
  "topic",
  "questionMode",
  "examRelevance",
  "profileSignal",
  "nextRevisionTopic",
  "detectedExam",
  "timeSensitive",
] as const;

/**
 * FreeModel's JSON mode is object-only, not JSON-Schema constrained. Keep the
 * complete AnswerPacket contract in this provider adapter rather than changing
 * Gemini's production system instruction or Vertex response schema.
 */
export const FREE_MODEL_ANSWER_PACKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...ANSWER_PACKET_REQUIRED_KEYS],
  properties: {
    responseMode: { type: "string", enum: ["text", "quiz"] },
    answer: { type: "string" },
    quizQuestion: { type: "string" },
    quizOptions: { type: "array", items: { type: "string" } },
    quizCorrectOptionIds: { type: "array", items: { type: "integer" } },
    quizExplanation: { type: "string" },
    quizItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "correctOptionIds", "explanation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctOptionIds: { type: "array", items: { type: "integer" } },
          explanation: { type: "string" },
        },
      },
    },
    sscTakeaway: { type: "string" },
    answerScope: { type: "string", enum: ["ssc_ga_gs", "ssc_support", "out_of_scope"] },
    subject: { type: "string", enum: ["history", "polity", "geography", "economy", "science", "static_gk", "current_affairs", "art_culture", "other"] },
    topic: { type: "string" },
    questionMode: { type: "string", enum: ["fact", "concept", "comparison", "statement_trap", "revision", "study_plan", "mcq"] },
    examRelevance: { type: "string", enum: ["A", "B", "C", "D"] },
    profileSignal: { type: "string", enum: ["neutral", "weak", "confusion", "strength"] },
    nextRevisionTopic: { type: "string" },
    detectedExam: { type: ["string", "null"] },
    timeSensitive: { type: "boolean" },
  },
} as const;

const ANSWER_PACKET_SCHEMA_INSTRUCTION =
  "Return exactly one unfenced JSON object matching this required AnswerPacket JSON Schema. " +
  "Every listed key is required. Do not add commentary, markdown, code fences, or extra properties. " +
  JSON.stringify(FREE_MODEL_ANSWER_PACKET_SCHEMA);

export interface FreeModelPricing {
  input_per_1k?: number;
  output_per_1k?: number;
}

export interface FreeModelModel {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  context_window?: number;
  capabilities: string[];
  pricing?: FreeModelPricing;
  rank?: number;
  coolingDown?: boolean;
  cooldownUntil?: number;
  cooldownReason?: string;
}

interface FreeModelCatalogEntry {
  models: FreeModelModel[];
  fetchedAt: number;
}

interface FreeModelCatalogResponse {
  data?: unknown;
}

interface FreeModelUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
}

interface FreeModelCompletionResponse {
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: FreeModelUsage;
}

export interface FreeModelTokenMetrics {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

export interface FreeModelGenerationResult {
  packet: AnswerPacket;
  modelUsed: string;
  latencyMs: number;
  tokens: FreeModelTokenMetrics;
  estimatedCostUsd: number | null;
  estimateBasis: string;
  jsonMode: boolean;
  thinkingEffort: string;
  failoverModels: string[];
}

export interface FreeModelGenerationInput {
  question: string;
  userPrompt: string;
  profileContext: ProfileContext;
  requestedQuizCount: number;
  targetModel?: string;
}

interface ModelCooldown {
  until: number;
  reason: string;
  status: number | null;
}

class FreeModelError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly modelId?: string;
  readonly cooldownUntil?: number;

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    modelId?: string,
    cooldownUntil?: number,
  ) {
    super(message);
    this.name = "FreeModelError";
    this.code = code;
    this.status = status;
    this.modelId = modelId;
    this.cooldownUntil = cooldownUntil;
  }
}

const catalogCache = new Map<string, FreeModelCatalogEntry>();
const modelCooldowns = new Map<string, ModelCooldown>();

function baseUrlFor(env: Env): string {
  const value = (env.FREEMODEL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new FreeModelError("invalid_base_url", "FreeModel base URL must use HTTPS.");
  }
  return value;
}

function apiKeyFor(env: Env): string {
  const key = env.FREEMODEL_API_KEY?.trim();
  if (!key) throw new FreeModelError("not_configured", "FreeModel API key is not configured.");
  return key;
}

function primaryModelFor(env: Env): string {
  return env.FREEMODEL_PRIMARY_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function finiteNonNegative(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeModel(value: unknown): FreeModelModel | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  const pricing = item.pricing && typeof item.pricing === "object"
    ? item.pricing as Record<string, unknown>
    : undefined;
  return {
    id: item.id.trim(),
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(typeof item.type === "string" ? { type: item.type } : {}),
    ...(finiteNonNegative(item.context_window) !== undefined
      ? { context_window: finiteNonNegative(item.context_window) }
      : {}),
    capabilities: isStringArray(item.capabilities) ? item.capabilities : [],
    ...(pricing ? {
      pricing: {
        ...(finiteNonNegative(pricing.input_per_1k) !== undefined
          ? { input_per_1k: finiteNonNegative(pricing.input_per_1k) }
          : {}),
        ...(finiteNonNegative(pricing.output_per_1k) !== undefined
          ? { output_per_1k: finiteNonNegative(pricing.output_per_1k) }
          : {}),
      },
    } : {}),
  };
}

function cooldownKey(baseUrl: string, modelId: string): string {
  return baseUrl + "|" + modelId;
}

function currentCooldown(baseUrl: string, modelId: string, now = Date.now()): ModelCooldown | null {
  const key = cooldownKey(baseUrl, modelId);
  const cooldown = modelCooldowns.get(key);
  if (!cooldown) return null;
  if (cooldown.until <= now) {
    modelCooldowns.delete(key);
    return null;
  }
  return cooldown;
}

function setModelCooldown(
  baseUrl: string,
  modelId: string,
  status: number | null,
  reason: string,
): number {
  const duration = status === 404 ? MODEL_MAINTENANCE_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS;
  const until = Date.now() + duration;
  modelCooldowns.set(cooldownKey(baseUrl, modelId), { until, reason, status });
  return until;
}

function rankModels(models: FreeModelModel[], primaryModel: string): FreeModelModel[] {
  const active = models.filter((model) => model.type === "chat");
  const byId = new Map(active.map((model) => [model.id, model]));
  const orderedIds = [primaryModel, ...PREFERRED_MODEL_ORDER.filter((id) => id !== primaryModel)];
  const ranked: FreeModelModel[] = [];
  for (const id of orderedIds) {
    const model = byId.get(id);
    if (!model || ranked.some((item) => item.id === model.id)) continue;
    ranked.push(model);
  }
  const remaining = active
    .filter((model) => !ranked.some((item) => item.id === model.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...ranked, ...remaining].map((model, index) => ({ ...model, rank: index + 1 }));
}

export function rankActiveFreeModelModels(
  models: FreeModelModel[],
  primaryModel = DEFAULT_PRIMARY_MODEL,
): FreeModelModel[] {
  return rankModels(models, primaryModel);
}

export function supportsFreeModelJsonMode(model: FreeModelModel): boolean {
  return model.capabilities.includes("json_mode");
}

export async function getFreeModelCatalog(
  env: Env,
  options: { forceRefresh?: boolean } = {},
): Promise<FreeModelCatalogEntry> {
  const baseUrl = baseUrlFor(env);
  const apiKey = apiKeyFor(env);
  const cached = catalogCache.get(baseUrl);
  if (!options.forceRefresh && cached && cached.fetchedAt + CATALOG_TTL_MS > Date.now()) {
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(baseUrl + "/models", {
        method: "GET",
        headers: { authorization: "Bearer " + apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      throw new FreeModelError(
        "catalog_unavailable",
        error instanceof Error && error.name === "AbortError"
          ? "FreeModel model catalogue request timed out."
          : "FreeModel model catalogue is temporarily unavailable.",
      );
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new FreeModelError("catalog_auth_failed", "FreeModel catalogue access was rejected.", response.status);
      }
      throw new FreeModelError("catalog_unavailable", "FreeModel model catalogue request failed.", response.status);
    }

    let payload: FreeModelCatalogResponse;
    try {
      payload = await response.json() as FreeModelCatalogResponse;
    } catch {
      throw new FreeModelError("catalog_malformed", "FreeModel returned an invalid model catalogue.", response.status);
    }
    if (!Array.isArray(payload.data)) {
      throw new FreeModelError("catalog_malformed", "FreeModel returned an invalid model catalogue.", response.status);
    }

    const models = payload.data
      .map(normalizeModel)
      .filter((model): model is FreeModelModel => model !== null)
      .filter((model) => model.type === "chat");
    const entry = { models, fetchedAt: Date.now() };
    catalogCache.set(baseUrl, entry);
    return entry;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getFreeModelModels(
  env: Env,
): Promise<{ models: FreeModelModel[]; fetchedAt: number; primaryModel: string }> {
  const baseUrl = baseUrlFor(env);
  const primaryModel = primaryModelFor(env);
  const catalog = await getFreeModelCatalog(env);
  const models = rankModels(catalog.models, primaryModel).map((model) => {
    const cooldown = currentCooldown(baseUrl, model.id);
    return {
      ...model,
      coolingDown: Boolean(cooldown),
      ...(cooldown ? {
        cooldownUntil: cooldown.until,
        cooldownReason: cooldown.reason,
      } : {}),
    };
  });
  return { models, fetchedAt: catalog.fetchedAt, primaryModel };
}

function requiredAnswerPacketKeysPresent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!ANSWER_PACKET_REQUIRED_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  return typeof record.answer === "string" &&
    typeof record.quizQuestion === "string" &&
    typeof record.quizOptions === "object" && Array.isArray(record.quizOptions) &&
    Array.isArray(record.quizCorrectOptionIds) &&
    typeof record.quizExplanation === "string" &&
    Array.isArray(record.quizItems) &&
    typeof record.sscTakeaway === "string" &&
    typeof record.topic === "string" &&
    typeof record.nextRevisionTopic === "string" &&
    (typeof record.detectedExam === "string" || record.detectedExam === null) &&
    typeof record.timeSensitive === "boolean";
}

function parseStrictAnswerPacket(content: string): Record<string, unknown> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new FreeModelError("malformed_json", "FreeModel returned malformed AnswerPacket JSON.");
  }
  if (!requiredAnswerPacketKeysPresent(decoded)) {
    throw new FreeModelError("malformed_json", "FreeModel returned an incomplete AnswerPacket.");
  }
  return decoded;
}

function usageTokens(usage: FreeModelUsage | undefined): FreeModelTokenMetrics {
  const promptTokens = Math.floor(finiteNonNegative(usage?.prompt_tokens) ?? 0);
  const candidatesTokens = Math.floor(finiteNonNegative(usage?.completion_tokens) ?? 0);
  const totalTokens = Math.floor(
    finiteNonNegative(usage?.total_tokens) ?? promptTokens + candidatesTokens,
  );
  return {
    promptTokens,
    candidatesTokens,
    thoughtsTokens: 0,
    totalTokens,
  };
}

function estimateModelCost(model: FreeModelModel, tokens: FreeModelTokenMetrics): number | null {
  const inputRate = model.pricing?.input_per_1k;
  const outputRate = model.pricing?.output_per_1k;
  if (inputRate === undefined || outputRate === undefined) return null;
  return (tokens.promptTokens / 1_000) * inputRate +
    (tokens.candidatesTokens / 1_000) * outputRate;
}

function safeProviderMessage(status: number): string {
  if (status === 401 || status === 403) return "FreeModel rejected the configured API key or its permissions.";
  if (status === 402) return "FreeModel's available token allowance or balance is exhausted.";
  if (status === 404) return "This model is unavailable or in maintenance.";
  if (status === 429) return "FreeModel rate limit was reached.";
  if (status >= 500) return "The upstream FreeModel provider is temporarily unavailable.";
  return "FreeModel rejected the inference request.";
}

async function completeModel(
  env: Env,
  model: FreeModelModel,
  question: string,
  userPrompt: string,
  profileContext: ProfileContext,
  requestedQuizCount: number,
  baseUrl: string,
): Promise<FreeModelGenerationResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const jsonMode = supportsFreeModelJsonMode(model);
  try {
    let response: Response;
    try {
      response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + apiKeyFor(env),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTION },
            { role: "system", content: ANSWER_PACKET_SCHEMA_INSTRUCTION },
            { role: "user", content: userPrompt },
          ],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          temperature: 0.1,
          max_tokens: MAX_COMPLETION_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FreeModelError("timeout", "FreeModel inference timed out.", null, model.id);
      }
      throw new FreeModelError("network_error", "FreeModel inference request failed.", null, model.id);
    }

    if (!response.ok) {
      const status = response.status;
      throw new FreeModelError(
        status === 402 ? "insufficient_funds" : status === 404 ? "model_unavailable" :
          status === 429 ? "rate_limited" : status >= 500 ? "upstream_error" : "request_rejected",
        safeProviderMessage(status),
        status,
        model.id,
      );
    }

    let payload: FreeModelCompletionResponse;
    try {
      payload = await response.json() as FreeModelCompletionResponse;
    } catch {
      throw new FreeModelError("malformed_json", "FreeModel returned an invalid completion response.", response.status, model.id);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new FreeModelError("malformed_json", "FreeModel returned no AnswerPacket content.", response.status, model.id);
    }

    const decoded = parseStrictAnswerPacket(content);
    const parsed = parseAnswerPacket(JSON.stringify(decoded));
    const packet = sanitizeAnswerPacket(
      parsed,
      false,
      false,
      question,
      profileContext,
      requestedQuizCount,
      false,
    );
    const tokens = usageTokens(payload.usage);
    const estimatedCostUsd = estimateModelCost(model, tokens);
    const responseModel = typeof payload.model === "string" && payload.model.trim()
      ? payload.model.trim()
      : model.id;

    return {
      packet,
      modelUsed: responseModel,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tokens,
      estimatedCostUsd,
      estimateBasis: estimatedCostUsd === null
        ? "Unavailable: the active catalogue did not publish both input and output rates."
        : "Estimate from active /v1/models pricing and response usage; not an invoice charge.",
      jsonMode,
      thinkingEffort: "Provider-managed; FreeModel exposes no comparable effort field in this response.",
      failoverModels: [],
    };
  } catch (error) {
    if (error instanceof FreeModelError) throw error;
    throw new FreeModelError("malformed_json", "FreeModel returned an unusable response.", null, model.id);
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientModelFailure(error: FreeModelError): boolean {
  return error.code === "model_unavailable" ||
    error.code === "rate_limited" ||
    error.code === "upstream_error" ||
    error.code === "timeout" ||
    error.code === "network_error" ||
    error.code === "malformed_json";
}

function cooldownForFailure(baseUrl: string, error: FreeModelError): number | undefined {
  if (!error.modelId || !isTransientModelFailure(error)) return undefined;
  const reason = error.code;
  const status = error.status ?? (reason === "model_unavailable" ? 404 : null);
  return setModelCooldown(baseUrl, error.modelId, status, reason);
}

export async function generateFreeModelAnswer(
  env: Env,
  input: FreeModelGenerationInput,
): Promise<FreeModelGenerationResult> {
  const baseUrl = baseUrlFor(env);
  const catalog = await getFreeModelCatalog(env);
  const primaryModel = primaryModelFor(env);
  const targetModel = input.targetModel?.trim();
  const autoMode = !targetModel || targetModel === "auto";
  const candidates = autoMode
    ? rankModels(catalog.models, primaryModel)
    : catalog.models.filter((model) => model.id === targetModel);

  if (!candidates.length) {
    throw new FreeModelError(
      "model_not_active",
      autoMode
        ? "FreeModel currently has no active chat models."
        : "The selected model is not present in the active FreeModel catalogue.",
      404,
      targetModel,
    );
  }

  const failoverModels: string[] = [];
  const failures: FreeModelError[] = [];
  for (const model of candidates) {
    const cooldown = currentCooldown(baseUrl, model.id);
    if (cooldown) {
      failoverModels.push(model.id + " (cooling down)");
      if (!autoMode) {
        throw new FreeModelError(
          "model_cooldown",
          "The selected model is temporarily cooling down after a provider failure.",
          cooldown.status,
          model.id,
          cooldown.until,
        );
      }
      continue;
    }

    try {
      const result = await completeModel(
        env,
        model,
        input.question,
        input.userPrompt,
        input.profileContext,
        input.requestedQuizCount,
        baseUrl,
      );
      return { ...result, failoverModels };
    } catch (error) {
      const failure = error instanceof FreeModelError
        ? error
        : new FreeModelError("upstream_error", "FreeModel inference failed.", null, model.id);
      if (failure.code === "insufficient_funds" || failure.status === 402) {
        throw failure;
      }
      if (!isTransientModelFailure(failure)) {
        throw failure;
      }
      const until = cooldownForFailure(baseUrl, failure);
      failures.push(failure);
      failoverModels.push(model.id + " (" + failure.code + ")");
      if (!autoMode) {
        throw new FreeModelError(
          failure.code,
          failure.message,
          failure.status,
          model.id,
          until,
        );
      }
    }
  }

  const lastFailure = failures[failures.length - 1];
  throw new FreeModelError(
    "all_models_unavailable",
    lastFailure
      ? "All active FreeModel candidates are unavailable or cooling down."
      : "All active FreeModel candidates are currently cooling down.",
    lastFailure?.status ?? null,
    lastFailure?.modelId,
    lastFailure?.cooldownUntil,
  );
}

export function resetFreeModelStateForTests(): void {
  catalogCache.clear();
  modelCooldowns.clear();
}

export function getFreeModelCooldownStateForTests(): Map<string, ModelCooldown> {
  return new Map(modelCooldowns);
}
