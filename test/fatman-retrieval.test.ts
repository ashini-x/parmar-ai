import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  getFatmanBookState: vi.fn(),
  reserveFatmanSearchQuery: vi.fn(),
}));

vi.mock("../src/analytics/db", () => analytics);

import {
  buildFatmanRetrievalQuery,
  buildFatmanSearchQueries,
  extractFatmanEvidenceExcerpt,
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

    expect(search).toHaveBeenNthCalledWith(1, {
      messages: [{ role: "user", content: "Battle of Plassey" }],
      ai_search_options: {
        retrieval: { max_num_results: 12, retrieval_type: "hybrid" },
      },
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      messages: [{ role: "user", content: "Battle Plassey" }],
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
    expect(search).toHaveBeenNthCalledWith(1, {
      messages: [{ role: "user", content: "Battle of Plassey 1757" }],
      ai_search_options: {
        retrieval: { max_num_results: 50, retrieval_type: "hybrid" },
      },
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(analytics.reserveFatmanSearchQuery).not.toHaveBeenCalled();
    expect(context.passages).toHaveLength(1);
  });

  it("does not invent a citation when no passages were retrieved", () => {
    expect(formatFatmanCitations([])).toBe("");
  });

  it("preserves matching evidence that appears late in a long OCR page", () => {
    const filler = "General historical notes that do not address the student's question. ".repeat(35);
    const ocrPage = [
      "Battle of Plassey took place in 1757 and Robert Clive led the East India Company.",
      filler,
      "The Battle of Buxar was fought in 1764 and the British forces were led by Hector Munro.",
      filler,
      "The Treaty of Allahabad was signed in 1765. The Company received the Diwani revenue rights of Bengal, Bihar and Orissa.",
    ].join(" ");
    const excerpt = extractFatmanEvidenceExcerpt(
      "Battle of Plassey 1757 Buxar 1764 Treaty of Allahabad 1765 Diwani",
      ocrPage,
      3_300,
    );

    expect(excerpt.length).toBeLessThanOrEqual(3_300);
    expect(excerpt).toContain("Plassey");
    expect(excerpt).toContain("Buxar");
    expect(excerpt).toContain("Allahabad");
    expect(excerpt).toContain("Diwani");
  });

  it("expands short Article lookups and common FR/DPSP shorthand", () => {
    expect(buildFatmanSearchQueries("What is Article 79?")).toEqual([
      "What is Article 79?",
      "Article 79 Indian Constitution",
      "Article 79",
    ]);
    expect(buildFatmanSearchQueries("What is the difference between FR and DPSP?")).toEqual([
      "What is the difference between FR and DPSP?",
      "Fundamental Rights features",
      "Directive Principles of State Policy features",
    ]);
  });

  it("uses the previous Fatman exchange only for context-dependent follow-ups", () => {
    const turns = [{
      question: "Who introduced the Subsidiary Alliance?",
      answer: "Lord Wellesley introduced it in 1798.",
    }];
    expect(buildFatmanRetrievalQuery("Why?", turns)).toContain("Previous student question: Who introduced the Subsidiary Alliance?");
    expect(buildFatmanRetrievalQuery("Why?", turns)).toContain("Current student follow-up: Why?");
    expect(buildFatmanRetrievalQuery("What is photosynthesis?", turns)).toBe("What is photosynthesis?");
  });

  it("ranks citations by question and answer evidence instead of lowest PDF page numbers", () => {
    const citation = formatFatmanCitations([
      { id: "irrelevant", pdfPage: 133, text: "Unrelated geography material about rivers and mountains.", score: 0.95 },
      { id: "plassey", pdfPage: 168, text: "Battle of Plassey in 1757. East India Company forces led by Robert Clive fought Siraj-ud-Daulah.", score: 0.58 },
      { id: "other", pdfPage: 160, text: "Unrelated rulers and dynasties in medieval India.", score: 0.72 },
    ], "Battle of Plassey Robert Clive", "At Plassey, Robert Clive led the East India Company forces against Siraj-ud-Daulah.");
    expect(citation).toContain("PDF p. 168");
  });

  it("cites both sides of a comparison when the lower-scoring page supports the answer", () => {
    const citation = formatFatmanCitations([
      { id: "rights", pdfPage: 213, text: "Fundamental Rights Part III are justiciable and legally enforceable.", score: 0.55 },
      { id: "dpsp-classification", pdfPage: 219, text: "Directive Principles promote social and economic welfare and a welfare state.", score: 0.54 },
      { id: "dpsp", pdfPage: 218, text: "Part IV Directive Principles of State Policy are non-justiciable and not legally enforceable.", score: 0.42 },
    ], "Compare Fundamental Rights Part III with Directive Principles Part IV and their enforceability",
    "Fundamental Rights in Part III are justiciable and legally enforceable. Directive Principles in Part IV are non-justiciable and guide the State toward social and economic welfare.");
    expect(citation).toContain("PDF p. 213");
    expect(citation).toContain("PDF p. 218");
  });

  it("fails closed when the D1 book state cannot be read", async () => {
    analytics.getFatmanBookState.mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(isFatmanReady(env)).resolves.toBe(false);
    expect(search).not.toHaveBeenCalled();
  });
});
