import { beforeEach, describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/analytics/db", () => ({
  ensureAnalyticsSchema: ensure,
  getFatmanBookState: vi.fn(),
  recordBrvinActivity: vi.fn(),
  setFatmanBookState: vi.fn(),
}));

import {
  retrieveBrvinProjectContext,
  BrvinRetrievalError,
  extractBrvinEvidenceExcerpt,
  isBrvinPassageRelevant,
} from "../src/brvin/retrieval";
import { brvinAdminPage, brvinAdminScript } from "../src/brvin/admin";

describe("BRVIN governed retrieval", () => {
  const project = { id: "project-a", name: "Project A", slug: "project-a" };
  const bookId = "11111111-2222-4333-8444-555555555555";
  const grants: Array<{ id: string; title: string; search_prefix: string }> = [];
  const search = vi.fn();
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => sql.includes("FROM brvin_projects") ? project : null),
        all: vi.fn(async () => ({ results: grants })),
      })),
    })),
  };
  const env = {
    DB: db,
    FATMAN_MIN_SCORE: "0.2",
    FATMAN_INSTANCE_NAME: "shared-index",
    FATMAN_SEARCH: { get: () => ({ search }) },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    grants.splice(0, grants.length);
    search.mockResolvedValue({ chunks: [] });
  });

  it("fails closed when a project has no assigned, verified knowledge sources", async () => {
    const context = await retrieveBrvinProjectContext(env, "project-a", "Article 14 equality");
    expect(context.passages).toEqual([]);
    expect(context.searchedSources).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it("searches only the project's explicitly granted source prefixes", async () => {
    grants.push({
      id: bookId, title: "Constitution of India",
      search_prefix: "brvin/books/" + bookId + "/pages/",
    });
    search.mockResolvedValue({
      chunks: [
        {
          id: "allowed-page-14",
          text: "Article 14 guarantees equality before the law and equal protection of the laws.",
          score: 0.99,
          scoring_details: { vector_score: 0.88, keyword_score: 3.1, reranking_score: 0.91 },
          item: { key: "brvin/books/" + bookId + "/pages/page-000014.txt" },
        },
        {
          id: "weak-rerank-page-15",
          text: "Article 14 guarantees equality before the law and equal protection of the laws.",
          score: 0.99,
          scoring_details: { vector_score: 0.96, keyword_score: 8.4, reranking_score: 0.38 },
          item: { key: "brvin/books/" + bookId + "/pages/page-000015.txt" },
        },
        {
          id: "unauthorized-page",
          text: "Article 14 equality before law from a book not assigned to this project.",
          score: 0.99,
          item: { key: "brvin/books/22222222-2222-4333-8444-555555555555/pages/page-000014.txt" },
        },
        {
          id: "other-index",
          text: "Article 14 guarantees equality before the law.",
          score: 0.99,
          item: { key: "other/pages/page-000014.txt" },
        },
      ],
    });

    const context = await retrieveBrvinProjectContext(env, "project-a", "Article 14 equality");
    expect(context.searchedSources).toBe(1);
    expect(context.passages).toEqual([
      expect.objectContaining({
        id: "allowed-page-14", bookId, bookTitle: "Constitution of India", pdfPage: 14,
        score: 0.91,
      }),
    ]);
    expect(search).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Article 14 equality" }],
      ai_search_options: {
        cache: { enabled: false },
        retrieval: {
          max_num_results: 16,
          match_threshold: 0.3,
          retrieval_type: "hybrid",
          filters: { folder: { $in: ["brvin/books/" + bookId + "/pages/"] } },
        },
        reranking: {
          enabled: true,
          model: "@cf/baai/bge-reranker-base",
          match_threshold: 0.15,
        },
      },
    });
  });

  it("uses meaningful-term relevance and evidence windows from long OCR pages", () => {
    const query = "drainage overflow drawdown";
    const longPage = ("Background description without relevant terms. ").repeat(180) +
      "Drainage overflow inspection confirms the drawdown period and the required outlet checks.";
    expect(isBrvinPassageRelevant(query, longPage)).toBe(true);
    const excerpt = extractBrvinEvidenceExcerpt(query, longPage);
    expect(excerpt).toContain("Drainage");
    expect(excerpt).toContain("drawdown");
    expect(excerpt.length).toBeLessThanOrEqual(1_800);
    expect(isBrvinPassageRelevant(query, "Unrelated historical introduction without those details.")).toBe(false);
  });

  it("keeps ordinal law terms and rejects a neighbouring-law mismatch", () => {
    expect(isBrvinPassageRelevant(
      "Newton's second law",
      "Newton's second law states that net force equals mass multiplied by acceleration.",
    )).toBe(true);
    expect(isBrvinPassageRelevant(
      "Newton's second law",
      "Newton's first law explains inertia and an object's resistance to changes in motion.",
    )).toBe(false);
  });

  it("selects a focused evidence window and bounds even a short-page excerpt", () => {
    const query = "force mass acceleration";
    const content = ("Unrelated background text with no matching scientific terms. ").repeat(42) +
      "For a constant mass, net force equals mass multiplied by acceleration.";
    const excerpt = extractBrvinEvidenceExcerpt(query, content);
    expect(excerpt).toContain("net force equals mass");
    expect(excerpt.length).toBeLessThanOrEqual(1_800);
    expect(excerpt.length).toBeLessThan(content.length);
  });

  it("returns the strongest concept-matching PDF page after reranking, not every page with overlapping terms", async () => {
    const prefix = "brvin/books/" + bookId + "/pages/";
    grants.push({ id: bookId, title: "Newton's Laws", search_prefix: prefix });
    search.mockResolvedValue({
      chunks: [
        {
          id: "page-1-inertia",
          text: "Newton's first law explains inertia. A force can change an object's speed or direction. A 1 N force gives a 1 kg object acceleration.",
          score: 0.98,
          scoring_details: { vector_score: 0.92, reranking_score: 0.31 },
          item: { key: prefix + "page-000001.txt" },
        },
        {
          id: "page-2-second-law",
          text: "Newton's second law relates net force, mass and acceleration. For an object of constant mass, acceleration is in the direction of the net force. A larger net force produces a larger acceleration; for the same net force, a larger mass produces a smaller acceleration. Fnet = m x a.",
          score: 0.86,
          scoring_details: { vector_score: 0.78, keyword_score: 4.2, reranking_score: 0.93 },
          item: { key: prefix + "page-000002.txt" },
        },
        {
          id: "page-3-worked-example",
          text: "Worked example: a box is pulled horizontally. Find the net force and calculate acceleration using the second law. The final result is 3 metres per second squared.",
          score: 0.97,
          scoring_details: { vector_score: 0.90, reranking_score: 0.38 },
          item: { key: prefix + "page-000003.txt" },
        },
      ],
    });

    const context = await retrieveBrvinProjectContext(
      env,
      "project-a",
      "How does Newton's second law relate force, mass and acceleration?",
    );

    expect(context.passages).toHaveLength(1);
    expect(context.passages[0]).toEqual(expect.objectContaining({
      id: "page-2-second-law",
      pdfPage: 2,
      score: 0.93,
    }));
    expect(context.passages[0].text).toContain("a larger mass produces a smaller acceleration");
  });

  it("allows a strong cross-encoder match when the evidence uses semantically related wording", async () => {
    grants.push({
      id: bookId,
      title: "Newton's Laws",
      search_prefix: "brvin/books/" + bookId + "/pages/",
    });
    search.mockResolvedValue({
      chunks: [{
        id: "paraphrased-second-law",
        text: "The resultant force on a body equals its inertia multiplied by the rate of change in velocity.",
        score: 0.72,
        scoring_details: { vector_score: 0.67, reranking_score: 0.91 },
        item: { key: "brvin/books/" + bookId + "/pages/page-000002.txt" },
      }],
    });

    const context = await retrieveBrvinProjectContext(
      env,
      "project-a",
      "How does Newton's second law relate force, mass and acceleration?",
    );

    expect(context.passages).toHaveLength(1);
    expect(context.passages[0]).toEqual(expect.objectContaining({
      id: "paraphrased-second-law",
      pdfPage: 2,
      score: 0.91,
    }));
  });

  it("does not expose content for an inactive or unknown project", async () => {
    db.prepare.mockImplementationOnce((sql: string) => ({
      bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }),
    }) as any);
    await expect(retrieveBrvinProjectContext(env, "unknown", "Article 14"))
      .rejects.toBeInstanceOf(BrvinRetrievalError);
    expect(search).not.toHaveBeenCalled();
  });

  it("renders an administrator-only BRVIN knowledge and operations console", async () => {
    const page = brvinAdminPage();
    const html = await page.text();
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('<script src="/admin/brvin/app.js" defer></script>');
    expect(html).not.toContain('<script type="module">');
    const scriptResponse = brvinAdminScript();
    expect(scriptResponse.headers.get("content-type")).toContain("application/javascript");
    const script = await scriptResponse.text();
    expect(script).toContain("BRVIN dashboard startup failed");
    expect(script).toContain("await refresh()");
    expect(html).toContain("BRVIN");
    expect(script).toContain("/admin/api/brvin/");
    expect(html).not.toContain("Add to VRAIN");
    expect(html).toContain("Knowledge collections");
    expect(html).toContain("Live operations");
    expect(html).toContain("Specialist activity");
    expect(html).toContain("Auto-refresh while a source is deleting");
    expect(html).toContain("Run read-only storage check");
    expect(html).toContain('id="storage-diagnostics"');
    expect(html).toContain("Operational summary");
    expect(html).toContain("Administrator runbook");
    expect(script).toContain("runStorageDiagnostics");
    expect(script).toContain("retentionLifecycleMissingPermissions");
    expect(script).toContain("Retry Vision OCR cleanup");
    expect(script).toContain("shared by all granted apps");
    expect(html).toContain('id="event-filter"');
    expect(script).toContain('$("event-filter").addEventListener("change"');
    expect(html).toContain("project access");
    expect(script).toContain('const previousCollectionId=$("collection").value;');
    expect(script).toContain("data-project-grant-revoke");
    expect(script).toContain("data-project-book-access");
    expect(script).toContain("data-project-collection-access");
    expect(script).toContain("Manage direct grants");
    expect(script).toContain("Manage collection grants");
    expect(script).toContain("data-app-grant");
    expect(script).toContain("user-to-project");
    expect(script).toContain("Grant application access");
    expect(html).toContain("Application grants are app-wide, not teacher-user-specific.");
    expect(script).toContain('c.id==="general"');
    expect(script).toContain("countSimplePdfPages(buffer)");
    expect(script).toContain("The operation paused during ");
    expect(script).not.toContain('import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"');
    expect(script).toContain('const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")');
  });
});
