import type { Env } from "../config/env";
import {
  fatmanIndexPageKey,
} from "../fatman/library";
import type {
  FatmanImportJob,
  FatmanVisionOcrPage,
  FatmanVisionOperationResult,
} from "../fatman/import";
import {
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
  getFatmanImportJob,
  getFatmanVisionOperation,
  gcsBucketName,
  listFatmanVisionOutputObjects,
  readFatmanVisionOutputPage,
} from "../fatman/import";
import { persistBrvinPageCorpus } from "./corpus-store";

export interface BrvinM14VisionBackfillSpec {
  sourceId: string;
  sourcePdfSha256: string;
  visionOperationId: string;
  pageCount: number;
}

export interface BrvinM14VisionBackfillResult {
  sourceId: string;
  generationId: string;
  pageCount: number;
  chunkCount: number;
  sourceBucket: string;
  corpusBucket: string;
  visionOperationId: string;
  pages: Array<{
    pdfPage: number;
    stableItemKey: string;
    chunkCount: number;
    sourceManifestCreated: boolean;
    pageManifestCreated: boolean;
  }>;
}

interface VisionOutputListing {
  prefix: string;
  objects: Array<{ name: string; size?: string; timeCreated?: string }>;
  truncated: boolean;
}

interface BackfillDependencies {
  getJob(env: Env, sourceId: string): Promise<FatmanImportJob | null>;
  getVisionOperation(env: Env, operationId: string, expectedOutputUri: string): Promise<FatmanVisionOperationResult>;
  listVisionObjects(env: Env, job: FatmanImportJob, maxObjects: number): Promise<VisionOutputListing>;
  readVisionPage(env: Env, sourceId: string, page: number): Promise<FatmanVisionOcrPage>;
  persistPage(
    env: Env,
    job: FatmanImportJob,
    page: number,
    rawText: string,
    stableItemKey: string,
    pageConfidence: number | undefined,
    options: { storageBucket: string },
  ): ReturnType<typeof persistBrvinPageCorpus>;
}

const defaultDependencies: BackfillDependencies = {
  getJob: getFatmanImportJob,
  getVisionOperation: getFatmanVisionOperation,
  listVisionObjects: listFatmanVisionOutputObjects,
  readVisionPage: readFatmanVisionOutputPage,
  persistPage: persistBrvinPageCorpus,
};

function validBucketName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u.test(value);
}

/**
 * Backfill M14 manifests from the original completed Vision output. This path
 * never uploads a PDF or submits another OCR request. It is deliberately
 * locked to a staging Worker, an explicit pilot opt-in and a separate derived
 * corpus bucket so it cannot write manifests into the production corpus.
 */
export async function backfillBrvinM14CorpusFromStoredVision(
  env: Env,
  spec: BrvinM14VisionBackfillSpec,
  dependencies: Partial<BackfillDependencies> = {},
): Promise<BrvinM14VisionBackfillResult> {
  const deps: BackfillDependencies = { ...defaultDependencies, ...dependencies };
  if (env.ENVIRONMENT !== "staging") {
    throw new Error("M14 Vision backfill is allowed only from the staging Worker environment.");
  }
  if (env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("M14 Vision backfill requires BRVIN_M14_PILOT_ENABLED=true.");
  }
  if (!/^[a-f0-9-]{36}$/iu.test(spec.sourceId) ||
      !/^[a-f0-9]{64}$/iu.test(spec.sourcePdfSha256) ||
      !spec.visionOperationId.trim() ||
      !Number.isSafeInteger(spec.pageCount) || spec.pageCount < 1 || spec.pageCount > 2_000) {
    throw new Error("The M14 Vision backfill specification is invalid.");
  }

  const sourceBucket = gcsBucketName(env);
  const corpusBucket = env.BRVIN_M14_CORPUS_BUCKET?.trim() ?? "";
  if (!validBucketName(corpusBucket) || corpusBucket === sourceBucket) {
    throw new Error("M14 requires a valid derived-corpus bucket that is separate from the original PDF/Vision bucket.");
  }
  const gcpProjectId = env.GCP_PROJECT_ID?.trim();
  if (!gcpProjectId || !spec.visionOperationId.startsWith("projects/" + gcpProjectId + "/operations/")) {
    throw new Error("The saved Vision operation does not belong to the staging Worker GCP project.");
  }

  const job = await deps.getJob(env, spec.sourceId);
  if (!job || job.id !== spec.sourceId || job.book_id !== spec.sourceId ||
      job.status !== "completed" || Number(job.page_count) !== spec.pageCount ||
      Number(job.indexed_pages) !== spec.pageCount ||
      job.source_sha256?.toLowerCase() !== spec.sourcePdfSha256.toLowerCase() ||
      job.vision_operation !== spec.visionOperationId) {
    throw new Error("The registered Physics source is not the exact completed import expected by the M14 backfill.");
  }

  const visionPrefix = fatmanVisionOutputPrefix(job);
  const expectedOutputUri = "gs://" + sourceBucket + "/" + visionPrefix;
  const operation = await deps.getVisionOperation(env, spec.visionOperationId, expectedOutputUri);
  if (!operation.done || operation.error) {
    throw new Error(operation.error || "The original Google Vision operation is not complete; M14 will not submit another OCR job.");
  }
  if (!operation.outputDestinations?.some((uri) => uri.replace(/\/+$/u, "") === expectedOutputUri.replace(/\/+$/u, ""))) {
    throw new Error("The saved Vision operation did not report the registered temporary OCR output prefix.");
  }

  const listing = await deps.listVisionObjects(env, job, spec.pageCount + 1);
  if (listing.truncated) throw new Error("The saved Vision output listing is truncated; M14 backfill refuses partial OCR sets.");
  const expectedObjects = Array.from({ length: spec.pageCount }, (_, index) =>
    fatmanOutputObjectName(job.id, index + 1, visionPrefix)
  );
  const actualNames = new Set(listing.objects.map((object) => object.name));
  if (listing.objects.length !== expectedObjects.length ||
      expectedObjects.some((objectName) => !actualNames.has(objectName))) {
    throw new Error("The saved Vision output does not contain exactly one OCR JSON object for every physical PDF page.");
  }

  const pages: BrvinM14VisionBackfillResult["pages"] = [];
  let generationId = "";
  let chunkCount = 0;

  for (let pdfPage = 1; pdfPage <= spec.pageCount; pdfPage += 1) {
    const ocrPage = await deps.readVisionPage(env, spec.sourceId, pdfPage);
    if (!ocrPage.rawText.trim()) {
      throw new Error("The stored Vision output for physical PDF page " + pdfPage + " is empty.");
    }
    const stableItemKey = fatmanIndexPageKey(job, pdfPage);
    const persisted = await deps.persistPage(
      env,
      job,
      pdfPage,
      ocrPage.rawText,
      stableItemKey,
      ocrPage.pageConfidence,
      { storageBucket: corpusBucket },
    );
    if (generationId && persisted.generationId !== generationId) {
      throw new Error("M14 generated inconsistent corpus IDs while replaying the original Vision operation.");
    }
    generationId = persisted.generationId;
    chunkCount += persisted.chunkCount;
    pages.push({
      pdfPage,
      stableItemKey,
      chunkCount: persisted.chunkCount,
      sourceManifestCreated: persisted.sourceManifestCreated,
      pageManifestCreated: persisted.pageManifestCreated,
    });
  }

  return {
    sourceId: spec.sourceId,
    generationId,
    pageCount: pages.length,
    chunkCount,
    sourceBucket,
    corpusBucket,
    visionOperationId: spec.visionOperationId,
    pages,
  };
}
