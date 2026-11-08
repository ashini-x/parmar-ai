import type { EmbeddingProvider, RetrievalCandidate } from "./provider-contract";
import { sha256Hex } from "./corpus";

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu;

export interface BrvinSparseVector {
  indices: number[];
  values: number[];
}

export interface BrvinM14ChunkInput {
  id: string;
  chunkIndex: number;
  normalizedText: string;
  contentSha256: string;
  contentTypes: string[];
  formulaCandidates: Array<{
    originalExpression: string;
    normalizedSearchExpression: string;
    confidence: string;
  }>;
}

export interface BrvinM14QueryResult extends RetrievalCandidate {
  pdfPage: number;
  sourceId: string;
  contentTypes: string[];
}

/** Case- and symbol-preserving sparse terms: F != f, x != ×, and - != −. */
export async function buildBrvinSparseVector(text: string): Promise<BrvinSparseVector> {
  const frequencies = new Map<string, number>();
  const normalizedText = text.normalize("NFC");
  TOKEN_PATTERN.lastIndex = 0;
  for (let match = TOKEN_PATTERN.exec(normalizedText); match; match = TOKEN_PATTERN.exec(normalizedText)) {
    const term = match[0];
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  const byIndex = new Map<number, { term: string; weight: number }>();
  for (const [term, frequency] of frequencies) {
    const digest = await sha256Hex("brvin-sparse-term-v1|" + term);
    const index = Number.parseInt(digest.slice(0, 8), 16) >>> 0;
    const existing = byIndex.get(index);
    if (existing && existing.term !== term) {
      throw new Error("A sparse-token hash collision was detected; indexing is stopped to preserve symbol identity.");
    }
    byIndex.set(index, { term, weight: 1 + Math.log(frequency) });
  }

  const sorted = [...byIndex.entries()].sort(([left], [right]) => left - right);
  return {
    indices: sorted.map(([index]) => index),
    values: sorted.map(([, item]) => item.weight),
  };
}

export async function brvinM14PointId(sourceId: string, itemKey: string, chunkId: string, contentSha256: string): Promise<string> {
  const digest = await sha256Hex([
    "brvin-m14-point-v1", sourceId, itemKey, chunkId, contentSha256,
  ].join("|"));
  const variant = ((Number.parseInt(digest[16], 16) & 0x03) | 0x08).toString(16);
  return digest.slice(0, 8) + "-" + digest.slice(8, 12) + "-5" +
    digest.slice(13, 16) + "-" + variant + digest.slice(17, 20) + "-" + digest.slice(20, 32);
}

function configuredUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("BRVIN M14 Qdrant URL is not configured.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BRVIN M14 Qdrant URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("BRVIN M14 Qdrant URL must be an HTTPS cluster origin without embedded credentials, query or fragment.");
  }
  return parsed.origin.replace(/\/$/u, "");
}

function configuredCollection(value: string | undefined): string {
  const collection = value?.trim() || "brvin_m14_physics_pilot_v1";
  if (!/^[a-zA-Z0-9_-]{3,100}$/u.test(collection)) {
    throw new Error("BRVIN M14 Qdrant collection name is invalid.");
  }
  return collection;
}

function validDimensions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_072) {
    throw new Error("BRVIN M14 Qdrant dense-vector dimensions are invalid.");
  }
  return value;
}

function payloadFilter(projectId: string, sourceIds: readonly string[]): Record<string, unknown> {
  if (!projectId.trim() || !sourceIds.length || sourceIds.some((id) => !id.trim())) {
    throw new Error("Qdrant retrieval requires a server-authorized project and non-empty source allowlist.");
  }
  return {
    must: [
      { key: "project_id", match: { value: projectId } },
      { key: "source_id", match: { any: [...new Set(sourceIds)] } },
    ],
  };
}

interface QdrantEnvelope<T> {
  result?: T;
  status?: string | { error?: string };
  time?: number;
  error?: string;
}

interface QdrantCollectionInfo {
  config?: {
    params?: {
      vectors?: Record<string, unknown> | { size?: number; distance?: string };
      sparse_vectors?: Record<string, unknown>;
    };
  };
  status?: string;
}

interface QdrantPoint {
  id?: string | number;
  score?: number;
  payload?: Record<string, unknown>;
}

interface QdrantOperationResult {
  operation_id?: number;
  status?: string;
}

interface QdrantQueryResponse {
  points?: QdrantPoint[];
}

export class BrvinQdrantHybridPilot {
  readonly providerId = "qdrant-dense-sparse-rrf";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly collection: string;
  private readonly dimensions: number;
  private readonly request: typeof fetch;

  constructor(
    config: {
      url: string | undefined;
      apiKey: string | undefined;
      collection?: string;
      dimensions: number;
    },
    private readonly embeddings: EmbeddingProvider,
    request: typeof fetch = fetch,
  ) {
    // Cloudflare's native fetch checks its receiver. Once stored on a class,
    // calling this.request(...) would otherwise pass the class instance as
    // this and fail with an Illegal invocation error in Workers.
    this.request = request.bind(globalThis);
    this.baseUrl = configuredUrl(config.url);
    this.apiKey = config.apiKey?.trim() ?? "";
    if (!this.apiKey) throw new Error("BRVIN M14 Qdrant API key is not configured.");
    this.collection = configuredCollection(config.collection);
    this.dimensions = validDimensions(config.dimensions);
  }

  async ensureCollection(): Promise<void> {
    const path = "/collections/" + encodeURIComponent(this.collection);
    const existing = await this.requestJson<QdrantCollectionInfo>(path, "GET", undefined, true);
    if (existing) {
      this.assertCollectionCompatibility(existing);
      return;
    }
    try {
      await this.requestJson(path, "PUT", {
        vectors: { dense: { size: this.dimensions, distance: "Cosine" } },
        sparse_vectors: { sparse: { modifier: "idf" } },
        metadata: {
          owner: "brvin-core",
          purpose: "m14-isolated-physics-pilot",
          embedding_provider: "vertex-gemini-embedding-001",
          embedding_dimensions: this.dimensions,
          sparse_model: "unicode-symbol-tokenizer-v1",
        },
      });
    } catch (error) {
      // A concurrent initializer may have won the create race. Re-read and
      // accept only an exactly compatible collection.
      const afterRace = await this.requestJson<QdrantCollectionInfo>(path, "GET", undefined, true);
      if (!afterRace) throw error;
      this.assertCollectionCompatibility(afterRace);
    }
    const created = await this.requestJson<QdrantCollectionInfo>(path, "GET");
    if (!created) throw new Error("The newly created Qdrant M14 collection could not be read back.");
    this.assertCollectionCompatibility(created);
  }

  async upsertPageChunks(input: {
    projectId: string;
    sourceId: string;
    itemKey: string;
    pdfPage: number;
    generationId: string;
    chunks: readonly BrvinM14ChunkInput[];
  }): Promise<{ pointCount: number; ids: string[]; modelId: string; modelVersion: string }> {
    if (!input.projectId.trim() || !input.sourceId.trim() || !input.itemKey.trim() ||
        !Number.isSafeInteger(input.pdfPage) || input.pdfPage < 1 || !input.generationId.trim() ||
        input.chunks.length < 1) {
      throw new Error("A complete, provenance-bearing page manifest is required for Qdrant upsert.");
    }
    await this.ensureCollection();
    const documentEmbeddings = await this.embeddings.embedDocuments(input.chunks.map((chunk) => chunk.normalizedText));
    if (documentEmbeddings.vectors.length !== input.chunks.length || documentEmbeddings.dimensions !== this.dimensions) {
      throw new Error("Vertex document embeddings do not match the Qdrant pilot collection dimensions.");
    }

    const points = await Promise.all(input.chunks.map(async (chunk, index) => {
      if (!chunk.id || !chunk.normalizedText.trim() || !/^[a-f0-9]{64}$/iu.test(chunk.contentSha256)) {
        throw new Error("A chunk is missing a valid deterministic identity, text or content hash.");
      }
      const dense = documentEmbeddings.vectors[index];
      if (dense.length !== this.dimensions || dense.some((value) => !Number.isFinite(value))) {
        throw new Error("Vertex returned a chunk embedding with an invalid dimension.");
      }
      const sparse = await buildBrvinSparseVector(chunk.normalizedText);
      const id = await brvinM14PointId(input.sourceId, input.itemKey, chunk.id, chunk.contentSha256);
      return {
        id,
        vector: { dense, sparse },
        payload: {
          project_id: input.projectId,
          source_id: input.sourceId,
          item_key: input.itemKey,
          pdf_page: input.pdfPage,
          generation_id: input.generationId,
          chunk_id: chunk.id,
          chunk_index: chunk.chunkIndex,
          content_sha256: chunk.contentSha256,
          chunk_text: chunk.normalizedText,
          content_types: chunk.contentTypes,
          formula_candidates: chunk.formulaCandidates,
          payload_schema: 1,
        },
      };
    }));

    const collectionPath = "/collections/" + encodeURIComponent(this.collection);
    const upsert = await this.requestJson<QdrantOperationResult>(
      collectionPath + "/points?wait=true",
      "PUT",
      { points },
    );
    if (upsert?.status !== "completed") {
      throw new Error("Qdrant did not confirm the page upsert as completed; no index success is reported.");
    }

    // A completed write is not enough for the pilot receipt: retrieve every
    // deterministic ID and verify its exact source/page/generation identity.
    // This prevents a successful HTTP response with missing or mismatched
    // stored payload from being counted as an indexed page.
    const readback = await this.requestJson<QdrantPoint[]>(
      collectionPath + "/points",
      "POST",
      {
        ids: points.map((point) => point.id),
        with_payload: true,
        with_vector: false,
      },
    );
    if (!Array.isArray(readback) || readback.length !== points.length) {
      throw new Error("Qdrant point read-back did not return every expected deterministic point ID.");
    }

    const byId = new Map<string, QdrantPoint>();
    for (const point of readback) {
      const id = typeof point.id === "string" || typeof point.id === "number" ? String(point.id) : "";
      if (!id || byId.has(id)) {
        throw new Error("Qdrant point read-back returned a missing or duplicate point ID.");
      }
      byId.set(id, point);
    }

    for (const expected of points) {
      const stored = byId.get(expected.id);
      const payload = stored?.payload;
      if (!stored || String(stored.id) !== expected.id ||
          payload?.project_id !== input.projectId ||
          payload?.source_id !== input.sourceId ||
          payload?.item_key !== input.itemKey ||
          Number(payload?.pdf_page) !== input.pdfPage ||
          payload?.generation_id !== input.generationId ||
          payload?.chunk_id !== expected.payload.chunk_id ||
          payload?.chunk_index !== expected.payload.chunk_index ||
          payload?.content_sha256 !== expected.payload.content_sha256) {
        throw new Error("Qdrant point read-back failed exact source, page, generation or chunk provenance validation.");
      }
    }

    return {
      pointCount: points.length,
      ids: points.map((point) => point.id),
      modelId: documentEmbeddings.modelId,
      modelVersion: documentEmbeddings.modelVersion,
    };
  }

  async query(input: {
    projectId: string;
    authorizedSourceIds: readonly string[];
    query: string;
    limit?: number;
    prefetchLimit?: number;
  }): Promise<BrvinM14QueryResult[]> {
    if (!input.query.trim()) throw new Error("A non-empty pilot query is required.");
    if (!input.authorizedSourceIds.length) return [];
    const filter = payloadFilter(input.projectId, input.authorizedSourceIds);
    await this.ensureCollection();
    const [denseResult, sparse] = await Promise.all([
      this.embeddings.embedQuery(input.query),
      buildBrvinSparseVector(input.query),
    ]);
    const dense = denseResult.vectors[0];
    if (!dense || dense.length !== this.dimensions || dense.some((value) => !Number.isFinite(value))) {
      throw new Error("Vertex query embedding does not match the Qdrant pilot collection dimensions.");
    }
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 10)));
    const prefetchLimit = Math.max(limit, Math.min(100, Math.trunc(input.prefetchLimit ?? 30)));
    const result = await this.requestJson<QdrantQueryResponse>(
      "/collections/" + encodeURIComponent(this.collection) + "/points/query",
      "POST",
      {
        prefetch: [
          { query: dense, using: "dense", filter, limit: prefetchLimit },
          { query: sparse, using: "sparse", filter, limit: prefetchLimit },
        ],
        query: { fusion: "rrf" },
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      },
    );

    if (!result) throw new Error("Qdrant returned an empty hybrid query response.");
    const allowed = new Set(input.authorizedSourceIds);
    return (result.points ?? []).flatMap((point) => {
      const payload = point.payload ?? {};
      const sourceId = typeof payload.source_id === "string" ? payload.source_id : "";
      const itemKey = typeof payload.item_key === "string" ? payload.item_key : "";
      const text = typeof payload.chunk_text === "string" ? payload.chunk_text : "";
      const pdfPage = Number(payload.pdf_page);
      if (payload.project_id !== input.projectId || !allowed.has(sourceId) ||
          !itemKey || !text || !Number.isSafeInteger(pdfPage) || pdfPage < 1) return [];
      return [{
        id: String(point.id ?? payload.chunk_id ?? itemKey),
        itemKey,
        text,
        score: Number.isFinite(point.score) ? Number(point.score) : 0,
        pdfPage,
        sourceId,
        contentTypes: Array.isArray(payload.content_types)
          ? payload.content_types.filter((value): value is string => typeof value === "string")
          : [],
        metadata: {
          projectId: input.projectId,
          sourceId,
          pdfPage,
          generationId: typeof payload.generation_id === "string" ? payload.generation_id : undefined,
          chunkId: typeof payload.chunk_id === "string" ? payload.chunk_id : undefined,
          contentSha256: typeof payload.content_sha256 === "string" ? payload.content_sha256 : undefined,
        },
      }];
    });
  }

  async deleteSource(projectId: string, sourceId: string): Promise<void> {
    if (!projectId.trim() || !sourceId.trim()) {
      throw new Error("Qdrant source deletion requires exact project and source identifiers.");
    }
    await this.requestJson(
      "/collections/" + encodeURIComponent(this.collection) + "/points/delete?wait=true",
      "POST",
      {
        filter: {
          must: [
            { key: "project_id", match: { value: projectId } },
            { key: "source_id", match: { value: sourceId } },
          ],
        },
      },
    );
  }

  async health(): Promise<{ providerId: string; ok: boolean; version?: string }> {
    const info = await this.requestJson<QdrantCollectionInfo>(
      "/collections/" + encodeURIComponent(this.collection),
      "GET",
    );
    if (!info) throw new Error("The Qdrant M14 collection health response is empty.");
    this.assertCollectionCompatibility(info);
    return { providerId: this.providerId, ok: true, version: "collection-schema-v1" };
  }

  private assertCollectionCompatibility(info: QdrantCollectionInfo): void {
    const vectors = info.config?.params?.vectors;
    const dense = vectors && typeof vectors === "object"
      ? (vectors as Record<string, unknown>).dense
      : undefined;
    const sparse = info.config?.params?.sparse_vectors as Record<string, { modifier?: string }> | undefined;
    const denseConfig = dense as { size?: number; distance?: string } | undefined;
    if (!denseConfig || Number(denseConfig.size) !== this.dimensions ||
        denseConfig.distance !== "Cosine" || sparse?.sparse?.modifier !== "idf") {
      throw new Error("The existing Qdrant collection does not match the M14 dense/sparse schema; refusing to mutate it.");
    }
  }

  private async requestJson<T = unknown>(
    path: string,
    method: "GET" | "POST" | "PUT",
    body?: unknown,
    allowNotFound = false,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.request(this.baseUrl + path, {
        method,
        headers: {
          "api-key": this.apiKey,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (allowNotFound && response.status === 404) return null;
      const raw = await response.text();
      let envelope: QdrantEnvelope<T>;
      try {
        envelope = JSON.parse(raw) as QdrantEnvelope<T>;
      } catch {
        throw new Error("Qdrant returned invalid JSON (HTTP " + response.status + ").");
      }
      const nestedStatusError = typeof envelope.status === "object" && envelope.status !== null &&
        typeof envelope.status.error === "string"
        ? envelope.status.error
        : "";
      if (!response.ok || envelope.status === "error" || nestedStatusError) {
        const rawDetail = typeof envelope.error === "string" ? envelope.error : nestedStatusError;
        const detail = rawDetail.replace(/\s+/gu, " ").slice(0, 320);
        throw new Error(
          "Qdrant " + method + " " + path + " failed (HTTP " + response.status + ")." +
          (detail ? " " + detail : "")
        );
      }
      return envelope.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Qdrant request timed out after " + REQUEST_TIMEOUT_MS + "ms.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createBrvinQdrantHybridPilot(
  env: {
    BRVIN_M14_QDRANT_URL?: string;
    BRVIN_M14_QDRANT_API_KEY?: string;
    BRVIN_M14_QDRANT_COLLECTION?: string;
    BRVIN_M14_EMBEDDING_DIMENSIONS?: string;
  },
  embeddings: EmbeddingProvider,
): BrvinQdrantHybridPilot {
  return new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL,
    apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection: env.BRVIN_M14_QDRANT_COLLECTION,
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
  }, embeddings);
}
