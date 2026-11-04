import type { AiSearchChunk, Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import { parseFatmanIndexPageKey } from "../fatman/library";

const MAX_QUERIES = 3;
const MAX_RESULTS_PER_QUERY = 50;
const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARS = 4_500;
const MAX_RAW_PASSAGE_CHARS = 12_000;

export type BrvinRetrievalEnv = Pick<Env, "DB" | "FATMAN_SEARCH" | "FATMAN_INSTANCE_NAME" | "FATMAN_MIN_SCORE">;

export interface BrvinPassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
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

function terms(value: string): string[] {
  return value.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
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

    for (const searchResult of successful) {
      const queryTerms = new Set(terms(searchResult.value.query));
      for (const chunk of searchResult.value.chunks) {
        const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
        const source = prefixSources.find((item) => key.startsWith(item.search_prefix));
        if (!source) continue;

        const parsed = parseFatmanIndexPageKey(key);
        if (!parsed || parsed.page < 1) continue;
        if (parsed.bookId && parsed.bookId !== source.id) continue;
        // The only valid page key without an embedded book UUID is the
        // immutable, built-in Fatman legacy reference.
        if (!parsed.bookId && (source.id !== "fatman-legacy-538" || source.search_prefix !== "fatman/pages/")) {
          continue;
        }

        const score = finiteScore(chunk.score) ??
          finiteScore(chunk.scoring_details?.reranking_score) ??
          finiteScore(chunk.scoring_details?.vector_score);
        if (score === undefined || score < minScore) continue;

        const rawText = cleanText(chunk.text, MAX_RAW_PASSAGE_CHARS);
        if (!rawText || !terms(rawText).some((term) => queryTerms.has(term))) continue;

        const text = cleanText(rawText, MAX_PASSAGE_CHARS);
        const id = typeof chunk.id === "string" && chunk.id
          ? chunk.id
          : key + ":" + text.slice(0, 80);
        const previous = bestById.get(id);
        if (!previous || score > previous.score) {
          bestById.set(id, {
            id,
            bookId: source.id,
            bookTitle: source.title,
            pdfPage: parsed.page,
            text,
            score,
          });
        }
      }
    }

    const passages = [...bestById.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PASSAGES);

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
