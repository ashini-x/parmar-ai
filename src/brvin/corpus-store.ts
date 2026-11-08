import type { Env } from "../config/env";
import type { FatmanImportJob } from "../fatman/import";
import { getGoogleAccessToken } from "../auth/google";
import {
  buildBrvinPageManifest,
  buildBrvinSourceManifest,
  sha256Hex,
} from "./corpus";

const GCS_API = "https://storage.googleapis.com";
const DERIVED_CORPUS_ROOT = "brvin/derived-corpus/";

function bucketName(env: Env): string {
  const value = env.FATMAN_GCS_BUCKET?.trim();
  if (!value || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)) {
    throw new Error("BRVIN derived-corpus storage is not configured.");
  }
  return value;
}

function validSourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/iu.test(value);
}

function objectPrefix(sourceId: string): string {
  if (!validSourceId(sourceId)) throw new Error("The BRVIN source identifier is invalid.");
  return DERIVED_CORPUS_ROOT + sourceId + "/";
}

async function putImmutableJson(
  bucket: string,
  token: string,
  objectName: string,
  value: unknown,
): Promise<{ created: boolean; sha256: string }> {
  const serialized = JSON.stringify(value);
  const expectedSha256 = await sha256Hex(serialized);
  const uploadUrl = new URL(GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucket) + "/o");
  uploadUrl.searchParams.set("uploadType", "media");
  uploadUrl.searchParams.set("name", objectName);
  uploadUrl.searchParams.set("ifGenerationMatch", "0");

  const response = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json; charset=utf-8",
    },
    body: serialized,
  });
  if (response.ok) return { created: true, sha256: expectedSha256 };

  if (response.status !== 412 && response.status !== 409) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 300);
    throw new Error("Could not persist the immutable BRVIN corpus object (HTTP " + response.status + "). " + detail);
  }

  // A retry is successful only when the existing immutable object is byte-for-
  // byte identical. A changed OCR payload must not silently overwrite a replay.
  const existingUrl = GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?alt=media";
  const existingResponse = await fetch(existingUrl, {
    headers: { authorization: "Bearer " + token },
  });
  if (!existingResponse.ok) {
    throw new Error("The existing BRVIN corpus object could not be verified after an immutable-write conflict.");
  }
  const existingText = await existingResponse.text();
  const existingSha256 = await sha256Hex(existingText);
  if (existingSha256 !== expectedSha256 || existingText !== serialized) {
    throw new Error("An immutable BRVIN corpus object already exists with different content; use a new corpus generation.");
  }
  return { created: false, sha256: expectedSha256 };
}

/**
 * Store one physical PDF page and its deterministic chunks in a private GCS
 * prefix separate from both the original PDF and temporary Vision OCR output.
 * Writes are create-only; identical retries are accepted, changed payloads are
 * rejected rather than overwritten.
 */
export async function persistBrvinPageCorpus(
  env: Env,
  job: FatmanImportJob,
  pdfPage: number,
  rawOcrText: string,
  stableItemKey: string,
  pageConfidence?: number,
): Promise<{
  generationId: string;
  chunkCount: number;
  sourceManifestObject: string;
  pageManifestObject: string;
  sourceManifestCreated: boolean;
  pageManifestCreated: boolean;
}> {
  const sourceId = job.book_id;
  if (!sourceId || sourceId !== job.id || !validSourceId(sourceId)) {
    throw new Error("The derived corpus can only be written for a registered BRVIN PDF source.");
  }
  const pageCount = Number(job.page_count ?? 0);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 2_000 || pdfPage > pageCount) {
    throw new Error("The BRVIN source does not have a verified physical PDF page count.");
  }
  if (!/^[a-f0-9]{64}$/iu.test(job.source_sha256)) {
    throw new Error("The BRVIN source PDF SHA-256 is missing or invalid.");
  }
  if (!job.vision_operation?.trim()) {
    throw new Error("A persisted Google Vision operation ID is required for a rebuildable corpus generation.");
  }

  const sourceManifest = await buildBrvinSourceManifest({
    sourceId,
    sourcePdfSha256: job.source_sha256,
    ocrOperationId: job.vision_operation,
    pageCount,
  });
  const pageManifest = await buildBrvinPageManifest({
    sourceId,
    sourcePdfSha256: job.source_sha256,
    generationId: sourceManifest.generationId,
    ocrOperationId: job.vision_operation,
    stableItemKey,
    pdfPage,
    rawOcrText,
    ...(pageConfidence !== undefined ? { pageConfidence } : {}),
  });

  const prefix = objectPrefix(sourceId) + sourceManifest.generationId + "/";
  const sourceManifestObject = prefix + "manifest.json";
  const pageNumber = String(pdfPage).padStart(6, "0");
  // One immutable page object per OCR/chunker generation. A later OCR run has
  // a new Vision operation ID and therefore a new generation directory.
  const pageManifestObject = prefix + "pages/page-" + pageNumber + ".json";
  const bucket = bucketName(env);
  const token = await getGoogleAccessToken(env);

  const sourceWrite = await putImmutableJson(bucket, token, sourceManifestObject, sourceManifest);
  const pageWrite = await putImmutableJson(bucket, token, pageManifestObject, pageManifest);

  return {
    generationId: sourceManifest.generationId,
    chunkCount: pageManifest.chunks.length,
    sourceManifestObject,
    pageManifestObject,
    sourceManifestCreated: sourceWrite.created,
    pageManifestCreated: pageWrite.created,
  };
}

/** Exported for deletion preflight/tests; this prefix is not subject to Vision OCR TTL. */
export function brvinDerivedCorpusPrefix(sourceId: string): string {
  return objectPrefix(sourceId);
}
