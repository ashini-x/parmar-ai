import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import type { FatmanImportJob } from "../src/fatman/import";
import {
  backfillBrvinM14CorpusFromStoredVision,
} from "../src/brvin/m14-vision-backfill";
import {
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
} from "../src/fatman/import";

const SOURCE_ID = "00000000-0000-4000-8000-000000000703";
const SOURCE_SHA = "e".repeat(64);
const OPERATION = "projects/test-gcp-project/operations/physics-pilot-ocr";
const PAGE_COUNT = 3;

function makeJob(): FatmanImportJob {
  return {
    id: SOURCE_ID,
    book_id: SOURCE_ID,
    book_title: "Force and Laws of Motion - Class IX pilot handout",
    source_object: "brvin/source-pdfs/" + SOURCE_ID + "/source.pdf",
    source_sha256: SOURCE_SHA,
    expected_size: 1234,
    uploaded_bytes: 1234,
    upload_session_uri: null,
    status: "completed",
    vision_operation: OPERATION,
    workflow_instance_id: "workflow-physics-pilot",
    indexed_pages: PAGE_COUNT,
    error_message: null,
    created_at: 1,
    updated_at: 2,
    page_count: PAGE_COUNT,
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: "staging",
    GCP_PROJECT_ID: "test-gcp-project",
    FATMAN_GCS_BUCKET: "fatman-source-bucket",
    BRVIN_M14_PILOT_ENABLED: "true",
    BRVIN_M14_CORPUS_BUCKET: "brvin-m14-private-corpus",
    ...overrides,
  } as Env;
}

function makeSpec() {
  return {
    sourceId: SOURCE_ID,
    sourcePdfSha256: SOURCE_SHA,
    visionOperationId: OPERATION,
    pageCount: PAGE_COUNT,
  };
}

function makeDependencies(overrides: Record<string, unknown> = {}) {
  const job = makeJob();
  const prefix = fatmanVisionOutputPrefix(job);
  const expectedUri = "gs://fatman-source-bucket/" + prefix;
  const dependencies = {
    getJob: vi.fn(async () => job),
    getVisionOperation: vi.fn(async () => ({
      done: true,
      outputDestinations: [expectedUri],
    })),
    listVisionObjects: vi.fn(async () => ({
      prefix: expectedUri,
      objects: Array.from({ length: PAGE_COUNT }, (_, index) => ({
        name: fatmanOutputObjectName(SOURCE_ID, index + 1, prefix),
        size: "500",
      })),
      truncated: false,
    })),
    readVisionPage: vi.fn(async (_env: Env, _sourceId: string, page: number) => ({
      rawText: page === 2
        ? "Worked example: 4 kg object. F = ma"
        : "Physics OCR text for physical page " + page,
      ...(page === 2 ? { pageConfidence: 0.97 } : {}),
    })),
    persistPage: vi.fn(async (
      _env: Env,
      _job: FatmanImportJob,
      page: number,
      rawText: string,
      _stableItemKey: string,
      _confidence?: number,
      _options?: { storageBucket: string },
    ) => ({
      generationId: "f".repeat(32),
      chunkCount: rawText.length > 30 ? 2 : 1,
      sourceManifestObject: "manifest.json",
      pageManifestObject: "page-" + page + ".json",
      sourceManifestCreated: page === 1,
      pageManifestCreated: true,
    })),
    ...overrides,
  };
  return { job, prefix, expectedUri, dependencies };
}

describe("BRVIN M14 original Vision OCR backfill", () => {
  it("reuses the exact completed Vision operation and writes immutable manifests to a separate pilot bucket", async () => {
    const { prefix, expectedUri, dependencies } = makeDependencies();
    const result = await backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      makeSpec(),
      dependencies as never,
    );

    expect(result).toMatchObject({
      sourceId: SOURCE_ID,
      generationId: "f".repeat(32),
      pageCount: 3,
      sourceBucket: "fatman-source-bucket",
      corpusBucket: "brvin-m14-private-corpus",
      visionOperationId: OPERATION,
    });
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.pages.map((page) => page.pdfPage)).toEqual([1, 2, 3]);
    expect(dependencies.getVisionOperation).toHaveBeenCalledWith(
      expect.anything(), OPERATION, expectedUri,
    );
    expect(dependencies.listVisionObjects).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), PAGE_COUNT + 1,
    );
    expect(dependencies.readVisionPage).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(dependencies.persistPage).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(dependencies.persistPage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      2,
      "Worked example: 4 kg object. F = ma",
      expect.any(String),
      0.97,
      { storageBucket: "brvin-m14-private-corpus" },
    );
    expect(prefix).toBe("brvin/temporary-vision-ocr/" + SOURCE_ID + "/");
    expect(result.pages[0].sourceManifestCreated).toBe(true);
    expect(result.pages[1].sourceManifestCreated).toBe(false);
  });

  it("replays recovered OCR from the isolated M14 bucket and records the new Vision operation", async () => {
    const recoveredOperation = "projects/test-gcp-project/operations/recovered-physics-ocr";
    const outputBucket = "brvin-m14-private-corpus";
    const outputPrefix = "brvin/m14-staging/vision-output/" + SOURCE_ID + "/attempt-001/";
    const recoveredUri = "gs://" + outputBucket + "/" + outputPrefix;
    const { job, dependencies } = makeDependencies({
      getJob: vi.fn(async () => ({ ...makeJob(), vision_operation: recoveredOperation })),
      getVisionOperation: vi.fn(async (_env: Env, operationId: string, expectedUri: string) => {
        expect(operationId).toBe(recoveredOperation);
        expect(expectedUri).toBe(recoveredUri);
        return { done: true, outputDestinations: [recoveredUri] };
      }),
      listVisionObjects: vi.fn(async () => ({
        prefix: recoveredUri,
        objects: Array.from({ length: PAGE_COUNT }, (_, index) => ({
          name: outputPrefix + "output-" + (index + 1) + "-to-" + (index + 1) + ".json",
          size: "500",
        })),
        truncated: false,
      })),
      readVisionPage: vi.fn(async (_env: Env, _sourceId: string, page: number) => ({
        rawText: "Recovered OCR page " + page + " F = ma",
      })),
    });

    const result = await backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      {
        ...makeSpec(),
        visionOperationId: recoveredOperation,
        visionOutputBucket: outputBucket,
        visionOutputPrefix: outputPrefix,
      },
      dependencies as never,
    );

    expect(result.visionOperationId).toBe(recoveredOperation);
    expect(result.corpusBucket).toBe(outputBucket);
    expect(result.pages.map((page) => page.pdfPage)).toEqual([1, 2, 3]);
    expect(dependencies.getVisionOperation).toHaveBeenCalledWith(
      expect.anything(), recoveredOperation, recoveredUri,
    );
    expect(dependencies.persistPage).toHaveBeenCalledTimes(3);
    expect(dependencies.persistPage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ vision_operation: recoveredOperation }),
      1,
      "Recovered OCR page 1 F = ma",
      expect.any(String),
      undefined,
      { storageBucket: outputBucket },
    );
  });

  it("fails closed outside staging or without explicit pilot enablement", async () => {
    const { dependencies } = makeDependencies();
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv({ ENVIRONMENT: "production" }),
      makeSpec(),
      dependencies as never,
    )).rejects.toThrow("staging Worker");
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv({ BRVIN_M14_PILOT_ENABLED: "false" }),
      makeSpec(),
      dependencies as never,
    )).rejects.toThrow("PILOT_ENABLED=true");
    expect(dependencies.getJob).not.toHaveBeenCalled();
  });

  it("requires a distinct M14 corpus bucket and exact registered source/operation provenance", async () => {
    const sourceBucket = makeDependencies();
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv({ BRVIN_M14_CORPUS_BUCKET: "fatman-source-bucket" }),
      makeSpec(),
      sourceBucket.dependencies as never,
    )).rejects.toThrow("separate from the original");

    const wrongSpec = makeSpec();
    wrongSpec.visionOperationId = "projects/test-gcp-project/operations/different-operation";
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      wrongSpec,
      sourceBucket.dependencies as never,
    )).rejects.toThrow("exact completed import");
    expect(sourceBucket.dependencies.getVisionOperation).not.toHaveBeenCalled();
    expect(sourceBucket.dependencies.persistPage).not.toHaveBeenCalled();
  });

  it("rejects incomplete or truncated Vision output sets before reading pages or writing manifests", async () => {
    const incomplete = makeDependencies({
      listVisionObjects: vi.fn(async () => ({
        prefix: "gs://fatman-source-bucket/" + fatmanVisionOutputPrefix(makeJob()),
        objects: [ { name: fatmanOutputObjectName(SOURCE_ID, 1, fatmanVisionOutputPrefix(makeJob())) } ],
        truncated: false,
      })),
    });
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      makeSpec(),
      incomplete.dependencies as never,
    )).rejects.toThrow("exactly one OCR JSON object");
    expect(incomplete.dependencies.readVisionPage).not.toHaveBeenCalled();
    expect(incomplete.dependencies.persistPage).not.toHaveBeenCalled();

    const truncated = makeDependencies({
      listVisionObjects: vi.fn(async () => ({
        prefix: "gs://fatman-source-bucket/" + fatmanVisionOutputPrefix(makeJob()),
        objects: [],
        truncated: true,
      })),
    });
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      makeSpec(),
      truncated.dependencies as never,
    )).rejects.toThrow("listing is truncated");
    expect(truncated.dependencies.persistPage).not.toHaveBeenCalled();
  });

  it("rejects an unfinished or wrong-destination Vision operation without re-submitting OCR", async () => {
    const pending = makeDependencies({
      getVisionOperation: vi.fn(async () => ({ done: false })),
    });
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      makeSpec(),
      pending.dependencies as never,
    )).rejects.toThrow("not complete");
    expect(pending.dependencies.persistPage).not.toHaveBeenCalled();

    const wrongDestination = makeDependencies({
      getVisionOperation: vi.fn(async () => ({
        done: true,
        outputDestinations: ["gs://another-bucket/unrelated/"],
      })),
    });
    await expect(backfillBrvinM14CorpusFromStoredVision(
      makeEnv(),
      makeSpec(),
      wrongDestination.dependencies as never,
    )).rejects.toThrow("did not report");
    expect(wrongDestination.dependencies.readVisionPage).not.toHaveBeenCalled();
    expect(wrongDestination.dependencies.persistPage).not.toHaveBeenCalled();
  });
});
