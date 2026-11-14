import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FatmanImportJob } from "../src/fatman/import";

vi.mock("../src/auth/google", () => ({
  getGoogleAccessToken: vi.fn(async () => "test-google-token"),
}));

import {
  brvinDerivedCorpusPrefix,
  persistBrvinPageCorpus,
} from "../src/brvin/corpus-store";

const SOURCE_ID = "00000000-0000-4000-8000-000000000499";

describe("BRVIN private derived-corpus GCS store", () => {
  const storedObjects = new Map<string, string>();

  beforeEach(() => {
    storedObjects.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));

      if (url.pathname.endsWith("/upload/storage/v1/b/private-test-bucket/o")) {
        const name = url.searchParams.get("name");
        if (!name) return new Response("missing object name", { status: 400 });
        if (storedObjects.has(name)) return new Response("precondition failed", { status: 412 });
        if (typeof init?.body !== "string") return new Response("missing object body", { status: 400 });
        storedObjects.set(name, init.body);
        return new Response("{}", { status: 200 });
      }

      if (url.searchParams.get("alt") === "media") {
        const name = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
        const existing = storedObjects.get(name);
        return existing === undefined
          ? new Response("not found", { status: 404 })
          : new Response(existing, { status: 200 });
      }

      return new Response("unexpected storage request", { status: 404 });
    }) as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows the exact legacy Fatman source key namespace without allowing arbitrary slugs", () => {
    expect(brvinDerivedCorpusPrefix("fatman-legacy-538"))
      .toBe("brvin/derived-corpus/fatman-legacy-538/");
    expect(() => brvinDerivedCorpusPrefix("fatman-legacy-539")).toThrow(/source identifier/u);
    expect(() => brvinDerivedCorpusPrefix("../fatman")).toThrow(/source identifier/u);
  });

  it("writes immutable source/page manifests and accepts only byte-identical replay", async () => {
    const job = {
      id: SOURCE_ID,
      book_id: SOURCE_ID,
      source_object: "brvin/source-pdfs/" + SOURCE_ID + "/source.pdf",
      source_sha256: "a".repeat(64),
      expected_size: 12,
      uploaded_bytes: 12,
      upload_session_uri: null,
      status: "processing",
      vision_operation: "vision-operation",
      workflow_instance_id: "workflow-instance",
      indexed_pages: 0,
      error_message: null,
      created_at: 1,
      updated_at: 1,
      book_title: "Physics pilot",
      page_count: 2,
    } as FatmanImportJob;
    const rawOcrText = "Newton's second law\nF = ma\nThe net force causes acceleration.";

    const first = await persistBrvinPageCorpus(
      { FATMAN_GCS_BUCKET: "private-test-bucket" } as any,
      job,
      2,
      rawOcrText,
      "brvin/books/" + SOURCE_ID + "/pages/page-000002.txt",
      0.93,
    );

    expect(first.sourceManifestCreated).toBe(true);
    expect(first.pageManifestCreated).toBe(true);
    expect(first.chunkCount).toBeGreaterThan(0);
    expect(brvinDerivedCorpusPrefix(SOURCE_ID)).toBe("brvin/derived-corpus/" + SOURCE_ID + "/");
    expect([...storedObjects.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp("brvin/derived-corpus/" + SOURCE_ID + "/.+/manifest\\.json$")),
      expect.stringMatching(new RegExp("brvin/derived-corpus/" + SOURCE_ID + "/.+/pages/page-000002\\.json$")),
    ]));

    const pageObject = [...storedObjects.entries()].find(([name]) => name.includes("/pages/page-000002.json"));
    expect(pageObject).toBeDefined();
    const persistedPage = JSON.parse(pageObject![1]);
    expect(persistedPage.rawOcrText).toBe(rawOcrText);
    expect(persistedPage.stableItemKey).toBe("brvin/books/" + SOURCE_ID + "/pages/page-000002.txt");
    expect(persistedPage.ocrEvidence).toMatchObject({
      confidenceState: "page-confidence-available",
      pageConfidence: 0.93,
    });

    const replay = await persistBrvinPageCorpus(
      { FATMAN_GCS_BUCKET: "private-test-bucket" } as any,
      job,
      2,
      rawOcrText,
      "brvin/books/" + SOURCE_ID + "/pages/page-000002.txt",
      0.93,
    );
    expect(replay.sourceManifestCreated).toBe(false);
    expect(replay.pageManifestCreated).toBe(false);
    expect(replay.pageManifestObject).toBe(first.pageManifestObject);
    expect(storedObjects.size).toBe(2);
  });
});
