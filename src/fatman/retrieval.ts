import type { AiSearchChunk, BrvinServiceRetrievalResult, ConversationTurn, Env, GeminiImageInput } from "../config/env";
import { getFatmanBookState } from "../analytics/db";
import { parseFatmanIndexPageKey } from "./library";

const MAX_QA_MATCHES = 50;
const MAX_SEARCH_VARIANTS = 3;
const MAX_CITATION_PAGES = 5;
const MAX_PASSAGES = 8;
const MAX_PAGES = 6;
const MAX_PASSAGE_CHARS = 4_500;
const FATMAN_EXCERPT_WINDOW_CHARS = 1_100;
const FATMAN_EXCERPT_WINDOW_STEP = 550;

const FATMAN_BRVIN_READY_SOURCES_SQL =
  "SELECT DISTINCT b.id,b.title FROM brvin_books b " +
  "JOIN brvin_projects p ON p.slug='fatman' AND p.status='active' " +
  "LEFT JOIN brvin_project_books pb ON pb.project_id=p.id AND pb.book_id=b.id " +
  "LEFT JOIN brvin_project_collections pc ON pc.project_id=p.id AND pc.collection_id=b.collection_id " +
  "WHERE b.status='ready' AND b.indexed_pages=b.page_count AND (pb.book_id IS NOT NULL OR pc.collection_id IS NOT NULL)";

const FATMAN_QUERY_STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "are", "as", "at", "be", "because",
  "been", "being", "between", "both", "but", "by", "can", "could", "did", "do", "does",
  "for", "from", "had", "has", "have", "how", "in", "into", "is", "it", "its", "of",
  "on", "or", "our", "please", "should", "that", "the", "their", "them", "there", "these",
  "this", "those", "to", "was", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "would", "you", "your", "pdf", "page", "fatman", "edition", "second",
  "2nd", "2026", "book", "chapter", "explain", "describe", "tell", "me", "about",
]);

export interface FatmanPassage {
  id: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  bookId?: string;
  bookTitle?: string;
  text: string;
  score: number;
}

export interface FatmanBookContext {
  passages: FatmanPassage[];
  pageImages: GeminiImageInput[];
  /** Number of hybrid AI Search requests used to assemble this context. */
  searchCount?: number;
  /** Optional retry guidance used only by the internal QA answer-repair pass. */
  qaRepairHint?: string;
}

export class FatmanRetrievalError extends Error {
  readonly retryable: boolean;
  readonly userMessage?: string;

  constructor(message: string, retryable = true, userMessage?: string) {
    super(message);
    this.name = "FatmanRetrievalError";
    this.retryable = retryable;
    this.userMessage = userMessage;
  }
}

function hasFatmanConfiguration(env: Env): boolean {
  const version = env.FATMAN_DOCUMENT_VERSION?.trim();
  const instanceName = env.FATMAN_INSTANCE_NAME?.trim();
  const expectedPages = Number(env.FATMAN_EXPECTED_PAGES);
  const threshold = Number(env.FATMAN_MIN_SCORE);
  return env.FATMAN_ENABLED?.trim().toLowerCase() === "true" &&
    Boolean(version && instanceName && env.FATMAN_SEARCH && env.DB) &&
    Number.isSafeInteger(expectedPages) && expectedPages > 0 &&
    Number.isFinite(threshold) && threshold >= 0 && threshold <= 1;
}

/** Checks the durable indexed state without requiring the public book-mode flag to be enabled. */
export async function isFatmanIndexed(env: Env): Promise<boolean> {
  if (!hasFatmanConfiguration(env)) return false;
  try {
    const state = await getFatmanBookState(env);
    return state.documentVersion === env.FATMAN_DOCUMENT_VERSION?.trim() &&
      state.indexedPages === Number(env.FATMAN_EXPECTED_PAGES);
  } catch {
    return false;
  }
}

export async function isFatmanReady(env: Env): Promise<boolean> {
  if (!env.BRVIN_SERVICE) return false;
  try {
    const status = await env.BRVIN_SERVICE.getProjectStatus();
    return status.ok && status.ready;
  } catch {
    return false;
  }
}

/**
 * Live Telegram retrieval crosses the private BRVIN Service Binding. The
 * project identity is selected by trusted Worker configuration, never by the
 * Telegram request or the student.
 */
export async function retrieveFatmanContext(env: Env, query: string): Promise<FatmanBookContext> {
  if (!env.BRVIN_SERVICE) {
    throw new FatmanRetrievalError(
      "BRVIN retrieval is not configured.",
      false,
      "Fatman Mode is temporarily unavailable. Please try again later.",
    );
  }
  const normalizedQuery = normalizeFatmanQuery(query);
  if (!normalizedQuery) throw new FatmanRetrievalError("Fatman search query is empty.", false);

  let result: BrvinServiceRetrievalResult;
  try {
    const pageNumbers = extractFatmanPageNumbers(normalizedQuery);
    result = await env.BRVIN_SERVICE.retrieveProjectContext({
      queries: buildFatmanSearchQueries(normalizedQuery),
      ...(pageNumbers.length ? { pageNumbers } : {}),
    });
  } catch {
    throw new FatmanRetrievalError("BRVIN retrieval is temporarily unavailable.", true);
  }
  if (!result.ok) {
    throw new FatmanRetrievalError(result.message, result.retryable, result.userMessage);
  }

  return {
    passages: result.passages.map((passage) => ({
      id: passage.id,
      bookId: passage.bookId,
      bookTitle: passage.bookTitle,
      pdfPage: passage.pdfPage,
      ...(passage.printedPage ? { printedPage: passage.printedPage } : {}),
      ...(passage.section ? { section: passage.section } : {}),
      text: passage.text,
      score: passage.score,
    })),
    pageImages: (result.pageImages ?? []).map((image) => ({
      mimeType: image.mimeType,
      data: image.data,
      byteLength: image.byteLength,
    })),
    searchCount: result.searchCount,
  };
}

/**
 * Internal release QA uses the same index, query expansion, hybrid retrieval and
 * relevance rules as live answers, but does not consume a student's monthly
 * search allowance.
 */
export async function retrieveFatmanQaContext(env: Env, query: string): Promise<FatmanBookContext> {
  if (!(await isFatmanIndexed(env))) {
    throw new FatmanRetrievalError("Fatman QA requires the configured 538-page index.", false);
  }
  const normalizedQuery = normalizeFatmanQuery(query);
  if (!normalizedQuery) throw new FatmanRetrievalError("Fatman QA search query is empty.", false);
  return searchFatmanQueries(env, buildFatmanSearchQueries(normalizedQuery), MAX_QA_MATCHES);
}

/**
 * Resolve short article lookups, comparison operands and common exam shorthand
 * into a small bounded set of search phrases. The phrases are search hints only:
 * they never become answer facts and every result still passes lexical relevance.
 */
export function extractFatmanPageNumbers(value: string): number[] {
  const pages = new Set<number>();
  const pattern = /\b(?:pdf\s*)?(?:page|pg\.?|p\.?)\s*(?:no\.?\s*)?(\d{1,5})\b/giu;
  for (const match of value.matchAll(pattern)) {
    const page = Number(match[1]);
    if (Number.isSafeInteger(page) && page > 0 && page <= 100_000) pages.add(page);
  }
  return [...pages].slice(0, 3);
}

export function buildFatmanSearchQueries(value: string): string[] {
  const query = normalizeFatmanQuery(value);
  if (!query) return [];

  const queryWithoutPageLocator = normalizeFatmanQuery(
    query.replace(/\b(?:pdf\s*)?(?:page|pg\.?|p\.?)\s*(?:no\.?\s*)?\d{1,5}\b/giu, " "),
  ) || query;
  const variants: string[] = [];
  const add = (candidate: string) => {
    const normalized = normalizeFatmanQuery(candidate);
    if (normalized && !variants.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      variants.push(normalized);
    }
  };
  add(queryWithoutPageLocator);

  const expandedQuery = expandFatmanAliases(queryWithoutPageLocator);
  const article = /\barticle\s+(\d{1,3}[a-z]?)\b/iu.exec(expandedQuery);
  if (article) add("Article " + article[1] + " Indian Constitution");

  const comparison = /(?:compare|comparison|difference\s+between|differentiate|distinguish)\s+(.+?)\s+(?:with|and|versus|vs\.?)\s+(.+?)(?=,|\b(?:focusing|in terms|regarding|with respect|on)\b|$)/iu.exec(expandedQuery);
  if (comparison) {
    const left = comparison[1].replace(/[^\p{L}\p{N}]+$/gu, "").trim();
    const right = comparison[2].replace(/[^\p{L}\p{N}]+$/gu, "").trim();
    add(left + " features");
    add(right + " features");
  } else {
    if (expandedQuery !== query) add(expandedQuery);
    const compact = expandedQuery
      .replace(/\b(?:what|is|are|the|a|an|of|to|for|in|on|at|by|with|from|and|or|please|explain|describe|tell|me|about|can|could|would|should|does|do|did|was|were|who|why|how|which)\b/giu, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (compact && compact.toLowerCase() !== query.toLowerCase()) add(compact);
  }

  return variants.slice(0, MAX_SEARCH_VARIANTS);
}

function expandFatmanAliases(value: string): string {
  let expanded = value.replace(/\bDPSPs?\b/giu, "Directive Principles of State Policy");
  if (/\bDPSP\b/iu.test(value) && /\bFR\b/iu.test(value)) {
    expanded = expanded.replace(/\bFR\b/giu, "Fundamental Rights");
  }
  return expanded;
}

async function searchFatmanQueries(
  env: Env,
  queries: string[],
  maxResults: number,
): Promise<FatmanBookContext> {
  const results = await Promise.allSettled(
    queries.slice(0, MAX_SEARCH_VARIANTS).map((query) => searchFatmanContext(env, query, maxResults)),
  );
  const contexts = results
    .filter((result): result is PromiseFulfilledResult<FatmanBookContext> => result.status === "fulfilled")
    .map((result) => result.value);
  if (!contexts.length) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  }
  return { ...mergeFatmanContexts(contexts), searchCount: results.length };
}

async function searchFatmanContext(env: Env, normalizedQuery: string, maxResults: number): Promise<FatmanBookContext> {
  let chunks: AiSearchChunk[];
  try {
    const instance = env.FATMAN_SEARCH!.get(env.FATMAN_INSTANCE_NAME!.trim());
    const result = await instance.search({
      messages: [{ role: "user", content: normalizedQuery }],
      ai_search_options: {
        retrieval: {
          max_num_results: maxResults,
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
  const pageCounts = new Map<string, number>();
  const allowedPages = new Set<string>();
  const state = await getFatmanBookState(env);
  const legacyReady = state.enabled &&
    state.documentVersion === env.FATMAN_DOCUMENT_VERSION?.trim() &&
    state.indexedPages === Number(env.FATMAN_EXPECTED_PAGES);
  const readyBookRows = await env.DB!.prepare(FATMAN_BRVIN_READY_SOURCES_SQL)
    .all<{ id: string; title: string }>();
  const readyBookTitles = new Map((readyBookRows.results ?? []).map((book) => [book.id, book.title]));
  const fatmanLegacyAssigned = readyBookTitles.has("fatman-legacy-538");

  for (const chunk of chunks) {
    const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const parsedKey = parseFatmanIndexPageKey(key);
    const pdfPage = parsedKey?.page;
    const fullText = typeof chunk.text === "string" ? cleanPassageText(chunk.text) : "";
    const score = finiteScore(chunk.score) ??
      finiteScore(chunk.scoring_details?.reranking_score) ??
      finiteScore(chunk.scoring_details?.vector_score);
    if (!pdfPage || !fullText || score === undefined || score < minScore) continue;
    if (!isFatmanPassageRelevant(normalizedQuery, fullText)) continue;
    // Test relevance against the entire OCR result before clipping.
    const text = extractFatmanEvidenceExcerpt(normalizedQuery, fullText, MAX_PASSAGE_CHARS);

    const id = typeof chunk.id === "string" && chunk.id
      ? chunk.id
      : key + ":" + text.slice(0, 80);
    if (seenIds.has(id)) continue;
    const metadata = chunk.item?.metadata;
    const bookId = parsedKey?.bookId;
    if (bookId ? !readyBookTitles.has(bookId) : (!legacyReady || !fatmanLegacyAssigned)) continue;
    const sourceKey = bookId ?? "fatman-legacy";
    const pageKey = sourceKey + ":" + pdfPage;
    if (!allowedPages.has(pageKey) && allowedPages.size >= MAX_PAGES) continue;
    const pageCount = pageCounts.get(pageKey) ?? 0;
    if (pageCount >= 2) continue;

    const printedPage = cleanMetadataText(metadata?.printedPage, 20);
    const section = cleanMetadataText(metadata?.section, 120);
    const bookTitle = bookId ? (cleanMetadataText(metadata?.bookTitle, 160) ?? readyBookTitles.get(bookId) ?? "Additional reference book") : undefined;
    passages.push({
      id,
      pdfPage,
      ...(bookId ? { bookId } : {}),
      ...(bookTitle ? { bookTitle } : {}),
      ...(printedPage ? { printedPage } : {}),
      ...(section ? { section } : {}),
      text,
      score,
    });
    seenIds.add(id);
    allowedPages.add(pageKey);
    pageCounts.set(pageKey, pageCount + 1);
    if (passages.length >= MAX_PASSAGES) break;
  }

  passages.sort((a, b) => b.score - a.score);
  return { passages, pageImages: [], searchCount: 1 };
}


/**
 * Supplies the immediately previous Fatman exchange only when a student sends
 * a context-dependent follow-up. It is retrieval context, not trusted evidence:
 * Gemini must still ground the answer in the newly retrieved book passages.
 */
export function buildFatmanRetrievalQuery(
  question: string,
  recentConversation: ConversationTurn[] = [],
): string {
  const normalizedQuestion = normalizeFatmanQuery(question);
  const latest = recentConversation.at(-1);
  if (!latest || !isFatmanFollowUp(normalizedQuestion)) return normalizedQuestion;

  return [
    "Previous student question: " + latest.question.slice(0, 400),
    "Previous Fatman answer for reference resolution only: " + latest.answer.slice(0, 900),
    "Current student follow-up: " + normalizedQuestion,
  ].join("\n");
}

function isFatmanFollowUp(question: string): boolean {
  const normalized = question.toLowerCase().replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  return /^(?:and\s+)?(?:why|how|what about|what next|which one|who was that|who is that|what does that|how so|why so|give an example|example please|explain more|simpler|in simple words|what about it|and then)\b/iu.test(normalized) ||
    /^(?:it|that|this|they|those|these|same|there)\b/iu.test(normalized) ||
    /^(?:can you explain|explain that|explain this|tell me more|continue|go on)\b/iu.test(normalized);
}

export function isFatmanPassageRelevant(query: string, passage: string): boolean {
  const queryTerms = meaningfulFatmanTerms(query);
  if (queryTerms.size === 0) return false;
  const passageTerms = meaningfulFatmanTerms(passage);
  let overlap = 0;
  for (const term of queryTerms) {
    if (passageTerms.has(term)) overlap += 1;
  }
  // Short keyword lookups need one match; natural-language and multi-part
  // questions need at least two independent content terms.
  return overlap >= (queryTerms.size <= 2 ? 1 : 2);
}

function meaningfulFatmanTerms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter((term) => term.length >= 2 && !FATMAN_QUERY_STOP_WORDS.has(term)),
  );
}

function normalizeFatmanQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim().slice(0, 4_000);
}

export function mergeFatmanContexts(contexts: FatmanBookContext[]): FatmanBookContext {
  const candidates = contexts.flatMap((context) => context.passages)
    .slice()
    .sort((a, b) => b.score - a.score);
  const passages: FatmanPassage[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  const pageCounts = new Map<string, number>();

  for (const passage of candidates) {
    const sourceKey = passage.bookId ?? "fatman-legacy";
    const pageKey = sourceKey + ":" + passage.pdfPage;
    const fingerprint = pageKey + ":" + passage.text.toLowerCase().replace(/\s+/gu, " ").slice(0, 180);
    if (ids.has(passage.id) || fingerprints.has(fingerprint)) continue;
    const pageCount = pageCounts.get(pageKey) ?? 0;
    if (pageCount >= 2 || (pageCount === 0 && pageCounts.size >= MAX_PAGES)) continue;

    ids.add(passage.id);
    fingerprints.add(fingerprint);
    pageCounts.set(pageKey, pageCount + 1);
    passages.push(passage);
    if (passages.length >= MAX_PASSAGES) break;
  }

  const searchCount = contexts.reduce((total, context) => total + (context.searchCount ?? 0), 0);
  return { passages, pageImages: [], ...(searchCount ? { searchCount } : {}) };
}

export function formatFatmanCitations(
  passages: FatmanPassage[],
  question = "",
  answer = "",
): string {
  const byBookPage = new Map<string, {
    bookId?: string;
    bookTitle: string;
    pdfPage: number;
    printedPage?: string;
    score: number;
    text: string;
  }>();
  for (const passage of passages) {
    const sourceKey = passage.bookId ?? "fatman-legacy";
    const key = sourceKey + ":" + passage.pdfPage;
    const current = byBookPage.get(key);
    byBookPage.set(key, {
      bookId: passage.bookId,
      bookTitle: passage.bookTitle ?? "Fatman 2nd Edition",
      pdfPage: passage.pdfPage,
      printedPage: current?.printedPage ?? passage.printedPage,
      score: Math.max(current?.score ?? 0, passage.score),
      text: current ? current.text + " " + passage.text : passage.text,
    });
  }

  const questionTerms = meaningfulFatmanTerms(question);
  const answerTerms = meaningfulFatmanTerms(answer);
  const ranked = [...byBookPage.values()].map((source) => {
    const passageTerms = meaningfulFatmanTerms(source.text);
    const questionOverlap = [...questionTerms].filter((term) => passageTerms.has(term)).length;
    const answerOverlap = [...answerTerms].filter((term) => passageTerms.has(term)).length;
    const questionCoverage = questionTerms.size
      ? questionOverlap / Math.min(questionTerms.size, 8)
      : 0;
    const answerCoverage = answerTerms.size
      ? answerOverlap / Math.min(answerTerms.size, 12)
      : 0;
    const relevance = source.score * 0.4 + questionCoverage * 0.2 + answerCoverage * 0.4;
    return { ...source, relevance };
  });

  const refs = ranked
    .sort((a, b) => b.relevance - a.relevance || a.bookTitle.localeCompare(b.bookTitle) || a.pdfPage - b.pdfPage)
    .slice(0, MAX_CITATION_PAGES)
    .sort((a, b) => a.bookTitle.localeCompare(b.bookTitle) || a.pdfPage - b.pdfPage)
    .map((source) => ({
      bookTitle: source.bookTitle,
      pageRef: source.printedPage
        ? "PDF p. " + source.pdfPage + " (book p. " + source.printedPage + ")"
        : "PDF p. " + source.pdfPage,
    }));
  const grouped = new Map<string, string[]>();
  for (const item of refs) {
    const list = grouped.get(item.bookTitle) ?? [];
    list.push(item.pageRef);
    grouped.set(item.bookTitle, list);
  }
  const sources = [...grouped.entries()].map(([bookTitle, pages]) => bookTitle + ", " + pages.join("; "));
  return sources.length ? "Source: " + sources.join("; ") + "." : "";
}

/**
 * Selects evidence-bearing windows across a long OCR page. The old first-N
 * character slice hid facts later on the same page, even when hybrid search
 * had found the correct page. Greedy term coverage keeps multiple distant
 * sections while avoiding repeated overlapping windows.
 */
export function extractFatmanEvidenceExcerpt(
  query: string,
  value: string,
  maxChars = MAX_PASSAGE_CHARS,
): string {
  const text = cleanPassageText(value);
  if (text.length <= maxChars) return text;

  const queryTerms = meaningfulFatmanTerms(query);
  if (!queryTerms.size) return text.slice(0, maxChars);

  const windows: Array<{ start: number; end: number; terms: Set<string> }> = [];
  for (let start = 0; start < text.length; start += FATMAN_EXCERPT_WINDOW_STEP) {
    const end = Math.min(text.length, start + FATMAN_EXCERPT_WINDOW_CHARS);
    const windowText = text.slice(start, end);
    const windowTerms = meaningfulFatmanTerms(windowText);
    const matchedTerms = new Set([...queryTerms].filter((term) => windowTerms.has(term)));
    if (matchedTerms.size) windows.push({ start, end, terms: matchedTerms });
    if (end === text.length) break;
  }

  if (!windows.length) return text.slice(0, maxChars);

  const selected: Array<{ start: number; end: number; terms: Set<string> }> = [];
  const covered = new Set<string>();
  let usedChars = 0;
  const maxWindows = Math.max(1, Math.ceil(maxChars / FATMAN_EXCERPT_WINDOW_CHARS));

  while (selected.length < maxWindows && usedChars < maxChars) {
    let best: typeof windows[number] | undefined;
    let bestScore = 0;

    for (const candidate of windows) {
      if (selected.includes(candidate)) continue;
      const overlap = selected.reduce((total, item) =>
        total + Math.max(0, Math.min(item.end, candidate.end) - Math.max(item.start, candidate.start)), 0);
      if (overlap > FATMAN_EXCERPT_WINDOW_CHARS * 0.45) continue;

      const newTerms = [...candidate.terms].filter((term) => !covered.has(term));
      const score = newTerms.length + candidate.terms.size * 0.08 - overlap / FATMAN_EXCERPT_WINDOW_CHARS;
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

  const ordered = selected.sort((a, b) => a.start - b.start);
  const pieces: string[] = [];
  let previousEnd = -1;
  let remaining = maxChars;
  for (const window of ordered) {
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

function cleanPassageText(value: string): string {
  return value
    .replace(/\bjoin\s*[-:]*\s*@?freebookspdf\d*\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
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
