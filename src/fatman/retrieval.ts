import type { AiSearchChunk, ConversationTurn, Env, GeminiImageInput } from "../config/env";
import { getFatmanBookState, reserveFatmanSearchQuery } from "../analytics/db";

const MAX_MATCHES = 12;
const MAX_QA_MATCHES = 50;
const MAX_SEARCH_VARIANTS = 3;
const MAX_CITATION_PAGES = 5;
const MAX_PASSAGES = 8;
const MAX_PAGES = 6;
const MAX_PASSAGE_CHARS = 2_000;

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
  if (!hasFatmanConfiguration(env)) return false;
  try {
    const state = await getFatmanBookState(env);
    return state.enabled &&
      state.documentVersion === env.FATMAN_DOCUMENT_VERSION?.trim() &&
      state.indexedPages === Number(env.FATMAN_EXPECTED_PAGES);
  } catch {
    return false;
  }
}

export async function retrieveFatmanContext(env: Env, query: string): Promise<FatmanBookContext> {
  if (!(await isFatmanReady(env))) {
    throw new FatmanRetrievalError("Fatman retrieval is not configured.", false);
  }

  const normalizedQuery = normalizeFatmanQuery(query);
  if (!normalizedQuery) throw new FatmanRetrievalError("Fatman search query is empty.", false);

  const configuredLimit = Number(env.FATMAN_MONTHLY_QUERY_LIMIT);
  const monthlyLimit = Number.isFinite(configuredLimit)
    ? Math.max(1, Math.min(800, Math.floor(configuredLimit)))
    : 800;
  const usage = await reserveFatmanSearchQuery(env, monthlyLimit);
  if (!usage.allowed) {
    throw new FatmanRetrievalError(
      "Fatman has reached this month's included search limit.",
      false,
      "Fatman search has reached this month's free usage limit. Use /help to return to usual study mode.",
    );
  }

  return searchFatmanQueries(env, buildFatmanSearchQueries(normalizedQuery), MAX_MATCHES);
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
export function buildFatmanSearchQueries(value: string): string[] {
  const query = normalizeFatmanQuery(value);
  if (!query) return [];

  const variants: string[] = [];
  const add = (candidate: string) => {
    const normalized = normalizeFatmanQuery(candidate);
    if (normalized && !variants.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      variants.push(normalized);
    }
  };
  add(query);

  const expandedQuery = expandFatmanAliases(query);
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
  const pageCounts = new Map<number, number>();
  const allowedPages = new Set<number>();

  for (const chunk of chunks) {
    const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const pdfPage = pageNumberFromKey(key);
    const text = typeof chunk.text === "string" ? cleanPassageText(chunk.text).slice(0, MAX_PASSAGE_CHARS) : "";
    const score = finiteScore(chunk.score) ??
      finiteScore(chunk.scoring_details?.reranking_score) ??
      finiteScore(chunk.scoring_details?.vector_score);
    if (!pdfPage || !text || score === undefined || score < minScore) continue;
    if (!isFatmanPassageRelevant(normalizedQuery, text)) continue;

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
  const pageCounts = new Map<number, number>();

  for (const passage of candidates) {
    const fingerprint = passage.pdfPage + ":" + passage.text.toLowerCase().replace(/\s+/gu, " ").slice(0, 180);
    if (ids.has(passage.id) || fingerprints.has(fingerprint)) continue;
    const pageCount = pageCounts.get(passage.pdfPage) ?? 0;
    if (pageCount >= 2 || (pageCount === 0 && pageCounts.size >= MAX_PAGES)) continue;

    ids.add(passage.id);
    fingerprints.add(fingerprint);
    pageCounts.set(passage.pdfPage, pageCount + 1);
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
  const byPdfPage = new Map<number, {
    printedPage?: string;
    score: number;
    text: string;
  }>();
  for (const passage of passages) {
    const current = byPdfPage.get(passage.pdfPage);
    byPdfPage.set(passage.pdfPage, {
      printedPage: current?.printedPage ?? passage.printedPage,
      score: Math.max(current?.score ?? 0, passage.score),
      text: current ? current.text + " " + passage.text : passage.text,
    });
  }

  const questionTerms = meaningfulFatmanTerms(question);
  const answerTerms = meaningfulFatmanTerms(answer);
  const ranked = [...byPdfPage.entries()].map(([pdfPage, source]) => {
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
    return { pdfPage, printedPage: source.printedPage, relevance };
  });

  const refs = ranked
    .sort((a, b) => b.relevance - a.relevance || a.pdfPage - b.pdfPage)
    .slice(0, MAX_CITATION_PAGES)
    .sort((a, b) => a.pdfPage - b.pdfPage)
    .map(({ pdfPage, printedPage }) => printedPage
      ? "PDF p. " + pdfPage + " (book p. " + printedPage + ")"
      : "PDF p. " + pdfPage);
  return refs.length ? "Source: Fatman 2nd Edition, " + refs.join("; ") + "." : "";
}

function pageNumberFromKey(key: string): number | undefined {
  if (!key.startsWith("fatman/pages/")) return undefined;
  const match = /^fatman\/pages\/page-(\d{1,6})\.(?:jpg|jpeg|pdf|txt)$/iu.exec(key);
  if (!match) return undefined;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : undefined;
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
