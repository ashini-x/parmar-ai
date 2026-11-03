import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  getFatmanBookState: vi.fn(),
  reserveFatmanSearchQuery: vi.fn(),
}));

vi.mock("../src/analytics/db", () => analytics);

import {
  FatmanRetrievalError,
  formatFatmanCitations,
  isFatmanPassageRelevant,
  isFatmanReady,
  retrieveFatmanContext,
  retrieveFatmanQaContext,
} from "../src/fatman/retrieval";

describe("Fatman page retrieval", () => {
  const search = vi.fn();
  const env = {
    FATMAN_ENABLED: "true",
    FATMAN_DOCUMENT_VERSION: "fatman-test-v1",
    FATMAN_INSTANCE_NAME: "fatman-test",
    FATMAN_EXPECTED_PAGES: "538",
    FATMAN_MIN_SCORE: "0.2",
    FATMAN_MONTHLY_QUERY_LIMIT: "800",
    DB: {},
    FATMAN_SEARCH: {
      get: () => ({ search }),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    analytics.getFatmanBookState.mockResolvedValue({
      enabled: true,
      documentVersion: "fatman-test-v1",
      indexedPages: 538,
    });
    analytics.reserveFatmanSearchQuery.mockResolvedValue({ allowed: true, queryCount: 1 });
    search.mockResolvedValue({
      chunks: [
        {
          id: "page-123-a",
          text: "Join - @freebookspdf00 The Battle of Plassey took place in 1757.",
          score: 0.82,
          item: { key: "fatman/pages/page-000123.jpg", metadata: { printedPage: "17" } },
        },
        {
          id: "page-124-low",
          text: "A low-scoring unrelated passage.",
          score: 0.1,
          item: { key: "fatman/pages/page-000124.jpg" },
        },
        {
          id: "non-fatman",
          text: "A result from another indexed item.",
          score: 0.9,
          item: { key: "other/pages/page-000125.jpg" },
        },
      ],
    });
  });

  it("fails closed unless the configured book version and page count are indexed", async () => {
    expect(await isFatmanReady(env)).toBe(true);
    expect(await isFatmanReady({ ...env, FATMAN_ENABLED: "false" })).toBe(false);
    expect(await isFatmanReady({ ...env, FATMAN_DOCUMENT_VERSION: "another-version" })).toBe(false);
    expect(await isFatmanReady({ ...env, DB: undefined })).toBe(false);
  });

  it("uses hybrid retrieval, filters weak/non-book hits, and preserves the exact PDF page", async () => {
    const context = await retrieveFatmanContext(env, "  Battle   of Plassey ");

    expect(search).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Battle of Plassey" }],
      ai_search_options: {
        retrieval: { max_num_results: 12, retrieval_type: "hybrid" },
      },
    });
    expect(analytics.reserveFatmanSearchQuery).toHaveBeenCalledWith(env, 800);
    expect(context.passages).toEqual([
      expect.objectContaining({
        id: "page-123-a",
        pdfPage: 123,
        printedPage: "17",
        text: "The Battle of Plassey took place in 1757.",
        score: 0.82,
      }),
    ]);
    expect(formatFatmanCitations(context.passages)).toBe(
      "Source: Fatman 2nd Edition, PDF p. 123 (book p. 17).",
    );
  });

  it("does not query AI Search after the monthly search allowance is exhausted", async () => {
    analytics.reserveFatmanSearchQuery.mockResolvedValueOnce({ allowed: false, queryCount: 800 });

    await expect(retrieveFatmanContext(env, "Plassey")).rejects.toMatchObject({
      name: "FatmanRetrievalError",
      retryable: false,
      userMessage: "Fatman search has reached this month's free usage limit. Use /help to return to usual study mode.",
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("filters vector-only matches that have no meaningful overlap with the student's query", () => {
    expect(isFatmanPassageRelevant(
      "exact SHA-256 fingerprint Cloudflare API token used to deploy this PDF",
      "Fatman 2nd Edition 2026 | PDF page 165 MODERN HISTORY",
    )).toBe(false);
    expect(isFatmanPassageRelevant(
      "Battle of Plassey 1757 Robert Clive",
      "Fatman 2nd Edition 2026 | PDF page 168 Battle of Plassey (1757) East India Company force led by Robert Clive.",
    )).toBe(true);
  });

  it("runs internal QA retrieval without consuming a student's monthly search allowance", async () => {
    const context = await retrieveFatmanQaContext(env, "Battle of Plassey 1757");
    expect(search).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Battle of Plassey 1757" }],
      ai_search_options: {
        retrieval: { max_num_results: 50, retrieval_type: "hybrid" },
      },
    });
    expect(analytics.reserveFatmanSearchQuery).not.toHaveBeenCalled();
    expect(context.passages).toHaveLength(1);
  });

  it("does not invent a citation when no passages were retrieved", () => {
    expect(formatFatmanCitations([])).toBe("");
  });

  it("fails closed when the D1 book state cannot be read", async () => {
    analytics.getFatmanBookState.mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(isFatmanReady(env)).resolves.toBe(false);
    expect(search).not.toHaveBeenCalled();
  });
});
