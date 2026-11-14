import { describe, expect, it, vi } from "vitest";
import { QdrantVertexReadOnlyRetrievalProvider } from "../src/brvin/provider-contract";
import type { BrvinQdrantHybridPilot } from "../src/brvin/qdrant-hybrid-pilot";

function makeProvider() {
  const query = vi.fn(async (input: unknown) => [{
    id: "point-1",
    itemKey: "brvin/books/source-1/pages/page-000004.txt",
    text: "Static friction adjusts up to its maximum magnitude.",
    score: 0.5,
    pdfPage: 4,
    sourceId: "source-1",
    contentTypes: ["explanatory_text"],
    metadata: { generationId: "generation-1" },
  }]);
  const health = vi.fn(async () => ({ providerId: "qdrant-dense-sparse-rrf", ok: true, version: "collection-schema-v1" }));
  const pilot = { query, health } as unknown as BrvinQdrantHybridPilot;
  return { provider: new QdrantVertexReadOnlyRetrievalProvider(pilot), query, health };
}

describe("BRVIN Qdrant query-only retrieval adapter", () => {
  it("returns no candidates before calling Vertex/Qdrant when D1 authorizes no source prefixes", async () => {
    const { provider, query } = makeProvider();
    await expect(provider.query({
      projectId: "project-1",
      query: "Does static friction adjust?",
      sourcePrefixes: [],
      maxResults: 16,
      matchThreshold: 0.3,
    })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("passes the server project and only D1-derived source IDs into hybrid Qdrant retrieval", async () => {
    const { provider, query } = makeProvider();
    const candidates = await provider.query({
      projectId: "project-1",
      query: "Does static friction adjust?",
      sourcePrefixes: [
        "brvin/books/source-1/pages/",
        "brvin/books/source-2/pages/",
        "fatman/pages/",
        "brvin/books/source-1/not-pages/",
      ],
      maxResults: 16,
      matchThreshold: 0.3,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      authorizedSourceIds: ["source-1", "source-2", "fatman-legacy-538"],
      query: "Does static friction adjust?",
      limit: 16,
      prefetchLimit: 48,
      ensureCollection: false,
    }));
    expect(candidates).toEqual([expect.objectContaining({
      id: "point-1",
      itemKey: "brvin/books/source-1/pages/page-000004.txt",
      score: 0.5,
      scoringDetails: { fusionMethod: "qdrant-rrf" },
      metadata: {
        generationId: "generation-1",
        pdfPage: 4,
        sourceId: "source-1",
        contentTypes: ["explanatory_text"],
      },
    })]);
  });

  it("maps only the exact legacy Fatman prefix to the pinned production source ID", async () => {
    const { provider, query } = makeProvider();
    await provider.query({
      projectId: "fatman-project",
      query: "Battle of Plassey",
      sourcePrefixes: [
        "fatman/pages/",
        "fatman/pages-extra/",
        "fatman/other/",
        "legacy/fatman/pages/",
      ],
      maxResults: 16,
      matchThreshold: 0.3,
    });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      authorizedSourceIds: ["fatman-legacy-538"],
    }));
  });

  it("fails closed for all corpus write and delete methods", async () => {
    const { provider } = makeProvider();
    await expect(provider.findExisting("key")).rejects.toThrow("query-only");
    await expect(provider.upsert({ key: "key", text: "text" })).rejects.toThrow("query-only");
    await expect(provider.deleteByKey("key")).rejects.toThrow("query-only");
    await expect(provider.deleteSource(["key"])).rejects.toThrow("query-only");
  });

  it("reports read-only collection health", async () => {
    const { provider, health } = makeProvider();
    await expect(provider.health()).resolves.toMatchObject({ providerId: "qdrant-dense-sparse-rrf", ok: true });
    expect(health).toHaveBeenCalledTimes(1);
  });
});
