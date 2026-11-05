import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAnalyticsSchema: vi.fn(async () => undefined),
  recordBrvinActivity: vi.fn(async () => undefined),
  ensureFatmanVisionLifecycleRule: vi.fn(async () => ({
    configured: true as const,
    created: false,
    prefix: "brvin/temporary-vision-ocr/",
    ageDays: 30,
  })),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

vi.mock("../src/analytics/db", () => ({
  ensureAnalyticsSchema: mocks.ensureAnalyticsSchema,
  recordBrvinActivity: mocks.recordBrvinActivity,
  setFatmanBookState: vi.fn(),
}));

vi.mock("../src/fatman/import", () => ({
  cleanupFatmanGcsObjects: vi.fn(),
  deleteFatmanGcsObjectPrefix: vi.fn(),
  ensureFatmanVisionLifecycleRule: mocks.ensureFatmanVisionLifecycleRule,
  fatmanImportObjectPrefix: vi.fn(),
  getFatmanImportJob: vi.fn(),
  getFatmanVisionOperation: vi.fn(),
  listFatmanIndexPages: vi.fn(),
  markFatmanImportCompleted: vi.fn(),
  markFatmanImportFailed: vi.fn(),
  readFatmanVisionOutput: vi.fn(),
  resumeFatmanImport: vi.fn(),
  setFatmanImportStatus: vi.fn(),
  submitFatmanVision: vi.fn(),
  updateFatmanImportProgress: vi.fn(),
}));

vi.mock("../src/fatman/recovery-policy", () => ({
  FATMAN_PAGE_RETRY_LIMIT: 12,
  fatmanPageRetryDelay: vi.fn(),
  isTransientFatmanIndexError: vi.fn(),
  shouldPauseAutomaticVisionCleanupRetry: vi.fn(() => false),
}));

vi.mock("../src/fatman/release-qa-runner", () => ({
  runFatmanReleaseQaForEnv: vi.fn(),
}));
vi.mock("../src/fatman/quality", () => ({
  buildFatmanBookVerificationPages: vi.fn(),
  buildFatmanRetrievalProbes: vi.fn(),
  FATMAN_VERIFICATION_PAGES: [],
  isRetryableFatmanQualityFailure: vi.fn(),
}));
vi.mock("../src/fatman/retrieval", () => ({
  retrieveFatmanContext: vi.fn(),
}));
vi.mock("../src/auth/google", () => ({
  getGoogleAccessToken: vi.fn(),
}));
vi.mock("../src/fatman/library", () => ({
  fatmanExpectedPageCount: vi.fn(),
  fatmanIndexPageKey: vi.fn(),
}));

import { runBrvinVisionRetentionSupervisor } from "../src/fatman/workflow";

function createEmptyDb() {
  const statement: any = {
    bind: vi.fn(),
    all: vi.fn(async () => ({ results: [] })),
    first: vi.fn(async () => null),
    run: vi.fn(async () => ({ meta: { changes: 0 } })),
  };
  statement.bind.mockImplementation(() => statement);
  return {
    db: { prepare: vi.fn(() => statement) },
    statement,
  };
}

describe("BRVIN Vision OCR retention supervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAnalyticsSchema.mockResolvedValue(undefined);
    mocks.recordBrvinActivity.mockResolvedValue(undefined);
    mocks.ensureFatmanVisionLifecycleRule.mockResolvedValue({
      configured: true,
      created: false,
      prefix: "brvin/temporary-vision-ocr/",
      ageDays: 30,
    });
  });

  it("verifies the lifecycle rule even when no cleanup candidates are pending", async () => {
    const { db, statement } = createEmptyDb();

    const result = await runBrvinVisionRetentionSupervisor({
      DB: db,
      FATMAN_IMPORT: {} as any,
    } as any);

    expect(result).toMatchObject({
      scanned: 0,
      started: 0,
      deferred: 0,
      paused: 0,
      lifecycleRule: "verified",
    });
    expect(statement.all).toHaveBeenCalledOnce();
    expect(mocks.ensureFatmanVisionLifecycleRule).toHaveBeenCalledOnce();
    expect(mocks.recordBrvinActivity).not.toHaveBeenCalled();
  });

  it("records a retention warning when lifecycle verification fails and there are no candidates", async () => {
    const { db, statement } = createEmptyDb();
    mocks.ensureFatmanVisionLifecycleRule.mockRejectedValueOnce(new Error("storage.buckets.get denied"));

    const result = await runBrvinVisionRetentionSupervisor({
      DB: db,
      FATMAN_IMPORT: {} as any,
    } as any);

    expect(result.scanned).toBe(0);
    expect(result.lifecycleRule).toContain("deferred:");
    expect(statement.first).toHaveBeenCalledOnce();
    expect(mocks.recordBrvinActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "storage.vision_ocr_expiry_configuration_deferred",
      status: "warning",
    }));
  });
});
