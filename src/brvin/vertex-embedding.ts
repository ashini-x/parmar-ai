import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import type { EmbeddingProvider, EmbeddingResult } from "./provider-contract";

const DEFAULT_MODEL_ID = "gemini-embedding-001";
const MAX_DOCUMENT_BATCH = 128;
const REQUEST_TIMEOUT_MS = 20_000;

interface VertexEmbeddingPrediction {
  embeddings?: {
    values?: number[];
    statistics?: {
      token_count?: number;
      truncated?: boolean;
    };
  };
}

interface VertexEmbeddingResponse {
  predictions?: VertexEmbeddingPrediction[];
  modelVersion?: string;
  model?: string;
  error?: { message?: string; status?: string };
}

function requiredString(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error("BRVIN M14 requires " + name + " to be configured.");
  return normalized;
}

function embeddingDimensions(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3_072) {
    throw new Error("BRVIN M14 embedding dimensions must be an integer between 1 and 3072.");
  }
  return parsed;
}

function validateLocation(value: string): string {
  if (!/^[a-z0-9-]{2,32}$/u.test(value)) {
    throw new Error("BRVIN M14 Vertex location is invalid.");
  }
  return value;
}

function validateModelId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(value)) {
    throw new Error("BRVIN M14 Vertex model ID is invalid.");
  }
  return value;
}

function validateText(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Vertex embedding input must be non-empty text.");
  }
  return value;
}

function endpoint(projectId: string, location: string, modelId: string): string {
  const host = location === "global"
    ? "https://aiplatform.googleapis.com"
    : "https://" + location + "-aiplatform.googleapis.com";
  return host + "/v1/projects/" + encodeURIComponent(projectId) +
    "/locations/" + encodeURIComponent(location) +
    "/publishers/google/models/" + encodeURIComponent(modelId) + ":predict";
}

/**
 * Google Gemini Embedding 001 accepts one input per predict request. This
 * adapter deliberately serializes document calls, avoids silent truncation,
 * and verifies every returned vector against the configured collection size.
 */
export class BrvinVertexEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "vertex-gemini-embedding-001";

  private readonly projectId: string;
  private readonly location: string;
  private readonly modelId: string;
  private readonly dimensions: number;

  constructor(
    private readonly env: Env,
    private readonly request: typeof fetch = fetch,
    private readonly accessToken: (env: Env) => Promise<string> = getGoogleAccessToken,
  ) {
    this.projectId = requiredString(env.GCP_PROJECT_ID, "GCP_PROJECT_ID");
    this.location = validateLocation(requiredString(env.BRVIN_M14_VERTEX_LOCATION, "BRVIN_M14_VERTEX_LOCATION"));
    this.modelId = validateModelId(env.BRVIN_M14_VERTEX_MODEL?.trim() || DEFAULT_MODEL_ID);
    this.dimensions = embeddingDimensions(env.BRVIN_M14_EMBEDDING_DIMENSIONS);
  }

  async embedDocuments(texts: readonly string[]): Promise<EmbeddingResult> {
    if (texts.length < 1 || texts.length > MAX_DOCUMENT_BATCH) {
      throw new RangeError("Vertex document embedding batch must contain 1 to " + MAX_DOCUMENT_BATCH + " texts.");
    }
    const vectors: number[][] = [];
    let modelVersion = this.modelId;
    for (const text of texts) {
      const result = await this.embedOne(text, "RETRIEVAL_DOCUMENT");
      vectors.push(result.vector);
      modelVersion = result.modelVersion;
    }
    return {
      modelId: this.modelId,
      modelVersion,
      dimensions: this.dimensions,
      vectors,
    };
  }

  async embedQuery(text: string): Promise<EmbeddingResult> {
    const result = await this.embedOne(text, "RETRIEVAL_QUERY");
    return {
      modelId: this.modelId,
      modelVersion: result.modelVersion,
      dimensions: this.dimensions,
      vectors: [result.vector],
    };
  }

  private async embedOne(
    input: string,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<{ vector: number[]; modelVersion: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = await this.accessToken(this.env);
      const response = await this.request(endpoint(this.projectId, this.location, this.modelId), {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          instances: [{ content: validateText(input), task_type: taskType }],
          parameters: {
            autoTruncate: false,
            outputDimensionality: this.dimensions,
          },
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: VertexEmbeddingResponse;
      try {
        payload = JSON.parse(raw) as VertexEmbeddingResponse;
      } catch {
        throw new Error("Vertex embedding endpoint returned invalid JSON (HTTP " + response.status + ").");
      }
      if (!response.ok) {
        const detail = payload.error?.message?.replace(/\s+/gu, " ").slice(0, 240);
        throw new Error("Vertex embedding request failed (HTTP " + response.status + ")." + (detail ? " " + detail : ""));
      }
      const vector = payload.predictions?.[0]?.embeddings?.values;
      if (!Array.isArray(vector) || vector.length !== this.dimensions ||
          vector.some((value) => !Number.isFinite(value))) {
        throw new Error("Vertex returned an embedding with an unexpected dimension or non-finite value.");
      }
      if (payload.predictions?.[0]?.embeddings?.statistics?.truncated === true) {
        throw new Error("Vertex truncated an embedding input; truncated embeddings are not accepted by the M14 pilot.");
      }
      return {
        vector,
        modelVersion: payload.modelVersion?.trim() || "not-returned",
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Vertex embedding request timed out after " + REQUEST_TIMEOUT_MS + "ms.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createBrvinVertexEmbeddingProvider(env: Env): BrvinVertexEmbeddingProvider {
  return new BrvinVertexEmbeddingProvider(env);
}
