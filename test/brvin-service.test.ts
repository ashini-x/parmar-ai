import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrvinProjectStatusForClient, retrieveBrvinForClient } from "../src/brvin/service-core";

describe("BRVIN private application retrieval", () => {
  const project = { id: "project-fatman", name: "Fatman", slug: "fatman" };
  const bookId = "11111111-2222-4333-8444-555555555555";
  const sources = [{
    id: bookId,
    title: "Constitution of India",
    search_prefix: "brvin/books/" + bookId + "/pages/",
    page_count: 538,
  }];
  const search = vi.fn();
  let exactPageItem: { id: string; key: string; status: string; metadata?: Record<string, unknown> } | null = null;
  const pageList = vi.fn(async (options?: { search?: string }) => ({
    result: exactPageItem && options?.search === exactPageItem.key ? [exactPageItem] : [],
  }));
  const pageDownload = vi.fn(async () => {
    const text = "Page 200 explains the separation of powers. Legislative, executive and judicial functions are distributed to prevent concentration of power.";
    return { contentType: "text/plain", size: text.length, body: new Blob([text]).stream() };
  });

  const makeEnv = (clientProject: typeof project | null = project) => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM brvin_service_clients")) return clientProject;
          if (sql.includes("INSERT INTO fatman_search_usage")) return { query_count: 1 };
          if (sql.includes("SELECT query_count FROM fatman_search_usage")) return { query_count: 1 };
          return null;
        }),
        all: vi.fn(async () => ({ results: sources })),
      })),
    }));
    return {
      DB: { prepare },
      BRVIN_SEARCH: { get: () => ({
        search,
        items: {
          list: pageList,
          get: () => ({ info: vi.fn(async () => exactPageItem), download: pageDownload }),
        },
      }) },
      BRVIN_SEARCH_INSTANCE: "shared-index",
      BRVIN_MIN_SCORE: "0.2",
      BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT: "800",
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    exactPageItem = null;
    search.mockResolvedValue({
      chunks: [{
        id: "allowed-page-14",
        text: "Article 14 guarantees equality before the law and equal protection of the laws.",
        score: 0.91,
        item: { key: "brvin/books/" + bookId + "/pages/page-000014.txt" },
      }],
    });
  });

  it("resolves only the service-bound client identity and reports readiness", async () => {
    const env = makeEnv();
    const status = await getBrvinProjectStatusForClient(env, "fatman");
    expect(status).toEqual({ ok: true, ready: true, authorizedSourceCount: 1 });
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("brvin_service_clients"));
  });

  it("fails closed for an unregistered application before searching", async () => {
    const env = makeEnv(null);
    const result = await retrieveBrvinForClient(env, "unregistered-app", {
      queries: ["Article 14 equality"],
    });
    expect(result).toMatchObject({ ok: false, code: "CLIENT_NOT_REGISTERED", retryable: false });
    expect(search).not.toHaveBeenCalled();
  });

  it("retrieves an explicitly requested PDF page by its authorised exact item key", async () => {
    const env = makeEnv();
    const exactKey = sources[0].search_prefix + "page-000200.txt";
    exactPageItem = { id: "exact-page-200", key: exactKey, status: "completed", metadata: { printedPage: "184" } };

    const result = await retrieveBrvinForClient(env, "fatman", {
      queries: ["Please explain the concept in simple language on page 200"],
      pageNumbers: [200],
    });

    expect(result).toMatchObject({ ok: true, searchCount: 0, searchedSources: 1 });
    if (!result.ok) throw new Error("Expected exact page retrieval.");
    expect(result.passages).toEqual([
      expect.objectContaining({
        id: "exact-page-200",
        bookId,
        bookTitle: "Constitution of India",
        pdfPage: 200,
        printedPage: "184",
        text: expect.stringContaining("separation of powers"),
      }),
    ]);
    expect(pageList).toHaveBeenCalledWith(expect.objectContaining({ search: exactKey }));
    expect(pageDownload).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  it("pre-filters to the mapped project's folder and returns verified page evidence", async () => {
    const env = makeEnv();
    const result = await retrieveBrvinForClient(env, "fatman", {
      queries: ["Article 14 equality"],
    });
    expect(result).toMatchObject({ ok: true, searchedSources: 1, searchCount: 1 });
    if (!result.ok) throw new Error("Expected successful retrieval.");
    expect(result.passages).toEqual([
      expect.objectContaining({ bookId, bookTitle: "Constitution of India", pdfPage: 14 }),
    ]);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      ai_search_options: {
        retrieval: {
          max_num_results: 50,
          retrieval_type: "hybrid",
          filters: { folder: { $in: [sources[0].search_prefix] } },
        },
      },
    }));
  });
});
