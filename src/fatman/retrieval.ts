import type { Env, GeminiImageInput } from "../config/env";
import { GoogleAuthError, getGoogleAccessToken } from "../auth/google";

const EMBEDDING_MODEL = "gemini-embedding-001";
export const FATMAN_EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_TIMEOUT_MS = 20_000;
const MAX_MATCHES = 12;
const MAX_PASSAGES = 8;
const MAX_PAGES = 6;
const MAX_PASSAGE_CHARS = 5_000;
const MAX_PAGE_IMAGE_BYTES = 1_500_000;
const MAX_PAGE_IMAGES = 2;

export interface FatmanPassage {
  id: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
  pageImageKey?: string;
}

export interface FatmanBookContext {
  passages: FatmanPassage[];
  pageImages: GeminiImageInput[];
}

interface EmbeddingResponse {
  predictions?: Array<{
    embeddings?: { values?: number[] };
    embedding?: { values?: number[] };
  }>;
  error?: { message?: string };
}

interface VectorMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface VectorQueryResponse {
  matches?: VectorMatch[];
}

export class FatmanRetrievalError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "FatmanRetrievalError";
    this.retryable = retryable;
  }
}

export function isFatmanReady(env: Env): boolean {
  const version = env.FATMAN_DOCUMENT_VERSION?.trim();
  const threshold = Number(env.FATMAN_MIN_SCORE);
  return env.FATMAN_ENABLED?.trim().toLowerCase() === "true" &&
    Boolean(version) &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1 &&
    Boolean(env.FATMAN_INDEX);
}

export async function retrieveFatmanContext(env: Env, query: string): Promise<FatmanBookContext> {
  if (!isFatmanReady(env) || !env.FATMAN_INDEX) {
    throw new FatmanRetrievalError("Fatman retrieval is not configured.", false);
  }

  const normalizedQuery = query.replace(/\s+/gu, " ").trim().slice(0, 4_000);
  if (!normalizedQuery) throw new FatmanRetrievalError("Fatman search query is empty.", false);

  const projectId = env.GCP_PROJECT_ID?.trim();
  if (!projectId) throw new FatmanRetrievalError("Google Cloud project ID is not configured.", false);
  const accessToken = await getGoogleAccessToken(env).catch((error) => {
    if (error instanceof GoogleAuthError) {
      throw new FatmanRetrievalError(error.message, error.retryable);
    }
    throw error;
  });
  const location = env.GEMINI_LOCATION?.trim() || "global";
  const endpoint = "https://aiplatform.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) + "/locations/" + encodeURIComponent(location) +
    "/publishers/google/models/" + EMBEDDING_MODEL + ":predict";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  let embedding: number[];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ content: normalizedQuery, task_type: "RETRIEVAL_QUERY" }],
        parameters: { outputDimensionality: FATMAN_EMBEDDING_DIMENSIONS },
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null) as EmbeddingResponse | null;
    if (!response.ok) {
      throw new FatmanRetrievalError(
        data?.error?.message ?? "Embedding request failed with HTTP " + response.status + ".",
        response.status >= 500 || response.status === 429,
      );
    }
    embedding = data?.predictions?.[0]?.embeddings?.values ??
      data?.predictions?.[0]?.embedding?.values ?? [];
    if (embedding.length !== FATMAN_EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
      throw new FatmanRetrievalError("Embedding response had an unexpected vector shape.", true);
    }
  } catch (error) {
    if (error instanceof FatmanRetrievalError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FatmanRetrievalError("Fatman query embedding timed out.");
    }
    throw new FatmanRetrievalError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }

  const version = env.FATMAN_DOCUMENT_VERSION!.trim();
  const result = await env.FATMAN_INDEX.query(embedding, {
    topK: MAX_MATCHES,
    returnMetadata: "all",
    filter: { book: "fatman", documentVersion: version },
  }) as VectorQueryResponse;

  const minScore = Number(env.FATMAN_MIN_SCORE);
  const passages: FatmanPassage[] = [];
  const seenIds = new Set<string>();
  const pageCounts = new Map<number, number>();
  const allowedPages = new Set<number>();

  for (const match of result.matches ?? []) {
    const metadata = match.metadata;
    const id = typeof match.id === "string" ? match.id : "";
    const score = Number(match.score);
    const pdfPage = positiveInteger(metadata?.pdfPage);
    const text = typeof metadata?.text === "string" ? metadata.text.trim().slice(0, MAX_PASSAGE_CHARS) : "";
    if (!id || seenIds.has(id) || !Number.isFinite(score) || score < minScore || !pdfPage || !text) continue;
    if (!allowedPages.has(pdfPage) && allowedPages.size >= MAX_PAGES) continue;
    const pageCount = pageCounts.get(pdfPage) ?? 0;
    if (pageCount >= 2) continue;

    const printedPage = cleanMetadataText(metadata?.printedPage, 20);
    const section = cleanMetadataText(metadata?.section, 120);
    const pageImageKey = cleanPageImageKey(metadata?.pageImageKey);
    passages.push({
      id,
      pdfPage,
      ...(printedPage ? { printedPage } : {}),
      ...(section ? { section } : {}),
      text,
      score,
      ...(pageImageKey ? { pageImageKey } : {}),
    });
    seenIds.add(id);
    allowedPages.add(pdfPage);
    pageCounts.set(pdfPage, pageCount + 1);
    if (passages.length >= MAX_PASSAGES) break;
  }

  return {
    passages,
    pageImages: await loadPageImages(env, passages),
  };
}

export function formatFatmanCitations(passages: FatmanPassage[]): string {
  const byPdfPage = new Map<number, string | undefined>();
  for (const passage of passages) {
    if (!byPdfPage.has(passage.pdfPage)) byPdfPage.set(passage.pdfPage, passage.printedPage);
  }
  const refs = [...byPdfPage.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 3)
    .map(([pdfPage, printedPage]) => printedPage
      ? "PDF p. " + pdfPage + " (book p. " + printedPage + ")"
      : "PDF p. " + pdfPage);
  return refs.length ? "Source: Fatman 2nd Edition, " + refs.join("; ") + "." : "";
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function cleanMetadataText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
  return cleaned || undefined;
}

function cleanPageImageKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("fatman/")) return undefined;
  const key = value.trim();
  if (!key || key.includes("..") || key.length > 512) return undefined;
  return key;
}

async function loadPageImages(env: Env, passages: FatmanPassage[]): Promise<GeminiImageInput[]> {
  if (!env.FATMAN_PAGES) return [];
  const keys = [...new Set(passages.map((passage) => passage.pageImageKey).filter((key): key is string => Boolean(key)))].slice(0, MAX_PAGE_IMAGES);
  const images: GeminiImageInput[] = [];

  for (const key of keys) {
    const object = await env.FATMAN_PAGES.get(key);
    if (!object || object.size > MAX_PAGE_IMAGE_BYTES) continue;
    const mimeType = object.httpMetadata?.contentType?.toLowerCase();
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    images.push({ mimeType, data: encodeBase64(bytes), byteLength: bytes.byteLength });
  }
  return images;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + blockSize, bytes.length)));
  }
  return btoa(binary);
}
