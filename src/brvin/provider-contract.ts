import type { AiSearchInstance } from "../config/env";

/**
 * Core-owned retrieval port. Providers return candidates only; authorization,
 * source readiness, quota enforcement and final provenance validation remain
 * in the BRVIN service/D1 path.
 */
export interface RetrievalCandidate {
  id: string;
  itemKey: string;
  text: string;
  score?: number;
  scoringDetails?: {
    vectorScore?: number;
    keywordScore?: number;
    vectorRank?: number;
    keywordRank?: number;
    fusionMethod?: string;
    rerankingScore?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface RetrievalQuery {
  query: string;
  sourcePrefixes: string[];
  maxResults: number;
  matchThreshold: number;
  reranking?: {
    enabled: boolean;
    model?: string;
    minimumScore?: number;
  };
}

export interface RetrievalDocument {
  key: string;
  text: string;
}

export interface RetrievalProviderHealth {
  providerId: string;
  ok: boolean;
  version?: string;
}

/**
 * The provider boundary is deliberately small and contains only operations
 * needed by Core. Implementations must make upsert/delete idempotent.
 */
export interface RetrievalProvider {
  readonly providerId: string;
  /** Return the same completed/queued/running state the legacy indexer uses to skip OCR reads. */
  findExisting(key: string): Promise<{ status: string } | null>;
  upsert(document: RetrievalDocument): Promise<{ status: string }>;
  query(input: RetrievalQuery): Promise<RetrievalCandidate[]>;
  deleteByKey(key: string): Promise<void>;
  deleteSource(itemKeys: readonly string[]): Promise<void>;
  health(): Promise<RetrievalProviderHealth>;
}

/**
 * Embeddings are a separate port from retrieval/storage. M13 defines this
 * contract; M14 chooses and implements the paid Vertex model after benchmarking.
 */
export interface EmbeddingResult {
  modelId: string;
  modelVersion: string;
  dimensions: number;
  vectors: number[][];
}

export interface EmbeddingProvider {
  readonly providerId: string;
  embedDocuments(texts: readonly string[]): Promise<EmbeddingResult>;
  embedQuery(text: string): Promise<EmbeddingResult>;
}

/**
 * The currently deployed provider is the only selectable implementation in
 * M13. Selection is a server-side Worker setting, never a consumer request.
 */
export function createBrvinRetrievalProvider(
  providerId: string | undefined,
  instance: AiSearchInstance,
): RetrievalProvider {
  const selected = providerId?.trim().toLowerCase() || "cloudflare-ai-search";
  if (selected !== "cloudflare-ai-search") {
    throw new Error("The configured BRVIN retrieval provider is not implemented in this release.");
  }

  return new CloudflareAiSearchRetrievalProvider(instance);
}

class CloudflareAiSearchRetrievalProvider implements RetrievalProvider {
  readonly providerId = "cloudflare-ai-search";

  constructor(private readonly instance: AiSearchInstance) {}

  async findExisting(key: string): Promise<{ status: string } | null> {
    const found = await this.instance.items.list({
      search: key,
      per_page: 50,
      source: "builtin",
    });
    const exact = (found.result ?? []).filter((item) => item.key === key);
    const keep = exact.find((item) => item.status === "completed") ??
      exact.find((item) => item.status === "queued" || item.status === "running");

    for (const item of exact) {
      if (item.id === keep?.id) continue;
      await this.instance.items.delete(item.id);
    }
    return keep ? { status: keep.status } : null;
  }

  async upsert(document: RetrievalDocument): Promise<{ status: string }> {
    const existing = await this.findExisting(document.key);
    if (existing) return existing;

    const indexed = await this.instance.items.upload(document.key, document.text);
    if (indexed.status === "error" || indexed.status === "skipped" || indexed.status === "outdated") {
      throw new Error(indexed.error ? String(indexed.error) : "The retrieval provider rejected the indexed document.");
    }
    return { status: indexed.status };
  }

  async query(input: RetrievalQuery): Promise<RetrievalCandidate[]> {
    const result = await this.instance.search({
      messages: [{ role: "user", content: input.query }],
      ai_search_options: {
        // Strict similarity cache reuses only near-identical prompts. Core
        // still validates every returned item key against the caller's current
        // D1-authorized source prefixes before any passage text is returned.
        // Cloudflare invalidates cached entries when their indexed chunks change
        // or are deleted; the instance TTL remains 48 hours.
        cache: { enabled: true, cache_threshold: "super_strict_match" },
        retrieval: {
          max_num_results: input.maxResults,
          retrieval_type: "hybrid",
          match_threshold: input.matchThreshold,
          filters: { folder: { $in: input.sourcePrefixes } },
        },
        reranking: {
          enabled: input.reranking?.enabled === true,
          ...(input.reranking?.enabled ? {
            model: input.reranking.model,
            match_threshold: input.reranking.minimumScore,
          } : {}),
        },
      },
    });

    return (result.chunks ?? []).flatMap((chunk) => {
      const itemKey = typeof chunk.item?.key === "string" ? chunk.item.key : "";
      const text = typeof chunk.text === "string" ? chunk.text : "";
      if (!itemKey || !text) return [];
      return [{
        id: typeof chunk.id === "string" ? chunk.id : itemKey + ":" + text.slice(0, 80),
        itemKey,
        text,
        ...(typeof chunk.score === "number" ? { score: chunk.score } : {}),
        ...(chunk.scoring_details ? {
          scoringDetails: {
            ...(typeof chunk.scoring_details.vector_score === "number" ? { vectorScore: chunk.scoring_details.vector_score } : {}),
            ...(typeof chunk.scoring_details.keyword_score === "number" ? { keywordScore: chunk.scoring_details.keyword_score } : {}),
            ...(typeof chunk.scoring_details.vector_rank === "number" ? { vectorRank: chunk.scoring_details.vector_rank } : {}),
            ...(typeof chunk.scoring_details.keyword_rank === "number" ? { keywordRank: chunk.scoring_details.keyword_rank } : {}),
            ...(typeof chunk.scoring_details.fusion_method === "string" ? { fusionMethod: chunk.scoring_details.fusion_method } : {}),
            ...(typeof chunk.scoring_details.reranking_score === "number" ? { rerankingScore: chunk.scoring_details.reranking_score } : {}),
          },
        } : {}),
        ...(chunk.item?.metadata ? { metadata: chunk.item.metadata } : {}),
      }];
    });
  }

  async deleteByKey(key: string): Promise<void> {
    const found = await this.instance.items.list({ search: key, per_page: 50, source: "builtin" });
    const exact = (found.result ?? []).filter((item) => item.key === key);
    for (const item of exact) await this.instance.items.delete(item.id);
  }

  async deleteSource(itemKeys: readonly string[]): Promise<void> {
    const wanted = new Set(itemKeys);
    if (!wanted.size) return;

    // Scan the provider catalog once, then delete exact source keys. The Core
    // deletion workflow already authorizes/validates the source prefix; this
    // second exact-key check prevents a provider-side broad delete.
    const matches: string[] = [];
    for (let page = 1; page <= 10_000; page += 1) {
      const response = await this.instance.items.list({ page, per_page: 50, source: "builtin" });
      const rows = response.result ?? [];
      for (const item of rows) {
        if (wanted.has(item.key)) matches.push(item.id);
      }
      const totalPages = response.result_info?.total_pages;
      if (typeof totalPages === "number" && totalPages > 0 && page >= totalPages) break;
      if (rows.length < 50) break;
      if (page === 10_000) throw new Error("Retrieval provider deletion inventory exceeded the safety page limit.");
    }
    for (const itemId of matches) await this.instance.items.delete(itemId);
  }

  async health(): Promise<RetrievalProviderHealth> {
    try {
      await this.instance.info();
      return { providerId: this.providerId, ok: true, version: "cloudflare-ai-search-managed" };
    } catch {
      return { providerId: this.providerId, ok: false, version: "cloudflare-ai-search-managed" };
    }
  }
}
