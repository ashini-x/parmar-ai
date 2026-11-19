import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import { json } from "../http/response";

export type OwnerThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "XHIGH";

export interface OwnerGeminiModelDefinition {
  id: string;
  label: string;
  lifecycle: "GA";
  apiVersion: "v1";
  inputModalities: readonly ["text"];
  outputModalities: readonly ["text"];
  contextWindowTokens: number;
  modelMaxOutputTokens: number;
  singleRequestOutputTokens: number;
  singleStreamingOutputTokens: number;
  supportsLongDecode?: boolean;
  thinkingLevels: readonly OwnerThinkingLevel[];
  defaultThinkingLevel: OwnerThinkingLevel;
}

/**
 * Centrally maintained Google Agent Platform registry. This is metadata, not
 * proof of access: a model becomes selectable only after the configured
 * project/location passes the live countTokens capability probe.
 */
export const OWNER_GEMINI_MODEL_REGISTRY: readonly OwnerGeminiModelDefinition[] = [
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, supportsLongDecode: true, thinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"], defaultThinkingLevel: "HIGH" },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 32_768, singleStreamingOutputTokens: 65_536, supportsLongDecode: true, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 32_768, singleStreamingOutputTokens: 65_536, supportsLongDecode: true, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, singleStreamingOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MINIMAL" },
] as const;

export type OwnerModelAvailability = "available" | "unavailable" | "unverified";

export interface OwnerGeminiModel extends OwnerGeminiModelDefinition {
  availability: OwnerModelAvailability;
  selectable: boolean;
  availabilityReason: "project_location_probe_passed" | "model_or_location_not_available" | "provider_access_denied" | "provider_temporarily_unavailable" | "not_checked";
}

export interface OwnerModelCatalogue {
  ok: boolean;
  configured: boolean;
  location: string | null;
  checkedAt: number;
  models: OwnerGeminiModel[];
  error?: "vertex_not_configured" | "google_auth_unavailable";
}

export interface OwnerProviderDependencies {
  getAccessToken: (env: Env) => Promise<string>;
  fetch: typeof fetch;
  /** Optional deterministic seams for bounded stream-open retry tests. */
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const defaultDependencies: OwnerProviderDependencies = {
  getAccessToken: getGoogleAccessToken,
  fetch: ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch,
};
const PROBE_TIMEOUT_MS = 8_000;
const ACCESS_TOKEN_TIMEOUT_MS = 12_000;
const GENERATION_MAX_ATTEMPTS = 3;
const CATALOGUE_CACHE_MS = 90_000;
// Interactive chat retries the initial stream-open response at most twice.
// Retries happen only before a successful SSE response/body has been accepted.
const STREAM_OPEN_MAX_ATTEMPTS = 3;
const STREAM_OPEN_INITIAL_BACKOFF_MS = 1_000;
const STREAM_OPEN_MAX_BACKOFF_MS = 4_000;
const catalogueCache = new Map<string, { expiresAt: number; value: OwnerModelCatalogue }>();
const verifiedModelCache = new Map<string, { expiresAt: number; model: OwnerGeminiModel }>();

function configuredProject(env: Env): string | null {
  const project = env.GCP_PROJECT_ID?.trim();
  return project && /^[a-z][a-z0-9-]{4,62}[a-z0-9]$/u.test(project) ? project : null;
}

function configuredLocation(env: Env): string {
  const location = env.GEMINI_LOCATION?.trim() || "global";
  return /^[a-z0-9-]+$/u.test(location) ? location : "global";
}

function vertexBase(location: string): string {
  return location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

function isRetryableStreamOpenStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 ||
    status === 502 || status === 503 || status === 504;
}

function streamOpenRetryDelayMs(
  response: Response,
  failedAttempt: number,
  random: () => number,
): number {
  const base = Math.min(
    STREAM_OPEN_INITIAL_BACKOFF_MS * (2 ** (failedAttempt - 1)),
    STREAM_OPEN_MAX_BACKOFF_MS,
  );
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  let delay = Math.round(base * jitter);

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAfterMs = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1_000
      : Math.max(0, Date.parse(retryAfter) - Date.now());
    if (Number.isFinite(retryAfterMs)) {
      delay = Math.max(delay, Math.min(STREAM_OPEN_MAX_BACKOFF_MS, retryAfterMs));
    }
  }

  return Math.min(STREAM_OPEN_MAX_BACKOFF_MS, delay);
}

async function waitForStreamRetry(
  milliseconds: number,
  signal: AbortSignal,
  dependencies: OwnerProviderDependencies,
): Promise<void> {
  const stopped = () => new OwnerGeminiProviderError("Generation was stopped.", undefined, false);
  if (signal.aborted) throw stopped();

  if (dependencies.sleep) {
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        dependencies.sleep(milliseconds),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(stopped());
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw stopped();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(stopped());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error("Timed out"));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
function failureReason(status: number | null): OwnerGeminiModel["availabilityReason"] {
  if (status === 400 || status === 404) return "model_or_location_not_available";
  if (status === 401 || status === 403) return "provider_access_denied";
  return "provider_temporarily_unavailable";
}

interface OwnerGeminiProbeResult {
  model: OwnerGeminiModel;
  status?: number;
  diagnostic?: string;
}

async function safeVertexErrorDiagnostic(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.clone().json() as {
      error?: {
        status?: unknown;
        message?: unknown;
        details?: Array<{ reason?: unknown; metadata?: Record<string, unknown> }>;
      };
    };
    const error = payload.error;
    if (!error || typeof error !== "object") return undefined;

    const fragments: string[] = [];
    const providerStatus = typeof error.status === "string" &&
      /^[A-Z0-9_]{3,48}$/u.test(error.status) ? error.status : undefined;
    if (providerStatus) fragments.push(providerStatus);

    const details = Array.isArray(error.details) ? error.details : [];
    const reason = details.map((detail) => detail?.reason)
      .find((value): value is string =>
        typeof value === "string" && /^[A-Z0-9_]{3,64}$/u.test(value));
    const detailPermission = details.map((detail) => detail?.metadata?.permission)
      .find((value): value is string =>
        typeof value === "string" &&
        /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u.test(value));

    // Some Google REST errors put ErrorInfo in a formatted message rather
    // than the JSON details array. Extract only safe reason and IAM
    // permission identifiers; never echo the raw message or resource path.
    const message = typeof error.message === "string" ? error.message : "";
    const messagePermission = message.match(/Permission ['"]([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)['"] denied/iu)?.[1];
    const messageReason = message.match(/reason:\s*["']([A-Z0-9_]{3,64})["']/u)?.[1];
    const permission = detailPermission ?? (
      messagePermission && /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u.test(messagePermission)
        ? messagePermission : undefined
    );
    const safeReason = reason ?? messageReason;

    if (safeReason && safeReason !== providerStatus) fragments.push("reason " + safeReason);
    if (permission) fragments.push("permission " + permission);
    return fragments.length ? "Google diagnostic: " + fragments.join("; ") + "." : undefined;
  } catch {
    return undefined;
  }
}

async function probeModel(
  env: Env,
  model: OwnerGeminiModelDefinition,
  project: string,
  location: string,
  token: string,
  dependencies: OwnerProviderDependencies,
): Promise<OwnerGeminiProbeResult> {
  const controller = new AbortController();
  try {
    const response = await withTimeout(dependencies.fetch(
      `${vertexBase(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model.id)}:countTokens`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Owner model availability check." }] }] }),
        signal: controller.signal,
      },
    ), PROBE_TIMEOUT_MS, () => controller.abort());

    if (response.ok) {
      return {
        model: { ...model, availability: "available", selectable: true, availabilityReason: "project_location_probe_passed" },
      };
    }

    return {
      model: {
        ...model,
        availability: response.status === 400 || response.status === 404 ? "unavailable" : "unverified",
        selectable: false,
        availabilityReason: failureReason(response.status),
      },
      status: response.status,
      diagnostic: await safeVertexErrorDiagnostic(response),
    };
  } catch {
    return {
      model: { ...model, availability: "unverified", selectable: false, availabilityReason: "provider_temporarily_unavailable" },
    };
  }
}


async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function listOwnerGeminiModels(
  env: Env,
  dependencies: OwnerProviderDependencies = defaultDependencies,
): Promise<OwnerModelCatalogue> {
  const project = configuredProject(env);
  const location = configuredLocation(env);
  const checkedAt = Date.now();
  if (!project || !env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim()) {
    return {
      ok: false, configured: false, location: null, checkedAt, error: "vertex_not_configured",
      models: OWNER_GEMINI_MODEL_REGISTRY.map((model) => ({ ...model, availability: "unverified", selectable: false, availabilityReason: "not_checked" })),
    };
  }

  const cacheKey = `${project}:${location}`;
  const cached = catalogueCache.get(cacheKey);
  if (cached && cached.expiresAt > checkedAt) return cached.value;

  let token: string;
  try {
    token = await withTimeout(dependencies.getAccessToken(env), ACCESS_TOKEN_TIMEOUT_MS);
  } catch {
    return {
      ok: false, configured: true, location, checkedAt, error: "google_auth_unavailable",
      models: OWNER_GEMINI_MODEL_REGISTRY.map((model) => ({ ...model, availability: "unverified", selectable: false, availabilityReason: "provider_access_denied" })),
    };
  }

  const probes = await mapLimited(OWNER_GEMINI_MODEL_REGISTRY, 3, (model) =>
    probeModel(env, model, project, location, token, dependencies));
  const models = probes.map((probe) => probe.model);
  const value: OwnerModelCatalogue = { ok: true, configured: true, location, checkedAt, models };
  const expiresAt = checkedAt + CATALOGUE_CACHE_MS;
  catalogueCache.set(cacheKey, { expiresAt, value });
  for (const model of models) {
    if (model.selectable) {
      verifiedModelCache.set(`${cacheKey}:${model.id}`, { expiresAt, model });
    }
  }
  return value;
}

export async function ownerIntelligenceModelsResponse(
  env: Env,
  dependencies: OwnerProviderDependencies = defaultDependencies,
): Promise<Response> {
  const catalogue = await listOwnerGeminiModels(env, dependencies);
  return json(catalogue, catalogue.ok ? 200 : 503, { "cache-control": "no-store" });
}

export type OwnerGeminiProviderStage = "count_tokens_probe" | "generate_content" | "stream_generate_content";

export class OwnerGeminiProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly stage?: OwnerGeminiProviderStage;
  readonly usage?: { promptTokens: number; outputTokens: number; totalTokens: number };
  readonly elapsedMs?: number;
  readonly finishReason?: string;
  constructor(
    message: string,
    status?: number,
    retryable = false,
    stage?: OwnerGeminiProviderStage,
    details: {
      usage?: { promptTokens: number; outputTokens: number; totalTokens: number };
      elapsedMs?: number;
      finishReason?: string;
    } = {},
  ) {
    super(message);
    this.name = "OwnerGeminiProviderError";
    this.status = status;
    this.retryable = retryable;
    this.stage = stage;
    this.usage = details.usage;
    this.elapsedMs = details.elapsedMs;
    this.finishReason = details.finishReason;
  }
}

export interface OwnerGeminiContent {
  role: "user" | "model";
  text: string;
}

export interface OwnerGeminiGenerationInput {
  modelId: string;
  contents: OwnerGeminiContent[];
  systemInstruction?: string;
  maxOutputTokens?: number;
  thinkingLevel?: OwnerThinkingLevel;
}

export interface OwnerGeminiGenerationResult {
  modelId: string;
  thinkingLevel: OwnerThinkingLevel;
  text: string;
  usage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  elapsedMs: number;
  rawResponse: Record<string, unknown>;
}

function providerStatusMessage(
  status: number,
  stage: OwnerGeminiProviderStage,
  diagnostic?: string,
): string {
  let message: string;
  if (status === 400) {
    message = stage === "count_tokens_probe"
      ? "Vertex AI rejected the Count Tokens availability check for this model."
      : stage === "stream_generate_content"
        ? "Vertex AI rejected the StreamGenerateContent request. The conversation format or request configuration may not be supported."
        : "Vertex AI rejected the GenerateContent request. The conversation format or request configuration may not be supported.";
  } else if (status === 401 || status === 403) {
    message = stage === "count_tokens_probe"
      ? "Vertex AI denied the Count Tokens availability probe for this model/project. No GenerateContent request was sent; this is a model-eligibility check failure."
      : stage === "stream_generate_content"
        ? "Vertex AI denied the StreamGenerateContent request for this model/project. This failure occurred at answer generation, after the model availability check."
        : "Vertex AI denied the GenerateContent request for this model/project. This failure occurred at answer generation, after the model availability check.";
  } else if (status === 404) {
    message = stage === "count_tokens_probe"
      ? "The selected model was not found by the Count Tokens availability check in this location."
      : stage === "stream_generate_content"
        ? "The selected model was not found by the StreamGenerateContent endpoint in this location."
        : "The selected model was not found by the GenerateContent endpoint in this location.";
  } else if (status === 429) {
    message = stage === "count_tokens_probe"
      ? "Vertex AI rate-limited the Count Tokens availability check."
      : stage === "stream_generate_content"
        ? "Vertex AI rate-limited the StreamGenerateContent request."
        : "Vertex AI rate-limited the GenerateContent request.";
  } else if (status >= 500) {
    const operation = stage === "count_tokens_probe"
      ? "the Count Tokens availability check"
      : stage === "stream_generate_content" ? "StreamGenerateContent" : "GenerateContent";
    message = "Vertex AI is temporarily unavailable during " + operation + ".";
  } else {
    message = "The Vertex AI request could not be completed during " +
      (stage === "count_tokens_probe" ? "the Count Tokens availability check." : "GenerateContent.");
  }
  return diagnostic ? message + " " + diagnostic : message;
}

/**
 * General-purpose Owner adapter. It intentionally has no SSC system prompt,
 * AnswerPacket contract, student profile, quota, grounding or BRɅIN retrieval.
 * M4 adds model-specific thinking and the streamed UI request lifecycle.
 */
export async function generateOwnerGeminiContent(
  env: Env,
  input: OwnerGeminiGenerationInput,
  dependencies: OwnerProviderDependencies = defaultDependencies,
): Promise<OwnerGeminiGenerationResult> {
  const definition = OWNER_GEMINI_MODEL_REGISTRY.find((model) => model.id === input.modelId);
  if (!definition) throw new OwnerGeminiProviderError("The requested model is not in the Owner model registry.");
  const project = configuredProject(env);
  const location = configuredLocation(env);
  if (!project || !env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim()) {
    throw new OwnerGeminiProviderError("Vertex AI is not configured for the Owner workspace.");
  }
  const contents = Array.isArray(input.contents) ? input.contents : [];
  const validTurnShape = contents.length >= 1 &&
    contents[0]?.role === "user" && contents[contents.length - 1]?.role === "user" &&
    contents.every((item, index) => item && (item.role === "user" || item.role === "model") &&
      typeof item.text === "string" && Boolean(item.text.trim()) &&
      (index === 0 || item.role !== contents[index - 1]?.role));
  if (!validTurnShape) {
    throw new OwnerGeminiProviderError("The conversation context must contain non-empty alternating user/model turns, starting and ending with a user turn.");
  }
  if (input.systemInstruction !== undefined &&
      (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000)) {
    throw new OwnerGeminiProviderError("The system instruction is invalid or too long.");
  }
  const thinkingLevel = input.thinkingLevel ?? definition.defaultThinkingLevel;
  if (!definition.thinkingLevels.includes(thinkingLevel)) {
    throw new OwnerGeminiProviderError("The selected thinking level is not supported by this model.");
  }
  // Verify only the exact Owner-selected model. A full catalogue refresh here
  // would fan out CountTokens probes to every model and needlessly add pressure
  // to a project/model capacity pool during an already rate-limited draft.
  const token = await getVerifiedModelAccessToken(env, definition, dependencies);
  const maxOutputTokens = Number.isSafeInteger(input.maxOutputTokens)
    ? Math.min(definition.singleRequestOutputTokens, Math.max(1, input.maxOutputTokens!))
    : definition.singleRequestOutputTokens;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let retryDelay: number | undefined;
    try {
      const body: Record<string, unknown> = {
        contents: input.contents.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
        generationConfig: { maxOutputTokens, thinkingConfig: { thinkingLevel } },
      };
      if (input.systemInstruction?.trim()) {
        body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
      }
      const response = await dependencies.fetch(
        `${vertexBase(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(definition.id)}:generateContent`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const diagnostic = await safeVertexErrorDiagnostic(response);
        const failure = new OwnerGeminiProviderError(
          providerStatusMessage(response.status, "generate_content", diagnostic),
          response.status,
          isRetryableStreamOpenStatus(response.status),
          "generate_content",
        );
        if (response.status === 429 && attempt < GENERATION_MAX_ATTEMPTS) {
          // Google explicitly documents a 429 capacity rejection as safe to
          // retry. Do not replay 408/5xx or transport timeouts: those outcomes
          // can be ambiguous with respect to provider-side execution/usage.
          retryDelay = streamOpenRetryDelayMs(response, attempt, dependencies.random ?? Math.random);
          try { await response.body?.cancel(); } catch { /* discard retryable response body */ }
        } else {
          throw failure;
        }
      } else {
        let parsed: Record<string, unknown>;
        try {
          parsed = await response.json() as Record<string, unknown>;
        } catch {
          throw new OwnerGeminiProviderError("Vertex AI returned an invalid response.");
        }
        const candidates = Array.isArray(parsed.candidates) ? parsed.candidates as Array<Record<string, unknown>> : [];
        const candidate = candidates[0];
        const responseContent = candidate && typeof candidate.content === "object" && candidate.content !== null
          ? candidate.content as Record<string, unknown> : null;
        const parts = responseContent && Array.isArray(responseContent.parts) ? responseContent.parts as Array<Record<string, unknown>> : [];
        const text = parts.map((part) => typeof part.text === "string" && part.thought !== true ? part.text : "").join("").trim();
        const usage = typeof parsed.usageMetadata === "object" && parsed.usageMetadata !== null
          ? parsed.usageMetadata as Record<string, unknown> : {};
        const usageSummary = {
          promptTokens: Number(usage.promptTokenCount ?? 0),
          outputTokens: Number(usage.candidatesTokenCount ?? 0),
          totalTokens: Number(usage.totalTokenCount ?? 0),
        };
        const elapsedMs = Date.now() - startedAt;
        const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined;
        if (!text || finishReason === "MAX_TOKENS") {
          const message = finishReason === "MAX_TOKENS"
            ? "Gemini reached the selected model's single-response output limit before completing the response. Thinking tokens count toward this limit; retry with the same model or choose a lower thinking level."
            : `Vertex AI completed without a text response${finishReason ? " (finish reason: " + finishReason + ")" : ""}.`;
          throw new OwnerGeminiProviderError(message, undefined, false, "generate_content", {
            usage: usageSummary, elapsedMs, finishReason,
          });
        }
        return {
          modelId: definition.id,
          thinkingLevel,
          text,
          usage: usageSummary,
          elapsedMs,
          rawResponse: parsed,
        };
      }
    } catch (error) {
      if (error instanceof OwnerGeminiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OwnerGeminiProviderError("The Vertex AI request was interrupted before completion. Please retry without changing the selected model.", undefined, true, "generate_content");
      }
      throw new OwnerGeminiProviderError("The Vertex AI request failed. Please retry without changing the selected model.", undefined, true, "generate_content");
    } finally {
    }

    if (retryDelay !== undefined) {
      await waitForStreamRetry(retryDelay, controller.signal, dependencies);
    }
  }

  throw new OwnerGeminiProviderError("Vertex AI could not complete the memory-draft request after bounded retries.", undefined, true, "generate_content");
}

async function getVerifiedModelAccessToken(
  env: Env,
  model: OwnerGeminiModelDefinition,
  dependencies: OwnerProviderDependencies,
): Promise<string> {
  const project = configuredProject(env);
  const location = configuredLocation(env);
  if (!project || !env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim()) {
    throw new OwnerGeminiProviderError("Vertex AI is not configured for the Owner workspace.");
  }

  let token: string;
  try {
    token = await withTimeout(dependencies.getAccessToken(env), ACCESS_TOKEN_TIMEOUT_MS);
  } catch {
    throw new OwnerGeminiProviderError("Google authentication for Vertex AI is currently unavailable.", undefined, true);
  }

  const cacheKey = `${project}:${location}:${model.id}`;
  const cached = verifiedModelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.model.selectable) return token;

  // A fresh full catalogue result is also a valid server-side verification.
  const catalogue = catalogueCache.get(`${project}:${location}`);
  const listed = catalogue?.expiresAt && catalogue.expiresAt > Date.now()
    ? catalogue.value.models.find((candidate) => candidate.id === model.id && candidate.selectable)
    : undefined;
  if (listed) {
    verifiedModelCache.set(cacheKey, { expiresAt: catalogue!.expiresAt, model: listed });
    return token;
  }

  // The catalogue cache has expired. Recheck only the model the Owner selected,
  // not every model in the registry, then reuse this token for the generation call.
  const probe = await probeModel(env, model, project, location, token, dependencies);
  if (!probe.model.selectable) {
    const status = probe.status;
    const message = status
      ? providerStatusMessage(status, "count_tokens_probe", probe.diagnostic)
      : "The Count Tokens availability probe could not complete. No GenerateContent request was sent; check Google authentication, network availability and retry.";
    throw new OwnerGeminiProviderError(
      message,
      status,
      status === 408 || status === 429 || (status !== undefined && status >= 500) || status === undefined,
      "count_tokens_probe",
    );
  }
  verifiedModelCache.set(cacheKey, { expiresAt: Date.now() + CATALOGUE_CACHE_MS, model: probe.model });
  return token;
}

/**
 * Count the exact input that the next Owner generation request will send.
 * CountTokens is an input estimate only; the conversation budget separately
 * reserves the maximum permitted output (including thinking tokens).
 */
export async function countOwnerGeminiInputTokens(
  env: Env,
  input: { modelId: string; contents: OwnerGeminiContent[]; systemInstruction?: string },
  dependencies: OwnerProviderDependencies = defaultDependencies,
): Promise<number> {
  const definition = OWNER_GEMINI_MODEL_REGISTRY.find((model) => model.id === input.modelId);
  if (!definition) throw new OwnerGeminiProviderError("The requested model is not in the Owner model registry.");
  const contents = Array.isArray(input.contents) ? input.contents : [];
  const validTurnShape = contents.length >= 1 &&
    contents[0]?.role === "user" && contents[contents.length - 1]?.role === "user" &&
    contents.every((item, index) => item && (item.role === "user" || item.role === "model") &&
      typeof item.text === "string" && Boolean(item.text.trim()) &&
      (index === 0 || item.role !== contents[index - 1]?.role));
  if (!validTurnShape ||
      (input.systemInstruction !== undefined &&
        (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000))) {
    throw new OwnerGeminiProviderError("The conversation context or system instruction is invalid.");
  }

  const project = configuredProject(env);
  if (!project) throw new OwnerGeminiProviderError("Vertex AI is not configured for the Owner workspace.");
  const location = configuredLocation(env);
  const token = await getVerifiedModelAccessToken(env, definition, dependencies);
  const controller = new AbortController();
  try {
    const response = await withTimeout(dependencies.fetch(
      `${vertexBase(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(definition.id)}:countTokens`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          contents: contents.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
          ...(input.systemInstruction?.trim()
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
        }),
        signal: controller.signal,
      },
    ), PROBE_TIMEOUT_MS, () => controller.abort());

    if (!response.ok) {
      const diagnostic = await safeVertexErrorDiagnostic(response);
      throw new OwnerGeminiProviderError(
        providerStatusMessage(response.status, "count_tokens_probe", diagnostic),
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
        "count_tokens_probe",
      );
    }
    const result = await response.json() as { totalTokens?: unknown };
    const totalTokens = Number(result.totalTokens);
    if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) {
      throw new OwnerGeminiProviderError("Vertex AI returned an invalid Count Tokens result.");
    }
    return totalTokens;
  } catch (error) {
    if (error instanceof OwnerGeminiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OwnerGeminiProviderError("The Count Tokens request timed out. Retry without changing the selected model.", 408, true, "count_tokens_probe");
    }
    throw new OwnerGeminiProviderError("The Count Tokens request could not be completed. Retry without changing the selected model.", undefined, true, "count_tokens_probe");
  }
}

export type OwnerGeminiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: OwnerGeminiGenerationResult["usage"]; elapsedMs: number };

export interface OwnerGeminiStreamInput extends OwnerGeminiGenerationInput {
  thinkingLevel: OwnerThinkingLevel;
}

/**
 * Opens a server-authoritative Vertex SSE stream. Thought parts are deliberately
 * omitted: only user-facing text parts are yielded to the Owner workspace.
 * The caller's AbortSignal is forwarded upstream so Stop/disconnect cancels work.
 */
export async function openOwnerGeminiStream(
  env: Env,
  input: OwnerGeminiStreamInput,
  signal: AbortSignal,
  dependencies: OwnerProviderDependencies = defaultDependencies,
): Promise<AsyncGenerator<OwnerGeminiStreamEvent>> {
  const definition = OWNER_GEMINI_MODEL_REGISTRY.find((model) => model.id === input.modelId);
  if (!definition) throw new OwnerGeminiProviderError("The requested model is not in the Owner model registry.");
  if (!definition.thinkingLevels.includes(input.thinkingLevel)) {
    throw new OwnerGeminiProviderError("The selected thinking level is not supported by this model.");
  }
  const contents = Array.isArray(input.contents) ? input.contents : [];
  const validTurnShape = contents.length >= 1 &&
    contents[0]?.role === "user" && contents[contents.length - 1]?.role === "user" &&
    contents.every((item, index) => item && (item.role === "user" || item.role === "model") &&
      typeof item.text === "string" && Boolean(item.text.trim()) &&
      (index === 0 || item.role !== contents[index - 1]?.role));
  if (!validTurnShape) {
    throw new OwnerGeminiProviderError("The conversation context must contain non-empty alternating user/model turns, starting and ending with a user turn.");
  }
  if (input.systemInstruction !== undefined &&
      (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000)) {
    throw new OwnerGeminiProviderError("The system instruction is invalid or too long.");
  }

  const project = configuredProject(env);
  if (!project) throw new OwnerGeminiProviderError("Vertex AI is not configured for the Owner workspace.");
  const location = configuredLocation(env);
  const outputCeiling = definition.supportsLongDecode
    ? definition.modelMaxOutputTokens
    : definition.singleStreamingOutputTokens;
  const maxOutputTokens = Number.isSafeInteger(input.maxOutputTokens)
    ? Math.min(outputCeiling, Math.max(1, input.maxOutputTokens!))
    : definition.singleStreamingOutputTokens;
  const useLongDecode = definition.supportsLongDecode === true &&
    maxOutputTokens > definition.singleStreamingOutputTokens;
  const apiVersion = useLongDecode ? "v1beta1" : definition.apiVersion;

  const token = await getVerifiedModelAccessToken(env, definition, dependencies);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  const startedAt = Date.now();
  const streamUrl =
    `${vertexBase(location)}/${apiVersion}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(definition.id)}:streamGenerateContent?alt=sse`;
  const body: Record<string, unknown> = {
    contents: input.contents.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
    generationConfig: {
      maxOutputTokens,
      thinkingConfig: { thinkingLevel: input.thinkingLevel },
    },
  };
  if (input.systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  const openSegment = async (continuationToken?: string): Promise<Response> => {
    const requestBody = continuationToken ? { ...body, continuationToken } : body;
    const streamRequest: RequestInit = {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    };
    let response: Response | undefined;
    for (let attempt = 1; attempt <= STREAM_OPEN_MAX_ATTEMPTS; attempt += 1) {
      response = await dependencies.fetch(streamUrl, streamRequest);
      // Only an explicit 429 is a definitive capacity rejection that is safe
      // to retry. Do not replay 408/5xx or ambiguous network outcomes.
      if (response.ok || response.status !== 429 || attempt === STREAM_OPEN_MAX_ATTEMPTS) break;
      const delay = streamOpenRetryDelayMs(response, attempt, dependencies.random ?? Math.random);
      try { await response.body?.cancel(); } catch { /* discard retryable rejection body */ }
      await waitForStreamRetry(delay, controller.signal, dependencies);
    }
    if (!response) {
      throw new OwnerGeminiProviderError("The Vertex AI streaming request returned no response.", undefined, true, "stream_generate_content");
    }
    if (!response.ok) {
      const diagnostic = await safeVertexErrorDiagnostic(response);
      throw new OwnerGeminiProviderError(
        providerStatusMessage(response.status, "stream_generate_content", diagnostic),
        response.status,
        isRetryableStreamOpenStatus(response.status),
        "stream_generate_content",
      );
    }
    if (!response.body) throw new OwnerGeminiProviderError("Vertex AI returned an empty response stream.");
    return response;
  };

  let firstResponse: Response;
  try {
    firstResponse = await openSegment();
  } catch (error) {
    signal.removeEventListener("abort", abortFromCaller);
    if (error instanceof OwnerGeminiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OwnerGeminiProviderError("The Vertex AI stream was stopped or the connection was interrupted.", undefined, true);
    }
    throw new OwnerGeminiProviderError("The Vertex AI streaming request failed. Please retry without changing the selected model.", undefined, true);
  }

  return (async function* (): AsyncGenerator<OwnerGeminiStreamEvent> {
    let fullText = "";
    const usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finished = false;
    const maxSegments = useLongDecode
      ? Math.max(1, Math.ceil(maxOutputTokens / definition.singleStreamingOutputTokens) + 1)
      : 1;

    type SegmentResult = {
      usage?: { promptTokens: number; outputTokens: number; totalTokens: number };
      finishReason?: string;
      continuationToken?: string;
    };

    async function* consumeSegment(
      segmentResponse: Response,
    ): AsyncGenerator<OwnerGeminiStreamEvent, SegmentResult> {
      if (!segmentResponse.body) throw new OwnerGeminiProviderError("Vertex AI returned an empty response stream.");
      const reader = segmentResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let segmentUsage: SegmentResult["usage"];
      let finishReason: string | undefined;
      let continuationToken: string | undefined;
      let segmentFinished = false;

      async function* parseBlock(block: string): AsyncGenerator<OwnerGeminiStreamEvent> {
        const data = block.split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") return;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data) as Record<string, unknown>; }
        catch { throw new OwnerGeminiProviderError("Vertex AI returned an invalid streaming event."); }

        const usageValue = typeof parsed.usageMetadata === "object" && parsed.usageMetadata !== null
          ? parsed.usageMetadata as Record<string, unknown> : null;
        if (usageValue) {
          const promptTokens = Number(usageValue.promptTokenCount ?? 0);
          const outputTokens = Number(usageValue.candidatesTokenCount ?? 0) + Number(usageValue.thoughtsTokenCount ?? 0);
          const totalTokens = Number(usageValue.totalTokenCount ?? (promptTokens + outputTokens));
          segmentUsage = {
            promptTokens: Number.isSafeInteger(promptTokens) && promptTokens >= 0 ? promptTokens : 0,
            outputTokens: Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? outputTokens : 0,
            totalTokens: Number.isSafeInteger(totalTokens) && totalTokens >= 0 ? totalTokens : 0,
          };
        }

        const candidates = Array.isArray(parsed.candidates) ? parsed.candidates as Array<Record<string, unknown>> : [];
        const candidate = candidates[0];
        if (typeof candidate?.finishReason === "string") finishReason = candidate.finishReason;
        if (typeof candidate?.continuationToken === "string" && candidate.continuationToken.trim()) {
          continuationToken = candidate.continuationToken;
        }
        const content = candidate && typeof candidate.content === "object" && candidate.content !== null
          ? candidate.content as Record<string, unknown> : null;
        const parts = content && Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];
        for (const part of parts) {
          if (part.thought === true || typeof part.text !== "string" || !part.text) continue;
          fullText += part.text;
          yield { type: "delta", text: part.text };
        }
      }

      try {
        while (true) {
          const next = await reader.read();
          buffer += decoder.decode(next.value, { stream: !next.done });
          let boundary = /\r?\n\r?\n/u.exec(buffer);
          while (boundary) {
            const block = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            yield* parseBlock(block);
            boundary = /\r?\n\r?\n/u.exec(buffer);
          }
          if (next.done) break;
        }
        if (buffer.trim()) yield* parseBlock(buffer);
        segmentFinished = true;
        return { usage: segmentUsage, finishReason, continuationToken };
      } finally {
        if (!segmentFinished) {
          try { await reader.cancel(); } catch { /* the upstream may already be closed */ }
        }
        reader.releaseLock();
      }
    }

    try {
      let segmentResponse = firstResponse;
      let segmentNumber = 0;
      while (true) {
        segmentNumber += 1;
        const segment = yield* consumeSegment(segmentResponse);
        if (segment.usage) {
          usage.promptTokens += segment.usage.promptTokens;
          usage.outputTokens += segment.usage.outputTokens;
          usage.totalTokens += segment.usage.totalTokens;
        }

        if (segment.finishReason === "CONTINUATION") {
          if (!useLongDecode || !segment.continuationToken) {
            throw new OwnerGeminiProviderError(
              "Gemini signalled that this response needs continuation, but this request cannot safely continue it.",
              undefined, false, "stream_generate_content",
              { usage, elapsedMs: Date.now() - startedAt, finishReason: segment.finishReason },
            );
          }
          if (segmentNumber >= maxSegments) {
            throw new OwnerGeminiProviderError(
              "Gemini exceeded the maximum number of continuation segments allowed by the current chat budget.",
              undefined, false, "stream_generate_content",
              { usage, elapsedMs: Date.now() - startedAt, finishReason: segment.finishReason },
            );
          }
          try {
            segmentResponse = await openSegment(segment.continuationToken);
          } catch (error) {
            if (error instanceof OwnerGeminiProviderError) {
              throw new OwnerGeminiProviderError(
                error.message, error.status, error.retryable, error.stage,
                { usage, elapsedMs: Date.now() - startedAt, finishReason: error.finishReason },
              );
            }
            throw error;
          }
          continue;
        }

        if (segment.finishReason === "MAX_TOKENS") {
          const message = fullText.trim()
            ? "Gemini reached the reserved response-token budget before completing the answer. Partial text has been retained. The 200,000-token conversation cap remains in force."
            : "Gemini used the reserved response-token budget on reasoning before producing visible text. The 200,000-token conversation cap remains in force.";
          throw new OwnerGeminiProviderError(message, undefined, false, "stream_generate_content", {
            usage, elapsedMs: Date.now() - startedAt, finishReason: segment.finishReason,
          });
        }
        if (!fullText.trim()) {
          const message = `Vertex AI completed without a text response${segment.finishReason ? " (finish reason: " + segment.finishReason + ")" : ""}.`;
          throw new OwnerGeminiProviderError(message, undefined, false, "stream_generate_content", {
            usage, elapsedMs: Date.now() - startedAt, finishReason: segment.finishReason,
          });
        }

        finished = true;
        yield { type: "done", usage, elapsedMs: Date.now() - startedAt };
        break;
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new OwnerGeminiProviderError("Generation was stopped.", undefined, false);
      }
      if (error instanceof OwnerGeminiProviderError) throw error;
      throw new OwnerGeminiProviderError("The Vertex AI stream failed. Any received text has been retained.", undefined, true);
    } finally {
      if (!finished && !controller.signal.aborted) {
        try { await firstResponse.body?.cancel(); } catch { /* the upstream may already be closed */ }
      }
      signal.removeEventListener("abort", abortFromCaller);
    }
  })();
}