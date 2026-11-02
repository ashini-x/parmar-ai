import type { AiSearchChunk, Env, GeminiImageInput } from "../config/env";

const MAX_MATCHES = 12;
const MAX_PASSAGES = 8;
const MAX_PAGES = 6;
const MAX_PASSAGE_CHARS = 2_000;

export interface FatmanPassage {
  id: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}

export interface FatmanBookContext {
  passages: FatmanPassage[];
  pageImages: GeminiImageInput[];
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
  const instanceName = env.FATMAN_INSTANCE_NAME?.trim();
  const threshold = Number(env.FATMAN_MIN_SCORE);
  return env.FATMAN_ENABLED?.trim().toLowerCase() === "true" &&
    Boolean(version) &&
    Boolean(instanceName) &&
    Boolean(env.FATMAN_SEARCH) &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1;
}

export async function retrieveFatmanContext(env: Env, query: string): Promise<FatmanBookContext> {
  if (!isFatmanReady(env) || !env.FATMAN_SEARCH) {
    throw new FatmanRetrievalError("Fatman retrieval is not configured.", false);
  }

  const normalizedQuery = query.replace(/\s+/gu, " ").trim().slice(0, 4_000);
  if (!normalizedQuery) throw new FatmanRetrievalError("Fatman search query is empty.", false);

  let chunks: AiSearchChunk[];
  try {
    const instance = env.FATMAN_SEARCH.get(env.FATMAN_INSTANCE_NAME!.trim());
    const result = await instance.search({
      messages: [{ role: "user", content: normalizedQuery }],
      ai_search_options: {
        retrieval: {
          max_num_results: MAX_MATCHES,
          retrieval_type: "hybrid",
        },
      },
    });
    chunks = result.chunks ?? [];
  } catch (error) {
    throw new FatmanRetrievalError(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }

  const minScore = Number(env.FATMAN_MIN_SCORE);
  const passages: FatmanPassage[] = [];
  const seenIds = new Set<string>();
  const pageCounts = new Map<number, number>();
  const allowedPages = new Set<number>();

  for (const chunk of chunks) {
    const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const pdfPage = pageNumberFromKey(key);
    const text = typeof chunk.text === "string"
      ? chunk.text.replace(/\s+/gu, " ").trim().slice(0, MAX_PASSAGE_CHARS)
      : "";
    const score = finiteScore(chunk.score) ??
      finiteScore(chunk.scoring_details?.reranking_score) ??
      finiteScore(chunk.scoring_details?.vector_score);
    if (!pdfPage || !text || score === undefined || score < minScore) continue;

    const id = typeof chunk.id === "string" && chunk.id
      ? chunk.id
      : key + ":" + text.slice(0, 80);
    if (seenIds.has(id)) continue;
    if (!allowedPages.has(pdfPage) && allowedPages.size >= MAX_PAGES) continue;
    const pageCount = pageCounts.get(pdfPage) ?? 0;
    if (pageCount >= 2) continue;

    const metadata = chunk.item?.metadata;
    const printedPage = cleanMetadataText(metadata?.printedPage, 20);
    const section = cleanMetadataText(metadata?.section, 120);
    passages.push({
      id,
      pdfPage,
      ...(printedPage ? { printedPage } : {}),
      ...(section ? { section } : {}),
      text,
      score,
    });
    seenIds.add(id);
    allowedPages.add(pdfPage);
    pageCounts.set(pdfPage, pageCount + 1);
    if (passages.length >= MAX_PASSAGES) break;
  }

  return { passages, pageImages: [] };
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

function pageNumberFromKey(key: string): number | undefined {
  const match = /(?:^|\/)page-(\d{1,6})\.(?:jpg|jpeg|pdf)$/iu.exec(key);
  if (!match) return undefined;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : undefined;
}

function finiteScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function cleanMetadataText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
  return cleaned || undefined;
}
