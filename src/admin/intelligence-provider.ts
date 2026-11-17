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
  thinkingLevels: readonly OwnerThinkingLevel[];
  defaultThinkingLevel: OwnerThinkingLevel;
}

/**
 * Centrally maintained Google Agent Platform registry. This is metadata, not
 * proof of access: a model becomes selectable only after the configured
 * project/location passes the live countTokens capability probe.
 */
export const OWNER_GEMINI_MODEL_REGISTRY: readonly OwnerGeminiModelDefinition[] = [
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 65_536, thinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"], defaultThinkingLevel: "HIGH" },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 32_768, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 1_048_576, singleRequestOutputTokens: 32_768, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], contextWindowTokens: 1_048_576, modelMaxOutputTokens: 65_536, singleRequestOutputTokens: 65_536, thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MINIMAL" },
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
}

const defaultDependencies: OwnerProviderDependencies = {
  getAccessToken: getGoogleAccessToken,
  fetch: globalThis.fetch.bind(globalThis),
};
const PROBE_TIMEOUT_MS = 8_000;
const ACCESS_TOKEN_TIMEOUT_MS = 12_000;
const MAX_CONVERSATION_CONTEXT_CHARS = 300_000;
const GENERATION_TIMEOUT_MS = 35_000;
const CATALOGUE_CACHE_MS = 90_000;
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

async function probeModel(
  env: Env,
  model: OwnerGeminiModelDefinition,
  project: string,
  location: string,
  token: string,
  dependencies: OwnerProviderDependencies,
): Promise<OwnerGeminiModel> {
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
      return { ...model, availability: "available", selectable: true, availabilityReason: "project_location_probe_passed" };
    }
    return { ...model, availability: response.status === 400 || response.status === 404 ? "unavailable" : "unverified", selectable: false, availabilityReason: failureReason(response.status) };
  } catch {
    return { ...model, availability: "unverified", selectable: false, availabilityReason: "provider_temporarily_unavailable" };
  }
}

async function mapLimited<T, R>(items: readonly T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
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

  const models = await mapLimited(OWNER_GEMINI_MODEL_REGISTRY, 3, (model) =>
    probeModel(env, model, project, location, token, dependencies));
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

export class OwnerGeminiProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "OwnerGeminiProviderError";
    this.status = status;
    this.retryable = retryable;
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

async function providerErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } };
    const message = payload?.error?.message;
    if (typeof message !== "string") return undefined;
    const sanitized = message.replace(/[\\r\\n\\t]+/gu, " ").replace(/\\s{2,}/gu, " ").trim();
    return sanitized ? sanitized.slice(0, 360) : undefined;
  } catch {
    return undefined;
  }
}

function providerStatusMessage(status: number, detail?: string): string {
  const base = status === 400
    ? "Vertex AI rejected the request. The conversation format or size may not be supported."
    : status === 401 || status === 403
      ? "Vertex AI denied GenerateContent access for this model or project. Check the service account's Vertex AI permissions and the model's project/location access."
      : status === 404
        ? "The selected model is not available at the configured location."
        : status === 429
          ? "Vertex AI is temporarily rate limiting requests for this project or model."
          : status >= 500
            ? "Vertex AI is temporarily unavailable."
            : "The Vertex AI request could not be completed.";
  return detail ? base + " Google details: " + detail : base;
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
  const validTurnShape = Array.isArray(input.contents) && input.contents.length >= 1 && input.contents.length <= 50 &&
    input.contents.every((item, index) => item && (item.role === "user" || item.role === "model") &&
      typeof item.text === "string" && Boolean(item.text.trim()) && item.text.length <= 50_000 &&
      (index === 0 ? item.role === "user" : item.role !== input.contents[index - 1].role)) &&
    input.contents[input.contents.length - 1]?.role === "user";
  const contextChars = Array.isArray(input.contents)
    ? input.contents.reduce((total, item) => total + (typeof item?.text === "string" ? item.text.length : 0), 0)
    : Number.POSITIVE_INFINITY;
  if (!validTurnShape || contextChars > MAX_CONVERSATION_CONTEXT_CHARS) {
    throw new OwnerGeminiProviderError("The conversation context is invalid or too large. BRɅIN keeps your full history, but only a clean recent section can be sent to this model.");
  }
  if (input.systemInstruction !== undefined &&
      (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000)) {
    throw new OwnerGeminiProviderError("The system instruction is invalid or too long.");
  }
  const thinkingLevel = input.thinkingLevel ?? definition.defaultThinkingLevel;
  if (!definition.thinkingLevels.includes(thinkingLevel)) {
    throw new OwnerGeminiProviderError("The selected thinking level is not supported by this model.");
  }
  // Public catalogue membership does not establish project entitlement.
  // Require a recent successful project/location capability probe before generation.
  const catalogue = await listOwnerGeminiModels(env, dependencies);
  const confirmedModel = catalogue.models.find((model) => model.id === definition.id && model.selectable);
  if (!catalogue.ok || !confirmedModel) {
    throw new OwnerGeminiProviderError(
      catalogue.ok
        ? "This model has not been confirmed for the configured Vertex AI project and location."
        : "Vertex AI model availability could not be verified for the Owner workspace.",
      undefined,
      true,
    );
  }

  const maxOutputTokens = Number.isSafeInteger(input.maxOutputTokens)
    ? Math.min(definition.singleRequestOutputTokens, Math.max(1, input.maxOutputTokens!))
    : Math.min(definition.singleRequestOutputTokens, 8_192);

  let token: string;
  try {
    token = await dependencies.getAccessToken(env);
  } catch {
    throw new OwnerGeminiProviderError("Google authentication for Vertex AI is currently unavailable.", undefined, true);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const startedAt = Date.now();
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
      const detail = await providerErrorDetail(response);
      throw new OwnerGeminiProviderError(providerStatusMessage(response.status, detail), response.status, response.status === 408 || response.status === 429 || response.status >= 500);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = await response.json() as Record<string, unknown>;
    } catch {
      throw new OwnerGeminiProviderError("Vertex AI returned an invalid response.");
    }
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates as Array<Record<string, unknown>> : [];
    const candidate = candidates[0];
    const content = candidate && typeof candidate.content === "object" && candidate.content !== null
      ? candidate.content as Record<string, unknown> : null;
    const parts = content && Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];
    const text = parts.map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
    if (!text) throw new OwnerGeminiProviderError("Vertex AI completed without a text response.");
    const usage = typeof parsed.usageMetadata === "object" && parsed.usageMetadata !== null
      ? parsed.usageMetadata as Record<string, unknown> : {};
    return {
      modelId: definition.id,
      thinkingLevel,
      text,
      usage: {
        promptTokens: Number(usage.promptTokenCount ?? 0),
        outputTokens: Number(usage.candidatesTokenCount ?? 0),
        totalTokens: Number(usage.totalTokenCount ?? 0),
      },
      elapsedMs: Date.now() - startedAt,
      rawResponse: parsed,
    };
  } catch (error) {
    if (error instanceof OwnerGeminiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OwnerGeminiProviderError("The Vertex AI request timed out.", undefined, true);
    }
    throw new OwnerGeminiProviderError("The Vertex AI request failed. Please retry without changing the selected model.", undefined, true);
  } finally {
    clearTimeout(timeout);
  }
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
  const verified = await probeModel(env, model, project, location, token, dependencies);
  if (!verified.selectable) {
    throw new OwnerGeminiProviderError(
      verified.availabilityReason === "provider_access_denied"
        ? "Vertex AI denied access to the selected model or project."
        : "The selected Gemini model is not currently verified for this project and location.",
      undefined,
      true,
    );
  }
  verifiedModelCache.set(cacheKey, { expiresAt: Date.now() + CATALOGUE_CACHE_MS, model: verified });
  return token;
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
  if (!Array.isArray(input.contents) || input.contents.length < 1 || input.contents.length > 50 ||
      input.contents.some((item) => !item || (item.role !== "user" && item.role !== "model") ||
        typeof item.text !== "string" || !item.text.trim() || item.text.length > 50_000)) {
    throw new OwnerGeminiProviderError("The conversation content is invalid or exceeds the supported request size.");
  }
  if (input.systemInstruction !== undefined &&
      (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000)) {
    throw new OwnerGeminiProviderError("The system instruction is invalid or too long.");
  }

  const project = configuredProject(env);
  if (!project) throw new OwnerGeminiProviderError("Vertex AI is not configured for the Owner workspace.");
  const location = configuredLocation(env);
  const maxOutputTokens = Number.isSafeInteger(input.maxOutputTokens)
    ? Math.min(definition.singleRequestOutputTokens, Math.max(1, input.maxOutputTokens!))
    : Math.min(definition.singleRequestOutputTokens, 8_192);

  const token = await getVerifiedModelAccessToken(env, definition, dependencies);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), 8 * 60_000);
  const startedAt = Date.now();
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

  let response: Response;
  try {
    response = await dependencies.fetch(
      `${vertexBase(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(definition.id)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
      const detail = await providerErrorDetail(response);
      throw new OwnerGeminiProviderError(providerStatusMessage(response.status, detail), response.status, response.status === 408 || response.status === 429 || response.status >= 500);
    }
    if (!response.body) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
      throw new OwnerGeminiProviderError("Vertex AI returned an empty response stream.");
    }
  } catch (error) {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortFromCaller);
    if (error instanceof OwnerGeminiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OwnerGeminiProviderError("The Vertex AI stream was cancelled or timed out.", undefined, true);
    }
    throw new OwnerGeminiProviderError("The Vertex AI streaming request failed. Please retry without changing the selected model.", undefined, true);
  }

  return (async function* (): AsyncGenerator<OwnerGeminiStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finished = false;

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
        usage = {
          promptTokens: Number(usageValue.promptTokenCount ?? usage.promptTokens),
          outputTokens: Number(usageValue.candidatesTokenCount ?? usage.outputTokens),
          totalTokens: Number(usageValue.totalTokenCount ?? usage.totalTokens),
        };
      }
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates as Array<Record<string, unknown>> : [];
      const candidate = candidates[0];
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
      if (!fullText.trim()) throw new OwnerGeminiProviderError("Vertex AI completed without a text response.");
      finished = true;
      yield { type: "done", usage, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new OwnerGeminiProviderError("Generation was stopped.", undefined, false);
      }
      if (error instanceof OwnerGeminiProviderError) throw error;
      throw new OwnerGeminiProviderError("The Vertex AI stream failed. Any received text has been retained.", undefined, true);
    } finally {
      if (!finished) {
        try { await reader.cancel(); } catch { /* the upstream may already be closed */ }
      }
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
      reader.releaseLock();
    }
  })();
}
