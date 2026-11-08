import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import {
  buildBrvinPageManifest,
  buildBrvinSourceManifest,
} from "../src/brvin/corpus";
import { readBrvinCorpusGeneration } from "../src/brvin/corpus-reader";

const SOURCE_ID = "00000000-0000-4000-8000-000000000701";
const PDF_SHA = "a".repeat(64);
const OPERATION = "projects/test-project/operations/physics-pilot";

async function fixture() {
  const source = await buildBrvinSourceManifest({
    sourceId: SOURCE_ID,
    sourcePdfSha256: PDF_SHA,
    ocrOperationId: OPERATION,
    pageCount: 2,
  });
  const page1 = await buildBrvinPageManifest({
    sourceId: SOURCE_ID,
    sourcePdfSha256: PDF_SHA,
    generationId: source.generationId,
    ocrOperationId: OPERATION,
    stableItemKey: "brvin/books/" + SOURCE_ID + "/pages/page-000001.txt",
    pdfPage: 1,
    rawOcrText: "Net force changes motion.\nF = ma",
  });
  const page2 = await buildBrvinPageManifest({
    sourceId: SOURCE_ID,
    sourcePdfSha256: PDF_SHA,
    generationId: source.generationId,
    ocrOperationId: OPERATION,
    stableItemKey: "brvin/books/" + SOURCE_ID + "/pages/page-000002.txt",
    pdfPage: 2,
    rawOcrText: "The acceleration is proportional to net force.",
  });
  const prefix = "brvin/derived-corpus/" + SOURCE_ID + "/" + source.generationId + "/";
  const objects = new Map<string, unknown>([
    [prefix + "manifest.json", source],
    [prefix + "pages/page-000001.json", page1],
    [prefix + "pages/page-000002.json", page2],
  ]);
  return { source, page1, page2, prefix, objects };
}

function readerEnv(): Env {
  return { FATMAN_GCS_BUCKET: "private-test-bucket" } as Env;
}

describe("BRVIN immutable corpus replay reader", () => {
  it("rebuilds every physical page from stored manifests without another OCR request", async () => {
    const data = await fixture();
    const requestMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      const objectName = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
      const value = data.objects.get(objectName);
      return value === undefined
        ? new Response("missing", { status: 404 })
        : new Response(JSON.stringify(value), { status: 200 });
    });
    const request = requestMock as typeof fetch;

    const replay = await readBrvinCorpusGeneration(readerEnv(), SOURCE_ID, data.source.generationId, {
      request,
      accessToken: async () => "test-token",
    });

    expect(replay.sourceManifest).toEqual(data.source);
    expect(replay.pageManifests.map((page) => page.pdfPage)).toEqual([1, 2]);
    expect(replay.pageManifests[0].rawOcrText).toBe("Net force changes motion.\nF = ma");
    expect(replay.chunkCount).toBe(data.page1.chunks.length + data.page2.chunks.length);
    expect(request).toHaveBeenCalledTimes(3);
    for (const [url, init] of requestMock.mock.calls) {
      expect(String(url)).toContain("storage.googleapis.com/storage/v1");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-token" });
    }
  });

  it("rejects a changed raw OCR payload even when the page file is readable", async () => {
    const data = await fixture();
    const changed = { ...data.page1, rawOcrText: "F = ma changed" };
    data.objects.set(data.prefix + "pages/page-000001.json", changed);
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      const objectName = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
      const value = data.objects.get(objectName);
      return value === undefined
        ? new Response("missing", { status: 404 })
        : new Response(JSON.stringify(value), { status: 200 });
    }) as typeof fetch;

    await expect(readBrvinCorpusGeneration(readerEnv(), SOURCE_ID, data.source.generationId, {
      request,
      accessToken: async () => "test-token",
    })).rejects.toThrow("integrity check");
  });

  it("rejects an incomplete generation instead of returning a partial corpus", async () => {
    const data = await fixture();
    data.objects.delete(data.prefix + "pages/page-000002.json");
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      const objectName = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
      const value = data.objects.get(objectName);
      return value === undefined
        ? new Response("missing", { status: 404 })
        : new Response(JSON.stringify(value), { status: 200 });
    }) as typeof fetch;

    await expect(readBrvinCorpusGeneration(readerEnv(), SOURCE_ID, data.source.generationId, {
      request,
      accessToken: async () => "test-token",
    })).rejects.toThrow("HTTP 404");
  });

  it("rejects malformed source or generation identifiers before making storage calls", async () => {
    const request = vi.fn() as typeof fetch;
    await expect(readBrvinCorpusGeneration(readerEnv(), "../source", "bad", {
      request,
      accessToken: async () => "test-token",
    })).rejects.toThrow("source identifier");
    expect(request).not.toHaveBeenCalled();
  });
});
