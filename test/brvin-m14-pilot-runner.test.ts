import { describe, expect, it, vi } from "vitest";
import {
  buildBrvinPageManifest,
  buildBrvinSourceManifest,
} from "../src/brvin/corpus";
import { indexBrvinCorpusGeneration } from "../src/brvin/m14-pilot-runner";

const sourceId = "00000000-0000-4000-8000-000000000702";

describe("BRVIN M14 OCR-free corpus replay runner", () => {
  it("replays all persisted pages in physical order without calling OCR or PDF storage", async () => {
    const sourceManifest = await buildBrvinSourceManifest({
      sourceId,
      sourcePdfSha256: "c".repeat(64),
      ocrOperationId: "saved-vision-operation",
      pageCount: 2,
    });
    const page2 = await buildBrvinPageManifest({
      sourceId,
      sourcePdfSha256: sourceManifest.sourcePdfSha256,
      generationId: sourceManifest.generationId,
      ocrOperationId: sourceManifest.ocrOperationId,
      stableItemKey: "brvin/books/" + sourceId + "/pages/page-000002.txt",
      pdfPage: 2,
      rawOcrText: "Worked example: Calculate force.\nF = ma",
    });
    const page1 = await buildBrvinPageManifest({
      sourceId,
      sourcePdfSha256: sourceManifest.sourcePdfSha256,
      generationId: sourceManifest.generationId,
      ocrOperationId: sourceManifest.ocrOperationId,
      stableItemKey: "brvin/books/" + sourceId + "/pages/page-000001.txt",
      pdfPage: 1,
      rawOcrText: "Newton's second law relates net force and acceleration.",
    });
    const calls: any[] = [];
    const pilot = {
      upsertPageChunks: vi.fn(async (input: any) => {
        calls.push(input);
        return {
          pointCount: input.chunks.length,
          ids: input.chunks.map((chunk: any) => chunk.id),
          modelId: "gemini-embedding-001",
          modelVersion: "gemini-embedding-001@pilot",
        };
      }),
    };

    const corpus = {
      sourceManifest,
      pageManifests: [page2, page1],
      chunkCount: page1.chunks.length + page2.chunks.length,
    };
    const first = await indexBrvinCorpusGeneration(pilot as any, "project-physics", corpus);
    const second = await indexBrvinCorpusGeneration(pilot as any, "project-physics", corpus);

    expect(first.pageCount).toBe(2);
    expect(first.chunkCount).toBe(corpus.chunkCount);
    expect(first.pointCount).toBe(corpus.chunkCount);
    expect(first.pointIds).toEqual(second.pointIds);
    expect(first.embeddingModelIds).toEqual(["gemini-embedding-001"]);
    expect(first.embeddingModelVersions).toEqual(["gemini-embedding-001@pilot"]);
    expect(calls.slice(0, 2).map((call) => call.pdfPage)).toEqual([1, 2]);
    expect(calls[1].chunks[0].normalizedText).toContain("F = ma");
    expect(calls[1].chunks[0].formulaCandidates[0]).toMatchObject({
      originalExpression: "F = ma",
      confidence: "candidate-unverified",
    });
  });

  it("rejects duplicate, incomplete or cross-generation page sets before replay", async () => {
    const sourceManifest = await buildBrvinSourceManifest({
      sourceId,
      sourcePdfSha256: "d".repeat(64),
      ocrOperationId: "saved-vision-operation-2",
      pageCount: 2,
    });
    const page1 = await buildBrvinPageManifest({
      sourceId,
      sourcePdfSha256: sourceManifest.sourcePdfSha256,
      generationId: sourceManifest.generationId,
      ocrOperationId: sourceManifest.ocrOperationId,
      stableItemKey: "brvin/books/" + sourceId + "/pages/page-000001.txt",
      pdfPage: 1,
      rawOcrText: "Newton's second law",
    });
    const pilot = { upsertPageChunks: vi.fn() };
    await expect(indexBrvinCorpusGeneration(pilot as any, "project-physics", {
      sourceManifest,
      pageManifests: [page1],
      chunkCount: page1.chunks.length,
    })).rejects.toThrow("every physical page");
    await expect(indexBrvinCorpusGeneration(pilot as any, "project-physics", {
      sourceManifest,
      pageManifests: [page1, page1],
      chunkCount: page1.chunks.length * 2,
    })).rejects.toThrow("duplicate page provenance");
    expect(pilot.upsertPageChunks).not.toHaveBeenCalled();
  });
});
