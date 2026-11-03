import type { AiSearchChunk, Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import { parseFatmanIndexPageKey } from "../fatman/library";

export interface BrvinPassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  text: string;
  score: number;
}

export interface BrvinProjectContext {
  project: { id: string; name: string; slug: string };
  passages: BrvinPassage[];
  searchedSources: number;
}

interface BrvinSource {
  id: string;
  title: string;
  search_prefix: string;
}

export class BrvinRetrievalError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "BrvinRetrievalError";
    this.retryable = retryable;
  }
}

function cleanText(value: unknown, max = 4_500): string {
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

/**
 * BRVIN project retrieval is fail-closed: only verified books reachable through
 * an explicit direct-book or collection grant can be searched or cited.
 */
export async function retrieveBrvinProjectContext(
  env: Env,
  projectSlug: string,
  query: string,
): Promise<BrvinProjectContext> {
  if (!env.DB || !env.FATMAN_SEARCH || !env.FATMAN_INSTANCE_NAME?.trim()) {
    throw new BrvinRetrievalError("BRVIN retrieval is not configured.");
  }
  const normalized = cleanText(query, 2_000);
  if (!normalized) throw new BrvinRetrievalError("BRVIN search query is empty.");

  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare(
      "SELECT id,name,slug FROM brvin_projects WHERE slug=? AND status='active' LIMIT 1"
    ).bind(projectSlug).first<{ id: string; name: string; slug: string }>();
    if (!project) throw new BrvinRetrievalError("This project is not registered with BRVIN.");

    const grants = await env.DB.prepare(
      "SELECT DISTINCT b.id,b.title,b.search_prefix FROM brvin_books b " +
      "JOIN brvin_projects p ON p.id=? AND p.status='active' " +
      "LEFT JOIN brvin_project_books pb ON pb.project_id=p.id AND pb.book_id=b.id " +
      "LEFT JOIN brvin_project_collections pc ON pc.project_id=p.id AND pc.collection_id=b.collection_id " +
      "WHERE b.status='ready' AND b.indexed_pages=b.page_count AND (pb.book_id IS NOT NULL OR pc.collection_id IS NOT NULL)"
    ).bind(project.id).all<BrvinSource>();
    const sources = grants.results ?? [];
    if (!sources.length) return { project, passages: [], searchedSources: 0 };

    const sourceById = new Map(sources.map(source => [source.id, source]));
    const prefixToSource = [...sources].sort((a,b)=>b.search_prefix.length-a.search_prefix.length);
    let result: { chunks?: AiSearchChunk[] };
    try {
      result = await env.FATMAN_SEARCH.get(env.FATMAN_INSTANCE_NAME.trim()).search({
        messages: [{ role: "user", content: normalized }],
        ai_search_options: { retrieval: { max_num_results: 50, retrieval_type: "hybrid" } },
      });
    } catch (error) {
      throw new BrvinRetrievalError(error instanceof Error ? error.message : String(error), true);
    }

    const queryTerms = new Set(terms(normalized));
    const minScoreValue = Number(env.FATMAN_MIN_SCORE ?? "0.2");
    const minScore = Number.isFinite(minScoreValue) ? Math.min(1,Math.max(0,minScoreValue)) : 0.2;
    const passages: BrvinPassage[] = [];
    const seen = new Set<string>();
    for (const chunk of result.chunks ?? []) {
      const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
      const source = prefixToSource.find(item => key.startsWith(item.search_prefix));
      if (!source || !sourceById.has(source.id)) continue;
      const parsed = parseFatmanIndexPageKey(key);
      if (!parsed || parsed.page < 1 || (parsed.bookId && parsed.bookId !== source.id)) continue;
      const score = finiteScore(chunk.score) ??
        finiteScore(chunk.scoring_details?.reranking_score) ??
        finiteScore(chunk.scoring_details?.vector_score);
      if (score === undefined || score < minScore) continue;
      const rawText = cleanText(chunk.text, 12_000);
      if (!rawText) continue;
      const overlap = terms(rawText).some(term => queryTerms.has(term));
      if (!overlap) continue;
      const text = cleanText(rawText, 4_500);
      const id = typeof chunk.id === "string" && chunk.id ? chunk.id : key + ":" + text.slice(0,80);
      if (seen.has(id)) continue;
      passages.push({
        id, bookId: source.id, bookTitle: source.title,
        pdfPage: parsed.page, text, score,
      });
      seen.add(id);
      if (passages.length >= 12) break;
    }
    passages.sort((a,b)=>b.score-a.score);
    return { project, passages, searchedSources: sources.length };
  } catch (error) {
    if (error instanceof BrvinRetrievalError) throw error;
    throw new BrvinRetrievalError(error instanceof Error ? error.message : String(error), true);
  }
}

/** Useful for admin/test diagnostics without exposing document text. */
export async function listBrvinProjectSources(env: Env, projectSlug: string): Promise<Array<{ id: string; title: string; pageCount: number }>> {
  if (!env.DB) throw new BrvinRetrievalError("BRVIN database is not configured.");
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(
    "SELECT DISTINCT b.id,b.title,b.page_count FROM brvin_books b " +
    "JOIN brvin_projects p ON p.id=(SELECT id FROM brvin_projects WHERE slug=? AND status='active' LIMIT 1) " +
    "LEFT JOIN brvin_project_books pb ON pb.project_id=p.id AND pb.book_id=b.id " +
    "LEFT JOIN brvin_project_collections pc ON pc.project_id=p.id AND pc.collection_id=b.collection_id " +
    "WHERE b.status='ready' AND b.indexed_pages=b.page_count AND (pb.book_id IS NOT NULL OR pc.collection_id IS NOT NULL) " +
    "ORDER BY b.title COLLATE NOCASE"
  ).bind(projectSlug).all<{id:string;title:string;page_count:number}>();
  return (result.results??[]).map(row=>({id:row.id,title:row.title,pageCount:Number(row.page_count)}));
}
