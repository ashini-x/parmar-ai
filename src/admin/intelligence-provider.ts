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
  thinkingLevels: readonly OwnerThinkingLevel[];
  defaultThinkingLevel: OwnerThinkingLevel;
}

/**
 * Centrally maintained Google Agent Platform registry. This is metadata, not
 * proof of access: a model becomes selectable only after the configured
 * project/location passes the live countTokens capability probe.
 */
export const OWNER_GEMINI_MODEL_REGISTRY: readonly OwnerGeminiModelDefinition[] = [
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"], defaultThinkingLevel: "HIGH" },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MEDIUM" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", lifecycle: "GA", apiVersion: "v1", inputModalities: ["text"], outputModalities: ["text"], thinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinkingLevel: "MINIMAL" },
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
const GENERATION_TIMEOUT_MS = 35_000;
const CATALOGUE_CACHE_MS = 90_000;
const catalogueCache = new Map<string, { expiresAt: number; value: OwnerModelCatalogue }>();

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
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await dependencies.fetch(
      `${vertexBase(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model.id)}:countTokens`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Owner model availability check." }] }] }),
        signal: controller.signal,
      },
    );
    if (response.ok) {
      return { ...model, availability: "available", selectable: true, availabilityReason: "project_location_probe_passed" };
    }
    return { ...model, availability: response.status === 400 || response.status === 404 ? "unavailable" : "unverified", selectable: false, availabilityReason: failureReason(response.status) };
  } catch {
    return { ...model, availability: "unverified", selectable: false, availabilityReason: "provider_temporarily_unavailable" };
  } finally {
    clearTimeout(timeout);
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
    token = await dependencies.getAccessToken(env);
  } catch {
    return {
      ok: false, configured: true, location, checkedAt, error: "google_auth_unavailable",
      models: OWNER_GEMINI_MODEL_REGISTRY.map((model) => ({ ...model, availability: "unverified", selectable: false, availabilityReason: "provider_access_denied" })),
    };
  }

  const models = await mapLimited(OWNER_GEMINI_MODEL_REGISTRY, 3, (model) =>
    probeModel(env, model, project, location, token, dependencies));
  const value: OwnerModelCatalogue = { ok: true, configured: true, location, checkedAt, models };
  catalogueCache.set(cacheKey, { expiresAt: checkedAt + CATALOGUE_CACHE_MS, value });
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
}

export interface OwnerGeminiGenerationResult {
  modelId: string;
  text: string;
  usage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  elapsedMs: number;
  rawResponse: Record<string, unknown>;
}

function providerStatusMessage(status: number): string {
  if (status === 400) return "Vertex AI rejected the request. Check the selected model and request configuration.";
  if (status === 401 || status === 403) return "Vertex AI denied access to this model or project.";
  if (status === 404) return "The selected model is not available at the configured location.";
  if (status === 429) return "Vertex AI is temporarily rate limiting requests for this project or model.";
  if (status >= 500) return "Vertex AI is temporarily unavailable.";
  return "The Vertex AI request could not be completed.";
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
  if (!Array.isArray(input.contents) || input.contents.length < 1 || input.contents.length > 50 ||
      input.contents.some((item) => !item || (item.role !== "user" && item.role !== "model") ||
        typeof item.text !== "string" || !item.text.trim() || item.text.length > 50_000)) {
    throw new OwnerGeminiProviderError("The conversation content is invalid or exceeds the supported request size.");
  }
  if (input.systemInstruction !== undefined &&
      (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000)) {
    throw new OwnerGeminiProviderError("The system instruction is invalid or too long.");
  }
  const maxOutputTokens = Number.isSafeInteger(input.maxOutputTokens)
    ? Math.min(32_768, Math.max(1, input.maxOutputTokens!))
    : 8_192;

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
      generationConfig: { maxOutputTokens },
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
      throw new OwnerGeminiProviderError(providerStatusMessage(response.status), response.status, response.status === 408 || response.status === 429 || response.status >= 500);
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
