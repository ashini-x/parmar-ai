import { beforeEach, describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/analytics/db", () => ({
  ensureAnalyticsSchema: ensure,
  getFatmanBookState: vi.fn(),
  recordBrvinActivity: vi.fn(),
  setFatmanBookState: vi.fn(),
}));

import { retrieveBrvinProjectContext, BrvinRetrievalError } from "../src/brvin/retrieval";
import { brvinAdminPage } from "../src/brvin/admin";

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
          score: 0.91,
          item: { key: "brvin/books/" + bookId + "/pages/page-000014.txt" },
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
      }),
    ]);
    expect(search).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Article 14 equality" }],
      ai_search_options: { retrieval: { max_num_results: 50, retrieval_type: "hybrid" } },
    });
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
    expect(html).toContain("BRVIN");
    expect(html).toContain("/admin/api/brvin/");
    expect(html).not.toContain("Add to VRAIN");
    expect(html).toContain("Knowledge collections");
    expect(html).toContain("Live operations");
    expect(html).toContain("Specialist activity");
    expect(html).toContain("5-second refresh");
    expect(html).toContain("project access");
    expect(html).toContain('const previousCollectionId=$("collection").value;');
    expect(html).toContain('c.id==="general"');
    expect(html).toContain("countSimplePdfPages(buffer)");
    expect(html).toContain("The operation paused during ");
    expect(html).not.toContain('import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"');
    expect(html).toContain('const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")');
  });
});
