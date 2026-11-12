import { describe, expect, it, vi } from "vitest";
import type { AiSearchInstance } from "../src/config/env";
import { createBrvinRetrievalProvider } from "../src/brvin/provider-contract";

function makeInstance() {
  const list = vi.fn(async (): Promise<{ result: Array<{ id: string; key: string; status: string }> }> => ({ result: [] }));
  const upload = vi.fn(async (): Promise<{ id: string; key: string; status: string }> => ({ id: "item-1", key: "source/page-000002.txt", status: "queued" }));
  const remove = vi.fn(async () => undefined);
  const search = vi.fn(async () => ({
    chunks: [{
      id: "candidate-1",
      text: "F = ma",
      score: 0.93,
      item: { key: "source/page-000002.txt", metadata: { page: 2 } },
      scoring_details: { vector_score: 0.91, keyword_score: 0.8, reranking_score: 0.95, fusion_method: "rrf" },
    }],
  }));
  const info = vi.fn(async () => ({ status: "ready" }));
  const instance = {
    items: { list, upload, delete: remove },
    search,
    info,
  } as unknown as AiSearchInstance;
  return { instance, list, upload, remove, search, info };
}

describe("BRVIN retrieval provider boundary", () => {
  it("keeps Cloudflare AI Search as the only M13 selectable implementation", () => {
    const { instance } = makeInstance();
    expect(createBrvinRetrievalProvider(undefined, instance).providerId).toBe("cloudflare-ai-search");
    expect(createBrvinRetrievalProvider("cloudflare-ai-search", instance).providerId).toBe("cloudflare-ai-search");
    expect(() => createBrvinRetrievalProvider("qdrant", instance)).toThrow("not implemented");
  });

  it("upserts idempotently and preserves an already completed legacy item", async () => {
    const { instance, list, upload, remove } = makeInstance();
    list.mockResolvedValueOnce({
      result: [
        { id: "keep", key: "source/page-000002.txt", status: "completed" },
        { id: "duplicate", key: "source/page-000002.txt", status: "queued" },
      ],
    });
    const provider = createBrvinRetrievalProvider("cloudflare-ai-search", instance);

    await expect(provider.upsert({ key: "source/page-000002.txt", text: "Page 2 content" }))
      .resolves.toEqual({ status: "completed" });

    expect(remove).toHaveBeenCalledWith("duplicate");
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps provider hybrid results to provider-neutral candidates", async () => {
    const { instance, search } = makeInstance();
    const provider = createBrvinRetrievalProvider("cloudflare-ai-search", instance);

    const candidates = await provider.query({
      projectId: "project-physics",
      query: "What is Newton's second law?",
      sourcePrefixes: ["source/"],
      maxResults: 16,
      matchThreshold: 0.3,
      reranking: { enabled: true, model: "bge-reranker", minimumScore: 0.4 },
    });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: "user", content: "What is Newton's second law?" }],
      ai_search_options: expect.objectContaining({
        cache: { enabled: true, cache_threshold: "super_strict_match" },
        retrieval: expect.objectContaining({
          retrieval_type: "hybrid",
          filters: { folder: { $in: ["source/"] } },
        }),
        reranking: { enabled: true, model: "bge-reranker", match_threshold: 0.4 },
      }),
    }));
    expect(candidates).toEqual([expect.objectContaining({
      id: "candidate-1",
      itemKey: "source/page-000002.txt",
      text: "F = ma",
      score: 0.93,
      scoringDetails: {
        vectorScore: 0.91,
        keywordScore: 0.8,
        rerankingScore: 0.95,
        fusionMethod: "rrf",
      },
      metadata: { page: 2 },
    })]);
  });

  it("deletes only exact source item keys and checks provider health", async () => {
    const { instance, list, remove, info } = makeInstance();
    list.mockResolvedValue({
      result: [
        { id: "exact", key: "source/page-000002.txt", status: "completed" },
        { id: "similar", key: "source/page-000002.txt-extra", status: "completed" },
      ],
    });
    const provider = createBrvinRetrievalProvider("cloudflare-ai-search", instance);

    await provider.deleteSource(["source/page-000002.txt", "source/page-000002.txt"]);
    await expect(provider.health()).resolves.toMatchObject({ providerId: "cloudflare-ai-search", ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("exact");
    expect(info).toHaveBeenCalledTimes(1);
  });
});
