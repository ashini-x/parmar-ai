import type { AiSearchInstance, AiSearchNamespace, Env } from "../config/env";
import { retrieveBrvinForApplicationV2 } from "./service-core";
import { readBrvinCorpusGeneration } from "./corpus-reader";
import { indexBrvinCorpusGeneration } from "./m14-pilot-runner";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";
import {
  BRVIN_M15_STAGING_ENVIRONMENT_ID,
  BRVIN_M15_STAGING_PROJECT_ID,
  BRVIN_M15_STAGING_SOURCE_ID,
} from "./m15-v2-staging";

export const BRVIN_M15_SECOND_SOURCE = {
  sourceId: "01238b3a-9902-4a42-90b4-574048ee4f00",
  title: "Force and Laws of Motion - Class IX pilot handout",
  fileName: "Force and Laws of Motion - Class IX pilot handout.pdf",
  sourcePdfSha256: "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c",
  generationId: "57129957231e548064e5594d8fb9f501",
  pageCount: 3,
} as const;

const MAX_RESULTS = 6;
const AI_SEARCH_METADATA_SCHEMA = [
  { field_name: "source_id", data_type: "text" },
  { field_name: "project_id", data_type: "text" },
  { field_name: "pdf_page", data_type: "number" },
  { field_name: "benchmark", data_type: "text" },
] as const;

export interface BrvinM15MultiSourceEnv extends Env {
  BRVIN_M15_BENCHMARK_AI_SEARCH?: AiSearchInstance;
}

export interface M15ExpectedLocation {
  sourceId: string;
  pdfPage: number;
}

export interface M15MultiSourceCase {
  id: string;
  query: string;
  expectedLocations: M15ExpectedLocation[];
  expectedNoMatch?: boolean;
}

export const M15_MULTI_SOURCE_QUERY_SUITE: readonly M15MultiSourceCase[] = [
  {
    id: "MS01",
    query: "Compare Newton's second law with the 4 kg rough-floor worked example using a 20 N pull and 8 N friction. Explain the formula and the resulting acceleration.",
    expectedLocations: [
      { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, pdfPage: 2 },
      { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, pdfPage: 3 },
      { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 1 },
    ],
  },
  {
    id: "MS02",
    query: "How does static friction adjust to the applied force, and how is that different from the kinetic friction in the worked block example?",
    expectedLocations: [
      { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, pdfPage: 3 },
      { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 4 },
    ],
  },
  {
    id: "MS03",
    query: "Explain the difference between mass and weight, and how mass is used in Newton's second law.",
    expectedLocations: [
      { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 2 },
      { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 3 },
    ],
  },
  {
    id: "MS04",
    query: "What is the restoring-force formula of the spring, including the sign and the physical PDF page that shows it?",
    expectedLocations: [
      { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 8 },
    ],
  },
  {
    id: "MN01",
    query: "What is the value of the Planck constant and how does it enter the photon-energy equation?",
    expectedLocations: [],
    expectedNoMatch: true,
  },
] as const;

function assertStaging(env: BrvinM15MultiSourceEnv): void {
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("The M15 multi-source provider check is restricted to isolated Core staging.");
  }
  if (!env.DB) throw new Error("The isolated M15 staging D1 database is missing.");
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error("The isolated M15 staging configuration is missing " + name + ".");
  return normalized;
}

function sourcePrefix(sourceId: string): string {
  return "brvin/books/" + sourceId + "/pages/";
}

function exactMetadataSchema(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== AI_SEARCH_METADATA_SCHEMA.length) return false;
  return AI_SEARCH_METADATA_SCHEMA.every((expected) =>
    value.some((actual) => typeof actual === "object" && actual !== null &&
      (actual as { field_name?: unknown }).field_name === expected.field_name &&
      (actual as { data_type?: unknown }).data_type === expected.data_type)
  );
}

async function ensureAiSearchMetadataSchema(search: AiSearchInstance): Promise<void> {
  const current = await search.info();
  if (exactMetadataSchema(current.custom_metadata)) return;
  const existing = current.custom_metadata;
  if (Array.isArray(existing) && existing.length > 0) {
    throw new Error("The M15 staging AI Search metadata schema differs from the pinned four-field schema; refusing to replace it.");
  }
  const updated = await search.update({
    custom_metadata: AI_SEARCH_METADATA_SCHEMA.map((field) => ({ ...field })),
  });
  if (!updated || typeof updated !== "object" ||
      !exactMetadataSchema((updated as Record<string, unknown>).custom_metadata)) {
    throw new Error("The M15 staging AI Search instance did not confirm its required metadata schema.");
  }
}

async function ensureCheckpointSchema(env: BrvinM15MultiSourceEnv): Promise<void> {
  const db = env.DB!;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS m15_v2_multisource_sources (" +
    "source_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_sha256 TEXT NOT NULL, " +
    "generation_id TEXT NOT NULL, page_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL, " +
    "qdrant_status TEXT NOT NULL DEFAULT 'pending', qdrant_point_count INTEGER NOT NULL DEFAULT 0, " +
    "ai_search_status TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'indexing', " +
    "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS m15_v2_multisource_runs (" +
    "id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('running','passed','failed')), " +
    "result_json TEXT, started_at INTEGER NOT NULL, completed_at INTEGER)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_m15_v2_multisource_runs_started " +
    "ON m15_v2_multisource_runs(started_at DESC)"
  ).run();
}

async function readSecondSourceCorpus(env: BrvinM15MultiSourceEnv) {
  const corpus = await readBrvinCorpusGeneration(
    env,
    BRVIN_M15_SECOND_SOURCE.sourceId,
    BRVIN_M15_SECOND_SOURCE.generationId,
  );
  const manifest = corpus.sourceManifest;
  if (manifest.sourceId !== BRVIN_M15_SECOND_SOURCE.sourceId ||
      manifest.generationId !== BRVIN_M15_SECOND_SOURCE.generationId ||
      manifest.sourcePdfSha256.toLowerCase() !== BRVIN_M15_SECOND_SOURCE.sourcePdfSha256 ||
      manifest.pageCount !== BRVIN_M15_SECOND_SOURCE.pageCount ||
      corpus.pageManifests.length !== BRVIN_M15_SECOND_SOURCE.pageCount ||
      corpus.chunkCount < BRVIN_M15_SECOND_SOURCE.pageCount) {
    throw new Error("The immutable M14 Physics corpus does not match the approved source ID, SHA-256, generation and three-page inventory.");
  }
  return corpus;
}

async function ensureProjectReady(env: BrvinM15MultiSourceEnv): Promise<void> {
  const project = await env.DB!.prepare(
    "SELECT id,slug,status FROM brvin_projects WHERE id=? LIMIT 1",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID).first<{ id: string; slug: string; status: string }>();
  if (!project || project.slug !== "m15-physics-benchmark" || project.status !== "active") {
    throw new Error("The fixed M15 staging project is missing or inactive; no second source was indexed.");
  }
}

async function registerSecondSourceInD1(env: BrvinM15MultiSourceEnv): Promise<void> {
  const db = env.DB!;
  const id = BRVIN_M15_SECOND_SOURCE.sourceId;
  const prefix = sourcePrefix(id);
  const now = Date.now();
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_books " +
    "(id,title,source_filename,source_sha256,expected_size,page_count,status,indexed_pages,error_message,collection_id,search_prefix,source_type,created_at,updated_at) " +
    "VALUES (?,?,?,?,0,?,'ready',?,NULL,'m15-multi-source',?,'pdf',?,?)"
  ).bind(
    id,
    BRVIN_M15_SECOND_SOURCE.title,
    BRVIN_M15_SECOND_SOURCE.fileName,
    BRVIN_M15_SECOND_SOURCE.sourcePdfSha256,
    BRVIN_M15_SECOND_SOURCE.pageCount,
    BRVIN_M15_SECOND_SOURCE.pageCount,
    prefix,
    now,
    now,
  ).run();

  const book = await db.prepare(
    "SELECT id,title,source_sha256,page_count,status,indexed_pages,search_prefix FROM brvin_books WHERE id=? LIMIT 1",
  ).bind(id).first<{
    id: string; title: string; source_sha256: string; page_count: number;
    status: string; indexed_pages: number; search_prefix: string;
  }>();
  if (!book || book.title !== BRVIN_M15_SECOND_SOURCE.title ||
      book.source_sha256.toLowerCase() !== BRVIN_M15_SECOND_SOURCE.sourcePdfSha256 ||
      Number(book.page_count) !== BRVIN_M15_SECOND_SOURCE.pageCount ||
      Number(book.indexed_pages) !== BRVIN_M15_SECOND_SOURCE.pageCount ||
      book.status !== "ready" || book.search_prefix !== prefix) {
    throw new Error("The second source D1 registry row failed exact identity, page-count or READY read-back.");
  }

  await db.prepare(
    "INSERT OR IGNORE INTO brvin_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'m15-multisource-staging')",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID, id, now).run();
  const mapping = await db.prepare(
    "SELECT project_id,book_id FROM brvin_project_books WHERE project_id=? AND book_id=? LIMIT 1",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID, id).first<{ project_id: string; book_id: string }>();
  if (!mapping || mapping.project_id !== BRVIN_M15_STAGING_PROJECT_ID || mapping.book_id !== id) {
    throw new Error("The second M15 source was not granted to the fixed staging project in D1.");
  }
}

export async function prepareBrvinM15MultiSourceCorpus(
  env: BrvinM15MultiSourceEnv,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureCheckpointSchema(env);
  await ensureProjectReady(env);

  const corpus = await readSecondSourceCorpus(env);
  const db = env.DB!;
  const source = BRVIN_M15_SECOND_SOURCE;
  const now = Date.now();
  await db.prepare(
    "INSERT OR IGNORE INTO m15_v2_multisource_sources " +
    "(source_id,project_id,source_sha256,generation_id,page_count,chunk_count,qdrant_status,qdrant_point_count,ai_search_status,status,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,'pending',0,'pending','indexing',?,?)"
  ).bind(
    source.sourceId,
    BRVIN_M15_STAGING_PROJECT_ID,
    source.sourcePdfSha256,
    source.generationId,
    source.pageCount,
    corpus.chunkCount,
    now,
    now,
  ).run();

  const checkpoint = await db.prepare(
    "SELECT source_id,project_id,source_sha256,generation_id,page_count,chunk_count,qdrant_status,qdrant_point_count,ai_search_status,status " +
    "FROM m15_v2_multisource_sources WHERE source_id=? LIMIT 1",
  ).bind(source.sourceId).first<{
    source_id: string; project_id: string; source_sha256: string; generation_id: string;
    page_count: number; chunk_count: number; qdrant_status: string; qdrant_point_count: number;
    ai_search_status: string; status: string;
  }>();
  if (!checkpoint || checkpoint.project_id !== BRVIN_M15_STAGING_PROJECT_ID ||
      checkpoint.source_sha256.toLowerCase() !== source.sourcePdfSha256 ||
      checkpoint.generation_id !== source.generationId ||
      Number(checkpoint.page_count) !== source.pageCount ||
      Number(checkpoint.chunk_count) !== corpus.chunkCount) {
    throw new Error("The persisted M15 second-source checkpoint conflicts with the immutable corpus identity.");
  }

  const qdrant = new BrvinQdrantHybridPilot({
    url: required(env.BRVIN_M14_QDRANT_URL, "BRVIN_M14_QDRANT_URL"),
    apiKey: required(env.BRVIN_M14_QDRANT_API_KEY, "BRVIN_M14_QDRANT_API_KEY"),
    collection: required(env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION, "BRVIN_M15_BENCHMARK_QDRANT_COLLECTION"),
    dimensions: Number(required(env.BRVIN_M14_EMBEDDING_DIMENSIONS, "BRVIN_M14_EMBEDDING_DIMENSIONS")),
  }, new BrvinVertexEmbeddingProvider(env));

  let qdrantPointCount = Number(checkpoint.qdrant_point_count ?? 0);
  const qdrantCount = await qdrant.countSourcePoints(BRVIN_M15_STAGING_PROJECT_ID, source.sourceId);
  if (checkpoint.qdrant_status !== "ready" || qdrantCount !== corpus.chunkCount) {
    await db.prepare(
      "UPDATE m15_v2_multisource_sources SET qdrant_status='indexing',status='indexing',updated_at=? WHERE source_id=?",
    ).bind(Date.now(), source.sourceId).run();
    const indexed = await indexBrvinCorpusGeneration(qdrant, BRVIN_M15_STAGING_PROJECT_ID, corpus);
    if (indexed.pointCount !== corpus.chunkCount || indexed.pageCount !== source.pageCount) {
      throw new Error("Qdrant did not confirm every deterministic point from the second immutable source.");
    }
    qdrantPointCount = await qdrant.countSourcePoints(BRVIN_M15_STAGING_PROJECT_ID, source.sourceId);
    if (qdrantPointCount !== corpus.chunkCount) {
      throw new Error("Qdrant exact source-point count does not match the second source's verified chunk count.");
    }
    await db.prepare(
      "UPDATE m15_v2_multisource_sources SET qdrant_status='ready',qdrant_point_count=?,updated_at=? WHERE source_id=?",
    ).bind(qdrantPointCount, Date.now(), source.sourceId).run();
  } else {
    qdrantPointCount = qdrantCount;
  }

  const search = env.BRVIN_M15_BENCHMARK_AI_SEARCH;
  if (!search) throw new Error("The dedicated M15 staging AI Search binding is missing.");
  await ensureAiSearchMetadataSchema(search);
  const prefix = sourcePrefix(source.sourceId);
  const expectedKeys = corpus.pageManifests.map((page) => page.stableItemKey);
  if (expectedKeys.length !== source.pageCount ||
      expectedKeys.some((key, index) => key !== prefix + "page-" + String(index + 1).padStart(6, "0") + ".txt")) {
    throw new Error("The original M14 corpus item keys do not match its exact immutable source prefix.");
  }

  const list = await search.items.list({ page: 1, per_page: 50 });
  const existing = [...(list.result ?? [])];
  for (const page of corpus.pageManifests) {
    const key = page.stableItemKey;
    const item = existing.find((candidate) => candidate.key === key);
    if (item?.status === "completed") continue;
    if (item && (item.status === "queued" || item.status === "running")) {
      await db.prepare(
        "UPDATE m15_v2_multisource_sources SET ai_search_status='indexing',status='indexing',updated_at=? WHERE source_id=?",
      ).bind(Date.now(), source.sourceId).run();
      return {
        ok: true,
        sourceId: source.sourceId,
        status: "ai_search_indexing",
        pendingPage: page.pdfPage,
        pendingItemStatus: item.status,
        qdrantPointCount,
        qdrantStatus: "ready",
        continuationRequired: true,
        note: "The existing AI Search item is still indexing. Re-enter the staging token and repeat this action; the existing OCR/corpus and Qdrant points are reused.",
      };
    }
    if (item && item.status !== "error" && item.status !== "skipped" && item.status !== "outdated") {
      throw new Error("The M15 second-source AI Search item has an unexpected status; refusing to overwrite it.");
    }
    if (item) {
      throw new Error("The M15 second-source AI Search item is in terminal status " + item.status + "; inspect the item before attempting any replacement.");
    }

    const uploaded = await search.items.upload(key, page.rawOcrText, {
      metadata: {
        source_id: source.sourceId,
        project_id: BRVIN_M15_STAGING_PROJECT_ID,
        pdf_page: String(page.pdfPage),
        benchmark: "brvin-m15-multisource-v1",
      },
    });
    if (uploaded.key !== key) {
      throw new Error("M15 AI Search returned an unexpected item key for physical page " + page.pdfPage + ".");
    }
    if (uploaded.status === "queued" || uploaded.status === "running") {
      await db.prepare(
        "UPDATE m15_v2_multisource_sources SET ai_search_status='indexing',status='indexing',updated_at=? WHERE source_id=?",
      ).bind(Date.now(), source.sourceId).run();
      return {
        ok: true,
        sourceId: source.sourceId,
        status: "ai_search_indexing",
        pendingPage: page.pdfPage,
        pendingItemStatus: uploaded.status,
        qdrantPointCount,
        qdrantStatus: "ready",
        continuationRequired: true,
        note: "Cloudflare AI Search accepted the item asynchronously. Re-enter the staging token and repeat this action to inspect the same deterministic key.",
      };
    }
    if (uploaded.status !== "completed") {
      throw new Error("M15 AI Search did not confirm indexing completion for physical page " + page.pdfPage + ".");
    }
    existing.push(uploaded);
  }

  const finalListing = await search.items.list({ page: 1, per_page: 50 });
  const sourceItems = (finalListing.result ?? []).filter((item) => item.key.startsWith(prefix));
  if (sourceItems.length !== source.pageCount ||
      sourceItems.some((item) => item.status !== "completed" || !expectedKeys.includes(item.key)) ||
      expectedKeys.some((key) => !sourceItems.some((item) => item.key === key))) {
    throw new Error("The dedicated M15 AI Search instance did not confirm all three exact second-source page items as completed.");
  }

  await db.prepare(
    "UPDATE m15_v2_multisource_sources SET ai_search_status='ready',status='ready',updated_at=? WHERE source_id=?",
  ).bind(Date.now(), source.sourceId).run();
  await registerSecondSourceInD1(env);

  const registry = await db.prepare(
    "SELECT b.id,b.status,b.page_count,b.indexed_pages,b.search_prefix " +
    "FROM brvin_books b JOIN brvin_project_books pb ON pb.book_id=b.id " +
    "WHERE pb.project_id=? ORDER BY b.id",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID).all<{
    id: string; status: string; page_count: number; indexed_pages: number; search_prefix: string;
  }>();
  const readySources = (registry.results ?? []).filter((book) =>
    book.status === "ready" && Number(book.indexed_pages) === Number(book.page_count));
  const expectedIds = new Set([
    "3b4d116d-4c18-450f-9cba-cb2bec3da7ca",
    source.sourceId,
  ]);
  if (readySources.length !== 2 || readySources.some((book) => !expectedIds.has(book.id))) {
    throw new Error("The M15 project registry did not read back exactly its two intended READY sources.");
  }

  return {
    ok: true,
    sourceId: source.sourceId,
    projectId: BRVIN_M15_STAGING_PROJECT_ID,
    sourcePdfSha256: source.sourcePdfSha256,
    generationId: source.generationId,
    pageCount: source.pageCount,
    chunkCount: corpus.chunkCount,
    qdrantPointCount,
    qdrantStatus: "ready",
    aiSearchItemCount: source.pageCount,
    aiSearchStatus: "ready",
    status: "ready",
    authorizedReadySourceCount: readySources.length,
    sideEffects: {
      pdfUploaded: false,
      visionOcrSubmitted: false,
      sourceOrOcrChanged: false,
      productionD1Accessed: false,
      productionProviderChanged: false,
      qdrantPointsUpserted: 0,
      qdrantPointsDeleted: 0,
      stagingQdrantPointsAdded: qdrantCount === corpus.chunkCount ? 0 : corpus.chunkCount,
    },
    note: "The second source reuses verified immutable M14 GCS page manifests and OCR. It is indexed only into the M15 staging Qdrant collection and dedicated M15 staging AI Search instance; D1 grants it to the existing M15 staging project.",
  };
}

export function m15MultiSourcePageKey(sourceId: string, page: number): string {
  if (!/^[a-f0-9-]{36}$/iu.test(sourceId) ||
      !Number.isSafeInteger(page) || page < 1 || page > 2_000) {
    throw new Error("A valid BRVIN source UUID and physical PDF page are required.");
  }
  return sourcePrefix(sourceId) + "page-" + String(page).padStart(6, "0") + ".txt";
}

function quotaMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

async function queryUsage(env: BrvinM15MultiSourceEnv): Promise<number> {
  const row = await env.DB!.prepare(
    "SELECT query_count FROM brvin_project_search_usage WHERE project_id=? AND billing_month=?",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID, quotaMonth()).first<{ query_count: number }>();
  return Number(row?.query_count ?? 0);
}

interface ProviderQueryResult {
  ok: boolean;
  code?: string;
  message?: string;
  searchedSources: number;
  searchCount: number;
  passages: Array<{
    sourceId: string;
    sourceTitle: string;
    pdfPage: number;
    score: number;
    text: string;
    provenanceValid: boolean;
  }>;
  provenanceViolationCount: number;
  expectedLocationHits: M15ExpectedLocation[];
  elapsedMs: number;
}

function expectedLocationKey(value: M15ExpectedLocation): string {
  return value.sourceId + ":" + value.pdfPage;
}

export function summarizeM15MultiSourceProvider(
  cases: Array<{ expectedLocations: readonly M15ExpectedLocation[]; result: ProviderQueryResult }>,
) {
  const allPassages = cases.flatMap((item) => item.result.passages);
  const expected = new Set(cases.flatMap((item) => item.expectedLocations.map(expectedLocationKey)));
  const found = new Set(allPassages.map((item) => item.sourceId + ":" + item.pdfPage));
  const expectedFound = [...expected].filter((key) => found.has(key));
  const sourceIds = [...new Set(allPassages.filter((item) => item.provenanceValid).map((item) => item.sourceId))];
  const latencies = cases.map((item) => item.result.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (q: number): number | null => latencies.length
    ? Math.round(latencies[Math.max(0, Math.min(latencies.length - 1, Math.ceil(q * latencies.length) - 1))] * 100) / 100
    : null;
  return {
    queryCount: cases.length,
    successfulQueries: cases.filter((item) => item.result.ok).length,
    failedQueries: cases.filter((item) => !item.result.ok).length,
    authorizedSourceIdsReturned: sourceIds,
    bothSourcesRepresented: sourceIds.includes(BRVIN_M15_SECOND_SOURCE.sourceId) &&
      sourceIds.includes(BRVIN_M15_STAGING_SOURCE_ID),
    expectedLocationCount: expected.size,
    expectedLocationsFound: expectedFound.length,
    expectedLocationCoverage: expected.size ? expectedFound.length / expected.size : 0,
    provenanceViolationCount: cases.reduce((sum, item) => sum + item.result.provenanceViolationCount, 0),
    noMatchQueryCandidateCount: cases
      .filter((item) => item.expectedLocations.length === 0)
      .reduce((sum, item) => sum + item.result.passages.length, 0),
    latencyMs: {
      sampleCount: latencies.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      note: "Sequential query cases; small staging measurement, not a load test or production SLO.",
    },
  };
}

async function retrieveOne(
  env: BrvinM15MultiSourceEnv,
  provider: "cloudflare-ai-search" | "qdrant-vertex",
  query: string,
  queryId: string,
): Promise<ProviderQueryResult> {
  const started = performance.now();
  try {
    const providerEnv: BrvinM15MultiSourceEnv = provider === "cloudflare-ai-search"
      ? {
          ...env,
          BRVIN_RETRIEVAL_PROVIDER: "cloudflare-ai-search",
          BRVIN_SEARCH: {
            get: (name: string) => {
              if (name !== "m15-benchmark") throw new Error("Unexpected AI Search instance requested by the M15 v2 staging override.");
              if (!env.BRVIN_M15_BENCHMARK_AI_SEARCH) throw new Error("The dedicated M15 staging AI Search binding is missing.");
              return env.BRVIN_M15_BENCHMARK_AI_SEARCH;
            },
          } as AiSearchNamespace,
          BRVIN_SEARCH_INSTANCE: "m15-benchmark",
        }
      : { ...env, BRVIN_RETRIEVAL_PROVIDER: "qdrant-vertex" };

    const result = await retrieveBrvinForApplicationV2(
      providerEnv,
      BRVIN_M15_STAGING_ENVIRONMENT_ID,
      {
        projectId: BRVIN_M15_STAGING_PROJECT_ID,
        queries: [query],
        requestId: "m15-multi-source-" + provider + "-" + queryId + "-" + crypto.randomUUID(),
      },
    );
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
        searchedSources: 0,
        searchCount: 0,
        passages: [],
        provenanceViolationCount: 0,
        expectedLocationHits: [],
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      };
    }
    const allowedPages = new Map<string, number>([
      [BRVIN_M15_SECOND_SOURCE.sourceId, BRVIN_M15_SECOND_SOURCE.pageCount],
      [BRVIN_M15_STAGING_SOURCE_ID, 8],
    ]);
    const passages = result.data.passages.map((passage) => {
      const maxPage = allowedPages.get(passage.bookId);
      const valid = maxPage !== undefined && Number.isSafeInteger(passage.pdfPage) &&
        passage.pdfPage >= 1 && passage.pdfPage <= maxPage &&
        typeof passage.text === "string" && passage.text.length > 0;
      return {
        sourceId: passage.bookId,
        sourceTitle: passage.bookTitle,
        pdfPage: valid ? passage.pdfPage : 0,
        score: passage.score,
        text: valid ? passage.text.slice(0, 900) : "",
        provenanceValid: valid,
      };
    });
    return {
      ok: true,
      searchedSources: result.data.searchedSources,
      searchCount: result.data.searchCount,
      passages,
      provenanceViolationCount: passages.filter((passage) => !passage.provenanceValid).length,
      expectedLocationHits: [],
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 200) : "Provider query failed.",
      searchedSources: 0,
      searchCount: 0,
      passages: [],
      provenanceViolationCount: 0,
      expectedLocationHits: [],
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }
}

export async function runM15MultiSourceCoreV2Evaluation(
  env: BrvinM15MultiSourceEnv,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureCheckpointSchema(env);
  const ready = await env.DB!.prepare(
    "SELECT b.id,b.title,b.page_count,b.indexed_pages,b.status " +
    "FROM brvin_books b JOIN brvin_project_books pb ON pb.book_id=b.id " +
    "WHERE pb.project_id=? ORDER BY b.id",
  ).bind(BRVIN_M15_STAGING_PROJECT_ID).all<{
    id: string; title: string; page_count: number; indexed_pages: number; status: string;
  }>();
  const expectedIds = new Set([
    BRVIN_M15_STAGING_SOURCE_ID,
    BRVIN_M15_SECOND_SOURCE.sourceId,
  ]);
  const readySources = (ready.results ?? []).filter((source) =>
    source.status === "ready" && Number(source.indexed_pages) === Number(source.page_count));
  if (readySources.length !== 2 || readySources.some((source) => !expectedIds.has(source.id))) {
    throw new Error("The M15 project must have exactly the two approved READY sources before multi-source retrieval evaluation.");
  }
  if (!env.BRVIN_M15_BENCHMARK_AI_SEARCH) {
    throw new Error("The dedicated M15 staging AI Search binding is missing.");
  }

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const usageBefore = await queryUsage(env);
  const inserted = await env.DB!.prepare(
    "INSERT INTO m15_v2_multisource_runs(id,status,result_json,started_at,completed_at) VALUES (?,'running',NULL,?,NULL)",
  ).bind(runId, startedAt).run();
  if (!inserted.success || Number(inserted.meta?.changes ?? 0) !== 1) {
    throw new Error("The M15 multi-source evaluation receipt could not be initialized.");
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of M15_MULTI_SOURCE_QUERY_SUITE) {
    const [aiSearch, qdrant] = await Promise.all([
      retrieveOne(env, "cloudflare-ai-search", item.query, item.id),
      retrieveOne(env, "qdrant-vertex", item.query, item.id),
    ]);
    const foundLocations = (providerResult: ProviderQueryResult): M15ExpectedLocation[] =>
      item.expectedLocations.filter((target) => providerResult.passages.some((passage) =>
        passage.provenanceValid && passage.sourceId === target.sourceId && passage.pdfPage === target.pdfPage));
    aiSearch.expectedLocationHits = foundLocations(aiSearch);
    qdrant.expectedLocationHits = foundLocations(qdrant);
    results.push({
      id: item.id,
      query: item.query,
      expectedLocations: item.expectedLocations,
      expectedNoMatch: item.expectedNoMatch === true,
      cloudflareAiSearch: aiSearch,
      qdrantVertex: qdrant,
    });
  }

  const scoreCases = (provider: "cloudflareAiSearch" | "qdrantVertex") =>
    results.map((item, index) => ({
      expectedLocations: M15_MULTI_SOURCE_QUERY_SUITE[index].expectedLocations,
      result: item[provider] as ProviderQueryResult,
    }));
  const cloudflareSummary = summarizeM15MultiSourceProvider(scoreCases("cloudflareAiSearch"));
  const qdrantSummary = summarizeM15MultiSourceProvider(scoreCases("qdrantVertex"));
  const usageAfter = await queryUsage(env);
  const expectedReservations = M15_MULTI_SOURCE_QUERY_SUITE.length * 2;
  const checks = {
    exactlyTwoAuthorizedReadySources: readySources.length === 2,
    bothProvidersCompletedEveryQuery: results.every((item) =>
      (item.cloudflareAiSearch as ProviderQueryResult).ok &&
      (item.qdrantVertex as ProviderQueryResult).ok),
    bothProvidersSearchedBothReadySourcesForEveryQuery: results.every((item) =>
      (item.cloudflareAiSearch as ProviderQueryResult).searchedSources === 2 &&
      (item.qdrantVertex as ProviderQueryResult).searchedSources === 2),
    noAiSearchProvenanceViolations: cloudflareSummary.provenanceViolationCount === 0,
    noQdrantProvenanceViolations: qdrantSummary.provenanceViolationCount === 0,
    bothProvidersRetrievedEvidenceFromBothSources: cloudflareSummary.bothSourcesRepresented &&
      qdrantSummary.bothSourcesRepresented,
    exactlyOneQuotaReservationPerProviderQuery: usageAfter === usageBefore + expectedReservations,
  };
  const passed = Object.values(checks).every(Boolean);
  const report = {
    ok: passed,
    receiptId: runId,
    benchmark: "brvin-m15-core-v2-multi-source",
    environment: "staging",
    providerModes: ["cloudflare-ai-search", "qdrant-vertex"],
    projectId: BRVIN_M15_STAGING_PROJECT_ID,
    sources: readySources.map((source) => ({
      sourceId: source.id,
      title: source.title,
      pageCount: source.page_count,
    })),
    queryCount: results.length,
    providers: {
      cloudflareAiSearch: cloudflareSummary,
      qdrantVertex: qdrantSummary,
    },
    quota: {
      before: usageBefore,
      after: usageAfter,
      expectedReservations,
    },
    checks,
    results,
    sideEffects: {
      aiSearchItemsUploaded: 0,
      aiSearchItemsDeleted: 0,
      qdrantPointsUpserted: 0,
      qdrantPointsDeleted: 0,
      sourceOrOcrChanged: false,
      productionD1Accessed: false,
      productionProviderChanged: false,
    },
    interpretation: "This invokes the real private Core v2 resolver twice per query, once with the dedicated staging AI Search binding and once with the staging Qdrant/Vertex provider override. Both runs resolve the same D1 project grants, READY source registry and quota boundary. This is a small source-discovery/provenance staging evaluation, not independent relevance qrels, answer-generation testing, a load test or production SLO evidence.",
  };
  const persisted = await env.DB!.prepare(
    "UPDATE m15_v2_multisource_runs SET status=?,result_json=?,completed_at=? WHERE id=? AND status='running'",
  ).bind(passed ? "passed" : "failed", JSON.stringify(report), Date.now(), runId).run();
  if (!persisted.success || Number(persisted.meta?.changes ?? 0) !== 1) {
    throw new Error("The M15 multi-source evaluation result could not be persisted to isolated staging D1.");
  }
  return report;
}


export function brvinM15MultiSourceOperatorPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>BRVIN M15 Multi-source Core v2 Gate</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#10151f;color:#edf2fa;padding:22px;min-height:100vh}
main{max-width:900px;margin:20px auto;background:#172131;border:1px solid #34445a;border-radius:18px;padding:clamp(20px,4vw,34px)}
h1{font-size:clamp(25px,4vw,34px);margin:8px 0}.eyebrow{color:#91b5e2;font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
p{color:#b8c6d8;line-height:1.6}.notice{padding:14px 16px;margin:16px 0;border:1px solid #40566f;border-radius:12px;background:#1d2c40}
label{display:block;margin:14px 0 8px;font-weight:650}input{width:100%;padding:12px;border:1px solid #50657e;border-radius:9px;background:#0d1521;color:#fff;font:inherit}
button{width:100%;border:0;border-radius:10px;padding:13px 15px;margin-top:10px;background:#2767c8;color:#fff;font:inherit;font-weight:750;cursor:pointer}
button.secondary{background:#2a3b52;border:1px solid #526b89}button:disabled{opacity:.45;cursor:not-allowed}
.status{padding:14px;border:1px solid #394d66;border-radius:10px;background:#0d1725;margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#b8c6d8}
.good{color:#9ae6b4}.bad{color:#ffaaa6}.small{font-size:13px;color:#9fb1c7}code{color:#d7e7ff;overflow-wrap:anywhere}
</style></head>
<body><main>
<div class="eyebrow">Core only · isolated M15 staging · no production cutover</div>
<h1>Multi-source Core v2 verification</h1>
<p>Adds the existing three-page M14 Physics source as a second document in the fixed M15 staging project. Reuses its immutable private GCS page manifests, raw OCR and deterministic chunks; no PDF upload or Vision OCR request is made.</p>
<div class="notice">
<strong>Exact staging boundary</strong>
<p class="small">The additional source is <code>01238b3a-9902-4a42-90b4-574048ee4f00</code>, SHA-256 <code>062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c</code>, 3 pages. It will be indexed only into the dedicated M15 Qdrant collection and M15 staging AI Search instance, then granted in the isolated M15 D1 project. The existing 8-page M15 source remains unchanged. No production D1, provider, source or Teachers Worker is accessed.</p>
</div>
<label for="token">Existing M15 staging operator token</label>
<input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Enter BRVIN_M14_ADMIN_TOKEN" minlength="32">
<button id="prepare" type="button" disabled>Prepare second source from immutable manifests</button>
<p class="small">If AI Search returns queued/running, re-enter the same token and repeat this button. Qdrant uses deterministic point IDs and a persisted checkpoint, so completed chunks are not needlessly re-embedded.</p>
<button id="evaluate" class="secondary" type="button" disabled>Run paired Core v2 multi-source evaluation</button>
<div id="progress" class="status" role="status" aria-live="polite">No multi-source action has been started.</div>
<div class="notice small">The evaluation performs five fixed read-only queries through the actual Core v2 resolver: one run against the isolated M15 AI Search binding and one against Qdrant + Vertex for each query. Both use the same D1 project/source grants and quota authority. The run reserves ten staging query units; it does not generate Gemini answers or modify either index.</div>
<p class="small"><a href="/admin/m15/benchmark" style="color:#8bb7ff">Back to M15 benchmark operator</a> · <a href="/admin/m14" style="color:#8bb7ff">M14 staging operator</a></p>
</main>
<script>
(() => {
 const token=document.getElementById("token"),prepare=document.getElementById("prepare"),evaluate=document.getElementById("evaluate");
 const progress=document.getElementById("progress");let ready=false;
 function refresh(){const valid=token.value.trim().length>=32;prepare.disabled=!valid;evaluate.disabled=!valid||!ready;}
 token.addEventListener("input",refresh);
 async function call(path){
   let secret=token.value.trim();token.value="";refresh();
   const response=await fetch(path,{method:"POST",headers:{authorization:"Bearer "+secret,"content-type":"application/json"},body:"{}",cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});
   secret="";
   let data;try{data=await response.json();}catch{throw new Error("Staging returned a non-JSON response (HTTP "+response.status+").");}
   if(!response.ok||data.ok!==true)throw new Error(data.error||data.message||("Staging request failed (HTTP "+response.status+")."));
   return data;
 }
 prepare.addEventListener("click",async()=>{
   if(prepare.disabled)return;prepare.disabled=true;evaluate.disabled=true;ready=false;
   progress.className="status";progress.textContent="Reading and verifying the original immutable three-page GCS corpus. Qdrant/AI Search indexing will occur only in the dedicated M15 staging resources…";
   try{
     const data=await call("/admin/m15/benchmark/multi-source/prepare");
     ready=data.status==="ready";
     progress.className="status "+(ready?"good":"");
     progress.textContent=JSON.stringify(data,null,2);
     if(!ready)progress.textContent+="\\n\\nThe second source is still indexing. Re-enter the staging token and repeat Prepare; do not upload a PDF or run OCR.";
   }catch(error){progress.className="status bad";progress.textContent=error.message;}
   refresh();
 });
 evaluate.addEventListener("click",async()=>{
   if(evaluate.disabled)return;evaluate.disabled=true;prepare.disabled=true;
   progress.className="status";progress.textContent="Running the real Core v2 resolver against both staging providers. This will consume ten M15 staging quota reservations…";
   try{
     const data=await call("/admin/m15/benchmark/multi-source/evaluate");
     progress.className="status "+(data.ok?"good":"bad");progress.textContent=JSON.stringify(data,null,2);
   }catch(error){progress.className="status bad";progress.textContent=error.message;}
   refresh();
 });
 refresh();
})();
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    },
  });
}
