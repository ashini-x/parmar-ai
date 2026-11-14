import type { AiSearchInstance, AiSearchNamespace, Env, ProfileContext } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import { generateGeminiAnswer } from "../ai/gemini";
import {
  FATMAN_RELEASE_QA_CASES,
  runFatmanReleaseQaCase,
  type FatmanReleaseQaCase,
  type FatmanReleaseQaCaseResult,
} from "../fatman/release-qa";
import type { FatmanBookContext, FatmanPassage } from "../fatman/retrieval";
import type { FatmanImportJob } from "../fatman/import";
import { nextAiSearchPage } from "../fatman/pagination";
import { persistBrvinPageCorpus } from "./corpus-store";
import { readBrvinCorpusPage } from "./corpus-reader";
import { buildBrvinSourceManifest } from "./corpus";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";
import { retrieveBrvinForApplicationV2 } from "./service-core";
import {
  BRVIN_M15_STAGING_APPLICATION_ID,
  BRVIN_M15_STAGING_ENVIRONMENT_ID,
} from "./m15-v2-staging";

export interface M15FatmanBenchmarkEnv extends Env {
  BRVIN_M15_FATMAN_SOURCE_EXPORT?: Pick<AiSearchInstance, "items">;
  BRVIN_M15_FATMAN_AI_SEARCH?: AiSearchInstance;
}

export const BRVIN_M15_FATMAN_SOURCE = {
  sourceId: "fatman-legacy-538",
  projectId: "c4ae7ce7-987f-4ae6-8bc4-6bf6d7a1c5f0",
  grantId: "49a15d12-0e5c-4ea1-a8ce-879ad0b79df3",
  title: "Fatman 2nd Edition",
  fileName: "Fatman 2nd Edition — existing legacy OCR index export",
  sourcePdfSha256: "8b183803fe8ee53087d731f7319519af9ac5bb62b39b2d3110acc3fe0ab59886",
  pageCount: 538,
  legacyDocumentVersion: "fatman-2026-8b183803",
  // The historic page OCR was produced through the Google Vision flow in
  // src/fatman/admin.ts. The original per-page Vision operation records were
  // not retained; this stable marker identifies the text-only index export.
  legacyExportMarker: "legacy-ai-search-index-export:fatman-2026-8b183803",
} as const;

const PROJECT_SLUG = "m15-fatman-538-benchmark";
const COLLECTION_ID = "m15-fatman-538";
const SOURCE_PREFIX = "fatman/pages/";
const LEGACY_PAGE_PREFIX = "fatman/pages/page-";
const MAX_LEGACY_PAGE_TEXT_CHARS = 120_000;
const EXPORT_BATCH_SIZE = 18;
const QDRANT_BATCH_SIZE = 6;
const AI_SEARCH_BATCH_SIZE = 8;
const RUN_TABLE = "m15_fatman_benchmark_runs";
const SOURCE_TABLE = "m15_fatman_benchmark_sources";
const AI_SEARCH_METADATA_SCHEMA = [
  { field_name: "source_id", data_type: "text" },
  { field_name: "project_id", data_type: "text" },
  { field_name: "pdf_page", data_type: "number" },
  { field_name: "benchmark", data_type: "text" },
] as const;

const QA_PROFILE: ProfileContext = {
  profile: {
    version: 2,
    targetExam: "SSC (M15 Fatman provider benchmark)",
    recentTopics: [],
    recentSubjects: [],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 0,
    lastUpdatedAt: 0,
  },
  recentTopicHint: "",
  attentionTopicHint: "",
  revisionHint: "",
  recentConversation: [],
};

type LegacyPageItem = { id: string; key: string; status: string; file_size?: number };
type SourceProgress = {
  source_id: string;
  project_id: string;
  source_sha256: string;
  generation_id: string;
  page_count: number;
  exported_pages: number;
  chunk_count: number;
  qdrant_indexed_pages: number;
  qdrant_point_count: number;
  ai_search_indexed_pages: number;
  status: string;
  created_at: number;
  updated_at: number;
};
type JudgeAssessment = {
  retrievalRelevance: number;
  answerCorrectness: number;
  sourceGrounding: number;
  citationAccuracy: number;
  abstainedCorrectly: boolean;
  criticalError: boolean;
  missingFacts: string[];
  unsupportedClaims: string[];
  rationale: string;
};
type AssessorReceipt = {
  agent: "A" | "B" | "adjudicator";
  model: string;
  assessment: JudgeAssessment;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedMs: number;
};
type ProviderCaseReceipt = {
  provider: "cloudflare-ai-search" | "qdrant-vertex";
  qa: FatmanReleaseQaCaseResult;
  answer: string;
  passages: Array<{ pdfPage: number; text: string }>;
  agentA: AssessorReceipt;
  agentB: AssessorReceipt;
  adjudication: {
    method: "independent-agreement-average" | "ai-adjudicator";
    assessment: JudgeAssessment;
    compositeScore: number;
    adjudicator?: AssessorReceipt;
  };
  elapsedMs: number;
};
type FatmanRunCase = {
  caseId: string;
  query: string;
  expectedPages: number[];
  expectedNoMatch: boolean;
  cloudflareAiSearch: ProviderCaseReceipt;
  qdrantVertex: ProviderCaseReceipt;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown M15 Fatman benchmark error.";
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 300);
}

function assertStaging(env: M15FatmanBenchmarkEnv): void {
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("The full-corpus Fatman benchmark is restricted to isolated M14/M15 staging.");
  }
  if (!env.DB || !env.GCP_PROJECT_ID || !env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.BRVIN_M14_CORPUS_BUCKET || !env.BRVIN_M14_QDRANT_URL ||
      !env.BRVIN_M14_QDRANT_API_KEY || !env.BRVIN_M14_EMBEDDING_DIMENSIONS ||
      !env.BRVIN_M15_FATMAN_QDRANT_COLLECTION || !env.BRVIN_M15_FATMAN_SOURCE_EXPORT ||
      !env.BRVIN_M15_FATMAN_AI_SEARCH) {
    throw new Error("The isolated Fatman source-export, staging AI Search, Vertex, Qdrant or D1 bindings are incomplete.");
  }
}

function pageKey(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > BRVIN_M15_FATMAN_SOURCE.pageCount) {
    throw new Error("A valid physical Fatman PDF page is required.");
  }
  return SOURCE_PREFIX + "page-" + String(page).padStart(6, "0") + ".txt";
}

export function pageNumberFromLegacyKey(key: string): number | null {
  if (!key.startsWith(LEGACY_PAGE_PREFIX) || !key.endsWith(".txt")) return null;
  const match = /^fatman\/pages\/page-(\d{1,6})\.txt$/u.exec(key);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page >= 1 && page <= BRVIN_M15_FATMAN_SOURCE.pageCount
    ? page
    : null;
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/iu.test(value);
}

function validBucket(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u.test(value);
}

async function ensureSchema(env: M15FatmanBenchmarkEnv): Promise<void> {
  const db = env.DB!;
  const statements = [
    "CREATE TABLE IF NOT EXISTS brvin_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',owner_label TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS brvin_books (id TEXT PRIMARY KEY,title TEXT NOT NULL,source_filename TEXT NOT NULL,source_sha256 TEXT NOT NULL DEFAULT '',expected_size INTEGER NOT NULL DEFAULT 0,page_count INTEGER NOT NULL,status TEXT NOT NULL,indexed_pages INTEGER NOT NULL DEFAULT 0,error_message TEXT,collection_id TEXT NOT NULL DEFAULT 'general',search_prefix TEXT NOT NULL,source_type TEXT NOT NULL DEFAULT 'pdf',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS brvin_project_books (project_id TEXT NOT NULL,book_id TEXT NOT NULL,created_at INTEGER NOT NULL,created_by TEXT,PRIMARY KEY(project_id,book_id))",
    "CREATE TABLE IF NOT EXISTS brvin_applications (id TEXT PRIMARY KEY CHECK(length(id)=36),slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',owner_label TEXT NOT NULL DEFAULT '',repository_url TEXT NOT NULL DEFAULT '',repository_default_branch TEXT NOT NULL DEFAULT 'main',runtime_provider TEXT NOT NULL DEFAULT 'cloudflare-workers',status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS brvin_application_environments (id TEXT PRIMARY KEY,application_id TEXT NOT NULL,environment_key TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',worker_name TEXT NOT NULL DEFAULT '',worker_url TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revoked_at INTEGER,revoked_by TEXT)",
    "CREATE TABLE IF NOT EXISTS brvin_application_project_grants (id TEXT PRIMARY KEY,application_id TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,created_by TEXT,revoked_at INTEGER,revoked_by TEXT)",
    "CREATE TABLE IF NOT EXISTS brvin_project_search_usage (project_id TEXT NOT NULL,billing_month TEXT NOT NULL,query_count INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,billing_month))",
    "CREATE TABLE IF NOT EXISTS " + SOURCE_TABLE + " (source_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,generation_id TEXT NOT NULL,page_count INTEGER NOT NULL,exported_pages INTEGER NOT NULL DEFAULT 0,chunk_count INTEGER NOT NULL DEFAULT 0,qdrant_indexed_pages INTEGER NOT NULL DEFAULT 0,qdrant_point_count INTEGER NOT NULL DEFAULT 0,ai_search_indexed_pages INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'exporting',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS m15_fatman_legacy_items (pdf_page INTEGER PRIMARY KEY,item_id TEXT NOT NULL,item_key TEXT NOT NULL,status TEXT NOT NULL,file_size INTEGER)",
    "CREATE TABLE IF NOT EXISTS " + RUN_TABLE + " (id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),result_json TEXT NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS idx_m15_fatman_runs_started ON " + RUN_TABLE + "(started_at DESC)",
  ];
  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  if (results.some((result) => !result.success)) {
    throw new Error("The isolated M15 Fatman source, project or run schema could not be confirmed.");
  }
}

async function ensureProjectFixture(env: M15FatmanBenchmarkEnv): Promise<void> {
  const db = env.DB!;
  const now = Date.now();
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_projects(id,name,slug,description,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)",
  ).bind(
    BRVIN_M15_FATMAN_SOURCE.projectId,
    "Fatman 538-page benchmark",
    PROJECT_SLUG,
    "Isolated M15 comparison of the complete legacy Fatman OCR index through Core v2.",
    now,
    now,
  ).run();

  const [project, application, environment] = await Promise.all([
    db.prepare("SELECT id,slug,status FROM brvin_projects WHERE id=? LIMIT 1")
      .bind(BRVIN_M15_FATMAN_SOURCE.projectId).first<{ id: string; slug: string; status: string }>(),
    db.prepare("SELECT id,status FROM brvin_applications WHERE id=? LIMIT 1")
      .bind(BRVIN_M15_STAGING_APPLICATION_ID).first<{ id: string; status: string }>(),
    db.prepare("SELECT id,application_id,environment_key,status FROM brvin_application_environments WHERE id=? LIMIT 1")
      .bind(BRVIN_M15_STAGING_ENVIRONMENT_ID).first<{ id: string; application_id: string; environment_key: string; status: string }>(),
  ]);
  if (!project || project.slug !== PROJECT_SLUG || project.status !== "active" ||
      !application || application.status !== "active" ||
      !environment || environment.application_id !== BRVIN_M15_STAGING_APPLICATION_ID ||
      environment.environment_key !== "staging" || environment.status !== "active") {
    throw new Error("The isolated Fatman M15 project/application/environment identity did not pass exact read-back.");
  }
}

async function getSourceProgress(env: M15FatmanBenchmarkEnv): Promise<SourceProgress | null> {
  return env.DB!.prepare(
    "SELECT source_id,project_id,source_sha256,generation_id,page_count,exported_pages,chunk_count,qdrant_indexed_pages,qdrant_point_count,ai_search_indexed_pages,status,created_at,updated_at FROM " +
    SOURCE_TABLE + " WHERE source_id=? LIMIT 1",
  ).bind(BRVIN_M15_FATMAN_SOURCE.sourceId).first<SourceProgress>();
}

async function ensureSourceProgress(env: M15FatmanBenchmarkEnv): Promise<SourceProgress> {
  let row = await getSourceProgress(env);
  if (row) {
    if (row.source_id !== BRVIN_M15_FATMAN_SOURCE.sourceId ||
        row.project_id !== BRVIN_M15_FATMAN_SOURCE.projectId ||
        row.source_sha256.toLowerCase() !== BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256 ||
        Number(row.page_count) !== BRVIN_M15_FATMAN_SOURCE.pageCount) {
      throw new Error("The Fatman M15 checkpoint conflicts with the pinned source identity.");
    }
    return row;
  }

  const sourceManifest = await buildBrvinSourceManifest({
    sourceId: BRVIN_M15_FATMAN_SOURCE.sourceId,
    sourcePdfSha256: BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256,
    ocrOperationId: BRVIN_M15_FATMAN_SOURCE.legacyExportMarker,
    pageCount: BRVIN_M15_FATMAN_SOURCE.pageCount,
  });
  const now = Date.now();
  const inserted = await env.DB!.prepare(
    "INSERT INTO " + SOURCE_TABLE +
    "(source_id,project_id,source_sha256,generation_id,page_count,exported_pages,chunk_count,qdrant_indexed_pages,qdrant_point_count,ai_search_indexed_pages,status,created_at,updated_at) " +
    "VALUES(?,?,?,?,?,0,0,0,0,0,'exporting',?,?)",
  ).bind(
    BRVIN_M15_FATMAN_SOURCE.sourceId,
    BRVIN_M15_FATMAN_SOURCE.projectId,
    BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256,
    sourceManifest.generationId,
    BRVIN_M15_FATMAN_SOURCE.pageCount,
    now,
    now,
  ).run();
  if (!inserted.success || Number(inserted.meta?.changes ?? 0) !== 1) {
    throw new Error("The immutable Fatman M15 source checkpoint could not be created.");
  }
  row = await getSourceProgress(env);
  if (!row) throw new Error("The Fatman M15 source checkpoint was not readable after creation.");
  return row;
}

async function listLegacyFatmanPages(env: M15FatmanBenchmarkEnv): Promise<Map<number, LegacyPageItem>> {
  const instance = env.BRVIN_M15_FATMAN_SOURCE_EXPORT;
  if (!instance) throw new Error("The read-only existing Fatman AI Search item binding is missing.");
  const all: LegacyPageItem[] = [];
  let page = 1;
  while (page <= 20) {
    const response = await instance.items.list({ page, per_page: 50, source: "builtin" });
    for (const item of response.result ?? []) {
      if (!pageNumberFromLegacyKey(item.key)) continue;
      all.push({
        id: item.id,
        key: item.key,
        status: item.status,
        ...(item.file_size !== undefined ? { file_size: item.file_size } : {}),
      });
    }
    const next = nextAiSearchPage(response, page, 50);
    if (next === null) break;
    page = next;
    if (page === 20) throw new Error("The legacy Fatman source inventory exceeded the bounded 20-page AI Search listing.");
  }

  const byPage = new Map<number, LegacyPageItem>();
  for (const item of all) {
    const physicalPage = pageNumberFromLegacyKey(item.key);
    if (!physicalPage) continue;
    const existing = byPage.get(physicalPage);
    if (existing && existing.id !== item.id && existing.status === "completed" && item.status === "completed") {
      throw new Error("The legacy Fatman AI Search index contains duplicate completed items for physical page " + physicalPage + ".");
    }
    if (!existing || (item.status === "completed" && existing.status !== "completed")) {
      byPage.set(physicalPage, item);
    }
  }
  if (byPage.size !== BRVIN_M15_FATMAN_SOURCE.pageCount) {
    throw new Error("The legacy Fatman AI Search inventory is incomplete: expected 538 distinct physical pages, found " + byPage.size + ".");
  }
  for (let physicalPage = 1; physicalPage <= BRVIN_M15_FATMAN_SOURCE.pageCount; physicalPage += 1) {
    const item = byPage.get(physicalPage);
    if (!item || item.status !== "completed") {
      throw new Error("Legacy Fatman physical page " + physicalPage + " is not completed in the current AI Search index.");
    }
  }
  return byPage;
}

async function ensureFatmanLegacyItemInventory(
  env: M15FatmanBenchmarkEnv,
): Promise<void> {
  const db = env.DB!;
  const count = await db.prepare(
    "SELECT COUNT(*) AS count FROM m15_fatman_legacy_items",
  ).first<{ count: number }>();
  if (Number(count?.count ?? 0) === BRVIN_M15_FATMAN_SOURCE.pageCount) return;

  // Build the inventory once from the read-only production item catalogue.
  // Continuations then read small D1 page ranges instead of rescanning all
  // eleven AI Search listing pages for every export batch.
  const inventory = await listLegacyFatmanPages(env);
  await db.prepare("DELETE FROM m15_fatman_legacy_items").run();
  const rows = [...inventory.entries()].sort((a, b) => a[0] - b[0]);
  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = rows.slice(offset, offset + 50).map(([pdfPage, item]) =>
      db.prepare(
        "INSERT INTO m15_fatman_legacy_items(pdf_page,item_id,item_key,status,file_size) VALUES(?,?,?,?,?)",
      ).bind(pdfPage, item.id, item.key, item.status, item.file_size ?? null)
    );
    const results = await db.batch(batch);
    if (results.some((result) => !result.success)) {
      throw new Error("The one-time legacy Fatman item inventory could not be saved in isolated staging D1.");
    }
  }
  const verified = await db.prepare(
    "SELECT COUNT(*) AS count FROM m15_fatman_legacy_items",
  ).first<{ count: number }>();
  if (Number(verified?.count ?? 0) !== BRVIN_M15_FATMAN_SOURCE.pageCount) {
    throw new Error("The legacy Fatman staging item inventory failed its exact 538-page read-back.");
  }
}

async function readFatmanInventoryRange(
  env: M15FatmanBenchmarkEnv,
  startPage: number,
  endPage: number,
): Promise<Map<number, LegacyPageItem>> {
  const rows = await env.DB!.prepare(
    "SELECT pdf_page,item_id,item_key,status,file_size FROM m15_fatman_legacy_items WHERE pdf_page BETWEEN ? AND ? ORDER BY pdf_page",
  ).bind(startPage, endPage).all<{
    pdf_page: number; item_id: string; item_key: string; status: string; file_size: number | null;
  }>();
  const result = new Map<number, LegacyPageItem>();
  for (const row of rows.results ?? []) {
    result.set(Number(row.pdf_page), {
      id: row.item_id,
      key: row.item_key,
      status: row.status,
      ...(row.file_size !== null ? { file_size: Number(row.file_size) } : {}),
    });
  }
  if (result.size !== endPage - startPage + 1) {
    throw new Error("The checkpointed legacy Fatman page inventory is missing a physical page in the current export batch.");
  }
  return result;
}

async function readLegacyFatmanPage(
  env: M15FatmanBenchmarkEnv,
  item: LegacyPageItem,
  expectedPage: number,
): Promise<string> {
  const instance = env.BRVIN_M15_FATMAN_SOURCE_EXPORT;
  if (!instance) throw new Error("The read-only existing Fatman AI Search item binding is missing.");
  const source = await instance.items.get(item.id).download();
  if (!source.contentType.toLowerCase().startsWith("text/")) {
    throw new Error("The original Fatman AI Search item did not return its stored OCR as text; no Vision re-run was attempted.");
  }
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_LEGACY_PAGE_TEXT_CHARS) {
    throw new Error("The stored Fatman OCR text for physical page " + expectedPage + " is outside the bounded 1–120,000 character range.");
  }
  const text = await new Response(source.body).text();
  if (!text.trim() || text.length > MAX_LEGACY_PAGE_TEXT_CHARS) {
    throw new Error("The stored Fatman OCR text for physical page " + expectedPage + " is empty or exceeds the safe page-text limit.");
  }
  const marker = /PDF\s+page\s*:\s*(\d+)/iu.exec(text.slice(0, 2_000));
  if (!marker || Number(marker[1]) !== expectedPage) {
    throw new Error("The stored OCR page marker does not match physical Fatman PDF page " + expectedPage + ".");
  }
  return text;
}

async function checkpointExportPage(
  env: M15FatmanBenchmarkEnv,
  page: number,
  chunkCount: number,
): Promise<void> {
  const result = await env.DB!.prepare(
    "UPDATE " + SOURCE_TABLE + " SET exported_pages=?,chunk_count=chunk_count+?,status='exporting',updated_at=? WHERE source_id=? AND exported_pages=?",
  ).bind(page, chunkCount, Date.now(), BRVIN_M15_FATMAN_SOURCE.sourceId, page - 1).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error("The Fatman page-export checkpoint could not advance contiguously at physical page " + page + ".");
  }
}

function buildLegacyImportJob(): FatmanImportJob {
  const now = Date.now();
  return {
    id: BRVIN_M15_FATMAN_SOURCE.sourceId,
    book_id: BRVIN_M15_FATMAN_SOURCE.sourceId,
    book_title: BRVIN_M15_FATMAN_SOURCE.title,
    source_object: "legacy-ai-search-index-export/" + BRVIN_M15_FATMAN_SOURCE.legacyDocumentVersion,
    source_sha256: BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256,
    expected_size: 0,
    uploaded_bytes: 0,
    upload_session_uri: null,
    status: "completed",
    vision_operation: BRVIN_M15_FATMAN_SOURCE.legacyExportMarker,
    workflow_instance_id: null,
    indexed_pages: BRVIN_M15_FATMAN_SOURCE.pageCount,
    error_message: null,
    created_at: now,
    updated_at: now,
    page_count: BRVIN_M15_FATMAN_SOURCE.pageCount,
  };
}

function createFatmanQdrantPilot(env: M15FatmanBenchmarkEnv): BrvinQdrantHybridPilot {
  const dimensions = Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 3072) {
    throw new Error("The isolated Fatman Qdrant embedding dimensions are invalid.");
  }
  return new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL,
    apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection: env.BRVIN_M15_FATMAN_QDRANT_COLLECTION!,
    dimensions,
  }, new BrvinVertexEmbeddingProvider(env));
}

function sourceMetadata(page: number): Record<string, string> {
  if (!Number.isSafeInteger(page) || page < 1 || page > BRVIN_M15_FATMAN_SOURCE.pageCount) {
    throw new Error("The M15 Fatman AI Search metadata page number is invalid.");
  }
  return {
    source_id: BRVIN_M15_FATMAN_SOURCE.sourceId,
    project_id: BRVIN_M15_FATMAN_SOURCE.projectId,
    pdf_page: String(page),
    benchmark: "brvin-m15-fatman-538-v1",
  };
}

function exactMetadataSchema(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== AI_SEARCH_METADATA_SCHEMA.length) return false;
  return AI_SEARCH_METADATA_SCHEMA.every((expected) =>
    value.some((actual) => typeof actual === "object" && actual !== null &&
      (actual as { field_name?: unknown }).field_name === expected.field_name &&
      (actual as { data_type?: unknown }).data_type === expected.data_type)
  );
}

async function ensureFatmanStagingSearchSchema(search: AiSearchInstance): Promise<void> {
  const info = await search.info();
  if (exactMetadataSchema(info.custom_metadata)) return;
  if (Array.isArray(info.custom_metadata) && info.custom_metadata.length > 0) {
    throw new Error("The isolated Fatman AI Search metadata schema differs from the pinned four-field schema; refusing to replace it.");
  }
  const updated = await search.update({ custom_metadata: AI_SEARCH_METADATA_SCHEMA.map((field) => ({ ...field })) });
  if (!updated || typeof updated !== "object" ||
      !exactMetadataSchema((updated as Record<string, unknown>).custom_metadata)) {
    throw new Error("The isolated Fatman AI Search index did not confirm its exact source/page metadata schema.");
  }
}

async function listStagingFatmanItems(search: AiSearchInstance): Promise<LegacyPageItem[]> {
  const all: LegacyPageItem[] = [];
  let page = 1;
  while (page <= 30) {
    const response = await search.items.list({ page, per_page: 50, source: "builtin" });
    for (const item of response.result ?? []) {
      if (!item.key.startsWith(SOURCE_PREFIX) || !item.key.endsWith(".txt")) continue;
      all.push({ id: item.id, key: item.key, status: item.status });
    }
    const next = nextAiSearchPage(response, page, 50);
    if (next === null) break;
    page = next;
    if (page === 30) throw new Error("The isolated Fatman staging AI Search inventory exceeded the bounded 30-page listing.");
  }
  return all;
}

async function registerReadyFatmanSource(env: M15FatmanBenchmarkEnv): Promise<void> {
  const db = env.DB!;
  const source = BRVIN_M15_FATMAN_SOURCE;
  const prefix = SOURCE_PREFIX;
  const now = Date.now();
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_books(id,title,source_filename,source_sha256,expected_size,page_count,status,indexed_pages,error_message,collection_id,search_prefix,source_type,created_at,updated_at) " +
    "VALUES(?,?,?,?,0,?,'ready',?,NULL,?,?,'legacy',?,?)",
  ).bind(
    source.sourceId,
    source.title,
    source.fileName,
    source.sourcePdfSha256,
    source.pageCount,
    source.pageCount,
    COLLECTION_ID,
    prefix,
    now,
    now,
  ).run();
  const book = await db.prepare(
    "SELECT id,title,source_sha256,page_count,indexed_pages,status,search_prefix FROM brvin_books WHERE id=? LIMIT 1",
  ).bind(source.sourceId).first<{
    id: string; title: string; source_sha256: string; page_count: number;
    indexed_pages: number; status: string; search_prefix: string;
  }>();
  if (!book || book.title !== source.title ||
      book.source_sha256.toLowerCase() !== source.sourcePdfSha256 ||
      Number(book.page_count) !== source.pageCount ||
      Number(book.indexed_pages) !== source.pageCount ||
      book.status !== "ready" || book.search_prefix !== prefix) {
    throw new Error("The Fatman source registry did not pass its exact SHA/page-count/READY read-back.");
  }

  await db.prepare(
    "INSERT OR IGNORE INTO brvin_project_books(project_id,book_id,created_at,created_by) VALUES(?,?,?,'m15-fatman-538-staging')",
  ).bind(source.projectId, source.sourceId, now).run();
  const [projectGrant, mapping] = await Promise.all([
    db.prepare("SELECT id,status FROM brvin_application_project_grants WHERE application_id=? AND project_id=? LIMIT 1")
      .bind(BRVIN_M15_STAGING_APPLICATION_ID, source.projectId).first<{ id: string; status: string }>(),
    db.prepare("SELECT project_id,book_id FROM brvin_project_books WHERE project_id=? AND book_id=? LIMIT 1")
      .bind(source.projectId, source.sourceId).first<{ project_id: string; book_id: string }>(),
  ]);
  if (!mapping || mapping.project_id !== source.projectId || mapping.book_id !== source.sourceId) {
    throw new Error("The Fatman source was not registered to its isolated project.");
  }
  if (!projectGrant) {
    await db.prepare(
      "INSERT INTO brvin_application_project_grants(id,application_id,project_id,status,created_at,created_by) VALUES(?,?,?,'active',?,'m15-fatman-538-staging')",
    ).bind(source.grantId, BRVIN_M15_STAGING_APPLICATION_ID, source.projectId, now).run();
  } else if (projectGrant.status !== "active" || projectGrant.id !== source.grantId) {
    throw new Error("The Fatman staging application grant is not in the exact active state expected.");
  }

  const verified = await db.prepare(
    "SELECT COUNT(*) AS ready_count FROM brvin_books b JOIN brvin_project_books pb ON pb.book_id=b.id WHERE pb.project_id=? AND b.id=? AND b.status='ready' AND b.indexed_pages=b.page_count",
  ).bind(source.projectId, source.sourceId).first<{ ready_count: number }>();
  if (Number(verified?.ready_count ?? 0) !== 1) {
    throw new Error("The isolated Fatman Core v2 source grant did not pass final D1 read-back.");
  }
}

async function readOneCorpusPage(env: M15FatmanBenchmarkEnv, page: number, generationId: string) {
  const result = await readBrvinCorpusPage(
    env, BRVIN_M15_FATMAN_SOURCE.sourceId, generationId, page,
  );
  if (result.pageManifest.stableItemKey !== pageKey(page)) {
    throw new Error("The stored Fatman corpus page key does not match its deterministic source/page identity.");
  }
  return result.pageManifest;
}

export async function prepareBrvinM15FatmanBenchmarkCorpus(
  env: M15FatmanBenchmarkEnv,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureSchema(env);
  await ensureProjectFixture(env);
  const state = await ensureSourceProgress(env);
  const generationId = state.generation_id;

  if (state.status === "ready") {
    return { ok: true, status: "ready", sourceId: state.source_id, projectId: state.project_id,
      pageCount: state.page_count, chunkCount: state.chunk_count,
      qdrantIndexedPages: state.qdrant_indexed_pages, qdrantPointCount: state.qdrant_point_count,
      aiSearchIndexedPages: state.ai_search_indexed_pages, continuationRequired: false };
  }

  if (state.exported_pages < state.page_count) {
    await ensureFatmanLegacyItemInventory(env);
    const job = buildLegacyImportJob();
    let manifestAlreadyPersisted = state.exported_pages > 0;
    const start = state.exported_pages + 1;
    const end = Math.min(state.page_count, start + EXPORT_BATCH_SIZE - 1);
    const legacyItems = await readFatmanInventoryRange(env, start, end);
    let exported = state.exported_pages;
    for (let physicalPage = start; physicalPage <= end; physicalPage += 1) {
      const item = legacyItems.get(physicalPage);
      if (!item || item.status !== "completed") {
        throw new Error("A completed legacy Fatman page disappeared before its staging export.");
      }
      const rawText = await readLegacyFatmanPage(env, item, physicalPage);
      const persisted = await persistBrvinPageCorpus(
        env, job, physicalPage, rawText, pageKey(physicalPage), undefined,
        {
          storageBucket: env.BRVIN_M14_CORPUS_BUCKET,
          sourceManifestAlreadyPersisted: manifestAlreadyPersisted,
        },
      );
      manifestAlreadyPersisted = true;
      const checkpoint = await checkpointExportPage(env, physicalPage, persisted.chunkCount);
      exported = physicalPage;
      void checkpoint;
    }
    const latest = await getSourceProgress(env);
    if (!latest) throw new Error("The Fatman export checkpoint disappeared after a batch.");
    if (exported === latest.page_count) {
      await env.DB!.prepare("UPDATE " + SOURCE_TABLE + " SET status='qdrant_indexing',updated_at=? WHERE source_id=?")
        .bind(Date.now(), BRVIN_M15_FATMAN_SOURCE.sourceId).run();
    }
    return {
      ok: true,
      status: exported === latest.page_count ? "qdrant_indexing" : "exporting",
      sourceId: latest.source_id, projectId: latest.project_id,
      pageCount: latest.page_count, exportedPages: exported,
      chunkCount: latest.chunk_count, qdrantIndexedPages: latest.qdrant_indexed_pages,
      aiSearchIndexedPages: latest.ai_search_indexed_pages,
      continuationRequired: true,
      note: "The full 538-page OCR text was exported from existing completed AI Search items into immutable private staging manifests. No PDF upload, Vision OCR or production-index mutation occurred.",
    };
  }

  if (state.qdrant_indexed_pages < state.page_count) {
    const pilot = createFatmanQdrantPilot(env);
    const start = state.qdrant_indexed_pages + 1;
    const end = Math.min(state.page_count, start + QDRANT_BATCH_SIZE - 1);
    let indexed = state.qdrant_indexed_pages;
    for (let physicalPage = start; physicalPage <= end; physicalPage += 1) {
      const page = await readOneCorpusPage(env, physicalPage, generationId);
      const result = await pilot.upsertPageChunks({
        projectId: state.project_id,
        sourceId: state.source_id,
        itemKey: page.stableItemKey,
        pdfPage: page.pdfPage,
        generationId,
        chunks: page.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          normalizedText: chunk.normalizedText,
          contentSha256: chunk.contentSha256,
          contentTypes: chunk.contentTypes,
          formulaCandidates: chunk.formulaCandidates.map((formula) => ({
            originalExpression: formula.originalExpression,
            normalizedSearchExpression: formula.normalizedSearchExpression,
            confidence: formula.confidence,
          })),
        })),
      });
      const update = await env.DB!.prepare(
        "UPDATE " + SOURCE_TABLE + " SET qdrant_indexed_pages=?,qdrant_point_count=qdrant_point_count+?,status='qdrant_indexing',updated_at=? WHERE source_id=? AND qdrant_indexed_pages=?",
      ).bind(physicalPage, result.pointCount, Date.now(), state.source_id, physicalPage - 1).run();
      if (!update.success || Number(update.meta?.changes ?? 0) !== 1) {
        throw new Error("The Qdrant page-index checkpoint could not advance at Fatman physical page " + physicalPage + ".");
      }
      indexed = physicalPage;
    }
    const latest = await getSourceProgress(env);
    if (!latest) throw new Error("The Qdrant page-index checkpoint disappeared after a batch.");
    if (indexed === latest.page_count) {
      const actualPoints = await pilot.countSourcePoints(state.project_id, state.source_id);
      if (actualPoints !== latest.chunk_count) {
        throw new Error("Qdrant source point count " + actualPoints + " does not match the verified Fatman chunk count " + latest.chunk_count + ".");
      }
      await env.DB!.prepare("UPDATE " + SOURCE_TABLE + " SET status='ai_search_indexing',qdrant_point_count=?,updated_at=? WHERE source_id=?")
        .bind(actualPoints, Date.now(), state.source_id).run();
    }
    return {
      ok: true,
      status: indexed === latest.page_count ? "ai_search_indexing" : "qdrant_indexing",
      sourceId: state.source_id, pageCount: state.page_count,
      exportedPages: latest.exported_pages, chunkCount: latest.chunk_count,
      qdrantIndexedPages: indexed,
      qdrantPointCount: latest.qdrant_point_count,
      aiSearchIndexedPages: latest.ai_search_indexed_pages,
      continuationRequired: true,
      note: "Qdrant is being populated with deterministic Vertex dense embeddings plus BM25 sparse vectors; each page write is read back and the checkpoint is resumable.",
    };
  }

  if (state.ai_search_indexed_pages < state.page_count) {
    const search = env.BRVIN_M15_FATMAN_AI_SEARCH!;
    await ensureFatmanStagingSearchSchema(search);
    const start = state.ai_search_indexed_pages + 1;
    const end = Math.min(state.page_count, start + AI_SEARCH_BATCH_SIZE - 1);
    let indexed = state.ai_search_indexed_pages;
    for (let physicalPage = start; physicalPage <= end; physicalPage += 1) {
      const page = await readOneCorpusPage(env, physicalPage, generationId);
      const key = pageKey(physicalPage);
      const existing = await search.items.list({ search: key, per_page: 50, source: "builtin" });
      const exact = (existing.result ?? []).filter((item) => item.key === key);
      const completed = exact.find((item) => item.status === "completed");
      if (completed) {
        indexed = physicalPage;
      } else if (exact.some((item) => item.status === "queued" || item.status === "running")) {
        return {
          ok: true, status: "ai_search_indexing", pendingPage: physicalPage,
          exportedPages: state.exported_pages, qdrantIndexedPages: state.qdrant_indexed_pages,
          aiSearchIndexedPages: indexed, continuationRequired: true,
          note: "Cloudflare AI Search accepted this deterministic page key and is still indexing it. Polling is safe; no duplicate item will be uploaded.",
        };
      } else {
        if (exact.length) {
          throw new Error("The staging AI Search page " + physicalPage + " has a terminal error or duplicate item; refusing to delete or overwrite it.");
        }
        const uploaded = await search.items.upload(key, page.rawOcrText, { metadata: sourceMetadata(physicalPage) });
        if (uploaded.key !== key) throw new Error("Staging AI Search returned an unexpected Fatman item key.");
        if (uploaded.status === "queued" || uploaded.status === "running") {
          return {
            ok: true, status: "ai_search_indexing", pendingPage: physicalPage,
            exportedPages: state.exported_pages, qdrantIndexedPages: state.qdrant_indexed_pages,
            aiSearchIndexedPages: indexed, continuationRequired: true,
            note: "Cloudflare AI Search accepted this page asynchronously. The next continuation will poll this exact key.",
          };
        }
        if (uploaded.status !== "completed") {
          throw new Error("Cloudflare AI Search did not confirm indexing completion for Fatman page " + physicalPage + ".");
        }
        indexed = physicalPage;
      }
      if (indexed > state.ai_search_indexed_pages) {
        const update = await env.DB!.prepare(
          "UPDATE " + SOURCE_TABLE + " SET ai_search_indexed_pages=?,status='ai_search_indexing',updated_at=? WHERE source_id=? AND ai_search_indexed_pages=?",
        ).bind(indexed, Date.now(), state.source_id, indexed - 1).run();
        if (!update.success || Number(update.meta?.changes ?? 0) !== 1) {
          throw new Error("The AI Search page-index checkpoint could not advance contiguously at Fatman page " + physicalPage + ".");
        }
      }
    }
    const latest = await getSourceProgress(env);
    if (!latest) throw new Error("The AI Search checkpoint disappeared after a batch.");
    return {
      ok: true, status: latest.ai_search_indexed_pages === latest.page_count ? "verifying" : "ai_search_indexing",
      sourceId: state.source_id, pageCount: state.page_count,
      exportedPages: latest.exported_pages, chunkCount: latest.chunk_count,
      qdrantIndexedPages: latest.qdrant_indexed_pages, qdrantPointCount: latest.qdrant_point_count,
      aiSearchIndexedPages: latest.ai_search_indexed_pages,
      continuationRequired: true,
    };
  }

  const searchItems = await listStagingFatmanItems(env.BRVIN_M15_FATMAN_AI_SEARCH!);
  const exactKeys = new Set(Array.from({ length: state.page_count }, (_, index) => pageKey(index + 1)));
  const matched = searchItems.filter((item) => exactKeys.has(item.key));
  if (matched.length !== state.page_count || matched.some((item) => item.status !== "completed")) {
    throw new Error("The isolated Fatman AI Search index did not confirm all 538 exact completed page items.");
  }
  const pilot = createFatmanQdrantPilot(env);
  const pointCount = await pilot.countSourcePoints(state.project_id, state.source_id);
  if (pointCount !== state.chunk_count) throw new Error("The final Fatman Qdrant source point count failed exact read-back.");
  await registerReadyFatmanSource(env);
  const done = await env.DB!.prepare(
    "UPDATE " + SOURCE_TABLE + " SET status='ready',qdrant_point_count=?,updated_at=? WHERE source_id=?",
  ).bind(pointCount, Date.now(), state.source_id).run();
  if (!done.success || Number(done.meta?.changes ?? 0) !== 1) {
    throw new Error("The isolated 538-page Fatman source could not be marked READY after provider verification.");
  }
  return {
    ok: true, status: "ready", sourceId: state.source_id, projectId: state.project_id,
    pageCount: state.page_count, exportedPages: state.page_count,
    chunkCount: state.chunk_count, qdrantIndexedPages: state.qdrant_indexed_pages,
    qdrantPointCount: pointCount, aiSearchIndexedPages: state.page_count,
    continuationRequired: false,
    sideEffects: {
      sourcePdfUploaded: false, visionOcrSubmitted: false,
      legacyAiSearchItemsModified: false, productionD1Accessed: false,
      productionAiSearchMutations: 0, productionQdrantMutations: 0,
    },
    note: "The immutable 538-page Fatman source is READY in a separate staging D1 project, Qdrant collection and AI Search instance. Production source/index data were read-only.",
  };
}

export async function getBrvinM15FatmanBenchmarkStatus(
  env: M15FatmanBenchmarkEnv,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureSchema(env);
  const state = await getSourceProgress(env);
  const runs = await env.DB!.prepare(
    "SELECT id,status,started_at,completed_at FROM " + RUN_TABLE + " ORDER BY started_at DESC LIMIT 5",
  ).all<{ id: string; status: string; started_at: number; completed_at: number | null }>();
  return {
    ok: true,
    status: state?.status ?? "not_started",
    source: state ? {
      sourceId: state.source_id,
      projectId: state.project_id,
      generationId: state.generation_id,
      pageCount: state.page_count,
      exportedPages: state.exported_pages,
      chunkCount: state.chunk_count,
      qdrantIndexedPages: state.qdrant_indexed_pages,
      qdrantPointCount: state.qdrant_point_count,
      aiSearchIndexedPages: state.ai_search_indexed_pages,
    } : null,
    latestRuns: (runs.results ?? []).map((item) => ({
      id: item.id, status: item.status, startedAt: item.started_at, completedAt: item.completed_at,
    })),
  };
}

export function compositeScore(value: JudgeAssessment): number {
  return Number((
    value.retrievalRelevance * 0.35 +
    value.answerCorrectness * 0.30 +
    value.sourceGrounding * 0.25 +
    value.citationAccuracy * 0.10
  ).toFixed(4));
}

export function validateJudgeAssessment(value: unknown): JudgeAssessment {
  if (!value || typeof value !== "object") throw new Error("The AI assessor returned no structured assessment.");
  const raw = value as Record<string, unknown>;
  const score = (key: string) => {
    const n = Number(raw[key]);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error("The AI assessor returned an invalid " + key + " score.");
    return n;
  };
  const strings = (key: string) => Array.isArray(raw[key])
    ? (raw[key] as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 12)
    : [];
  if (typeof raw.abstainedCorrectly !== "boolean" || typeof raw.criticalError !== "boolean") {
    throw new Error("The AI assessor omitted the required abstention or critical-error decision.");
  }
  return {
    retrievalRelevance: score("retrievalRelevance"),
    answerCorrectness: score("answerCorrectness"),
    sourceGrounding: score("sourceGrounding"),
    citationAccuracy: score("citationAccuracy"),
    abstainedCorrectly: raw.abstainedCorrectly,
    criticalError: raw.criticalError,
    missingFacts: strings("missingFacts"),
    unsupportedClaims: strings("unsupportedClaims"),
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 900) : "",
  };
}

const ASSESSMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    retrievalRelevance: { type: "INTEGER" },
    answerCorrectness: { type: "INTEGER" },
    sourceGrounding: { type: "INTEGER" },
    citationAccuracy: { type: "INTEGER" },
    abstainedCorrectly: { type: "BOOLEAN" },
    criticalError: { type: "BOOLEAN" },
    missingFacts: { type: "ARRAY", items: { type: "STRING" } },
    unsupportedClaims: { type: "ARRAY", items: { type: "STRING" } },
    rationale: { type: "STRING" },
  },
  required: [
    "retrievalRelevance", "answerCorrectness", "sourceGrounding", "citationAccuracy",
    "abstainedCorrectly", "criticalError", "missingFacts", "unsupportedClaims", "rationale",
  ],
};

async function callVertexAssessor(
  env: M15FatmanBenchmarkEnv,
  agent: "A" | "B" | "adjudicator",
  model: string,
  systemInstruction: string,
  payload: Record<string, unknown>,
): Promise<AssessorReceipt> {
  const projectId = env.GCP_PROJECT_ID?.trim();
  const location = env.GEMINI_LOCATION?.trim() || "global";
  if (!projectId) throw new Error("The staging Google Cloud project is not configured for AI assessment.");
  const token = await getGoogleAccessToken(env);
  const endpoint =
    "https://aiplatform.googleapis.com/v1/projects/" + encodeURIComponent(projectId) +
    "/locations/" + encodeURIComponent(location) +
    "/publishers/google/models/" + encodeURIComponent(model) + ":generateContent";
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1_600,
        responseMimeType: "application/json",
        responseSchema: ASSESSMENT_SCHEMA,
        thinkingConfig: { thinkingLevel: "MEDIUM" },
      },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 240);
    throw new Error("Vertex AI assessor " + model + " failed (HTTP " + response.status + "). " + detail);
  }
  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
  if (!text || data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    throw new Error("Vertex AI assessor " + model + " did not return a complete structured assessment.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\s*`{3}(?:json)?\s*/iu, "").replace(/\s*`{3}\s*$/u, ""));
  } catch {
    throw new Error("Vertex AI assessor " + model + " returned invalid JSON.");
  }
  const usage = data.usageMetadata ?? {};
  return {
    agent,
    model,
    assessment: validateJudgeAssessment(parsed),
    promptTokens: Number(usage.promptTokenCount ?? 0),
    outputTokens: Number(usage.candidatesTokenCount ?? 0),
    totalTokens: Number(usage.totalTokenCount ?? 0),
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

const AGENT_A_INSTRUCTION = [
  "You are Agent A, the independent source-retrieval and evidence-coverage assessor.",
  "Assess only the supplied question, required source facts, physical-page targets, retrieved page passages and answer.",
  "Grade retrieval relevance and coverage by passage content, not scores, rank labels or the provider. Grade whether the answer is supported by the passages and whether it cites the correct PDF pages.",
  "Never use outside knowledge to repair missing book evidence. A passage that is merely about the same broad topic is not answer-bearing.",
  "For an expected no-match case, abstainedCorrectly is true only when the answer explicitly declines to assert unsupported facts. Any specific unsupported answer is a critical error.",
  "Scores are integers from 0 (unusable/incorrect) to 5 (complete and fully supported). Return only the requested JSON object.",
].join(" ");

const AGENT_B_INSTRUCTION = [
  "You are Agent B, a separate skeptical answer-correctness auditor. You have not seen Agent A's assessment.",
  "Independently verify each material claim in the answer against the exact retrieved OCR passages and the required facts.",
  "Penalize invented names, dates, numbers, formula operators, page claims, omitted decisive facts, contradictions, and unsupported expansions. Do not reward fluent wording when source evidence is absent.",
  "Also grade retrieval relevance: a returned passage is useful only when its actual text supports the requested question. Do not use provider labels, scores or ranking values as evidence.",
  "For expected no-match questions, require an explicit abstention and no invented answer. Return criticalError=true for a material unsupported or contradictory claim.",
  "Scores are integers from 0 (unusable/incorrect) to 5 (complete and fully supported). Return only the requested JSON object.",
].join(" ");

const ADJUDICATOR_INSTRUCTION = [
  "You are the final AI adjudicator in a source-grounded retrieval comparison. You are independent of the two prior assessments.",
  "Read the original question, expected facts, physical-page targets, source passages and answer. Then consider both assessors' rationales and scores.",
  "Resolve disagreements from the supplied source evidence, not by averaging blindly. Do not use general knowledge to fill gaps. A material unsupported claim or wrong citation is a critical error.",
  "Return one conservative final set of 0–5 scores and an explicit abstention/critical-error decision as JSON.",
].join(" ");

function buildAssessmentInput(
  qaCase: FatmanReleaseQaCase,
  passages: FatmanPassage[],
  answer: string,
): Record<string, unknown> {
  return {
    caseId: qaCase.id,
    question: qaCase.question,
    expectedPdfPages: qaCase.expectedPages,
    requiredFactGroups: qaCase.requiredFactGroups,
    expectedNoMatch: qaCase.expectAbstention === true,
    passages: passages.slice(0, 8).map((passage, index) => ({
      passageId: "E" + (index + 1),
      physicalPdfPage: passage.pdfPage,
      text: passage.text.slice(0, 1_100),
    })),
    answer: answer.slice(0, 3_900),
  };
}

async function assessOneProviderCase(
  env: M15FatmanBenchmarkEnv,
  provider: "cloudflare-ai-search" | "qdrant-vertex",
  qaCase: FatmanReleaseQaCase,
): Promise<ProviderCaseReceipt> {
  const started = performance.now();
  const providerEnv = provider === "cloudflare-ai-search"
    ? {
        ...env,
        BRVIN_RETRIEVAL_PROVIDER: "cloudflare-ai-search",
        BRVIN_SEARCH: {
          get: (name: string) => {
            if (name !== "m15-fatman") throw new Error("Unexpected AI Search instance requested by the Fatman evaluator.");
            if (!env.BRVIN_M15_FATMAN_AI_SEARCH) throw new Error("The staging Fatman AI Search binding is missing.");
            return env.BRVIN_M15_FATMAN_AI_SEARCH;
          },
        } as AiSearchNamespace,
        BRVIN_SEARCH_INSTANCE: "m15-fatman",
      }
    : {
        ...env,
        BRVIN_RETRIEVAL_PROVIDER: "qdrant-vertex",
        BRVIN_M15_BENCHMARK_QDRANT_COLLECTION: env.BRVIN_M15_FATMAN_QDRANT_COLLECTION,
      };

  const contexts = new Map<string, FatmanBookContext>();
  let answer = "";
  const qa = await runFatmanReleaseQaCase({
    retrieve: async (query) => {
      const result = await retrieveBrvinForApplicationV2(
        providerEnv,
        BRVIN_M15_STAGING_ENVIRONMENT_ID,
        {
          projectId: BRVIN_M15_FATMAN_SOURCE.projectId,
          queries: [query],
          requestId: "m15-fatman-" + provider + "-" + qaCase.id + "-" + crypto.randomUUID(),
        },
      );
      if (!result.ok) throw new Error("Core v2 " + provider + " retrieval failed: " + result.message);
      const context: FatmanBookContext = {
        passages: result.data.passages.map((passage) => ({
          id: passage.id,
          pdfPage: passage.pdfPage,
          bookId: passage.bookId,
          bookTitle: passage.bookTitle,
          ...(passage.printedPage ? { printedPage: passage.printedPage } : {}),
          ...(passage.section ? { section: passage.section } : {}),
          text: passage.text,
          score: passage.score,
        })),
        pageImages: [],
        searchCount: Math.max(1, result.data.searchCount),
      };
      contexts.set(query, context);
      return context;
    },
    answer: async (question, context, repairHint) => {
      const generation = await generateGeminiAnswer(
        env,
        question,
        QA_PROFILE,
        [],
        undefined,
        repairHint ? { ...context, qaRepairHint: repairHint } : context,
      );
      answer = generation.packet.answer;
      return {
        answer,
        estimatedCostMicrousd: generation.usage.reduce(
          (total, usage) => total + Math.max(0, Math.floor(usage.estimatedCostMicrousd ?? 0)),
          0,
        ),
      };
    },
  }, qaCase);

  const uniquePassages = new Map<string, FatmanPassage>();
  for (const context of contexts.values()) {
    for (const passage of context.passages) {
      const current = uniquePassages.get(passage.id);
      if (!current || passage.score > current.score) uniquePassages.set(passage.id, passage);
    }
  }
  const passages = [...uniquePassages.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const input = buildAssessmentInput(qaCase, passages, answer);
  const modelA = env.BRVIN_M15_FATMAN_JUDGE_A_MODEL?.trim() || "gemini-4-argon";
  const modelB = env.BRVIN_M15_FATMAN_JUDGE_B_MODEL?.trim() || "gemini-3.8-flash";
  const [agentA, agentB] = await Promise.all([
    callVertexAssessor(env, "A", modelA, AGENT_A_INSTRUCTION, input),
    callVertexAssessor(env, "B", modelB, AGENT_B_INSTRUCTION, input),
  ]);
  const scoreA = compositeScore(agentA.assessment);
  const scoreB = compositeScore(agentB.assessment);
  const disagreement =
    Math.abs(scoreA - scoreB) >= 0.6 ||
    agentA.assessment.criticalError !== agentB.assessment.criticalError ||
    agentA.assessment.abstainedCorrectly !== agentB.assessment.abstainedCorrectly;
  let adjudication: ProviderCaseReceipt["adjudication"];
  if (disagreement) {
    const adjudicator = await callVertexAssessor(
      env,
      "adjudicator",
      modelA,
      ADJUDICATOR_INSTRUCTION,
      {
        ...input,
        independentAssessments: [
          { model: agentA.model, scores: agentA.assessment },
          { model: agentB.model, scores: agentB.assessment },
        ],
      },
    );
    adjudication = {
      method: "ai-adjudicator",
      assessment: adjudicator.assessment,
      compositeScore: compositeScore(adjudicator.assessment),
      adjudicator,
    };
  } else {
    const assessment: JudgeAssessment = {
      retrievalRelevance: Math.round((agentA.assessment.retrievalRelevance + agentB.assessment.retrievalRelevance) / 2 * 100) / 100,
      answerCorrectness: Math.round((agentA.assessment.answerCorrectness + agentB.assessment.answerCorrectness) / 2 * 100) / 100,
      sourceGrounding: Math.round((agentA.assessment.sourceGrounding + agentB.assessment.sourceGrounding) / 2 * 100) / 100,
      citationAccuracy: Math.round((agentA.assessment.citationAccuracy + agentB.assessment.citationAccuracy) / 2 * 100) / 100,
      abstainedCorrectly: agentA.assessment.abstainedCorrectly && agentB.assessment.abstainedCorrectly,
      criticalError: agentA.assessment.criticalError || agentB.assessment.criticalError,
      missingFacts: [...new Set([...agentA.assessment.missingFacts, ...agentB.assessment.missingFacts])].slice(0, 12),
      unsupportedClaims: [...new Set([...agentA.assessment.unsupportedClaims, ...agentB.assessment.unsupportedClaims])].slice(0, 12),
      rationale: "Both independent assessors agreed within the predeclared 0.6 composite-score tolerance; conservative flags were retained.",
    };
    adjudication = {
      method: "independent-agreement-average",
      assessment,
      compositeScore: compositeScore(assessment),
    };
  }

  return {
    provider,
    qa,
    answer: answer.slice(0, 3_900),
    passages: passages.map((passage) => ({ pdfPage: passage.pdfPage, text: passage.text.slice(0, 1_100) })),
    agentA,
    agentB,
    adjudication,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function summarizeProvider(cases: FatmanRunCase[], provider: "cloudflareAiSearch" | "qdrantVertex") {
  const rows = cases.map((item) => item[provider]);
  const assessment = (row: ProviderCaseReceipt) => row.adjudication.assessment;
  const timings = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (q: number) => timings.length
    ? timings[Math.max(0, Math.min(timings.length - 1, Math.ceil(q * timings.length) - 1))]
    : null;
  const positive = rows.filter((row) => row.qa.expectedPages.length > 0 && row.qa.category !== "out_of_book");
  const negative = rows.filter((row) => row.qa.category === "out_of_book");
  const agentA = rows.map((row) => compositeScore(row.agentA.assessment));
  const agentB = rows.map((row) => compositeScore(row.agentB.assessment));
  const adjudicated = rows.map((row) => row.adjudication.compositeScore);
  const qaPassed = rows.filter((row) => row.qa.status === "passed").length;
  const retrievalPassed = rows.filter((row) => row.qa.retrievalStatus === "passed").length;
  const answerPassed = rows.filter((row) => row.qa.answerStatus === "passed").length;
  const criticalErrors = rows.filter((row) => assessment(row).criticalError).length;
  const abstentionPassed = negative.filter((row) => assessment(row).abstainedCorrectly).length;
  return {
    queryCount: rows.length,
    completedQueries: rows.length,
    deterministicQaPassed: qaPassed,
    deterministicRetrievalPassed: retrievalPassed,
    deterministicAnswerPassed: answerPassed,
    positiveQueryCount: positive.length,
    outOfBookQueryCount: negative.length,
    outOfBookAbstentionPassed: abstentionPassed,
    outOfBookCandidateQueryCount: negative.filter((row) => row.passages.length > 0).length,
    criticalErrorCount: criticalErrors,
    agentACompositeScore: average(agentA),
    agentBCompositeScore: average(agentB),
    adjudicatedCompositeScore: average(adjudicated),
    retrievalRelevanceScore: average(rows.map((row) => assessment(row).retrievalRelevance)),
    answerCorrectnessScore: average(rows.map((row) => assessment(row).answerCorrectness)),
    sourceGroundingScore: average(rows.map((row) => assessment(row).sourceGrounding)),
    citationAccuracyScore: average(rows.map((row) => assessment(row).citationAccuracy)),
    observedCaseLatencyMs: {
      sampleCount: timings.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      note: "Sequential per-case staging measurements; not a concurrency load test or production SLO.",
    },
    answerGenerationCount: rows.reduce((sum, row) => sum + row.qa.generationAttempts, 0),
    searchRequestCount: rows.reduce((sum, row) => sum + row.qa.queryCount, 0),
    estimatedAnswerCostMicrousd: rows.reduce((sum, row) => sum + row.qa.estimatedCostMicrousd, 0),
    judgeInputTokens: rows.reduce((sum, row) =>
      sum + row.agentA.totalTokens + row.agentB.totalTokens + (row.adjudication.adjudicator?.totalTokens ?? 0), 0),
  };
}

export async function startBrvinM15FatmanBenchmark(
  env: M15FatmanBenchmarkEnv,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureSchema(env);
  const source = await getSourceProgress(env);
  if (!source || source.status !== "ready" || source.exported_pages !== source.page_count ||
      source.qdrant_indexed_pages !== source.page_count ||
      source.ai_search_indexed_pages !== source.page_count) {
    throw new Error("The complete 538-page Fatman source must be READY in both staging providers before evaluation starts.");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const created = await env.DB!.prepare(
    "INSERT INTO " + RUN_TABLE + "(id,status,result_json,started_at,completed_at) VALUES(?,'running','[]',?,NULL)",
  ).bind(id, now).run();
  if (!created.success || Number(created.meta?.changes ?? 0) !== 1) {
    throw new Error("The Fatman M15 dual-provider evaluation run could not be created.");
  }
  return {
    ok: true,
    runId: id,
    status: "running",
    caseIds: FATMAN_RELEASE_QA_CASES.map((item) => item.id),
    totalCases: FATMAN_RELEASE_QA_CASES.length,
    assessorModels: {
      agentA: env.BRVIN_M15_FATMAN_JUDGE_A_MODEL?.trim() || "gemini-4-argon",
      agentB: env.BRVIN_M15_FATMAN_JUDGE_B_MODEL?.trim() || "gemini-3.8-flash",
    },
  };
}

export async function runBrvinM15FatmanBenchmarkCase(
  env: M15FatmanBenchmarkEnv,
  runId: string,
  caseId: string,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureSchema(env);
  if (!/^[a-f0-9-]{36}$/iu.test(runId)) throw new Error("The Fatman benchmark run identifier is invalid.");
  const qaCase = FATMAN_RELEASE_QA_CASES.find((item) => item.id === caseId);
  if (!qaCase) throw new Error("The requested Fatman QA case is not part of the pinned v4 suite.");
  const run = await env.DB!.prepare(
    "SELECT id,status,result_json FROM " + RUN_TABLE + " WHERE id=? LIMIT 1",
  ).bind(runId).first<{ id: string; status: string; result_json: string }>();
  if (!run || run.status !== "running") throw new Error("The requested Fatman evaluation run is not active.");
  let existing: FatmanRunCase[];
  try {
    existing = JSON.parse(run.result_json) as FatmanRunCase[];
  } catch {
    throw new Error("The saved Fatman evaluation receipt is not valid JSON.");
  }
  const prior = existing.find((item) => item.caseId === caseId);
  if (prior) return { ok: true, runId, caseId, alreadyCompleted: true, completedCases: existing.length, totalCases: FATMAN_RELEASE_QA_CASES.length };

  const [cloudflareAiSearch, qdrantVertex] = await Promise.all([
    assessOneProviderCase(env, "cloudflare-ai-search", qaCase),
    assessOneProviderCase(env, "qdrant-vertex", qaCase),
  ]);
  const row: FatmanRunCase = {
    caseId,
    query: qaCase.question,
    expectedPages: [...qaCase.expectedPages],
    expectedNoMatch: qaCase.expectAbstention === true,
    cloudflareAiSearch,
    qdrantVertex,
  };
  existing.push(row);
  const persisted = await env.DB!.prepare(
    "UPDATE " + RUN_TABLE + " SET result_json=? WHERE id=? AND status='running'",
  ).bind(JSON.stringify(existing), runId).run();
  if (!persisted.success || Number(persisted.meta?.changes ?? 0) !== 1) {
    throw new Error("The Fatman provider/assessor result could not be persisted to isolated staging D1.");
  }
  return {
    ok: true,
    runId,
    caseId,
    completedCases: existing.length,
    totalCases: FATMAN_RELEASE_QA_CASES.length,
    cloudflareAiSearch: {
      qaStatus: cloudflareAiSearch.qa.status,
      score: cloudflareAiSearch.adjudication.compositeScore,
      agentA: compositeScore(cloudflareAiSearch.agentA.assessment),
      agentB: compositeScore(cloudflareAiSearch.agentB.assessment),
      adjudication: cloudflareAiSearch.adjudication.method,
      elapsedMs: cloudflareAiSearch.elapsedMs,
    },
    qdrantVertex: {
      qaStatus: qdrantVertex.qa.status,
      score: qdrantVertex.adjudication.compositeScore,
      agentA: compositeScore(qdrantVertex.agentA.assessment),
      agentB: compositeScore(qdrantVertex.agentB.assessment),
      adjudication: qdrantVertex.adjudication.method,
      elapsedMs: qdrantVertex.elapsedMs,
    },
  };
}

export async function finalizeBrvinM15FatmanBenchmark(
  env: M15FatmanBenchmarkEnv,
  runId: string,
): Promise<Record<string, unknown>> {
  assertStaging(env);
  await ensureSchema(env);
  const run = await env.DB!.prepare(
    "SELECT id,status,result_json,started_at FROM " + RUN_TABLE + " WHERE id=? LIMIT 1",
  ).bind(runId).first<{ id: string; status: string; result_json: string; started_at: number }>();
  if (!run || run.status !== "running") throw new Error("The Fatman M15 benchmark run is not active.");
  const cases = JSON.parse(run.result_json) as FatmanRunCase[];
  if (cases.length !== FATMAN_RELEASE_QA_CASES.length ||
      FATMAN_RELEASE_QA_CASES.some((item) => !cases.some((row) => row.caseId === item.id))) {
    throw new Error("The Fatman benchmark cannot be finalized until all 12 provider-paired cases have completed.");
  }
  const ai = summarizeProvider(cases, "cloudflareAiSearch");
  const qdrant = summarizeProvider(cases, "qdrantVertex");
  const qdrantNotWorseOnGuardrails =
    qdrant.deterministicQaPassed >= ai.deterministicQaPassed &&
    qdrant.criticalErrorCount <= ai.criticalErrorCount &&
    qdrant.outOfBookAbstentionPassed >= ai.outOfBookAbstentionPassed;
  const qdrantWins =
    qdrant.adjudicatedCompositeScore > ai.adjudicatedCompositeScore + 0.001 &&
    qdrantNotWorseOnGuardrails &&
    qdrant.agentACompositeScore >= ai.agentACompositeScore - 0.05 &&
    qdrant.agentBCompositeScore >= ai.agentBCompositeScore - 0.05;
  const aiWins =
    ai.adjudicatedCompositeScore > qdrant.adjudicatedCompositeScore + 0.001 &&
    ai.deterministicQaPassed >= qdrant.deterministicQaPassed &&
    ai.criticalErrorCount <= qdrant.criticalErrorCount &&
    ai.outOfBookAbstentionPassed >= qdrant.outOfBookAbstentionPassed;
  const winner = qdrantWins ? "qdrant-vertex" : aiWins ? "cloudflare-ai-search" : "no-clear-winner";
  const report = {
    ok: true,
    benchmark: "brvin-m15-fatman-538-two-agent-end-to-end-v1",
    runId,
    environment: "staging",
    source: {
      sourceId: BRVIN_M15_FATMAN_SOURCE.sourceId,
      title: BRVIN_M15_FATMAN_SOURCE.title,
      sourcePdfSha256: BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256,
      pageCount: BRVIN_M15_FATMAN_SOURCE.pageCount,
      generationId: (await getSourceProgress(env))?.generation_id,
    },
    queryCount: cases.length,
    providers: {
      cloudflareAiSearch: { instance: "brvin-m15-fatman-legacy-v1", summary: ai },
      qdrantVertex: { collection: env.BRVIN_M15_FATMAN_QDRANT_COLLECTION, summary: qdrant },
    },
    decision: {
      winner,
      qdrantNotWorseOnGuardrails,
      qdrantWinsByBothAssessors: qdrant.agentACompositeScore > ai.agentACompositeScore &&
        qdrant.agentBCompositeScore > ai.agentBCompositeScore,
      adjudicatedQualityScoreDifference: Number((qdrant.adjudicatedCompositeScore - ai.adjudicatedCompositeScore).toFixed(4)),
      productionCutoverRecommended: qdrantWins,
      humanReviewRequired: false,
      note: "The winner is selected from two blind independent AI assessors plus a separate AI adjudication pass on material disagreements. The deterministic Fatman retrieval/answer QA, critical-error count and out-of-book abstention are guardrails. No human labels or review are required.",
    },
    assessorModels: {
      agentA: env.BRVIN_M15_FATMAN_JUDGE_A_MODEL?.trim() || "gemini-4-argon",
      agentB: env.BRVIN_M15_FATMAN_JUDGE_B_MODEL?.trim() || "gemini-3.8-flash",
      adjudicator: env.BRVIN_M15_FATMAN_JUDGE_A_MODEL?.trim() || "gemini-4-argon",
    },
    quota: {
      projectId: BRVIN_M15_FATMAN_SOURCE.projectId,
      month: new Date().toISOString().slice(0, 7),
      queryCount: await env.DB!.prepare(
        "SELECT query_count FROM brvin_project_search_usage WHERE project_id=? AND billing_month=?",
      ).bind(BRVIN_M15_FATMAN_SOURCE.projectId, new Date().toISOString().slice(0, 7))
        .first<{ query_count: number }>().then((row) => Number(row?.query_count ?? 0)),
    },
    results: cases,
    sideEffects: {
      productionD1Accessed: false,
      productionAiSearchMutations: 0,
      productionQdrantMutations: 0,
      legacyAiSearchItemsModified: false,
      sourcePdfUploaded: false,
      visionOcrSubmitted: false,
    },
    interpretation: "This is a paired end-to-end comparison using the same 538-page Fatman source text, frozen 12-case suite, source-grounded answer generator and two independent AI assessors for both providers. It is not a concurrency load test; sequential latency is reported separately.",
  };
  const updated = await env.DB!.prepare(
    "UPDATE " + RUN_TABLE + " SET status='completed',result_json=?,completed_at=? WHERE id=? AND status='running'",
  ).bind(JSON.stringify(report), Date.now(), runId).run();
  if (!updated.success || Number(updated.meta?.changes ?? 0) !== 1) {
    throw new Error("The completed Fatman benchmark receipt could not be finalized in isolated staging D1.");
  }
  return report;
}

function equalSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function authorized(request: Request, env: M15FatmanBenchmarkEnv): Promise<boolean> {
  const configured = env.BRVIN_M14_ADMIN_TOKEN?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return configured.length >= 32 && equalSecret(configured, supplied);
}

async function handleAuthenticatedRequest(
  request: Request,
  env: M15FatmanBenchmarkEnv,
  pathname: string,
): Promise<Response> {
  if (env.ENVIRONMENT !== "staging" || env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ ok: false, error: "m15_fatman_staging_disabled" }, 404);
  }
  if (!await authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    if (pathname === "/admin/m15/fatman/status" && request.method === "GET") {
      return json(await getBrvinM15FatmanBenchmarkStatus(env));
    }
    if (pathname === "/admin/m15/fatman/prepare" && request.method === "POST") {
      return json(await prepareBrvinM15FatmanBenchmarkCorpus(env));
    }
    if (pathname === "/admin/m15/fatman/evaluate/start" && request.method === "POST") {
      return json(await startBrvinM15FatmanBenchmark(env));
    }
    if (pathname === "/admin/m15/fatman/evaluate/case" && request.method === "POST") {
      const body = await request.json() as { runId?: unknown; caseId?: unknown };
      if (typeof body.runId !== "string" || typeof body.caseId !== "string") {
        return json({ ok: false, error: "run_id_and_case_id_required" }, 400);
      }
      return json(await runBrvinM15FatmanBenchmarkCase(env, body.runId, body.caseId));
    }
    if (pathname === "/admin/m15/fatman/evaluate/finalize" && request.method === "POST") {
      const body = await request.json() as { runId?: unknown };
      if (typeof body.runId !== "string") return json({ ok: false, error: "run_id_required" }, 400);
      return json(await finalizeBrvinM15FatmanBenchmark(env, body.runId));
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export function m15FatmanBenchmarkOperatorPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>BRVIN M15 · Fatman 538 benchmark</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#10151f;color:#edf2fa;padding:22px;min-height:100vh}
main{max-width:840px;margin:20px auto;background:#172131;border:1px solid #34445a;border-radius:18px;padding:clamp(20px,4vw,34px)}
h1{font-size:clamp(25px,4vw,34px);margin:8px 0}.eyebrow{color:#91b5e2;font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
p{color:#b8c6d8;line-height:1.6}.notice{padding:14px 16px;margin:16px 0;border:1px solid #40566f;border-radius:12px;background:#1d2c40}
label{display:block;margin:14px 0 8px;font-weight:650}input{width:100%;padding:12px;border:1px solid #50657e;border-radius:9px;background:#0d1521;color:#fff;font:inherit}
button{width:100%;border:0;border-radius:10px;padding:13px 15px;margin-top:10px;background:#2767c8;color:#fff;font:inherit;font-weight:750;cursor:pointer}
button.secondary{background:#2a3b52;border:1px solid #526b89}button:disabled{opacity:.45;cursor:not-allowed}
.status{padding:14px;border:1px solid #394d66;border-radius:10px;background:#0d1725;margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#b8c6d8}
.good{color:#9ae6b4}.bad{color:#ffaaa6}.small{font-size:13px;color:#9fb1c7}code{color:#d7e7ff;overflow-wrap:anywhere}
progress{width:100%;height:10px;margin-top:12px}
</style></head><body><main>
<div class="eyebrow">Core staging · source-isolated · no production cutover</div>
<h1>Fatman 538-page provider benchmark</h1>
<p>Exports the existing legacy Fatman OCR text from its current AI Search items into immutable staging manifests. It does not upload the PDF, rerun Vision OCR, or modify the live index. It then builds two identical staging corpora: the matched Cloudflare AI Search index and Vertex AI + Qdrant hybrid retrieval.</p>
<div class="notice"><strong>Frozen source and assessment policy</strong>
<p class="small">Source SHA-256: <code>8b183803fe8ee53087d731f7319519af9ac5bb62b39b2d3110acc3fe0ab59886</code><br>Pages: 538 · Existing production Fatman index: read-only<br>Assessment: two independent AI agents plus an AI adjudicator when they materially disagree. No human review or manual labeling.</p></div>
<label for="token">Existing M14/M15 staging operator token</label>
<input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Enter BRVIN_M14_ADMIN_TOKEN" minlength="32">
<button id="prepare" type="button">Build the 538-page staging comparison corpus</button>
<progress id="progress" value="0" max="538"></progress>
<div id="status" class="status" role="status" aria-live="polite">Checking the isolated staging configuration…</div>
<button id="evaluate" class="secondary" type="button" disabled>Run the two-agent, 12-case Fatman comparison</button>
<div id="result" class="status" aria-live="polite"></div>
<p class="small">The evaluation runs each frozen real-user case against both providers using the same Core v2 resolver and Gemini answer-generation path. Agent A and Agent B receive blinded evidence packs independently. A third AI adjudicator resolves material disagreements. Results are saved to staging D1.</p>
</main>
<script>
const API="/admin/m15/fatman";
const tokenInput=document.getElementById("token");
const prepareButton=document.getElementById("prepare");
const evaluateButton=document.getElementById("evaluate");
const progress=document.getElementById("progress");
const statusBox=document.getElementById("status");
const resultBox=document.getElementById("result");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function auth(){const value=tokenInput.value.trim();if(value.length<32)throw new Error("Enter the existing staging operator token.");return {"authorization":"Bearer "+value,"content-type":"application/json"};}
async function api(path,method="GET",body){
 const response=await fetch(API+path,{method,headers:auth(),...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok||data.ok!==true)throw new Error(data.error||("HTTP "+response.status));
 return data;
}
async function refreshStatus(){
 const data=await api("/status");
 const source=data.source||{};
 const exported=Number(source.exportedPages||0);
 const qdrant=Number(source.qdrantIndexedPages||0);
 const search=Number(source.aiSearchIndexedPages||0);
 progress.value=Math.max(exported,qdrant,search);
 statusBox.textContent="Stage: "+data.status+
  "\nImmutable OCR pages exported: "+exported+"/538"+
  "\nQdrant pages indexed/read back: "+qdrant+"/538"+
  "\nCloudflare staging AI Search pages completed: "+search+"/538"+
  "\nDeterministic chunks: "+Number(source.chunkCount||0)+
  "\nQdrant points: "+Number(source.qdrantPointCount||0);
 evaluateButton.disabled=data.status!=="ready";
 return data;
}
prepareButton.addEventListener("click",async()=>{
 prepareButton.disabled=true;evaluateButton.disabled=true;
 try{
  let data=await api("/prepare","POST",{});
  let iterations=0;
  while(data.continuationRequired===true){
   iterations++;
   const source=data;
   statusBox.textContent="Building the isolated 538-page corpus…\nStage: "+source.status+
    "\nExported: "+Number(source.exportedPages||0)+"/538"+
    "\nQdrant: "+Number(source.qdrantIndexedPages||0)+"/538"+
    "\nAI Search: "+Number(source.aiSearchIndexedPages||0)+"/538"+
    (source.pendingPage?"\nWaiting for AI Search page "+source.pendingPage:"");
   if(source.status==="ai_search_indexing"&&source.pendingPage)await sleep(1800);
   else if(iterations%6===0)await sleep(300);
   data=await api("/prepare","POST",{});
   if(iterations>400)throw new Error("The staging continuation exceeded its safety limit.");
  }
  await refreshStatus();
  statusBox.className="status good";
  statusBox.textContent+="\n\nBoth isolated provider indexes are READY.";
  evaluateButton.disabled=false;
 }catch(error){
  statusBox.className="status bad";statusBox.textContent="Preparation stopped: "+error.message;
 }finally{prepareButton.disabled=false;}
});
evaluateButton.addEventListener("click",async()=>{
 evaluateButton.disabled=true;prepareButton.disabled=true;
 resultBox.textContent="Starting the paired AI assessment…";
 try{
  const started=await api("/evaluate/start","POST",{});
  const ids=started.caseIds||[];
  for(let index=0;index<ids.length;index++){
   const row=await api("/evaluate/case","POST",{runId:started.runId,caseId:ids[index]});
   resultBox.textContent="AI assessment progress: "+(index+1)+"/"+ids.length+
    "\nCase: "+ids[index]+
    "\nCloudflare AI Search adjudicated score: "+row.cloudflareAiSearch.score.toFixed(2)+"/5"+
    "\nQdrant + Vertex adjudicated score: "+row.qdrantVertex.score.toFixed(2)+"/5"+
    "\nIndependent assessor A and B complete; disagreement adjudication: "+
    (row.cloudflareAiSearch.adjudication==="ai-adjudicator"||row.qdrantVertex.adjudication==="ai-adjudicator"?"used":"not required");
  }
  const final=await api("/evaluate/finalize","POST",{runId:started.runId});
  const decision=final.decision;
  resultBox.className=decision.winner==="qdrant-vertex"?"status good":"status";
  resultBox.textContent="Benchmark complete.\nWinner: "+decision.winner+
   "\nCloudflare AI Search score: "+final.providers.cloudflareAiSearch.summary.adjudicatedCompositeScore.toFixed(3)+"/5"+
   "\nQdrant + Vertex score: "+final.providers.qdrantVertex.summary.adjudicatedCompositeScore.toFixed(3)+"/5"+
   "\nQdrant production recommendation: "+(decision.productionCutoverRecommended?"YES":"NO")+
   "\n\nThe full paired receipt is stored in isolated staging D1. No production configuration was changed.";
 }catch(error){
  resultBox.className="status bad";resultBox.textContent="Evaluation stopped: "+error.message;
 }finally{evaluateButton.disabled=false;prepareButton.disabled=false;}
});
(async()=>{try{await refreshStatus();}catch(error){statusBox.textContent="Enter the staging token, then start the corpus build. "+error.message;}})();
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

export async function handleM15FatmanBenchmarkRequest(
  request: Request,
  env: M15FatmanBenchmarkEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/admin/m15/fatman") {
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (env.ENVIRONMENT !== "staging" ||
        env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
      return json({ ok: false, error: "m15_fatman_staging_disabled" }, 404);
    }
    return m15FatmanBenchmarkOperatorPage();
  }
  if (!url.pathname.startsWith("/admin/m15/fatman/")) return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  return handleAuthenticatedRequest(request, env, url.pathname);
}
