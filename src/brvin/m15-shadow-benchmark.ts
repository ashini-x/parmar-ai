import type { AiSearchChunk, AiSearchInstance, Env } from "../config/env";
import { BRVIN_M14_PHYSICS_PILOT, BRVIN_M14_PHYSICS_QUERY_SUITE } from "./m14-physics-evaluation";
import { BrvinQdrantHybridPilot, type BrvinM14QueryResult } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";

const SOURCE_PREFIX = "brvin/books/" + BRVIN_M14_PHYSICS_PILOT.sourceId + "/pages/";
const TOP_K = 5;
const QDRANT_PREFETCH = 15;
type ShadowSearchBinding = Pick<AiSearchInstance, "search">;

export interface BrvinM15ShadowEnv extends Env {
  /** Direct binding to the current AI Search index. This runner uses search() only. */
  BRVIN_M15_AI_SEARCH?: ShadowSearchBinding;
}
interface ShadowCandidate {
  rank: number; page: number | null; score: number | null; itemKey?: string; pointId?: string;
  denseRank?: number; sparseRank?: number; rerankingScore?: number; provenanceValid: boolean; textPreview?: string;
}
interface ProviderQueryResult {
  ok: boolean; elapsedMs: number; resultCount: number; retrievedPages: Array<number | null>;
  expectedPageRanks: Array<number | null>; provenanceViolationCount: number; candidates: ShadowCandidate[];
  errorType?: string;
}
interface M15ShadowCaseResult {
  id: string; category: string; query: string; expectedPages: number[]; expectedExpression?: string;
  expectedNoMatch: boolean; cloudflareAiSearch: ProviderQueryResult; qdrantVertex: ProviderQueryResult;
}
function providerErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 64) : "ProviderError";
}
function pageFromItemKey(key: string): number | null {
  if (!key.startsWith(SOURCE_PREFIX)) return null;
  const match = key.match(/page-(\d{6})\.txt$/u);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page >= 1 && page <= BRVIN_M14_PHYSICS_PILOT.pageCount ? page : null;
}
function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}
function summarizeProvider(results: Array<{ id: string; expectedPages: number[]; expectedNoMatch: boolean; result: ProviderQueryResult }>) {
  const positive = results.filter((item) => !item.expectedNoMatch);
  const expectedPageCount = positive.reduce((sum, item) => sum + item.expectedPages.length, 0);
  const coveredExpectedPageCount = positive.reduce((sum, item) =>
    sum + item.expectedPages.filter((page) => item.result.retrievedPages.includes(page)).length, 0);
  const returnedResultCount = results.reduce((sum, item) => sum + item.result.resultCount, 0);
  const expectedPageResultCount = positive.reduce((sum, item) =>
    sum + item.result.retrievedPages.filter((page) => page !== null && item.expectedPages.includes(page)).length, 0);
  const reciprocalRankSum = positive.reduce((sum, item) => {
    const firstRank = item.result.expectedPageRanks
      .filter((rank): rank is number => rank !== null)
      .sort((left, right) => left - right)[0];
    return sum + (firstRank ? 1 / firstRank : 0);
  }, 0);
  const timings = results.filter((item) => item.result.ok).map((item) => item.result.elapsedMs);
  const noMatch = results.filter((item) => item.expectedNoMatch);
  return {
    queries: results.length,
    successfulQueries: results.filter((item) => item.result.ok).length,
    failedQueries: results.filter((item) => !item.result.ok).length,
    expectedPageCount,
    coveredExpectedPageCount,
    expectedPageCoverageRate: expectedPageCount ? coveredExpectedPageCount / expectedPageCount : 0,
    allExpectedPagesCovered: expectedPageCount > 0 && coveredExpectedPageCount === expectedPageCount,
    returnedResultCount,
    expectedPageResultCount,
    pageLabelPrecisionAt5: returnedResultCount ? expectedPageResultCount / returnedResultCount : 0,
    meanReciprocalExpectedPageRank: positive.length ? reciprocalRankSum / positive.length : 0,
    provenanceViolationCount: results.reduce((sum, item) => sum + item.result.provenanceViolationCount, 0),
    noMatchCases: noMatch.map((item) => ({
      id: item.id, resultCount: item.result.resultCount, topScore: item.result.candidates[0]?.score ?? null,
    })),
    observedQueryLatencyMs: {
      sampleCount: timings.length,
      p50: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      p99: percentile(timings, 0.99),
      note: "Twelve sequential paired samples only; staging observation, not a load test or production SLO.",
    },
  };
}
async function timedQuery(run: () => Promise<ShadowCandidate[]>, expectedPages: number[]): Promise<ProviderQueryResult> {
  const started = performance.now();
  try {
    const candidates = await run();
    const retrievedPages = candidates.map((candidate) => candidate.page);
    return {
      ok: true, elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      resultCount: candidates.length, retrievedPages,
      expectedPageRanks: expectedPages.map((page) => {
        const index = retrievedPages.indexOf(page);
        return index >= 0 ? index + 1 : null;
      }),
      provenanceViolationCount: candidates.filter((candidate) => !candidate.provenanceValid).length,
      candidates,
    };
  } catch (error) {
    return {
      ok: false, elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      resultCount: 0, retrievedPages: [], expectedPageRanks: expectedPages.map(() => null),
      provenanceViolationCount: 0, candidates: [], errorType: providerErrorType(error),
    };
  }
}
function mapAiSearchCandidates(chunks: AiSearchChunk[]): ShadowCandidate[] {
  return chunks.slice(0, TOP_K).map((chunk, index) => {
    const itemKey = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const page = pageFromItemKey(itemKey);
    const provenanceValid = page !== null;
    return {
      rank: index + 1, page, score: typeof chunk.score === "number" ? chunk.score : null,
      ...(provenanceValid ? { itemKey, ...(typeof chunk.id === "string" ? { pointId: chunk.id } : {}) } : {}),
      ...(typeof chunk.scoring_details?.vector_rank === "number" ? { denseRank: chunk.scoring_details.vector_rank } : {}),
      ...(typeof chunk.scoring_details?.keyword_rank === "number" ? { sparseRank: chunk.scoring_details.keyword_rank } : {}),
      ...(typeof chunk.scoring_details?.reranking_score === "number" ? { rerankingScore: chunk.scoring_details.reranking_score } : {}),
      provenanceValid,
      ...(provenanceValid && typeof chunk.text === "string" ? { textPreview: chunk.text.slice(0, 900) } : {}),
    };
  });
}
function mapQdrantCandidates(chunks: BrvinM14QueryResult[]): ShadowCandidate[] {
  return chunks.slice(0, TOP_K).map((chunk, index) => {
    const provenanceValid = chunk.sourceId === BRVIN_M14_PHYSICS_PILOT.sourceId &&
      chunk.itemKey.startsWith(SOURCE_PREFIX) && chunk.pdfPage >= 1 &&
      chunk.pdfPage <= BRVIN_M14_PHYSICS_PILOT.pageCount;
    return {
      rank: index + 1, page: provenanceValid ? chunk.pdfPage : null, score: chunk.score ?? null,
      ...(provenanceValid ? { itemKey: chunk.itemKey, pointId: chunk.id, textPreview: chunk.text.slice(0, 900) } : {}),
      provenanceValid,
    };
  });
}

/** Read-only M15 paired provider benchmark. Uses only AI Search search() and Qdrant points/query. */
export async function runBrvinM15ShadowBenchmark(env: BrvinM15ShadowEnv) {
  if (!env.BRVIN_M15_AI_SEARCH) throw new Error("The M15 direct AI Search binding is not configured.");
  if (!env.BRVIN_M14_VERTEX_LOCATION?.trim() || !env.BRVIN_M14_VERTEX_MODEL?.trim() ||
      !env.BRVIN_M14_EMBEDDING_DIMENSIONS || !env.BRVIN_M14_QDRANT_URL?.trim() ||
      !env.BRVIN_M14_QDRANT_API_KEY?.trim() || !env.BRVIN_M14_QDRANT_COLLECTION?.trim()) {
    throw new Error("The isolated M15 Vertex/Qdrant configuration is incomplete.");
  }
  const dimensions = Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 3072) {
    throw new Error("The M15 embedding dimensions are invalid.");
  }
  const qdrant = new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL, apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection: env.BRVIN_M14_QDRANT_COLLECTION, dimensions,
  }, new BrvinVertexEmbeddingProvider(env));
  const results: M15ShadowCaseResult[] = [];

  // Bounded at one in-flight query per provider. Concurrency/load is tested separately.
  for (const item of BRVIN_M14_PHYSICS_QUERY_SUITE) {
    const [aiSearchResult, qdrantResult] = await Promise.all([
      timedQuery(async () => {
        const response = await env.BRVIN_M15_AI_SEARCH!.search({
          messages: [{ role: "user", content: item.query }],
          ai_search_options: {
            cache: { enabled: false },
            retrieval: {
              max_num_results: 16, match_threshold: 0.3, retrieval_type: "hybrid",
              keyword_match_mode: "or", filters: { folder: { $in: [SOURCE_PREFIX] } },
            },
            reranking: { enabled: true, model: "@cf/baai/bge-reranker-base", match_threshold: 0.4 },
          },
        });
        const candidates = mapAiSearchCandidates(response.chunks ?? []);
        if (candidates.some((candidate) => !candidate.provenanceValid)) {
          throw new Error("AI Search returned a candidate outside the pinned Physics source prefix.");
        }
        return candidates;
      }, item.expectedPdfPages),
      timedQuery(async () => {
        const chunks = await qdrant.query({
          projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
          authorizedSourceIds: [BRVIN_M14_PHYSICS_PILOT.sourceId],
          query: item.query, limit: TOP_K, prefetchLimit: QDRANT_PREFETCH, ensureCollection: false,
        });
        const candidates = mapQdrantCandidates(chunks);
        if (candidates.some((candidate) => !candidate.provenanceValid)) {
          throw new Error("Qdrant returned a candidate with mismatched Physics source/page provenance.");
        }
        return candidates;
      }, item.expectedPdfPages),
    ]);
    results.push({
      id: item.id, category: item.category, query: item.query,
      expectedPages: [...item.expectedPdfPages],
      ...(item.expectedExpression ? { expectedExpression: item.expectedExpression } : {}),
      expectedNoMatch: item.expectedNoMatch === true,
      cloudflareAiSearch: aiSearchResult, qdrantVertex: qdrantResult,
    });
  }

  const summarize = (provider: "cloudflareAiSearch" | "qdrantVertex") =>
    summarizeProvider(results.map((item) => ({
      id: item.id,
      expectedPages: item.expectedPages,
      expectedNoMatch: item.expectedNoMatch,
      result: item[provider],
    })));
  return {
    benchmark: "brvin-m15-read-only-shadow",
    projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
    sourceId: BRVIN_M14_PHYSICS_PILOT.sourceId,
    sourceSha256: BRVIN_M14_PHYSICS_PILOT.sourceSha256,
    sourcePrefix: SOURCE_PREFIX,
    sourcePageCount: BRVIN_M14_PHYSICS_PILOT.pageCount,
    queryCount: results.length,
    providers: {
      cloudflareAiSearch: {
        instance: "fatman-2026-8b183803", mode: "direct read-only search() binding",
        summary: summarize("cloudflareAiSearch"),
      },
      qdrantVertex: {
        collection: env.BRVIN_M14_QDRANT_COLLECTION,
        embeddingModel: env.BRVIN_M14_VERTEX_MODEL,
        dimensions,
        mode: "read-only points/query",
        summary: summarize("qdrantVertex"),
      },
    },
    results,
    sideEffects: {
      aiSearchItemsUploaded: 0, aiSearchItemsDeleted: 0,
      qdrantPointsUpserted: 0, qdrantPointsDeleted: 0,
      sourceOrOcrChanged: false, providerSelectorChanged: false,
      consumerAnswersChanged: false,
    },
    interpretation: "Page-level comparison only. AI Search has 11 auto-chunks while Qdrant has 7 custom chunks; do not apply Qdrant chunk qrels to AI Search. Independent passage qrels or normalized source-span mapping, broader corpus, concurrency/load, authorization/revocation and cost remain M15 gates. Negative cases measure retrieval candidates only, not Gemini answer abstention. Latency samples are staging timings, not a production SLO or load test.",
  };
}
