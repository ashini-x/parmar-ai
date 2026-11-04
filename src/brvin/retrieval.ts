import type { AiSearchChunk, Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import { parseFatmanIndexPageKey } from "../fatman/library";

const MAX_QUERIES = 3;
const MAX_RESULTS_PER_QUERY = 50;
const MAX_PASSAGES = 8;
const MAX_PAGES = 6;
const MAX_PASSAGES_PER_PAGE = 2;
const MAX_PASSAGE_CHARS = 4_500;
const MAX_RAW_PASSAGE_CHARS = 60_000;
const EXCERPT_WINDOW_CHARS = 1_100;
const EXCERPT_WINDOW_STEP = 550;

export type BrvinRetrievalEnv = Pick<Env, "DB" | "FATMAN_SEARCH" | "FATMAN_INSTANCE_NAME" | "FATMAN_MIN_SCORE">;

export interface BrvinPassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}

export interface BrvinProjectIdentity {
  id: string;
  name: string;
  slug: string;
}

export interface BrvinProjectContext {
  project: BrvinProjectIdentity;
  passages: BrvinPassage[];
  searchedSources: number;
  searchCount: number;
}

export interface BrvinSource {
  id: string;
  title: string;
  search_prefix: string;
  page_count: number;
}

export class BrvinRetrievalError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "BrvinRetrievalError";
    this.retryable = retryable;
  }
}

function cleanText(value: unknown, max = MAX_PASSAGE_CHARS): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/gu, "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function finiteScore(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cleanMetadataText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\\r\\n]+/gu, " ").replace(/\\s+/gu, " ").trim().slice(0, maxLength);
  return cleaned || undefined;
}

const QUERY_STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "are", "as", "at", "be", "because",
  "been", "being", "between", "both", "but", "by", "can", "could", "did", "do", "does",
  "for", "from", "had", "has", "have", "how", "in", "into", "is", "it", "its", "of",
  "on", "or", "our", "please", "should", "that", "the", "their", "them", "there", "these",
  "this", "those", "to", "was", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "would", "you", "your", "pdf", "page", "fatman", "edition", "second",
  "2nd", "2026", "book", "chapter", "explain", "describe", "tell", "me", "about",
]);

function meaningfulBrvinTerms(value: string): Set<string> {
  return new Set(
    value.toLowerCase().normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter((term) => term.length >= 2 && !QUERY_STOP_WORDS.has(term)),
  );
}

export function isBrvinPassageRelevant(query: string, passage: string): boolean {
  const queryTerms = meaningfulBrvinTerms(query);
  if (queryTerms.size === 0) return false;
  const passageTerms = meaningfulBrvinTerms(passage);
  let overlap = 0;
  for (const term of queryTerms) if (passageTerms.has(term)) overlap += 1;
  return overlap >= (queryTerms.size <= 2 ? 1 : 2);
}

function cleanEvidenceText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\bjoin\s*[-:]*\s*@?freebookspdf\d*\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_RAW_PASSAGE_CHARS);
}

/** Select evidence-bearing windows across the full OCR page, not only its opening. */
export function extractBrvinEvidenceExcerpt(
  query: string,
  value: string,
  maxChars = MAX_PASSAGE_CHARS,
): string {
  const text = cleanEvidenceText(value);
  if (text.length <= maxChars) return text;

  const queryTerms = meaningfulBrvinTerms(query);
  if (!queryTerms.size) return text.slice(0, maxChars);

  const windows: Array<{ start: number; end: number; terms: Set<string> }> = [];
  for (let start = 0; start < text.length; start += EXCERPT_WINDOW_STEP) {
    const end = Math.min(text.length, start + EXCERPT_WINDOW_CHARS);
    const windowTerms = meaningfulBrvinTerms(text.slice(start, end));
    const matchedTerms = new Set([...queryTerms].filter((term) => windowTerms.has(term)));
    if (matchedTerms.size) windows.push({ start, end, terms: matchedTerms });
    if (end === text.length) break;
  }
  if (!windows.length) return text.slice(0, maxChars);

  const selected: Array<{ start: number; end: number; terms: Set<string> }> = [];
  const covered = new Set<string>();
  let usedChars = 0;
  const maxWindows = Math.max(1, Math.ceil(maxChars / EXCERPT_WINDOW_CHARS));
  while (selected.length < maxWindows && usedChars < maxChars) {
    let best: typeof windows[number] | undefined;
    let bestScore = 0;
    for (const candidate of windows) {
      if (selected.includes(candidate)) continue;
      const overlap = selected.reduce((total, item) =>
        total + Math.max(0, Math.min(item.end, candidate.end) - Math.max(item.start, candidate.start)), 0);
      if (overlap > EXCERPT_WINDOW_CHARS * 0.45) continue;
      const newTerms = [...candidate.terms].filter((term) => !covered.has(term));
      const score = newTerms.length + candidate.terms.size * 0.08 - overlap / EXCERPT_WINDOW_CHARS;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best || bestScore <= 0) break;
    selected.push(best);
    best.terms.forEach((term) => covered.add(term));
    usedChars += best.end - best.start;
  }
  if (!selected.length) return text.slice(0, maxChars);

  const pieces: string[] = [];
  let previousEnd = -1;
  let remaining = maxChars;
  for (const window of selected.sort((a, b) => a.start - b.start)) {
    const start = Math.max(window.start, previousEnd);
    if (start >= window.end || remaining <= 0) continue;
    const piece = text.slice(start, Math.min(window.end, start + remaining));
    if (piece) {
      pieces.push(piece);
      remaining -= piece.length;
      previousEnd = start + piece.length;
    }
  }
  return pieces.join(" … ");
}

function normalizeQueries(values: string[]): string[] {
  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => cleanText(value, 2_000))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, MAX_QUERIES);
}

function isSafeSearchPrefix(prefix: string): boolean {
  return /^[A-Za-z0-9/_-]+\/$/u.test(prefix) &&
    !prefix.includes("..") &&
    new TextEncoder().encode(prefix).byteLength <= 64;
}

/**
 * Resolve only complete, retrieval-ready books reachable through either a
 * direct project grant or a project-to-collection grant.
 */
export async function getBrvinProjectSources(
  env: BrvinRetrievalEnv,
  projectId: string,
): Promise<BrvinSource[]> {
  if (!env.DB) throw new BrvinRetrievalError("BRVIN database is not configured.");
  const result = await env.DB.prepare(
    "SELECT DISTINCT b.id,b.title,b.search_prefix,b.page_count FROM brvin_books b " +
    "JOIN brvin_projects p ON p.id=? AND p.status='active' " +
    "LEFT JOIN brvin_project_books pb ON pb.project_id=p.id AND pb.book_id=b.id " +
    "LEFT JOIN brvin_project_collections pc ON pc.project_id=p.id AND pc.collection_id=b.collection_id " +
    "WHERE b.status='ready' AND b.indexed_pages=b.page_count AND (pb.book_id IS NOT NULL OR pc.collection_id IS NOT NULL)"
  ).bind(projectId).all<BrvinSource>();
  return result.results ?? [];
}

/**
 * Search an already-resolved project. The authorised folders are applied by
 * AI Search before retrieval; every result is then checked again against the
 * current D1 grant set and its registered page-key format.
 */
export async function retrieveBrvinProjectContextForProject(
  env: BrvinRetrievalEnv,
  project: BrvinProjectIdentity,
  queries: string[],
  resolvedSources?: BrvinSource[],
): Promise<BrvinProjectContext> {
  if (!env.DB || !env.FATMAN_SEARCH || !env.FATMAN_INSTANCE_NAME?.trim()) {
    throw new BrvinRetrievalError("BRVIN retrieval is not configured.");
  }

  const normalizedQueries = normalizeQueries(queries);
  if (!normalizedQueries.length) {
    throw new BrvinRetrievalError("BRVIN search query is empty.");
  }

  try {
    const sources = resolvedSources ?? await getBrvinProjectSources(env, project.id);
    if (!sources.length) {
      return { project, passages: [], searchedSources: 0, searchCount: 0 };
    }

    const prefixes = [...new Set(sources.map((source) => source.search_prefix))];
    if (prefixes.some((prefix) => !isSafeSearchPrefix(prefix))) {
      throw new BrvinRetrievalError("A registered BRVIN search prefix is invalid.");
    }
    const prefixSources = [...sources].sort((a, b) => b.search_prefix.length - a.search_prefix.length);
    const instance = env.FATMAN_SEARCH.get(env.FATMAN_INSTANCE_NAME.trim());
    const settled = await Promise.allSettled(normalizedQueries.map(async (query) => {
      const result = await instance.search({
        messages: [{ role: "user", content: query }],
        ai_search_options: {
          retrieval: {
            max_num_results: MAX_RESULTS_PER_QUERY,
            retrieval_type: "hybrid",
            filters: { folder: { $in: prefixes } },
          },
        },
      });
      return { query, chunks: result.chunks ?? [] };
    }));

    const successful = settled.filter(
      (item): item is PromiseFulfilledResult<{ query: string; chunks: AiSearchChunk[] }> =>
        item.status === "fulfilled",
    );
    if (!successful.length) {
      const failure = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
      throw new BrvinRetrievalError(
        failure?.reason instanceof Error ? failure.reason.message : "BRVIN search failed.",
        true,
      );
    }

    const minScoreValue = Number(env.FATMAN_MIN_SCORE ?? "0.2");
    const minScore = Number.isFinite(minScoreValue)
      ? Math.min(1, Math.max(0, minScoreValue))
      : 0.2;
    const bestById = new Map<string, BrvinPassage>();
    const fingerprints = new Set<string>();
    const pageCounts = new Map<string, number>();
    const allowedPages = new Set<string>();

    for (const searchResult of successful) {
      for (const chunk of searchResult.value.chunks) {
        const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
        const source = prefixSources.find((item) => key.startsWith(item.search_prefix));
        if (!source) continue;

        const parsed = parseFatmanIndexPageKey(key);
        if (!parsed || parsed.page < 1) continue;
        if (parsed.bookId && parsed.bookId !== source.id) continue;
        if (!parsed.bookId && (source.id !== "fatman-legacy-538" || source.search_prefix !== "fatman/pages/")) {
          continue;
        }

        const score = finiteScore(chunk.score) ??
          finiteScore(chunk.scoring_details?.reranking_score) ??
          finiteScore(chunk.scoring_details?.vector_score);
        if (score === undefined || score < minScore) continue;

        const rawText = cleanEvidenceText(chunk.text);
        if (!rawText || !isBrvinPassageRelevant(searchResult.value.query, rawText)) continue;
        const text = extractBrvinEvidenceExcerpt(searchResult.value.query, rawText, MAX_PASSAGE_CHARS);
        if (!text) continue;

        const pageKey = source.id + ":" + parsed.page;
        const id = typeof chunk.id === "string" && chunk.id
          ? chunk.id
          : key + ":" + text.slice(0, 80);
        const previous = bestById.get(id);
        if (previous) {
          if (score > previous.score) bestById.set(id, { ...previous, score, text });
          continue;
        }

        // Continue examining all query variants after reaching the passage cap,
        // so a later variant can still improve the score/evidence for an existing id.
        if (bestById.size >= MAX_PASSAGES) continue;
        const fingerprint = pageKey + ":" + text.toLowerCase().replace(/\s+/gu, " ").slice(0, 180);
        if (fingerprints.has(fingerprint)) continue;
        if (!allowedPages.has(pageKey) && allowedPages.size >= MAX_PAGES) continue;
        const pageCount = pageCounts.get(pageKey) ?? 0;
        if (pageCount >= MAX_PASSAGES_PER_PAGE) continue;

        const printedPage = cleanMetadataText(chunk.item?.metadata?.printedPage, 20);
        const section = cleanMetadataText(chunk.item?.metadata?.section, 120);
        bestById.set(id, {
          id,
          bookId: source.id,
          bookTitle: source.title,
          pdfPage: parsed.page,
          ...(printedPage ? { printedPage } : {}),
          ...(section ? { section } : {}),
          text,
          score,
        });
        fingerprints.add(fingerprint);
        allowedPages.add(pageKey);
        pageCounts.set(pageKey, pageCount + 1);
      }
    }

    const passages = [...bestById.values()].sort((a, b) => b.score - a.score);
    return {
      project,
      passages,
      searchedSources: sources.length,
      searchCount: successful.length,
    };
  } catch (error) {
    if (error instanceof BrvinRetrievalError) throw error;
    throw new BrvinRetrievalError(error instanceof Error ? error.message : String(error), true);
  }
}

/**
 * Compatibility wrapper for internal callers that address a project by slug.
 * Application-facing callers use the trusted client-to-project RPC mapping.
 */
export async function retrieveBrvinProjectContext(
  env: Env,
  projectSlug: string,
  query: string,
): Promise<BrvinProjectContext> {
  if (!env.DB) throw new BrvinRetrievalError("BRVIN database is not configured.");
  const normalized = cleanText(query, 2_000);
  if (!normalized) throw new BrvinRetrievalError("BRVIN search query is empty.");

  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare(
      "SELECT id,name,slug FROM brvin_projects WHERE slug=? AND status='active' LIMIT 1",
    ).bind(projectSlug).first<BrvinProjectIdentity>();
    if (!project) throw new BrvinRetrievalError("This project is not registered with BRVIN.");
    return retrieveBrvinProjectContextForProject(env, project, [normalized]);
  } catch (error) {
    if (error instanceof BrvinRetrievalError) throw error;
    throw new BrvinRetrievalError(error instanceof Error ? error.message : String(error), true);
  }
}

/** Diagnostics expose titles and page counts, never document text. */
export async function listBrvinProjectSources(
  env: Env,
  projectSlug: string,
): Promise<Array<{ id: string; title: string; pageCount: number }>> {
  if (!env.DB) throw new BrvinRetrievalError("BRVIN database is not configured.");
  await ensureAnalyticsSchema(env);
  const project = await env.DB.prepare(
    "SELECT id FROM brvin_projects WHERE slug=? AND status='active' LIMIT 1",
  ).bind(projectSlug).first<{ id: string }>();
  if (!project) throw new BrvinRetrievalError("This project is not registered with BRVIN.");
  const sources = await getBrvinProjectSources(env, project.id);
  return sources.map((row) => ({
    id: row.id,
    title: row.title,
    pageCount: Number(row.page_count),
  }));
}
