import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  fatmanIndexStatus: vi.fn(),
  fatmanUploadStatus: vi.fn(),
}));

vi.mock("../src/fatman/admin", () => ({
  fatmanIndexStatus: sources.fatmanIndexStatus,
}));

vi.mock("../src/fatman/import", () => ({
  fatmanUploadStatus: sources.fatmanUploadStatus,
}));

import { fatmanMonitorPage, fatmanMonitorStatus } from "../src/fatman/monitor";

function response(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Fatman live monitor", () => {
  const env = { FATMAN_DOCUMENT_VERSION: "fatman-test-v1" } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    const pages = [
      { page: 1, status: "completed" },
      { page: 2, status: "running" },
      { page: 3, status: "queued" },
      { page: 4, status: "error", error: "Index rejected page text." },
    ];
    sources.fatmanIndexStatus.mockResolvedValue(response({
      ok: true,
      exists: true,
      enabled: false,
      expectedPages: 538,
      pages,
    }));
    sources.fatmanUploadStatus.mockResolvedValue(response({
      ok: true,
      import: {
        id: "import-123",
        status: "processing",
        expectedSize: 1000,
        uploadedBytes: 1000,
        indexedPages: 0,
        expectedPages: 538,
        hasVisionOperation: true,
        workflowInstanceId: "workflow-123",
      },
      pipeline: {
        vision: { status: "completed", operation: "operations/vision-123" },
        workflow: { status: "running", id: "workflow-123" },
      },
      bucketConfigured: true,
      serviceAccountEmail: "worker@example.test",
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns exact page states, missing ranges and live pipeline state", async () => {
    const responseValue = await fatmanMonitorStatus(env);
    const result = await responseValue.json() as any;

    expect(responseValue.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.expectedPages).toBe(538);
    expect(result.pages).toHaveLength(538);
    expect(result.progress.counts).toEqual({
      completed: 1,
      running: 1,
      queued: 1,
      failed: 1,
      missing: 534,
    });
    expect(result.progress.completedPages).toBe(1);
    expect(result.progress.remainingPages).toBe(537);
    expect(result.progress.submittedPages).toBe(4);
    expect(result.progress.notSubmittedPages).toBe(534);
    expect(result.progress.highestContiguousCompletedPage).toBe(1);
    expect(result.progress.completionPercent).toBe(0.2);
    expect(result.pages[3]).toMatchObject({
      page: 4,
      status: "error",
      error: "Index rejected page text.",
    });
    expect(result.pages[4]).toEqual({ page: 5, status: "missing" });
    expect(result.missingRanges[0]).toEqual({ start: 5, end: 538 });
    expect(result.failedPages).toHaveLength(1);
    expect(result.import.id).toBe("import-123");
    expect(result.pipeline.vision.status).toBe("completed");
    expect(result.pipeline.workflow.status).toBe("running");
    expect(result.documentVersion).toBe("fatman-test-v1");
    expect(result.qa).toBeNull();
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(sources.fatmanUploadStatus).toHaveBeenCalledWith(env, null, true);
  });

  it("deduplicates page records by preferring the strongest recorded state", async () => {
    sources.fatmanIndexStatus.mockResolvedValue(response({
      ok: true,
      exists: true,
      enabled: false,
      expectedPages: 538,
      pages: [
        { page: 1, status: "running" },
        { page: 1, status: "completed" },
        { page: 2, status: "error", error: "Old failed record" },
        { page: 2, status: "queued" },
      ],
    }));

    const result = await (await fatmanMonitorStatus(env)).json() as any;

    expect(result.pages[0].status).toBe("completed");
    expect(result.pages[1].status).toBe("queued");
    expect(result.progress.counts.completed).toBe(1);
    expect(result.progress.counts.queued).toBe(1);
    expect(result.progress.counts.failed).toBe(0);
  });

  it("surfaces index-status failures instead of presenting stale zero progress as live", async () => {
    sources.fatmanIndexStatus.mockResolvedValue(response({
      ok: false,
      error: "AI Search is temporarily unavailable.",
    }, 502));

    const responseValue = await fatmanMonitorStatus(env);
    const result = await responseValue.json() as any;

    expect(responseValue.status).toBe(502);
    expect(result).toEqual({
      ok: false,
      error: "AI Search is temporarily unavailable.",
    });
  });

  it("renders a separate monitor page with live refresh, controls and the page map", async () => {
    const page = fatmanMonitorPage();
    const html = await page.text();

    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("/admin/api/fatman/monitor");
    expect(html).toContain("setInterval(refresh,10000)");
    expect(html).toContain("Pause auto-refresh");
    expect(html).toContain("Page-by-page map");
    expect(html).toContain("Not submitted yet");
    expect(html).toContain("Google Vision OCR");
    expect(html).toContain("Cloudflare Workflow");
    expect(html).toContain("Real-user release QA");
    expect(html).toContain("/admin/api/fatman/qa");
    expect(html).toContain("Run QA now");
    expect(html).toContain("pdfTransferComplete");
    expect(html).toContain("server-side supervisor coordinates page indexing");
  });
});
