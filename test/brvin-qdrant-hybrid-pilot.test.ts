import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider, EmbeddingResult } from "../src/brvin/provider-contract";
import {
  BrvinQdrantHybridPilot,
  brvinM14PointId,
  buildBrvinSparseVector,
} from "../src/brvin/qdrant-hybrid-pilot";

function makeEmbeddings(): EmbeddingProvider {
  const result = (texts: readonly string[]): EmbeddingResult => ({
    modelId: "gemini-embedding-001",
    modelVersion: "gemini-embedding-001-test",
    dimensions: 3,
    vectors: texts.map((_, index) => [0.1 + index * 0.01, 0.2, 0.3]),
  });
  return {
    providerId: "vertex-test",
    embedDocuments: vi.fn(async (texts: readonly string[]) => result(texts)),
    embedQuery: vi.fn(async (text: string) => result([text])),
  };
}

const collectionInfo = {
  result: {
    config: {
      params: {
        vectors: { dense: { size: 3, distance: "Cosine" } },
        sparse_vectors: { sparse: { modifier: "idf" } },
      },
    },
  },
  status: "ok",
};

function makeQdrant() {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  let firstCollectionRead = true;
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });

    if (url.endsWith("/collections/brvin_m14_physics_pilot_v1") && method === "GET" && firstCollectionRead) {
      firstCollectionRead = false;
      return new Response(JSON.stringify({ status: "error", error: "not found" }), { status: 404 });
    }
    if (url.endsWith("/collections/brvin_m14_physics_pilot_v1") && method === "GET") {
      return new Response(JSON.stringify(collectionInfo), { status: 200 });
    }
    if (url.endsWith("/collections/brvin_m14_physics_pilot_v1") && method === "PUT") {
      return new Response(JSON.stringify({ result: true, status: "ok" }), { status: 200 });
    }
    if (url.includes("/points?wait=true") && method === "PUT") {
      return new Response(JSON.stringify({ result: { operation_id: 1, status: "completed" }, status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/points/query") && method === "POST") {
      return new Response(JSON.stringify({
        result: {
          points: [
            {
              id: "authorized-point",
              score: 0.93,
              payload: {
                project_id: "project-a",
                source_id: "source-a",
                item_key: "brvin/books/source-a/pages/page-000002.txt",
                pdf_page: 2,
                chunk_text: "F = ma",
                chunk_id: "chunk-a",
                generation_id: "generation-a",
                content_types: ["formula", "explanatory_text"],
              },
            },
            {
              id: "wrong-source",
              score: 0.99,
              payload: {
                project_id: "project-a",
                source_id: "source-b",
                item_key: "private/source-b",
                pdf_page: 1,
                chunk_text: "not authorized",
              },
            },
            {
              id: "wrong-project",
              score: 0.98,
              payload: {
                project_id: "project-b",
                source_id: "source-a",
                item_key: "private/project-b",
                pdf_page: 1,
                chunk_text: "not authorized",
              },
            },
          ],
        },
        status: "ok",
      }), { status: 200 });
    }
    if (url.endsWith("/points/delete?wait=true") && method === "POST") {
      return new Response(JSON.stringify({ result: { operation_id: 2, status: "completed" }, status: "ok" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: "error", error: "unexpected request" }), { status: 404 });
  }) as typeof fetch;

  return { request, calls };
}

function makePilot(request = makeQdrant().request, embeddings = makeEmbeddings()) {
  return new BrvinQdrantHybridPilot({
    url: "https://cluster.example.qdrant.cloud",
    apiKey: "qdrant-test-key",
    collection: "brvin_m14_physics_pilot_v1",
    dimensions: 3,
  }, embeddings, request);
}

describe("BRVIN M14 Qdrant dense+sparse hybrid pilot", () => {
  it("invokes stored fetch implementations with the Worker global receiver", async () => {
    let receiver: unknown;
    const request = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify(collectionInfo), { status: 200 }));
    };
    const pilot = makePilot(request as typeof fetch);
    await pilot.health();
    expect(receiver).toBe(globalThis);
  });

  it("preserves case and mathematical operator distinctions in sparse-token identities", async () => {
    const terms = ["F", "f", "x", "×", "-", "−"];
    const indexes = await Promise.all(terms.map(async (term) =>
      (await buildBrvinSparseVector(term)).indices[0],
    ));
    expect(new Set(indexes).size).toBe(terms.length);
    const repeated = await buildBrvinSparseVector("F F ma");
    expect(repeated.values[repeated.indices.indexOf((await buildBrvinSparseVector("F")).indices[0])]).toBeGreaterThan(1);
  });

  it("creates one named dense+sparse IDF collection and upserts stable provenance-bearing points", async () => {
    const { request, calls } = makeQdrant();
    const embeddings = makeEmbeddings();
    const pilot = makePilot(request, embeddings);
    const page = {
      projectId: "project-a",
      sourceId: "source-a",
      itemKey: "brvin/books/source-a/pages/page-000002.txt",
      pdfPage: 2,
      generationId: "generation-a",
      chunks: [{
        id: "brvchunk_" + "a".repeat(64),
        chunkIndex: 0,
        normalizedText: "Newton's second law: F = ma",
        contentSha256: "b".repeat(64),
        contentTypes: ["formula", "explanatory_text"],
        formulaCandidates: [{
          originalExpression: "F = ma",
          normalizedSearchExpression: "F = ma",
          confidence: "candidate-unverified",
        }],
      }],
    };

    const first = await pilot.upsertPageChunks(page);
    const replay = await pilot.upsertPageChunks(page);

    expect(first.pointCount).toBe(1);
    expect(first.ids[0]).toMatch(/^[a-f0-9-]{36}$/u);
    expect(replay.ids).toEqual(first.ids);
    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    const create = calls.find((call) => call.method === "PUT" && call.url.endsWith("/collections/brvin_m14_physics_pilot_v1"));
    expect(create?.body).toMatchObject({
      vectors: { dense: { size: 3, distance: "Cosine" } },
      sparse_vectors: { sparse: { modifier: "idf" } },
      metadata: { purpose: "m14-isolated-physics-pilot" },
    });
    const upserts = calls.filter((call) => call.method === "PUT" && call.url.includes("/points?wait=true"));
    expect(upserts).toHaveLength(2);
    expect(upserts[0].body.points[0]).toMatchObject({
      vector: {
        dense: [0.1, 0.2, 0.3],
        sparse: { indices: expect.any(Array), values: expect.any(Array) },
      },
      payload: {
        project_id: "project-a",
        source_id: "source-a",
        pdf_page: 2,
        item_key: page.itemKey,
        chunk_text: "Newton's second law: F = ma",
      },
    });
  });

  it("uses one dense+sparse RRF path with server-authorized project/source filters and post-validates every point", async () => {
    const { request, calls } = makeQdrant();
    const pilot = makePilot(request);
    const result = await pilot.query({
      projectId: "project-a",
      authorizedSourceIds: ["source-a"],
      query: "How does net force relate to acceleration?",
      limit: 8,
      prefetchLimit: 24,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "authorized-point",
      itemKey: "brvin/books/source-a/pages/page-000002.txt",
      sourceId: "source-a",
      pdfPage: 2,
      text: "F = ma",
      contentTypes: ["formula", "explanatory_text"],
    });
    const queryCall = calls.find((call) => call.url.endsWith("/points/query"));
    expect(queryCall?.body.query).toEqual({ fusion: "rrf" });
    expect(queryCall?.body.prefetch).toHaveLength(2);
    expect(queryCall?.body.prefetch.map((item: any) => item.using)).toEqual(["dense", "sparse"]);
    for (const prefetch of queryCall?.body.prefetch ?? []) {
      expect(prefetch.filter.must).toEqual([
        { key: "project_id", match: { value: "project-a" } },
        { key: "source_id", match: { any: ["source-a"] } },
      ]);
    }
    expect(queryCall?.body.filter).toEqual(queryCall?.body.prefetch[0].filter);
  });

  it("fails closed without an authorized source and deletes only the exact project/source pair", async () => {
    const { request, calls } = makeQdrant();
    const embeddings = makeEmbeddings();
    const pilot = makePilot(request, embeddings);
    await expect(pilot.query({
      projectId: "project-a",
      authorizedSourceIds: [],
      query: "Newton's second law",
    })).resolves.toEqual([]);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);

    await pilot.deleteSource("project-a", "source-a");
    const deletion = calls.find((call) => call.url.endsWith("/points/delete?wait=true"));
    expect(deletion?.body.filter.must).toEqual([
      { key: "project_id", match: { value: "project-a" } },
      { key: "source_id", match: { value: "source-a" } },
    ]);
  });

  it("rejects non-HTTPS clusters and incompatible existing collection dimensions", async () => {
    expect(() => new BrvinQdrantHybridPilot({
      url: "http://localhost:6333",
      apiKey: "key",
      dimensions: 3,
    }, makeEmbeddings())).toThrow("HTTPS");

    const incompatible = vi.fn(async () => new Response(JSON.stringify({
      result: { config: { params: { vectors: { dense: { size: 4, distance: "Cosine" } }, sparse_vectors: { sparse: {} } } } },
      status: "ok",
    }), { status: 200 })) as typeof fetch;
    const pilot = makePilot(incompatible);
    await expect(pilot.ensureCollection()).rejects.toThrow("does not match");
  });
});

describe("BRVIN M14 deterministic Qdrant point identity", () => {
  it("is stable and scoped to exact source, key, chunk and content hash", async () => {
    const id = await brvinM14PointId("source-a", "item-a", "chunk-a", "a".repeat(64));
    expect(await brvinM14PointId("source-a", "item-a", "chunk-a", "a".repeat(64))).toBe(id);
    expect(await brvinM14PointId("source-b", "item-a", "chunk-a", "a".repeat(64))).not.toBe(id);
    expect(await brvinM14PointId("source-a", "item-a", "chunk-a", "b".repeat(64))).not.toBe(id);
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  });
});
