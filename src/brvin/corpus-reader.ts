import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import {
  buildBrvinPageManifest,
  buildBrvinSourceManifest,
  normalizeBrvinSearchText,
  sha256Hex,
  type BrvinCorpusPageManifest,
  type BrvinCorpusSourceManifest,
} from "./corpus";

const GCS_API = "https://storage.googleapis.com";
const MAX_PAGE_COUNT = 2_000;
const PAGE_READ_CONCURRENCY = 4;

function bucketName(env: Env): string {
  const value = env.BRVIN_M14_CORPUS_BUCKET?.trim();
  if (!value || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u.test(value)) {
    throw new Error("The isolated M14 derived-corpus bucket is not configured.");
  }
  return value;
}

function validateIdentifiers(sourceId: string, generationId: string): void {
  if (sourceId !== "fatman-legacy-538" && !/^[a-f0-9-]{36}$/iu.test(sourceId)) throw new Error("The BRVIN source identifier is invalid.");
  if (!/^[a-f0-9]{32}$/iu.test(generationId)) throw new Error("The BRVIN corpus generation identifier is invalid.");
}

async function readObject<T>(
  bucket: string,
  objectName: string,
  token: string,
  request: typeof fetch,
): Promise<T> {
  const url = GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?alt=media";
  const response = await request(url, {
    method: "GET",
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("Could not read a private BRVIN corpus object (HTTP " + response.status + ").");
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error("A private BRVIN corpus object contains invalid JSON.");
  }
}

function validateSourceManifest(
  value: BrvinCorpusSourceManifest,
  sourceId: string,
  generationId: string,
): void {
  if (!value || value.schemaVersion !== 1 || value.sourceId !== sourceId ||
      value.generationId !== generationId || !/^[a-f0-9]{64}$/iu.test(value.sourcePdfSha256) ||
      !value.ocrOperationId || !Number.isSafeInteger(value.pageCount) ||
      value.pageCount < 1 || value.pageCount > MAX_PAGE_COUNT ||
      value.chunker?.version !== "lexical-window-v1" ||
      value.normalizer?.version !== "unicode-nfc-whitespace-v1") {
    throw new Error("The BRVIN source manifest is incomplete or incompatible with this corpus reader.");
  }
}

async function validatePageManifest(
  page: BrvinCorpusPageManifest,
  source: BrvinCorpusSourceManifest,
  expectedPage: number,
): Promise<void> {
  if (!page || page.schemaVersion !== source.schemaVersion || page.sourceId !== source.sourceId ||
      page.sourcePdfSha256 !== source.sourcePdfSha256 || page.generationId !== source.generationId ||
      page.ocrOperationId !== source.ocrOperationId || page.pdfPage !== expectedPage ||
      !page.stableItemKey?.trim() || !page.rawOcrText?.trim() ||
      !/^[a-f0-9]{64}$/iu.test(page.rawOcrSha256) ||
      !/^[a-f0-9]{64}$/iu.test(page.normalizedSearchTextSha256) ||
      !Array.isArray(page.chunks) || page.chunks.length < 1) {
    throw new Error("A BRVIN page manifest is missing required source or physical-page provenance.");
  }
  const [rawHash, normalizedHash] = await Promise.all([
    sha256Hex(page.rawOcrText),
    sha256Hex(page.normalizedSearchText),
  ]);
  if (rawHash !== page.rawOcrSha256 ||
      normalizeBrvinSearchText(page.rawOcrText) !== page.normalizedSearchText ||
      normalizedHash !== page.normalizedSearchTextSha256) {
    throw new Error("A BRVIN page manifest failed its raw OCR or normalized-text integrity check.");
  }
  const rebuilt = await buildBrvinPageManifest({
    sourceId: page.sourceId,
    sourcePdfSha256: page.sourcePdfSha256,
    generationId: page.generationId,
    ocrOperationId: page.ocrOperationId,
    stableItemKey: page.stableItemKey,
    pdfPage: page.pdfPage,
    rawOcrText: page.rawOcrText,
    pageConfidence: page.ocrEvidence.pageConfidence,
  });
  if (JSON.stringify(rebuilt.chunks) !== JSON.stringify(page.chunks) ||
      JSON.stringify(rebuilt.contentTypes) !== JSON.stringify(page.contentTypes) ||
      JSON.stringify(rebuilt.formulaCandidates) !== JSON.stringify(page.formulaCandidates) ||
      rebuilt.normalizedSearchText !== page.normalizedSearchText) {
    throw new Error("A BRVIN page manifest failed deterministic chunk identity or formula-metadata replay.");
  }
  const seenChunkIds = new Set<string>();
  for (const chunk of page.chunks) {
    if (!chunk.id?.startsWith("brvchunk_") || seenChunkIds.has(chunk.id) ||
        !chunk.rawText || !chunk.normalizedText ||
        !/^[a-f0-9]{64}$/iu.test(chunk.contentSha256) ||
        await sha256Hex(chunk.rawText) !== chunk.contentSha256 ||
        normalizeBrvinSearchText(chunk.rawText) !== chunk.normalizedText) {
      throw new Error("A BRVIN page chunk failed its deterministic identity or content integrity check.");
    }
    seenChunkIds.add(chunk.id);
  }
}

/**
 * Rebuild a corpus generation from immutable GCS manifests without PDF upload
 * or Vision OCR. Page reads are bounded and all page/hash/provenance checks
 * complete before any caller should send chunks to a retrieval provider.
 */
export async function readBrvinCorpusGeneration(
  env: Env,
  sourceId: string,
  generationId: string,
  dependencies: {
    request?: typeof fetch;
    accessToken?: (env: Env) => Promise<string>;
  } = {},
): Promise<{
  sourceManifest: BrvinCorpusSourceManifest;
  pageManifests: BrvinCorpusPageManifest[];
  chunkCount: number;
}> {
  validateIdentifiers(sourceId, generationId);
  const request = dependencies.request ?? fetch;
  const getToken = dependencies.accessToken ?? getGoogleAccessToken;
  const bucket = bucketName(env);
  const token = await getToken(env);
  const prefix = "brvin/derived-corpus/" + sourceId + "/" + generationId + "/";
  const sourceManifest = await readObject<BrvinCorpusSourceManifest>(
    bucket, prefix + "manifest.json", token, request,
  );
  validateSourceManifest(sourceManifest, sourceId, generationId);
  const deterministicSourceManifest = await buildBrvinSourceManifest({
    sourceId,
    sourcePdfSha256: sourceManifest.sourcePdfSha256,
    ocrOperationId: sourceManifest.ocrOperationId,
    pageCount: sourceManifest.pageCount,
  });
  if (deterministicSourceManifest.generationId !== generationId) {
    throw new Error("The BRVIN source manifest generation ID does not match its deterministic source inputs.");
  }

  const pages = new Array<BrvinCorpusPageManifest>(sourceManifest.pageCount);
  let nextPage = 1;
  async function worker(): Promise<void> {
    while (true) {
      const pageNumber = nextPage;
      nextPage += 1;
      if (pageNumber > sourceManifest.pageCount) return;
      const objectName = prefix + "pages/page-" + String(pageNumber).padStart(6, "0") + ".json";
      const page = await readObject<BrvinCorpusPageManifest>(bucket, objectName, token, request);
      await validatePageManifest(page, sourceManifest, pageNumber);
      pages[pageNumber - 1] = page;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PAGE_READ_CONCURRENCY, sourceManifest.pageCount) }, () => worker()),
  );
  if (pages.some((page) => !page)) {
    throw new Error("The BRVIN corpus generation is incomplete; not every physical PDF page has a manifest.");
  }
  return {
    sourceManifest,
    pageManifests: pages,
    chunkCount: pages.reduce((total, page) => total + page.chunks.length, 0),
  };
}


/**
 * Read and fully validate one page from an immutable corpus generation.
 * Staging rebuilds use this bounded reader so a 538-page source can be
 * embedded and indexed over multiple Worker invocations without re-reading
 * every previously completed page on each continuation.
 */
export async function readBrvinCorpusPage(
  env: Env,
  sourceId: string,
  generationId: string,
  pdfPage: number,
  dependencies: {
    request?: typeof fetch;
    accessToken?: (env: Env) => Promise<string>;
  } = {},
): Promise<{ sourceManifest: BrvinCorpusSourceManifest; pageManifest: BrvinCorpusPageManifest }> {
  validateIdentifiers(sourceId, generationId);
  if (!Number.isSafeInteger(pdfPage) || pdfPage < 1 || pdfPage > MAX_PAGE_COUNT) {
    throw new Error("The requested BRVIN corpus physical page is invalid.");
  }
  const request = dependencies.request ?? fetch;
  const getToken = dependencies.accessToken ?? getGoogleAccessToken;
  const bucket = bucketName(env);
  const token = await getToken(env);
  const prefix = "brvin/derived-corpus/" + sourceId + "/" + generationId + "/";
  const sourceManifest = await readObject<BrvinCorpusSourceManifest>(
    bucket, prefix + "manifest.json", token, request,
  );
  validateSourceManifest(sourceManifest, sourceId, generationId);
  const deterministic = await buildBrvinSourceManifest({
    sourceId,
    sourcePdfSha256: sourceManifest.sourcePdfSha256,
    ocrOperationId: sourceManifest.ocrOperationId,
    pageCount: sourceManifest.pageCount,
  });
  if (deterministic.generationId !== generationId || pdfPage > sourceManifest.pageCount) {
    throw new Error("The requested BRVIN page does not belong to the verified source generation.");
  }
  const pageManifest = await readObject<BrvinCorpusPageManifest>(
    bucket,
    prefix + "pages/page-" + String(pdfPage).padStart(6, "0") + ".json",
    token,
    request,
  );
  await validatePageManifest(pageManifest, sourceManifest, pdfPage);
  return { sourceManifest, pageManifest };
}
