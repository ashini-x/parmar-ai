import { describe, expect, it, vi } from "vitest";
import { BrvinVertexEmbeddingProvider } from "../src/brvin/vertex-embedding";
import type { Env } from "../src/config/env";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GCP_PROJECT_ID: "test-gcp-project",
    BRVIN_M14_VERTEX_LOCATION: "us-central1",
    BRVIN_M14_VERTEX_MODEL: "gemini-embedding-001",
    BRVIN_M14_EMBEDDING_DIMENSIONS: "3",
    ...overrides,
  } as Env;
}

function okEmbedding(vector: number[], modelVersion = "gemini-embedding-001@2026-08"): Response {
  return new Response(JSON.stringify({
    predictions: [{ embeddings: { values: vector, statistics: { truncated: false, token_count: 4 } } }],
    modelVersion,
  }), { status: 200 });
}

describe("BRVIN M14 Vertex embedding adapter", () => {
  it("uses separate document/query task types and validates exact output dimensions", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(okEmbedding([0.1, 0.2, 0.3]))
      .mockResolvedValueOnce(okEmbedding([0.4, 0.5, 0.6]));
    const token = vi.fn(async () => "test-google-token");
    const provider = new BrvinVertexEmbeddingProvider(makeEnv(), request as typeof fetch, token);

    const documents = await provider.embedDocuments(["Newton's second law"]);
    const query = await provider.embedQuery("How does net force affect acceleration?");

    expect(documents).toMatchObject({
      modelId: "gemini-embedding-001",
      modelVersion: "gemini-embedding-001@2026-08",
      dimensions: 3,
      vectors: [[0.1, 0.2, 0.3]],
    });
    expect(query.vectors).toEqual([[0.4, 0.5, 0.6]]);
    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0];
    const second = request.mock.calls[1];
    expect(String(first[0])).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/test-gcp-project/locations/us-central1/publishers/google/models/gemini-embedding-001:predict",
    );
    const firstBody = JSON.parse(String(first[1]?.body));
    const secondBody = JSON.parse(String(second[1]?.body));
    expect(firstBody.instances).toEqual([{ content: "Newton's second law", task_type: "RETRIEVAL_DOCUMENT" }]);
    expect(secondBody.instances).toEqual([{ content: "How does net force affect acceleration?", task_type: "RETRIEVAL_QUERY" }]);
    expect(firstBody.parameters).toEqual({ autoTruncate: false, outputDimensionality: 3 });
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer test-google-token" });
  });

  it("sends document inputs one at a time rather than relying on unsupported multi-input prediction", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(okEmbedding([0.1, 0.2, 0.3]))
      .mockResolvedValueOnce(okEmbedding([0.4, 0.5, 0.6]));
    const provider = new BrvinVertexEmbeddingProvider(makeEnv(), request as typeof fetch, async () => "token");

    const result = await provider.embedDocuments(["first chunk", "second chunk"]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.vectors).toHaveLength(2);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).instances).toHaveLength(1);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).instances).toHaveLength(1);
  });

  it("rejects missing configuration, oversized batches, wrong dimensions and truncated output", async () => {
    expect(() => new BrvinVertexEmbeddingProvider(makeEnv({ BRVIN_M14_VERTEX_LOCATION: undefined } as Partial<Env>)))
      .toThrow("BRVIN_M14_VERTEX_LOCATION");
    const provider = new BrvinVertexEmbeddingProvider(makeEnv(), vi.fn() as typeof fetch, async () => "token");
    await expect(provider.embedDocuments([])).rejects.toThrow("1 to 128");
    await expect(provider.embedDocuments(["x".repeat(100)]).then(() => undefined)).rejects.toThrow();

    const wrongDimensions = new BrvinVertexEmbeddingProvider(
      makeEnv(),
      vi.fn(async () => okEmbedding([0.1, 0.2])) as typeof fetch,
      async () => "token",
    );
    await expect(wrongDimensions.embedQuery("test")).rejects.toThrow("unexpected dimension");

    const truncated = new BrvinVertexEmbeddingProvider(
      makeEnv(),
      vi.fn(async () => new Response(JSON.stringify({
        predictions: [{ embeddings: { values: [0.1, 0.2, 0.3], statistics: { truncated: true } } }],
      }), { status: 200 })) as typeof fetch,
      async () => "token",
    );
    await expect(truncated.embedQuery("test")).rejects.toThrow("truncated");
  });
});
