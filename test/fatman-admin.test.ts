import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  getFatmanBookState: vi.fn(),
  reserveFatmanSearchQuery: vi.fn(),
  setFatmanBookState: vi.fn(),
}));

vi.mock("../src/analytics/db", () => analytics);

import {
  finalizeFatmanIndex,
  prepareFatmanIndex,
  previewFatmanIndex,
  uploadFatmanPage,
} from "../src/fatman/admin";

describe("Fatman admin retrieval gate", () => {
  const pageItems = Array.from({ length: 538 }, (_, index) => ({
    id: "item-" + (index + 1),
    key: "fatman/pages/page-" + String(index + 1).padStart(6, "0") + ".jpg",
    status: "completed",
  }));
  const itemsList = vi.fn();
  const itemsUploadAndPoll = vi.fn();
  const itemsGetInfo = vi.fn();
  const search = vi.fn();
  const namespaceList = vi.fn();
  const namespaceCreate = vi.fn();
  const instanceUpdate = vi.fn();
  const instance = {
    items: {
      list: itemsList,
      uploadAndPoll: itemsUploadAndPoll,
      get: (itemId: string) => ({ info: () => itemsGetInfo(itemId) }),
    },
    search,
    update: instanceUpdate,
  };
  const env = {
    FATMAN_SEARCH: {
      list: namespaceList,
      get: () => instance,
      create: namespaceCreate,
    },
    FATMAN_INSTANCE_NAME: "fatman-test",
    FATMAN_DOCUMENT_VERSION: "fatman-test-v1",
    FATMAN_MONTHLY_QUERY_LIMIT: "800",
    DB: {},
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    namespaceList.mockResolvedValue({ result: [{ id: "fatman-test" }] });
    namespaceCreate.mockResolvedValue(instance);
    instanceUpdate.mockResolvedValue(undefined);
    itemsUploadAndPoll.mockResolvedValue({ id: "new-page", key: "fatman/pages/page-000001.jpg", status: "completed" });
    itemsGetInfo.mockResolvedValue({ id: "pending-page", key: "fatman/pages/page-000001.jpg", status: "completed" });
    itemsList.mockImplementation(async (options: { page?: number }) => {
      const page = options.page ?? 1;
      return {
        result: pageItems.slice((page - 1) * 50, page * 50),
        result_info: { total_pages: 11 },
      };
    });
    search.mockResolvedValue({
      chunks: [{
        id: "passage-123",
        key: "fatman/pages/page-000123.jpg",
        text: "Verified source passage.",
        score: 0.76,
        item: { key: "fatman/pages/page-000123.jpg" },
      }],
    });
    analytics.getFatmanBookState.mockResolvedValue({
      enabled: false,
      documentVersion: "",
      indexedPages: 0,
    });
    analytics.reserveFatmanSearchQuery.mockResolvedValue({ allowed: true, queryCount: 1 });
    analytics.setFatmanBookState.mockResolvedValue(undefined);
  });

  it("surfaces asynchronous Cloudflare OCR failures and stops accepting the page", async () => {
    itemsList.mockResolvedValue({ result: [] });
    itemsUploadAndPoll.mockResolvedValue({
      id: "failed-page",
      key: "fatman/pages/page-000001.jpg",
      status: "error",
      error: "page_limit_reached: Free AI Search image processing is unavailable",
    });
    const request = new Request("https://worker.test/admin/api/fatman/page/1", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    const response = await uploadFatmanPage(env, request, 1);
    const result = await response.json() as any;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      ok: false,
      page: 1,
      status: "error",
      error: "page_limit_reached: Free AI Search image processing is unavailable",
    });
    expect(itemsUploadAndPoll).toHaveBeenCalledTimes(1);
  });

  it("keeps OCR enabled when preparing an existing scanned-book index", async () => {
    const response = await prepareFatmanIndex(env);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.expectedPages).toBe(538);
    expect(instanceUpdate).toHaveBeenCalledWith({
      indexing_options: { use_ocr: true },
      index_method: { vector: true, keyword: true },
    });
    expect(namespaceCreate).not.toHaveBeenCalled();
  });

  it("creates a new scanned-book index with OCR enabled", async () => {
    namespaceList.mockResolvedValue({ result: [] });
    const response = await prepareFatmanIndex(env);

    expect(response.status).toBe(200);
    expect(namespaceCreate).toHaveBeenCalledWith({
      id: "fatman-test",
      indexing_options: { use_ocr: true },
      index_method: { vector: true, keyword: true },
    });
  });

  it("returns preview passages with their exact PDF page", async () => {
    const request = new Request("https://worker.test/admin/api/fatman/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "  Battle   of Plassey " }),
    });

    const response = await previewFatmanIndex(env, request);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.results).toEqual([
      { page: 123, text: "Verified source passage.", score: 0.76 },
    ]);
    expect(search).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Battle of Plassey" }],
      ai_search_options: { retrieval: { max_num_results: 5, retrieval_type: "hybrid" } },
    });
  });

  it("refuses previews until all 538 pages are complete", async () => {
    const incompleteItems = pageItems.slice(0, -1);
    itemsList.mockImplementation(async (options: { page?: number }) => {
      const page = options.page ?? 1;
      return {
        result: incompleteItems.slice((page - 1) * 50, page * 50),
        result_info: { total_pages: 11 },
      };
    });
    const request = new Request("https://worker.test/admin/api/fatman/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Plassey" }),
    });

    const response = await previewFatmanIndex(env, request);

    expect(response.status).toBe(409);
    expect(search).not.toHaveBeenCalled();
    expect(analytics.reserveFatmanSearchQuery).not.toHaveBeenCalled();
  });

  it("requires explicit review before enabling and verifies all page states", async () => {
    const unreviewed = new Request("https://worker.test/admin/api/fatman/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewedQueries: ["one", " one ", "two"] }),
    });
    expect((await finalizeFatmanIndex(env, unreviewed)).status).toBe(400);
    expect(analytics.setFatmanBookState).not.toHaveBeenCalled();

    const reviewed = new Request("https://worker.test/admin/api/fatman/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewedQueries: ["Battle of Plassey", "Permanent Settlement", "Mansabdari system"] }),
    });
    const response = await finalizeFatmanIndex(env, reviewed);

    expect(response.status).toBe(200);
    expect(analytics.setFatmanBookState).toHaveBeenCalledWith(env, {
      enabled: true,
      documentVersion: "fatman-test-v1",
      indexedPages: 538,
    });
  });
});
