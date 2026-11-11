import { generateGeminiAnswer, type GroundedGeminiSourceContext } from "../ai/gemini";
import type { AiSearchInstance, Env, ProfileContext, StudentProfile } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import {
  getFatmanVisionOperation,
  type FatmanImportJob,
  type FatmanVisionOcrPage,
} from "../fatman/import";
import { fatmanIndexPageKey } from "../fatman/library";
import { persistBrvinPageCorpus } from "./corpus-store";
import { readBrvinCorpusGeneration } from "./corpus-reader";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";

const GCS_API = "https://storage.googleapis.com";
const VISION_API = "https://vision.googleapis.com/v1";
const SOURCE_FILE_NAME = "BRVIN_M15_Physics_Benchmark_Source_v1.pdf";
const SOURCE_SHA256 = "cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92";
const SOURCE_BYTES = 62012;
const SOURCE_PAGE_COUNT = 8;
const BENCHMARK_QDRANT_COLLECTION = "brvin_m15_physics_benchmark_v1";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const TOP_K = 5;
const PREFETCH_LIMIT = 15;
const M15_QDRANT_PAGES_PER_INVOCATION = 2;
const M15_AI_SEARCH_PAGES_PER_INVOCATION = 2;
const M15_AI_SEARCH_METADATA_SCHEMA = [
  { field_name: "source_id", data_type: "text" },
  { field_name: "project_id", data_type: "text" },
  { field_name: "pdf_page", data_type: "number" },
  { field_name: "benchmark", data_type: "text" },
] as const;

type ProviderName = "cloudflareAiSearch" | "qdrantVertex";

export interface M15BenchmarkStagingEnv extends Env {
  BRVIN_M15_BENCHMARK_AI_SEARCH?: AiSearchInstance;
}

interface M15BenchmarkSourceRow {
  source_id: string;
  project_id: string;
  title: string;
  file_name: string;
  source_object: string;
  source_sha256: string;
  expected_size: number;
  uploaded_bytes: number;
  status: string;
  vision_operation: string | null;
  vision_output_prefix: string;
  page_count: number;
  indexed_pages: number;
  generation_id: string | null;
  qdrant_point_count: number;
  qdrant_indexed_pages: number;
  ai_search_indexed_pages: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface M15VisionObject {
  name: string;
  size?: string;
  generation?: string;
}

/** Prevent read-only Vision status checks from moving a completed corpus or index stage backwards. */
export function shouldPersistM15VisionStatus(currentStatus: string): boolean {
  return currentStatus === "ocr_running" ||
    currentStatus === "ocr_completed" ||
    currentStatus === "ocr_failed" ||
    currentStatus === "ocr_output_incomplete";
}

/** Select a bounded, zero-based page window so large Qdrant replays fit Worker subrequest limits. */
export function m15QdrantPageWindow(
  indexedPages: number,
  pageCount = SOURCE_PAGE_COUNT,
  batchSize = M15_QDRANT_PAGES_PER_INVOCATION,
): { startIndex: number; endIndex: number } {
  if (!Number.isSafeInteger(indexedPages) || !Number.isSafeInteger(pageCount) ||
      !Number.isSafeInteger(batchSize) || indexedPages < 0 || pageCount < 1 ||
      indexedPages > pageCount || batchSize < 1) {
    throw new Error("M15 Qdrant page progress or batch bounds are invalid.");
  }
  return {
    startIndex: indexedPages,
    endIndex: Math.min(pageCount, indexedPages + batchSize),
  };
}

/** Select a bounded, zero-based AI Search page window for one Worker invocation. */
export function m15AiSearchPageWindow(
  indexedPages: number,
  pageCount = SOURCE_PAGE_COUNT,
  batchSize = M15_AI_SEARCH_PAGES_PER_INVOCATION,
): { startIndex: number; endIndex: number } {
  if (!Number.isSafeInteger(indexedPages) || !Number.isSafeInteger(pageCount) ||
      !Number.isSafeInteger(batchSize) || indexedPages < 0 || pageCount < 1 ||
      indexedPages > pageCount || batchSize < 1) {
    throw new Error("M15 AI Search page progress or batch bounds are invalid.");
  }
  return {
    startIndex: indexedPages,
    endIndex: Math.min(pageCount, indexedPages + batchSize),
  };
}

export function m15AiSearchMetadataForPage(sourceId: string, projectId: string, pdfPage: number): Record<string, string> {
  if (!sourceId.trim() || !projectId.trim() || !Number.isSafeInteger(pdfPage) ||
      pdfPage < 1 || pdfPage > SOURCE_PAGE_COUNT) {
    throw new Error("M15 AI Search page metadata requires a source, project and valid physical page number.");
  }
  return {
    source_id: sourceId,
    project_id: projectId,
    pdf_page: String(pdfPage),
    benchmark: "brvin-m15-physics-v1",
  };
}

export function isM15AiSearchItemPending(status: string): boolean {
  return status === "queued" || status === "running";
}

export function m15AiSearchMetadataSchemaMatches(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== M15_AI_SEARCH_METADATA_SCHEMA.length) return false;
  return M15_AI_SEARCH_METADATA_SCHEMA.every((expected) =>
    value.some((actual) => typeof actual === "object" && actual !== null &&
      (actual as { field_name?: unknown }).field_name === expected.field_name &&
      (actual as { data_type?: unknown }).data_type === expected.data_type)
  );
}

async function ensureM15AiSearchMetadataSchema(search: AiSearchInstance): Promise<void> {
  const current = await search.info();
  if (m15AiSearchMetadataSchemaMatches(current.custom_metadata)) return;

  // The dedicated M15 instance is created empty. Configure the exact four-field
  // schema once before the first item write. Refuse to replace an unexpected
  // non-empty schema because Cloudflare schema changes trigger a full re-index.
  const configured = current.custom_metadata;
  if (Array.isArray(configured) && configured.length > 0) {
    throw new Error("The isolated M15 AI Search instance has an unexpected custom metadata schema; refusing to replace it.");
  }
  const updated = await search.update({
    custom_metadata: M15_AI_SEARCH_METADATA_SCHEMA.map((field) => ({ ...field })),
  });
  if (!updated || typeof updated !== "object" ||
      !m15AiSearchMetadataSchemaMatches((updated as Record<string, unknown>).custom_metadata)) {
    throw new Error("Cloudflare AI Search did not confirm the required M15 custom metadata schema.");
  }
}

interface M15Candidate {
  rank: number;
  page: number | null;
  score: number | null;
  itemKey?: string;
  pointId?: string;
  provenanceValid: boolean;
  textPreview?: string;
}

interface M15ProviderResult {
  ok: boolean;
  elapsedMs: number;
  resultCount: number;
  retrievedPages: Array<number | null>;
  provenanceViolationCount: number;
  candidates: M15Candidate[];
  errorType?: string;
  errorMessage?: string;
}

interface M15ShadowQueryResult extends M15Case {
  cloudflareAiSearch: M15ProviderResult;
  qdrantVertex: M15ProviderResult;
}

interface M15Case {
  id: string;
  category: "positive" | "out-of-corpus" | "exact-symbol-near-miss";
  query: string;
  expectedPages: number[];
  expectedNoMatch: boolean;
}

export const M15_BENCHMARK_QUERY_SUITE: readonly M15Case[] = [
  { id: "P01", category: "positive", query: "Explain Newton’s second law and how net force, mass and acceleration are related.", expectedPages: [1], expectedNoMatch: false },
  { id: "P02", category: "positive", query: "A trolley has 10 N east and 4 N west acting on it. If its mass is 2 kg, what is its acceleration and direction?", expectedPages: [1], expectedNoMatch: false },
  { id: "P03", category: "positive", query: "A 6 kg cart experiences a net forward force of 18 N. Calculate its acceleration.", expectedPages: [2], expectedNoMatch: false },
  { id: "P04", category: "positive", query: "An object of mass 4 kg accelerates at 2.5 m/s². Find the net force.", expectedPages: [2], expectedNoMatch: false },
  { id: "P05", category: "positive", query: "What is the weight in newtons of a 2 kg object on Earth when g is 9.8 m/s²?", expectedPages: [3], expectedNoMatch: false },
  { id: "P06", category: "positive", query: "How is mass different from weight, and which one changes with local gravity?", expectedPages: [3], expectedNoMatch: false },
  { id: "P07", category: "positive", query: "Find the kinetic friction on a 5 kg block on a horizontal floor when μ_k = 0.20 and g = 9.8 m/s².", expectedPages: [4], expectedNoMatch: false },
  { id: "P08", category: "positive", query: "Does static friction always equal μ_s times the normal force, or can it adjust?", expectedPages: [4], expectedNoMatch: false },
  { id: "P09", category: "positive", query: "For a 4 kg block on a 30 degree frictionless incline, find the downslope component of weight and the normal force.", expectedPages: [5], expectedNoMatch: false },
  { id: "P10", category: "positive", query: "A 2 kg object starts from rest and gains 16 J of net work. What is its final speed?", expectedPages: [6], expectedNoMatch: false },
  { id: "P11", category: "positive", query: "A 0.15 kg ball changes velocity from +20 m/s to −10 m/s in 0.05 s. Find its change in momentum and average force.", expectedPages: [7], expectedNoMatch: false },
  { id: "P12", category: "positive", query: "A spring with k = 200 N/m is stretched by 0.05 m. Find the restoring force and elastic potential energy.", expectedPages: [8], expectedNoMatch: false },
  { id: "N01", category: "out-of-corpus", query: "What is the capacitance of a parallel-plate capacitor with a dielectric between its plates?", expectedPages: [], expectedNoMatch: true },
  { id: "N02", category: "out-of-corpus", query: "A 12 V battery is connected to a 3 ohm resistor. Use Ohm’s law to calculate the current.", expectedPages: [], expectedNoMatch: true },
  { id: "N03", category: "out-of-corpus", query: "What is the magnetic Lorentz force on a moving charged particle in a uniform magnetic field?", expectedPages: [], expectedNoMatch: true },
  { id: "N04", category: "out-of-corpus", query: "Use the ideal gas law PV = nRT to find the pressure of a gas.", expectedPages: [], expectedNoMatch: true },
  { id: "H01", category: "exact-symbol-near-miss", query: "Find the exact restoring-force expression F_s = +k × x as written in the source.", expectedPages: [], expectedNoMatch: true },
] as const;

const M15_BENCHMARK_BATCH_SIZE = 3;

export function m15BenchmarkBatchWindow(startIndex: number): { startIndex: number; endIndex: number; hasMore: boolean } {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= M15_BENCHMARK_QUERY_SUITE.length ||
      startIndex % M15_BENCHMARK_BATCH_SIZE !== 0) {
    throw new Error("The M15 benchmark batch cursor is invalid.");
  }
  const endIndex = Math.min(M15_BENCHMARK_QUERY_SUITE.length, startIndex + M15_BENCHMARK_BATCH_SIZE);
  return { startIndex, endIndex, hasMore: endIndex < M15_BENCHMARK_QUERY_SUITE.length };
}

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
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 240);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
}

function validBucket(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u.test(value);
}

function sourcePrefix(sourceId: string): string {
  if (!validUuid(sourceId)) throw new Error("The benchmark source identifier is invalid.");
  return "brvin/books/" + sourceId + "/pages/";
}

function visionPrefix(sourceId: string): string {
  if (!validUuid(sourceId)) throw new Error("The benchmark source identifier is invalid.");
  return "brvin/m14-staging/vision-output/" + sourceId + "/attempt-001/";
}

async function ensureSchema(env: Env): Promise<void> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS m15_benchmark_sources (" +
    "source_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, file_name TEXT NOT NULL, " +
    "source_object TEXT NOT NULL, source_sha256 TEXT NOT NULL UNIQUE, expected_size INTEGER NOT NULL, " +
    "uploaded_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, vision_operation TEXT, " +
    "vision_output_prefix TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, indexed_pages INTEGER NOT NULL DEFAULT 0, " +
    "generation_id TEXT, qdrant_point_count INTEGER NOT NULL DEFAULT 0, qdrant_indexed_pages INTEGER NOT NULL DEFAULT 0, " +
    "ai_search_indexed_pages INTEGER NOT NULL DEFAULT 0, " +
    "error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
  ).run();
  const columns = await env.DB.prepare("PRAGMA table_info(m15_benchmark_sources)").all<{ name: string }>();
  if (!(columns.results ?? []).some((column) => column.name === "qdrant_indexed_pages")) {
    await env.DB.prepare(
      "ALTER TABLE m15_benchmark_sources ADD COLUMN qdrant_indexed_pages INTEGER NOT NULL DEFAULT 0",
    ).run();
  }
}

async function getSource(env: Env, sourceId: string): Promise<M15BenchmarkSourceRow | null> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  if (!validUuid(sourceId)) throw new Error("The benchmark source identifier is invalid.");
  return env.DB.prepare(
    "SELECT * FROM m15_benchmark_sources WHERE source_id = ? LIMIT 1",
  ).bind(sourceId).first<M15BenchmarkSourceRow>();
}

function googleBucket(env: Env): string {
  const value = env.BRVIN_M14_CORPUS_BUCKET?.trim() ?? "";
  if (!validBucket(value)) throw new Error("The isolated M15 staging storage bucket is not configured.");
  return value;
}

async function gcsMetadata(
  env: Env,
  bucket: string,
  objectName: string,
): Promise<{ generation: string; size: number }> {
  const token = await getGoogleAccessToken(env);
  const url = GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?fields=name,generation,size";
  const response = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("The benchmark source object could not be read from private staging storage (HTTP " + response.status + ").");
  const body = await response.json() as { name?: string; generation?: string | number; size?: string | number };
  const size = Number(body.size);
  if (body.name !== objectName || body.generation === undefined || !Number.isSafeInteger(size) || size < 1) {
    throw new Error("Private staging source metadata is incomplete.");
  }
  return { generation: String(body.generation), size };
}

async function putImmutableSourceObject(
  env: Env,
  bucket: string,
  objectName: string,
  bytes: Uint8Array,
): Promise<void> {
  const token = await getGoogleAccessToken(env);
  const uploadUrl = new URL(GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucket) + "/o");
  uploadUrl.searchParams.set("uploadType", "media");
  uploadUrl.searchParams.set("name", objectName);
  uploadUrl.searchParams.set("ifGenerationMatch", "0");
  const uploadBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(uploadBody).set(bytes);
  const response = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/pdf" },
    body: uploadBody,
  });
  if (response.ok) return;
  if (response.status !== 409 && response.status !== 412) {
    throw new Error("Could not upload the benchmark PDF to private staging storage (HTTP " + response.status + ").");
  }
  const metadata = await gcsMetadata(env, bucket, objectName);
  const existing = await readGcsBytes(env, bucket, objectName, metadata.generation);
  const digest = await sha256Hex(existing);
  if (existing.byteLength !== bytes.byteLength || digest !== SOURCE_SHA256) {
    throw new Error("An object already exists at the benchmark source path with different bytes; refusing to overwrite it.");
  }
}

async function readGcsBytes(env: Env, bucket: string, objectName: string, generation?: string): Promise<Uint8Array> {
  const token = await getGoogleAccessToken(env);
  const url = new URL(GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName));
  url.searchParams.set("alt", "media");
  if (generation) url.searchParams.set("generation", generation);
  const response = await fetch(url.toString(), { headers: { authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("Could not read a private staging object (HTTP " + response.status + ").");
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(hashInput).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", hashInput));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

function objectNameForPage(page: number, prefix: string): string {
  return prefix + "output-" + page + "-to-" + page + ".json";
}

async function listVisionObjects(
  env: Env,
  bucket: string,
  prefix: string,
): Promise<{ objects: M15VisionObject[]; truncated: boolean }> {
  const token = await getGoogleAccessToken(env);
  const objects: M15VisionObject[] = [];
  let pageToken = "";
  let truncated = false;
  const maxObjects = SOURCE_PAGE_COUNT + 1;
  do {
    const query = new URLSearchParams({
      prefix,
      maxResults: String(Math.min(1000, maxObjects - objects.length)),
      fields: "items(name,size,generation),nextPageToken",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) + "/o?" + query.toString(),
      { headers: { authorization: "Bearer " + token } },
    );
    if (!response.ok) throw new Error("Could not inspect the isolated benchmark OCR output (HTTP " + response.status + ").");
    const body = await response.json() as {
      items?: Array<{ name?: string; size?: string | number; generation?: string | number }>;
      nextPageToken?: string;
    };
    for (const item of body.items ?? []) {
      if (typeof item.name !== "string" || !item.name.startsWith(prefix)) continue;
      objects.push({
        name: item.name,
        ...(item.size !== undefined ? { size: String(item.size) } : {}),
        ...(item.generation !== undefined ? { generation: String(item.generation) } : {}),
      });
      if (objects.length >= maxObjects) break;
    }
    pageToken = body.nextPageToken ?? "";
    truncated = Boolean(pageToken) && objects.length >= maxObjects;
  } while (pageToken && objects.length < maxObjects);
  return { objects, truncated };
}

function validateVisionInventory(objects: readonly M15VisionObject[], prefix: string, truncated: boolean): boolean {
  if (truncated || objects.length !== SOURCE_PAGE_COUNT) return false;
  const names = new Set(objects.map((object) => object.name));
  for (let page = 1; page <= SOURCE_PAGE_COUNT; page += 1) {
    if (!names.has(objectNameForPage(page, prefix))) return false;
  }
  return true;
}

async function readVisionPage(
  env: Env,
  bucket: string,
  sourceId: string,
  prefix: string,
  page: number,
): Promise<FatmanVisionOcrPage> {
  if (!Number.isSafeInteger(page) || page < 1 || page > SOURCE_PAGE_COUNT) {
    throw new Error("The requested physical PDF page is outside the benchmark source.");
  }
  const bytes = await readGcsBytes(env, bucket, objectNameForPage(page, prefix));
  let payload: {
    responses?: Array<{
      fullTextAnnotation?: { text?: string; pages?: Array<{ confidence?: number }> };
      error?: { message?: string };
    }>;
    context?: { pageNumber?: number };
  };
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as typeof payload;
  } catch {
    throw new Error("Google Vision OCR JSON for physical page " + page + " is invalid.");
  }
  if (payload.context?.pageNumber && Number(payload.context.pageNumber) !== page) {
    throw new Error("Google Vision OCR output does not match physical page " + page + ".");
  }
  const response = payload.responses?.[0];
  if (!response) throw new Error("Google Vision returned no OCR response for physical page " + page + ".");
  if (response.error?.message) throw new Error("Google Vision OCR failed on physical page " + page + ".");
  const rawText = response.fullTextAnnotation?.text;
  if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 1_000_000) {
    throw new Error("Google Vision OCR text for physical page " + page + " is empty or exceeds the safe manifest limit.");
  }
  const confidence = response.fullTextAnnotation?.pages?.[0]?.confidence;
  return {
    rawText,
    ...(typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? { pageConfidence: confidence }
      : {}),
  };
}

function syntheticImportJob(row: M15BenchmarkSourceRow): FatmanImportJob {
  return {
    id: row.source_id,
    book_id: row.source_id,
    source_object: row.source_object,
    source_sha256: row.source_sha256,
    expected_size: Number(row.expected_size),
    uploaded_bytes: Number(row.uploaded_bytes),
    upload_session_uri: null,
    status: "completed",
    vision_operation: row.vision_operation,
    workflow_instance_id: null,
    indexed_pages: SOURCE_PAGE_COUNT,
    error_message: null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    book_title: row.title,
    page_count: SOURCE_PAGE_COUNT,
  };
}

async function authenticated(request: Request, env: M15BenchmarkStagingEnv): Promise<boolean> {
  const expected = env.BRVIN_M14_ADMIN_TOKEN?.trim() ?? "";
  const suppliedHeader = request.headers.get("authorization") ?? "";
  const supplied = suppliedHeader.startsWith("Bearer ") ? suppliedHeader.slice(7) : "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

export function validateM15BenchmarkPdf(fileName: string, bytes: Uint8Array): { ok: true; sha256: string } | { ok: false; error: string } {
  if (fileName !== SOURCE_FILE_NAME) return { ok: false, error: "Select the exact file " + SOURCE_FILE_NAME + "." };
  if (bytes.byteLength !== SOURCE_BYTES || bytes.byteLength > MAX_SOURCE_BYTES) {
    return { ok: false, error: "The benchmark PDF size does not match the approved eight-page source file." };
  }
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return { ok: false, error: "The uploaded file does not have a valid PDF signature." };
  }
  return { ok: true, sha256: SOURCE_SHA256 };
}

export function summarizeM15BenchmarkProvider(results: Array<{
  id: string;
  category: M15Case["category"];
  expectedPages: number[];
  expectedNoMatch: boolean;
  result: M15ProviderResult;
}>) {
  const positives = results.filter((item) => item.category === "positive");
  const expectedPages = positives.reduce((sum, item) => sum + item.expectedPages.length, 0);
  const coveredPages = positives.reduce((sum, item) =>
    sum + item.expectedPages.filter((page) => item.result.retrievedPages.includes(page)).length, 0);
  const expectedPageCandidates = positives.reduce((sum, item) =>
    sum + item.result.retrievedPages.filter((page) => page !== null && item.expectedPages.includes(page)).length, 0);
  const noMatch = results.filter((item) => item.category === "out-of-corpus");
  const completedNoMatch = noMatch.filter((item) => item.result.ok);
  const failedNoMatch = noMatch.filter((item) => !item.result.ok);
  const noMatchWithCandidates = completedNoMatch.filter((item) => item.result.resultCount > 0);
  const nearMiss = results.filter((item) => item.category === "exact-symbol-near-miss");
  const completedNearMiss = nearMiss.filter((item) => item.result.ok);
  const failedNearMiss = nearMiss.filter((item) => !item.result.ok);
  const nearMissWithCandidates = completedNearMiss.filter((item) => item.result.resultCount > 0);
  const validTimings = results.filter((item) => item.result.ok).map((item) => item.result.elapsedMs);
  const percentile = (values: number[], quantile: number): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1))];
  };
  const positiveSlots = positives.length * TOP_K;
  const allSlots = results.length * TOP_K;
  return {
    queryCount: results.length,
    successfulQueries: results.filter((item) => item.result.ok).length,
    failedQueries: results.filter((item) => !item.result.ok).length,
    positiveQueryCount: positives.length,
    positiveQueriesCompleted: positives.filter((item) => item.result.ok).length,
    positiveQueryFailures: positives.filter((item) => !item.result.ok).length,
    expectedPageTargets: expectedPages,
    coveredExpectedPageTargets: coveredPages,
    expectedPageCoverageRate: expectedPages ? coveredPages / expectedPages : 0,
    allExpectedPagesCovered: expectedPages > 0 && coveredPages === expectedPages,
    expectedPageCandidateCount: expectedPageCandidates,
    positivePageLabelPrecisionAt5: positiveSlots ? expectedPageCandidates / positiveSlots : 0,
    allSuitePageLabelPrecisionAt5: allSlots ? expectedPageCandidates / allSlots : 0,
    // A failed query is not an empty retrieval. Candidate-presence rates use completed checks only.
    outOfCorpusQueryCount: noMatch.length,
    outOfCorpusQueriesCompleted: completedNoMatch.length,
    outOfCorpusQueryFailures: failedNoMatch.length,
    outOfCorpusAllQueriesCompleted: completedNoMatch.length === noMatch.length,
    outOfCorpusQueriesWithCandidates: noMatchWithCandidates.length,
    outOfCorpusQueriesWithoutCandidates: completedNoMatch.length - noMatchWithCandidates.length,
    outOfCorpusCandidatePresenceRate: completedNoMatch.length
      ? noMatchWithCandidates.length / completedNoMatch.length
      : null,
    outOfCorpusCandidateCount: completedNoMatch.reduce((sum, item) => sum + item.result.resultCount, 0),
    exactSymbolNearMissCount: nearMiss.length,
    exactSymbolNearMissQueriesCompleted: completedNearMiss.length,
    exactSymbolNearMissQueryFailures: failedNearMiss.length,
    exactSymbolNearMissAllQueriesCompleted: completedNearMiss.length === nearMiss.length,
    exactSymbolNearMissWithCandidates: nearMissWithCandidates.length,
    exactSymbolNearMissWithoutCandidates: completedNearMiss.length - nearMissWithCandidates.length,
    exactSymbolNearMissCandidatePresenceRate: completedNearMiss.length
      ? nearMissWithCandidates.length / completedNearMiss.length
      : null,
    exactSymbolNearMissCandidateCount: completedNearMiss.reduce((sum, item) => sum + item.result.resultCount, 0),
    allNegativeControlsCompleted: failedNoMatch.length === 0 && failedNearMiss.length === 0,
    provenanceViolationCount: results.reduce((sum, item) => sum + item.result.provenanceViolationCount, 0),
    observedWorkerLatencyMs: {
      sampleCount: validTimings.length,
      p50: percentile(validTimings, 0.5),
      p95: percentile(validTimings, 0.95),
      p99: percentile(validTimings, 0.99),
      note: "Sequential per-provider staging samples, not a load test or production SLO.",
    },
  };
}

async function createQdrantPilot(env: Env, collection: string): Promise<BrvinQdrantHybridPilot> {
  const configuredCollection = env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION?.trim();
  if (!configuredCollection || collection !== configuredCollection ||
      configuredCollection !== BENCHMARK_QDRANT_COLLECTION) {
    throw new Error("The M15 benchmark must use its exact dedicated staging Qdrant collection.");
  }
  const dimensions = Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 3072) {
    throw new Error("The isolated M15 Vertex embedding dimensions are invalid.");
  }
  if (!env.BRVIN_M14_VERTEX_LOCATION?.trim() || !env.BRVIN_M14_VERTEX_MODEL?.trim() ||
      !env.BRVIN_M14_QDRANT_URL?.trim() || !env.BRVIN_M14_QDRANT_API_KEY?.trim()) {
    throw new Error("The isolated M15 Vertex/Qdrant credentials or model settings are incomplete.");
  }
  return new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL,
    apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection,
    dimensions,
  }, new BrvinVertexEmbeddingProvider(env));
}

async function getVerifiedCorpus(env: Env, row: M15BenchmarkSourceRow) {
  if (!row.generation_id || row.page_count !== SOURCE_PAGE_COUNT || row.indexed_pages !== SOURCE_PAGE_COUNT) {
    throw new Error("The benchmark source is not yet verified as eight complete physical pages.");
  }
  const corpus = await readBrvinCorpusGeneration(env, row.source_id, row.generation_id);
  if (corpus.sourceManifest.sourcePdfSha256 !== SOURCE_SHA256 ||
      corpus.sourceManifest.pageCount !== SOURCE_PAGE_COUNT ||
      corpus.pageManifests.length !== SOURCE_PAGE_COUNT) {
    throw new Error("The benchmark corpus hash, source ID or physical page inventory does not match the approved source.");
  }
  return corpus;
}

async function startVision(env: M15BenchmarkStagingEnv, row: M15BenchmarkSourceRow): Promise<Record<string, unknown>> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  const bucket = googleBucket(env);
  const metadata = await gcsMetadata(env, bucket, row.source_object);
  if (metadata.size !== SOURCE_BYTES || Number(row.expected_size) !== SOURCE_BYTES) {
    throw new Error("The private staged source object has an unexpected size. No OCR request was sent.");
  }
  const bytes = await readGcsBytes(env, bucket, row.source_object, metadata.generation);
  if (await sha256Hex(bytes) !== SOURCE_SHA256) {
    throw new Error("The private staged source PDF fingerprint changed. No OCR request was sent.");
  }
  const prefix = visionPrefix(row.source_id);
  const existing = await listVisionObjects(env, bucket, prefix);
  if (existing.objects.length > 0 || existing.truncated) {
    throw new Error("The isolated OCR output prefix is not empty. No duplicate Vision request was sent.");
  }
  const now = Date.now();
  const lock = await env.DB.prepare(
    "UPDATE m15_benchmark_sources SET status = 'ocr_submitting', vision_output_prefix = ?, error_message = NULL, updated_at = ? " +
    "WHERE source_id = ? AND status = 'uploaded' AND vision_operation IS NULL",
  ).bind(prefix, now, row.source_id).run();
  if ((lock.meta?.changes ?? 0) !== 1) {
    const latest = await getSource(env, row.source_id);
    return { sourceId: row.source_id, status: latest?.status ?? "unknown", alreadySubmitted: true };
  }
  const token = await getGoogleAccessToken(env);
  const payload = {
    requests: [{
      inputConfig: {
        gcsSource: { uri: "gs://" + bucket + "/" + row.source_object },
        mimeType: "application/pdf",
      },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      outputConfig: {
        gcsDestination: { uri: "gs://" + bucket + "/" + prefix },
        batchSize: 1,
      },
    }],
  };
  try {
    const response = await fetch(VISION_API + "/files:asyncBatchAnnotate", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/[\r\n\t]+/gu, " ").slice(0, 180);
      await env.DB.prepare(
        "UPDATE m15_benchmark_sources SET status = 'ocr_submission_failed', error_message = ?, updated_at = ? WHERE source_id = ? AND status = 'ocr_submitting'",
      ).bind("Vision rejected the OCR submission (HTTP " + response.status + "). " + detail, Date.now(), row.source_id).run();
      throw new Error("Google Vision rejected the OCR request (HTTP " + response.status + ").");
    }
    const body = await response.json() as { name?: string };
    if (!body.name) {
      await env.DB.prepare(
        "UPDATE m15_benchmark_sources SET status = 'submission_uncertain', error_message = ?, updated_at = ? WHERE source_id = ? AND status = 'ocr_submitting'",
      ).bind("Google Vision returned no operation ID; automatic resubmission is blocked.", Date.now(), row.source_id).run();
      throw new Error("Google Vision returned no operation ID. The submission is marked uncertain and will not be repeated automatically.");
    }
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET status = 'ocr_running', vision_operation = ?, error_message = NULL, updated_at = ? WHERE source_id = ? AND status = 'ocr_submitting'",
    ).bind(body.name, Date.now(), row.source_id).run();
    return { sourceId: row.source_id, status: "ocr_running", visionOperationRecorded: true, outputPrefix: prefix };
  } catch (error) {
    if (error instanceof Error && error.message.includes("HTTP ")) throw error;
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET status = 'submission_uncertain', error_message = ?, updated_at = ? WHERE source_id = ? AND status = 'ocr_submitting'",
    ).bind("The Vision submission response was uncertain. Do not resubmit automatically.", Date.now(), row.source_id).run();
    throw new Error("The Vision submission response was uncertain. The source is locked against duplicate OCR; inspect staging status before further action.");
  }
}

async function inspectVision(env: M15BenchmarkStagingEnv, row: M15BenchmarkSourceRow): Promise<Record<string, unknown>> {
  if (!row.vision_operation) {
    return { sourceId: row.source_id, status: row.status, operationRecorded: false, error: row.error_message ?? undefined };
  }
  const bucket = googleBucket(env);
  const prefix = row.vision_output_prefix || visionPrefix(row.source_id);
  const expectedUri = "gs://" + bucket + "/" + prefix;
  const operation = await getFatmanVisionOperation(env, row.vision_operation, expectedUri);
  const inventory = operation.done && !operation.error
    ? await listVisionObjects(env, bucket, prefix)
    : { objects: [] as M15VisionObject[], truncated: false };
  const complete = operation.done && !operation.error &&
    operation.outputDestinations?.some((uri) => uri.replace(/\/+$/u, "") === expectedUri.replace(/\/+$/u, "")) &&
    validateVisionInventory(inventory.objects, prefix, inventory.truncated);
  const status = operation.error ? "ocr_failed" : complete ? "ocr_completed" : operation.done ? "ocr_output_incomplete" : "ocr_running";
  if (env.DB && shouldPersistM15VisionStatus(row.status)) {
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET status = ?, page_count = ?, error_message = ?, updated_at = ? " +
      "WHERE source_id = ? AND vision_operation = ? AND status IN ('ocr_running','ocr_completed','ocr_failed','ocr_output_incomplete')",
    ).bind(
      status,
      complete ? SOURCE_PAGE_COUNT : 0,
      operation.error ? "Google Vision reported an OCR operation error." : complete ? null : operation.done ? "Vision completed but the exact eight-file page output inventory is incomplete or its destination differs." : null,
      Date.now(),
      row.source_id,
      row.vision_operation,
    ).run();
  }
  return {
    sourceId: row.source_id,
    status,
    operationDone: operation.done,
    operationHasError: Boolean(operation.error),
    destinationMatches: Boolean(operation.outputDestinations?.some((uri) => uri.replace(/\/+$/u, "") === expectedUri.replace(/\/+$/u, ""))),
    expectedPageCount: SOURCE_PAGE_COUNT,
    actualOutputFileCount: inventory.objects.length,
    expectedOutputFiles: Array.from({ length: SOURCE_PAGE_COUNT }, (_, index) => "output-" + (index + 1) + "-to-" + (index + 1) + ".json"),
    actualOutputFiles: inventory.objects.map((item) => item.name.slice(prefix.length)).sort(),
    truncated: inventory.truncated,
    error: operation.error ? "Google Vision reported an operation error." : undefined,
  };
}

async function buildCorpus(env: M15BenchmarkStagingEnv, row: M15BenchmarkSourceRow): Promise<Record<string, unknown>> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  if (row.status !== "ocr_completed" || !row.vision_operation ||
      row.page_count !== SOURCE_PAGE_COUNT) {
    throw new Error("OCR must be complete with exactly eight verified output files before building manifests.");
  }
  const bucket = googleBucket(env);
  const prefix = row.vision_output_prefix;
  const operation = await getFatmanVisionOperation(
    env,
    row.vision_operation,
    "gs://" + bucket + "/" + prefix,
  );
  const inventory = await listVisionObjects(env, bucket, prefix);
  if (!operation.done || operation.error ||
      !operation.outputDestinations?.some((uri) => uri.replace(/\/+$/u, "") === ("gs://" + bucket + "/" + prefix).replace(/\/+$/u, "")) ||
      !validateVisionInventory(inventory.objects, prefix, inventory.truncated)) {
    throw new Error("The Vision operation or its eight-page OCR inventory no longer satisfies the corpus-build gate.");
  }
  const job = syntheticImportJob(row);
  let generationId = "";
  let chunkCount = 0;
  const pages = [];
  for (let page = 1; page <= SOURCE_PAGE_COUNT; page += 1) {
    const ocr = await readVisionPage(env, bucket, row.source_id, prefix, page);
    const saved = await persistBrvinPageCorpus(
      env,
      job,
      page,
      ocr.rawText,
      fatmanIndexPageKey(job, page),
      ocr.pageConfidence,
      { storageBucket: bucket },
    );
    if (generationId && saved.generationId !== generationId) {
      throw new Error("The benchmark source produced inconsistent immutable corpus generation IDs.");
    }
    generationId = saved.generationId;
    chunkCount += saved.chunkCount;
    pages.push({ pdfPage: page, chunkCount: saved.chunkCount });
  }
  const verified = await readBrvinCorpusGeneration(env, row.source_id, generationId);
  if (verified.pageManifests.length !== SOURCE_PAGE_COUNT ||
      verified.chunkCount !== chunkCount ||
      verified.sourceManifest.sourcePdfSha256 !== SOURCE_SHA256) {
    throw new Error("The staged source/page manifests failed deterministic read-back verification.");
  }
  await env.DB.prepare(
    "UPDATE m15_benchmark_sources SET status = 'corpus_ready', page_count = ?, indexed_pages = ?, generation_id = ?, error_message = NULL, updated_at = ? WHERE source_id = ?",
  ).bind(SOURCE_PAGE_COUNT, SOURCE_PAGE_COUNT, generationId, Date.now(), row.source_id).run();
  return {
    sourceId: row.source_id,
    projectId: row.project_id,
    generationId,
    sourceSha256: SOURCE_SHA256,
    pageCount: SOURCE_PAGE_COUNT,
    chunkCount,
    pages,
    verified: true,
  };
}

async function indexQdrant(env: M15BenchmarkStagingEnv, row: M15BenchmarkSourceRow): Promise<Record<string, unknown>> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  if (row.status !== "corpus_ready" && row.status !== "qdrant_indexing" &&
      row.status !== "qdrant_ready" && row.status !== "ai_search_ready" && row.status !== "ready") {
    throw new Error("Build and verify the eight-page corpus before Qdrant indexing.");
  }
  const corpus = await getVerifiedCorpus(env, row);
  const source = corpus.sourceManifest;
  const sortedPages = [...corpus.pageManifests].sort((left, right) => left.pdfPage - right.pdfPage);
  if (source.sourceId !== row.source_id || source.generationId !== row.generation_id ||
      source.sourcePdfSha256 !== SOURCE_SHA256 || source.pageCount !== SOURCE_PAGE_COUNT ||
      sortedPages.length !== SOURCE_PAGE_COUNT) {
    throw new Error("The verified M15 corpus does not match the registered source generation.");
  }

  // Validate the entire generation before any page write, preserving the same
  // all-pages provenance gate used by the original whole-generation replay.
  const seenPages = new Set<number>();
  const seenChunkIds = new Set<string>();
  let verifiedChunkCount = 0;
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index];
    const expectedPage = index + 1;
    if (page.sourceId !== source.sourceId || page.generationId !== source.generationId ||
        page.sourcePdfSha256 !== source.sourcePdfSha256 || page.ocrOperationId !== source.ocrOperationId ||
        page.pdfPage !== expectedPage || seenPages.has(page.pdfPage) ||
        !page.stableItemKey?.trim() || !Array.isArray(page.chunks) || page.chunks.length < 1) {
      throw new Error("M15 Qdrant replay rejected mismatched source, incomplete page coverage, or duplicate page provenance.");
    }
    seenPages.add(page.pdfPage);
    verifiedChunkCount += page.chunks.length;
    for (const chunk of page.chunks) {
      if (!chunk.id || seenChunkIds.has(chunk.id) || !chunk.normalizedText?.trim() ||
          !/^[a-f0-9]{64}$/iu.test(chunk.contentSha256)) {
        throw new Error("M15 Qdrant replay rejected a duplicate or invalid deterministic chunk identity.");
      }
      seenChunkIds.add(chunk.id);
    }
  }
  if (seenPages.size !== SOURCE_PAGE_COUNT || verifiedChunkCount !== corpus.chunkCount) {
    throw new Error("M15 Qdrant replay did not contain the complete, contiguous page/chunk set.");
  }

  const indexedPages = Number(row.qdrant_indexed_pages ?? 0);
  const window = m15QdrantPageWindow(indexedPages);
  const pilot = await createQdrantPilot(env, BENCHMARK_QDRANT_COLLECTION);
  const modelIds = new Set<string>();
  const modelVersions = new Set<string>();

  // Each invocation writes at most two physical pages. After every page we
  // persist a deterministic checkpoint. If a response is lost or a Worker
  // reaches a platform limit after a Qdrant upsert, replaying that page safely
  // overwrites the same deterministic point IDs rather than creating duplicates.
  for (const page of sortedPages.slice(window.startIndex, window.endIndex)) {
    const indexed = await pilot.upsertPageChunks({
      projectId: row.project_id,
      sourceId: row.source_id,
      itemKey: page.stableItemKey,
      pdfPage: page.pdfPage,
      generationId: source.generationId,
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
    if (indexed.pointCount !== page.chunks.length || indexed.ids.length !== page.chunks.length ||
        new Set(indexed.ids).size !== indexed.pointCount) {
      throw new Error("Qdrant did not confirm every deterministic point for physical page " + page.pdfPage + ".");
    }

    const completedPages = page.pdfPage;
    const completedPointCount = sortedPages.slice(0, completedPages)
      .reduce((sum, completedPage) => sum + completedPage.chunks.length, 0);
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET qdrant_indexed_pages = ?, qdrant_point_count = ?, status = 'qdrant_indexing', error_message = NULL, updated_at = ? WHERE source_id = ?",
    ).bind(completedPages, completedPointCount, Date.now(), row.source_id).run();
    modelIds.add(indexed.modelId);
    modelVersions.add(indexed.modelVersion);
  }

  const completedPages = window.endIndex;
  const completedPointCount = sortedPages.slice(0, completedPages)
    .reduce((sum, page) => sum + page.chunks.length, 0);
  if (completedPages < SOURCE_PAGE_COUNT) {
    return {
      sourceId: row.source_id,
      projectId: row.project_id,
      generationId: source.generationId,
      collection: BENCHMARK_QDRANT_COLLECTION,
      status: "qdrant_indexing",
      pageCount: SOURCE_PAGE_COUNT,
      indexedPages: completedPages,
      nextPage: completedPages + 1,
      remainingPages: SOURCE_PAGE_COUNT - completedPages,
      chunkCount: corpus.chunkCount,
      pointCount: completedPointCount,
      pagesPerInvocation: M15_QDRANT_PAGES_PER_INVOCATION,
      continuationRequired: true,
      deterministicRetrySafe: true,
    };
  }

  if (completedPointCount !== corpus.chunkCount || completedPointCount < SOURCE_PAGE_COUNT) {
    throw new Error("Qdrant M15 checkpoint totals do not match the verified corpus chunk count.");
  }
  await env.DB.prepare(
    "UPDATE m15_benchmark_sources SET qdrant_point_count = ?, qdrant_indexed_pages = ?, status = CASE WHEN ai_search_indexed_pages = ? THEN 'ready' ELSE 'qdrant_ready' END, error_message = NULL, updated_at = ? WHERE source_id = ?",
  ).bind(completedPointCount, SOURCE_PAGE_COUNT, SOURCE_PAGE_COUNT, Date.now(), row.source_id).run();
  return {
    sourceId: row.source_id,
    projectId: row.project_id,
    generationId: source.generationId,
    collection: BENCHMARK_QDRANT_COLLECTION,
    status: "qdrant_ready",
    pageCount: SOURCE_PAGE_COUNT,
    indexedPages: SOURCE_PAGE_COUNT,
    chunkCount: corpus.chunkCount,
    pointCount: completedPointCount,
    embeddingModelIds: [...modelIds],
    embeddingModelVersions: [...modelVersions],
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
    pagesPerInvocation: M15_QDRANT_PAGES_PER_INVOCATION,
    continuationRequired: false,
    deterministicRetrySafe: true,
  };
}

async function indexAiSearch(env: M15BenchmarkStagingEnv, row: M15BenchmarkSourceRow): Promise<Record<string, unknown>> {
  if (!env.DB) throw new Error("The isolated staging D1 database is not configured.");
  const search = env.BRVIN_M15_BENCHMARK_AI_SEARCH;
  if (!search) throw new Error("The isolated M15 benchmark AI Search binding is not configured.");
  if (row.status !== "corpus_ready" && row.status !== "qdrant_ready" && row.status !== "ai_search_ready" &&
      row.status !== "ai_search_indexing" && row.status !== "ready") {
    throw new Error("Build and verify the eight-page corpus before AI Search indexing.");
  }
  const corpus = await getVerifiedCorpus(env, row);
  const pages = [...corpus.pageManifests].sort((a, b) => a.pdfPage - b.pdfPage);
  if (pages.length !== SOURCE_PAGE_COUNT || corpus.sourceManifest.sourceId !== row.source_id ||
      corpus.sourceManifest.generationId !== row.generation_id ||
      corpus.sourceManifest.sourcePdfSha256 !== SOURCE_SHA256) {
    throw new Error("The verified M15 corpus does not match the registered source generation.");
  }

  await ensureM15AiSearchMetadataSchema(search);
  const listing = await search.items.list({ page: 1, per_page: 50 });
  const existingItems = listing.result ?? [];
  let indexedPages = Number(row.ai_search_indexed_pages ?? 0);
  const window = m15AiSearchPageWindow(indexedPages);

  // Two pages per request bounds Worker subrequests. Existing deterministic
  // page keys are checked before upload so an ambiguous prior response is
  // resumed without creating duplicate items.
  for (const page of pages.slice(window.startIndex, window.endIndex)) {
    const key = page.stableItemKey;
    if (!key.startsWith(sourcePrefix(row.source_id))) {
      throw new Error("A source page key escaped the exact M15 source prefix; AI Search indexing was stopped.");
    }
    const existing = existingItems.find((item) => item.key === key);
    if (existing) {
      if (isM15AiSearchItemPending(existing.status)) {
        await env.DB.prepare(
          "UPDATE m15_benchmark_sources SET status = 'ai_search_indexing', updated_at = ? WHERE source_id = ?",
        ).bind(Date.now(), row.source_id).run();
        return {
          sourceId: row.source_id,
          instance: "brvin-m15-physics-staging-v1",
          status: "ai_search_indexing",
          indexedPages,
          pendingPage: page.pdfPage,
          pendingItemStatus: existing.status,
          nextPage: page.pdfPage,
          continuationRequired: true,
          deterministicRetrySafe: true,
        };
      }
      if (existing.status !== "completed") {
        throw new Error("The existing M15 AI Search item for physical page " + page.pdfPage +
          " is in status " + existing.status + "; inspect that item before retrying.");
      }
    } else {
      // Submit once and return the asynchronous item state. Do not hold a Worker
      // invocation open while Cloudflare embeds/indexes the page; the next Step 6
      // call inspects the deterministic item key and resumes from its current state.
      const item = await search.items.upload(key, page.rawOcrText, {
        metadata: m15AiSearchMetadataForPage(row.source_id, row.project_id, page.pdfPage),
      });
      if (item.key !== key) {
        throw new Error("Cloudflare AI Search returned an item key that does not match physical page " + page.pdfPage + ".");
      }
      if (isM15AiSearchItemPending(item.status)) {
        await env.DB.prepare(
          "UPDATE m15_benchmark_sources SET status = 'ai_search_indexing', updated_at = ? WHERE source_id = ?",
        ).bind(Date.now(), row.source_id).run();
        return {
          sourceId: row.source_id,
          instance: "brvin-m15-physics-staging-v1",
          status: "ai_search_indexing",
          indexedPages,
          pendingPage: page.pdfPage,
          pendingItemStatus: item.status,
          nextPage: page.pdfPage,
          continuationRequired: true,
          deterministicRetrySafe: true,
        };
      }
      if (item.status !== "completed") {
        throw new Error("Cloudflare AI Search indexing failed for physical page " + page.pdfPage +
          " with status " + item.status + (item.error ? ": " + item.error.slice(0, 160) : "."));
      }
      existingItems.push(item);
    }

    indexedPages = page.pdfPage;
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET ai_search_indexed_pages = ?, status = 'ai_search_indexing', error_message = NULL, updated_at = ? WHERE source_id = ?",
    ).bind(indexedPages, Date.now(), row.source_id).run();
  }

  const completedPages = window.endIndex;
  if (completedPages < SOURCE_PAGE_COUNT) {
    return {
      sourceId: row.source_id,
      instance: "brvin-m15-physics-staging-v1",
      status: "ai_search_indexing",
      pageCount: SOURCE_PAGE_COUNT,
      indexedPages: completedPages,
      nextPage: completedPages + 1,
      remainingPages: SOURCE_PAGE_COUNT - completedPages,
      pagesPerInvocation: M15_AI_SEARCH_PAGES_PER_INVOCATION,
      continuationRequired: true,
      deterministicRetrySafe: true,
    };
  }

  const finalListing = await search.items.list({ page: 1, per_page: 50 });
  const matching = (finalListing.result ?? []).filter((item) => item.key?.startsWith(sourcePrefix(row.source_id)));
  const expectedKeys = new Set(pages.map((page) => page.stableItemKey));
  if (matching.length !== SOURCE_PAGE_COUNT ||
      matching.some((item) => item.status !== "completed" || !expectedKeys.has(item.key)) ||
      [...expectedKeys].some((key) => !matching.some((item) => item.key === key))) {
    throw new Error("The isolated AI Search instance did not confirm all eight exact source-page items as completed.");
  }
  await env.DB.prepare(
    "UPDATE m15_benchmark_sources SET ai_search_indexed_pages = ?, status = CASE WHEN qdrant_point_count > 0 THEN 'ready' ELSE 'ai_search_ready' END, error_message = NULL, updated_at = ? WHERE source_id = ?",
  ).bind(SOURCE_PAGE_COUNT, Date.now(), row.source_id).run();
  return {
    sourceId: row.source_id,
    instance: "brvin-m15-physics-staging-v1",
    itemCount: matching.length,
    completedItems: matching.filter((item) => item.status === "completed").length,
    pageKeys: matching.map((item) => item.key).sort(),
    pagesPerInvocation: M15_AI_SEARCH_PAGES_PER_INVOCATION,
    continuationRequired: false,
    deterministicRetrySafe: true,
  };
}

function pageFromItemKey(key: string, expectedSourceId: string): number | null {
  const prefix = sourcePrefix(expectedSourceId);
  if (!key.startsWith(prefix)) return null;
  const match = /^page-(\d{6})\.txt$/u.exec(key.slice(prefix.length));
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page >= 1 && page <= SOURCE_PAGE_COUNT ? page : null;
}

function mapAiSearch(chunks: NonNullable<Awaited<ReturnType<AiSearchInstance["search"]>>["chunks"]>, sourceId: string): M15Candidate[] {
  return chunks.slice(0, TOP_K).map((chunk, index) => {
    const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const page = pageFromItemKey(key, sourceId);
    const valid = page !== null;
    return {
      rank: index + 1,
      page,
      score: typeof chunk.score === "number" ? chunk.score : null,
      ...(valid ? { itemKey: key } : {}),
      provenanceValid: valid,
      ...(valid && typeof chunk.text === "string" ? { textPreview: chunk.text.slice(0, 900) } : {}),
    };
  });
}

function mapQdrant(chunks: Awaited<ReturnType<BrvinQdrantHybridPilot["query"]>>, sourceId: string): M15Candidate[] {
  return chunks.slice(0, TOP_K).map((chunk, index) => {
    const valid = chunk.sourceId === sourceId &&
      chunk.itemKey.startsWith(sourcePrefix(sourceId)) &&
      chunk.pdfPage >= 1 && chunk.pdfPage <= SOURCE_PAGE_COUNT;
    return {
      rank: index + 1,
      page: valid ? chunk.pdfPage : null,
      score: chunk.score ?? null,
      ...(valid ? { itemKey: chunk.itemKey, pointId: chunk.id, textPreview: chunk.text.slice(0, 900) } : {}),
      provenanceValid: valid,
    };
  });
}

function safeM15ProviderErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Provider query failed with a non-Error value.";
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [redacted]")
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\b\s*[:=]\s*["']?[^,\s;"']+["']?/giu, "$1=[redacted]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/giu, "$1?[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240) || "Provider query failed.";
}

async function timedQuery(run: () => Promise<M15Candidate[]>): Promise<M15ProviderResult> {
  const started = performance.now();
  try {
    const candidates = await run();
    return {
      ok: true,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      resultCount: candidates.length,
      retrievedPages: candidates.map((item) => item.page),
      provenanceViolationCount: candidates.filter((item) => !item.provenanceValid).length,
      candidates,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      resultCount: 0,
      retrievedPages: [],
      provenanceViolationCount: 0,
      candidates: [],
      errorType: error instanceof Error && error.name ? error.name.slice(0, 64) : "ProviderError",
      errorMessage: safeM15ProviderErrorMessage(error),
    };
  }
}

export async function runM15BenchmarkSourceShadow(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
  startIndex: number,
): Promise<Record<string, unknown>> {
  if (!env.BRVIN_M15_BENCHMARK_AI_SEARCH) throw new Error("The separate M15 staging AI Search binding is missing.");
  if (source.status !== "ready" || source.page_count !== SOURCE_PAGE_COUNT ||
      source.indexed_pages !== SOURCE_PAGE_COUNT ||
      source.ai_search_indexed_pages !== SOURCE_PAGE_COUNT || source.qdrant_point_count < SOURCE_PAGE_COUNT) {
    throw new Error("Both isolated staging indexes must be READY for all eight physical pages before paired evaluation.");
  }
  const batch = m15BenchmarkBatchWindow(startIndex);
  const pilot = await createQdrantPilot(env, BENCHMARK_QDRANT_COLLECTION);
  const results: M15ShadowQueryResult[] = [];
  for (const item of M15_BENCHMARK_QUERY_SUITE.slice(batch.startIndex, batch.endIndex)) {
    const [aiSearch, qdrant] = await Promise.all([
      timedQuery(async () => {
        const response = await env.BRVIN_M15_BENCHMARK_AI_SEARCH!.search({
          messages: [{ role: "user", content: item.query }],
          ai_search_options: {
            cache: { enabled: false },
            retrieval: {
              max_num_results: 16,
              match_threshold: 0.3,
              retrieval_type: "hybrid",
              keyword_match_mode: "or",
              filters: { folder: { $in: [sourcePrefix(source.source_id)] } },
            },
            reranking: { enabled: true, model: "@cf/baai/bge-reranker-base", match_threshold: 0.4 },
          },
        });
        return mapAiSearch(response.chunks ?? [], source.source_id);
      }),
      timedQuery(async () => {
        const hits = await pilot.query({
          projectId: source.project_id,
          authorizedSourceIds: [source.source_id],
          query: item.query,
          limit: TOP_K,
          prefetchLimit: PREFETCH_LIMIT,
          ensureCollection: false,
        });
        return mapQdrant(hits, source.source_id);
      }),
    ]);
    results.push({
      ...item,
      cloudflareAiSearch: aiSearch,
      qdrantVertex: qdrant,
    });
  }
  return {
    benchmark: "brvin-m15-second-source-paired-shadow",
    sourceId: source.source_id,
    batch: {
      ...batch,
      totalQueries: M15_BENCHMARK_QUERY_SUITE.length,
      completedQueriesInBatch: results.length,
    },
    results,
  };
}

function isM15ProviderResult(value: unknown): value is M15ProviderResult {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.ok === "boolean" && typeof item.elapsedMs === "number" &&
    Number.isFinite(item.elapsedMs) && typeof item.resultCount === "number" &&
    Number.isSafeInteger(item.resultCount) && item.resultCount >= 0 &&
    Array.isArray(item.retrievedPages) && typeof item.provenanceViolationCount === "number" &&
    Array.isArray(item.candidates);
}

function buildM15BenchmarkReceipt(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
  rawResults: unknown,
): Record<string, unknown> {
  if (source.status !== "ready" || source.page_count !== SOURCE_PAGE_COUNT ||
      source.indexed_pages !== SOURCE_PAGE_COUNT || source.ai_search_indexed_pages !== SOURCE_PAGE_COUNT ||
      source.qdrant_point_count < SOURCE_PAGE_COUNT) {
    throw new Error("Both isolated staging indexes must remain READY before the paired receipt is assembled.");
  }
  if (!Array.isArray(rawResults) || rawResults.length !== M15_BENCHMARK_QUERY_SUITE.length) {
    throw new Error("The complete 17-query benchmark result set is required to assemble the receipt.");
  }
  const results = rawResults as M15ShadowQueryResult[];
  for (let index = 0; index < M15_BENCHMARK_QUERY_SUITE.length; index += 1) {
    const expected = M15_BENCHMARK_QUERY_SUITE[index];
    const actual = results[index] as unknown as Record<string, unknown>;
    if (!actual || actual.id !== expected.id || actual.query !== expected.query ||
        actual.category !== expected.category || !Array.isArray(actual.expectedPages) ||
        JSON.stringify(actual.expectedPages) !== JSON.stringify(expected.expectedPages) ||
        actual.expectedNoMatch !== expected.expectedNoMatch ||
        !isM15ProviderResult(actual.cloudflareAiSearch) || !isM15ProviderResult(actual.qdrantVertex)) {
      throw new Error("Benchmark results are missing, duplicated, reordered or do not match the fixed 17-query suite.");
    }
  }
  const summarize = (provider: ProviderName) => summarizeM15BenchmarkProvider(
    results.map((item) => ({
      id: item.id,
      category: item.category,
      expectedPages: item.expectedPages,
      expectedNoMatch: item.expectedNoMatch,
      result: provider === "cloudflareAiSearch" ? item.cloudflareAiSearch : item.qdrantVertex,
    })),
  );
  return {
    benchmark: "brvin-m15-second-source-paired-shadow",
    source: {
      sourceId: source.source_id,
      projectId: source.project_id,
      title: source.title,
      fileName: source.file_name,
      sourceSha256: source.source_sha256,
      pageCount: source.page_count,
      generationId: source.generation_id,
    },
    queryCount: results.length,
    positiveQueryCount: M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "positive").length,
    outOfCorpusQueryCount: M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "out-of-corpus").length,
    exactSymbolNearMissQueryCount: M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "exact-symbol-near-miss").length,
    providers: {
      cloudflareAiSearch: {
        instance: "brvin-m15-physics-staging-v1",
        mode: "isolated staging AI Search search() binding",
        summary: summarize("cloudflareAiSearch"),
      },
      qdrantVertex: {
        collection: BENCHMARK_QDRANT_COLLECTION,
        model: env.BRVIN_M14_VERTEX_MODEL,
        dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
        mode: "isolated staging query-only points/query",
        summary: summarize("qdrantVertex"),
      },
    },
    results,
    sideEffects: {
      aiSearchItemsUploaded: 0,
      aiSearchItemsDeleted: 0,
      qdrantPointsUpserted: 0,
      qdrantPointsDeleted: 0,
      sourceOrOcrChanged: false,
      providerSelectorChanged: false,
      consumerAnswersChanged: false,
    },
    interpretation: "This is a 17-query retrieval-only benchmark executed in six small Worker invocations to stay below the per-invocation subrequest limit. Positive expected-page metrics are page-label proxies, not independent passage qrels. Candidate presence on N01-N04 and H01 is not automatically a false positive: reviewers must grade returned passages against the source. H01 is a separate exact-symbol near-miss because the source contains the opposite restoring-force sign. Qdrant RRF scores are ranking values, not confidence probabilities. The benchmark does not invoke Gemini answer generation or prove answer abstention. Each batch performs search/query only and has zero index side effects.",
  };
}

async function uploadSource(request: Request, env: M15BenchmarkStagingEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "staging_database_missing" }, 503);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "multipart_form_required" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, error: "source_pdf_file_required" }, 400);
  if (file.size > MAX_SOURCE_BYTES) return json({ ok: false, error: "source_pdf_too_large" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateM15BenchmarkPdf(file.name, bytes);
  if (!validated.ok) return json({ ok: false, error: "benchmark_pdf_validation_failed", detail: validated.error }, 400);
  const digest = await sha256Hex(bytes);
  if (digest !== SOURCE_SHA256) return json({ ok: false, error: "benchmark_pdf_sha256_mismatch" }, 400);

  const bucket = googleBucket(env);
  const existing = await env.DB.prepare(
    "SELECT * FROM m15_benchmark_sources WHERE source_sha256 = ? LIMIT 1",
  ).bind(SOURCE_SHA256).first<M15BenchmarkSourceRow>();
  if (existing && existing.status !== "uploading") {
    return json({ ok: true, source: publicSource(existing), alreadyRegistered: true });
  }
  const now = Date.now();
  let row = existing;
  if (!row) {
    const sourceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const sourceObject = "brvin/m15-benchmark/source-pdfs/" + sourceId + "/source.pdf";
    const outputPrefix = visionPrefix(sourceId);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO m15_benchmark_sources " +
      "(source_id, project_id, title, file_name, source_object, source_sha256, expected_size, uploaded_bytes, status, vision_operation, vision_output_prefix, page_count, indexed_pages, generation_id, qdrant_point_count, ai_search_indexed_pages, error_message, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'uploading', NULL, ?, 0, 0, NULL, 0, 0, NULL, ?, ?)",
    ).bind(
      sourceId,
      projectId,
      "Physics Benchmark — M15 v1",
      SOURCE_FILE_NAME,
      sourceObject,
      SOURCE_SHA256,
      SOURCE_BYTES,
      outputPrefix,
      now,
      now,
    ).run();
    row = await env.DB.prepare(
      "SELECT * FROM m15_benchmark_sources WHERE source_sha256 = ? LIMIT 1",
    ).bind(SOURCE_SHA256).first<M15BenchmarkSourceRow>();
  }
  if (!row) return json({ ok: false, error: "source_registry_insert_failed" }, 500);
  try {
    await putImmutableSourceObject(env, bucket, row.source_object, bytes);
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET uploaded_bytes = ?, status = 'uploaded', error_message = NULL, updated_at = ? WHERE source_id = ? AND status IN ('uploading','uploaded')",
    ).bind(SOURCE_BYTES, Date.now(), row.source_id).run();
    const updated = await getSource(env, row.source_id);
    return json({ ok: true, source: updated ? publicSource(updated) : publicSource(row), alreadyRegistered: Boolean(existing) });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET error_message = ?, updated_at = ? WHERE source_id = ?",
    ).bind(safeError(error), Date.now(), row.source_id).run();
    return json({ ok: false, error: "source_upload_failed", detail: safeError(error), sourceId: row.source_id }, 502);
  }
}

function publicSource(row: M15BenchmarkSourceRow): Record<string, unknown> {
  return {
    sourceId: row.source_id,
    projectId: row.project_id,
    title: row.title,
    fileName: row.file_name,
    sourceSha256: row.source_sha256,
    expectedSize: Number(row.expected_size),
    uploadedBytes: Number(row.uploaded_bytes),
    status: row.status,
    pageCount: Number(row.page_count),
    indexedPages: Number(row.indexed_pages),
    generationId: row.generation_id,
    qdrantPointCount: Number(row.qdrant_point_count),
    qdrantIndexedPages: Number(row.qdrant_indexed_pages ?? 0),
    aiSearchIndexedPages: Number(row.ai_search_indexed_pages),
    visionOperationRecorded: Boolean(row.vision_operation),
    error: row.error_message ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function m15BenchmarkAdminPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>BRVIN M15 Benchmark Staging</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#10151f;color:#edf2fa;padding:24px;min-height:100vh}
main{max-width:820px;margin:24px auto;background:#172131;border:1px solid #34445a;border-radius:18px;padding:clamp(20px,4vw,34px)}
h1{font-size:clamp(25px,5vw,34px);margin:8px 0}p{color:#b8c6d8;line-height:1.55}.eyebrow{color:#91b5e2;font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
.notice{padding:14px 16px;margin:18px 0;border:1px solid #40566f;border-radius:12px;background:#1d2c40}.notice strong{color:#fff}
label{display:block;margin:14px 0 8px;font-weight:650}input[type=password],input[type=file]{width:100%;padding:12px;border:1px solid #50657e;border-radius:9px;background:#0d1521;color:#fff;font:inherit}
button{width:100%;border:0;border-radius:10px;padding:13px 15px;margin-top:10px;background:#2767c8;color:#fff;font:inherit;font-weight:750;cursor:pointer}
button.secondary{background:#2a3b52;border:1px solid #526b89}button:disabled{opacity:.45;cursor:not-allowed}
.confirm{display:flex;align-items:flex-start;gap:10px;font-weight:400;line-height:1.5;color:#d1dceb}.confirm input{margin-top:5px}
.status{padding:13px 14px;border:1px solid #394d66;border-radius:10px;background:#0d1725;margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
.muted{color:#aabbd0}.good{color:#9ae6b4}.bad{color:#ffaaa6}.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:18px 0}
.step{border:1px solid #34475d;border-radius:9px;padding:10px;background:#121d2c;color:#c8d4e3;font-size:13px}
.small{font-size:13px}code{color:#d7e7ff;overflow-wrap:anywhere}
</style></head>
<body><main>
<div class="eyebrow">Isolated Core staging · M15 second source</div>
<h1>Physics benchmark v1</h1>
<p>This operator uploads one fingerprint-pinned eight-page PDF into the private M14 staging bucket, runs OCR into a source-specific prefix, builds immutable page manifests, and indexes into separate staging AI Search and Qdrant resources.</p>
<div class="notice"><strong>Production protection</strong><p class="small">The original three-page M14 source remains unchanged. This page does not write to the production D1 registry, production GCS source bucket, production AI Search instance, Teachers Worker, or production provider selector. The paired query action is read-only.</p></div>
<div class="status muted" id="health">Checking staging configuration…</div>
<label for="token">Staging operator token</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Enter BRVIN_M14_ADMIN_TOKEN" minlength="32">
<label for="file">Approved source PDF</label><input id="file" type="file" accept="application/pdf">
<p class="small">Select exactly <code>BRVIN_M15_Physics_Benchmark_Source_v1.pdf</code> (62,012 bytes). The Worker independently checks the filename, PDF signature and SHA-256 before storing it.</p>
<button id="upload" type="button" disabled>1 · Upload and register benchmark source</button>
<label for="sourceId">Registered staging source ID</label><input id="sourceId" type="text" readonly placeholder="Generated after successful upload">
<button id="recover" class="secondary" type="button" disabled>Restore existing registered source (read only)</button>
<p class="small">After a browser restart, enter the staging operator token and use Restore to reload the existing source ID and saved progress. Only this non-secret ID is remembered locally; the operator token is never stored.</p>
<label class="confirm"><input id="ocrConfirm" type="checkbox"><span>I understand this submits one Google Cloud Vision PDF OCR request. Google Cloud usage charges may apply. Duplicate OCR submissions are blocked.</span></label>
<button id="ocr" type="button" disabled>2 · Start OCR once (billable)</button>
<button id="status" class="secondary" type="button" disabled>3 · Check OCR operation and eight-page output inventory (read only)</button>
<button id="corpus" class="secondary" type="button" disabled>4 · Build and verify immutable page manifests</button>
<button id="qdrant" class="secondary" type="button" disabled>5 · Embed and index into isolated Qdrant collection</button>
<button id="aisearch" class="secondary" type="button" disabled>6 · Index eight OCR pages into isolated AI Search</button>
<button id="benchmark" class="secondary" type="button" disabled>7 · Run 17-query paired benchmark (read only)</button>
<div class="steps">
<div class="step">Secure upload</div><div class="step">Google Vision OCR</div><div class="step">Page indexing</div><div class="step">Retrieval quality checks</div><div class="step">Ready</div>
</div>
<div class="notice"><strong>Do not upload the test card.</strong><p class="small">Keep <code>BRVIN_M15_Physics_Benchmark_Test_Card_v1.pdf</code> on your computer. It contains the question list and expected pages and must never enter the indexed corpus.</p></div>
<div class="status muted" id="result" role="status" aria-live="polite">No benchmark upload or processing action has been started.</div>
</main>
<script>
(() => {
  const token = document.getElementById("token");
  const file = document.getElementById("file");
  const sourceId = document.getElementById("sourceId");
  const ocrConfirm = document.getElementById("ocrConfirm");
  const result = document.getElementById("result");
  const health = document.getElementById("health");
  const buttons = Object.fromEntries(["upload","ocr","status","corpus","qdrant","aisearch","benchmark","recover"].map(id=>[id,document.getElementById(id)]));
  let sourceStatus = "";
  function refresh() {
    const authReady = token.value.trim().length >= 32;
    const hasSource = /^[0-9a-f-]{36}$/i.test(sourceId.value.trim());
    buttons.upload.disabled = !authReady || !file.files.length;
    buttons.recover.disabled = !authReady || hasSource;
    buttons.ocr.disabled = !authReady || !hasSource || !ocrConfirm.checked || sourceStatus !== "uploaded";
    buttons.status.disabled = !authReady || !hasSource;
    buttons.corpus.disabled = !authReady || !hasSource || sourceStatus !== "ocr_completed";
    buttons.qdrant.disabled = !authReady || !hasSource || !["corpus_ready","qdrant_indexing","qdrant_ready","ai_search_ready","ready"].includes(sourceStatus);
    buttons.qdrant.textContent = sourceStatus === "qdrant_indexing"
      ? "5 · Continue Qdrant indexing (next 2 pages)"
      : "5 · Embed and index into isolated Qdrant collection";
    buttons.aisearch.disabled = !authReady || !hasSource || !["corpus_ready","qdrant_ready","ai_search_ready","ai_search_indexing","ready"].includes(sourceStatus);
    buttons.aisearch.textContent = sourceStatus === "ai_search_indexing"
      ? "6 · Continue AI Search indexing (next 2 pages)"
      : "6 · Index eight OCR pages into isolated AI Search";
    buttons.benchmark.disabled = !authReady || !hasSource || sourceStatus !== "ready";
  }
  const sourceStorageKey = "brvinM15BenchmarkSourceId";
  function rememberSourceId(value) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return;
    try { localStorage.setItem(sourceStorageKey,value); } catch {}
    try { sessionStorage.setItem(sourceStorageKey,value); } catch {}
  }
  function readRememberedSourceId() {
    try {
      const saved = localStorage.getItem(sourceStorageKey);
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    } catch {}
    try {
      const saved = sessionStorage.getItem(sourceStorageKey);
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    } catch {}
    return "";
  }
  file.addEventListener("change",refresh);token.addEventListener("input",refresh);ocrConfirm.addEventListener("change",refresh);
  async function call(path,method,body,busy) {
    let secret=token.value.trim();token.value="";refresh();result.className="status muted";result.textContent=busy;
    try {
      const headers={authorization:"Bearer "+secret};
      const options={method,headers,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"};
      if(body instanceof FormData){options.body=body;}else if(body!==undefined){headers["content-type"]="application/json";options.body=JSON.stringify(body);}
      const response=await fetch(path,options);const data=await response.json();
      result.className="status "+(response.ok&&data.ok===true?"good":"bad");result.textContent=JSON.stringify(data,null,2);
      if(data.source?.sourceId){sourceId.value=data.source.sourceId;sourceStatus=data.source.status;rememberSourceId(sourceId.value);}
      if(data.sourceId&&!sourceId.value){sourceId.value=data.sourceId;rememberSourceId(sourceId.value);}
      if(data.status){sourceStatus=data.status;}
      if(data.source?.status){sourceStatus=data.source.status;}
      if(data.result?.status){sourceStatus=data.result.status;}
      return data;
    }catch(error){result.className="status bad";result.textContent="Request failed. Check your connection, re-enter the token and use the read-only status action before retrying a state-changing operation.";return null;}
    finally{secret="";token.value="";refresh();}
  }
  async function refreshStatus() {
    if(!sourceId.value)return;
    const data=await call("/admin/m15/benchmark/source/status?sourceId="+encodeURIComponent(sourceId.value),"GET",undefined,"Checking the source record, Vision operation and physical-page output inventory. This does not start OCR.");
    if(data?.source){sourceStatus=data.source.status;refresh();}
  }
  buttons.upload.addEventListener("click",async()=>{
    const chosen=file.files[0];if(!chosen)return;
    const form=new FormData();form.append("file",chosen,chosen.name);
    buttons.upload.disabled=true;
    await call("/admin/m15/benchmark/source/upload","POST",form,"Verifying exact filename, byte size and SHA-256, then uploading into private staging storage. This does not touch production.");
  });
  buttons.ocr.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/ocr","POST",{sourceId:sourceId.value},"Checking the immutable source PDF and submitting one Vision OCR operation into the private staging bucket. Do not click again.");
    ocrConfirm.checked=false;
  });
  buttons.status.addEventListener("click",refreshStatus);
  buttons.recover.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/recover","GET",undefined,
      "Restoring the existing registered source from the authenticated staging registry. This is read-only; it does not upload a file, run OCR, or modify either index.");
  });
  buttons.corpus.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/corpus","POST",{sourceId:sourceId.value},"Validating all eight Vision JSON files, persisting immutable page manifests/chunks, and reading them back for hash and page-provenance verification.");
  });
  buttons.qdrant.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/qdrant","POST",{sourceId:sourceId.value},"Indexing at most two verified PDF pages into the isolated Qdrant collection. Re-enter the token and repeat Step 5 until all eight pages are complete.");
  });
  buttons.aisearch.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/ai-search","POST",{sourceId:sourceId.value},"Configuring the dedicated M15 metadata schema if needed, then indexing at most two verified OCR pages into the isolated AI Search instance. Re-enter the token and repeat Step 6 until all eight pages are complete.");
  });
  buttons.benchmark.addEventListener("click",async()=>{
    let secret=token.value.trim();
    const selectedSourceId=sourceId.value.trim();
    if(secret.length<32||!selectedSourceId)return;
    token.value="";refresh();buttons.benchmark.disabled=true;
    const totalQueries=17;let collected=[];let nextIndex=0;let batchNumber=0;
    const requestBatch=async(path,payload)=>{
      const response=await fetch(path,{
        method:"POST",
        headers:{authorization:"Bearer "+secret,"content-type":"application/json"},
        body:JSON.stringify(payload),cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"
      });
      let data;
      try{data=await response.json();}catch{throw new Error("The staging Worker returned an unreadable response (HTTP "+response.status+").");}
      if(!response.ok||data.ok!==true)throw new Error(data.error||("Staging benchmark request failed (HTTP "+response.status+")."));
      return data;
    };
    result.className="status muted";result.textContent="Starting the read-only paired benchmark in small batches. The operator token is held only in memory for this click and cleared when the run ends.";
    try{
      while(nextIndex<totalQueries){
        result.textContent="Running paired retrieval batch "+(batchNumber+1)+" · completed "+collected.length+"/"+totalQueries+" query pairs. Do not close this page.";
        const data=await requestBatch("/admin/m15/benchmark/run",{sourceId:selectedSourceId,startIndex:nextIndex});
        const batch=data.result?.batch;const batchResults=data.result?.results;
        if(!batch||batch.startIndex!==nextIndex||!Number.isSafeInteger(batch.endIndex)||batch.endIndex<=nextIndex||
            batch.endIndex>totalQueries||batch.hasMore!==(batch.endIndex<totalQueries)||
            !Array.isArray(batchResults)||batchResults.length!==batch.endIndex-nextIndex){
          throw new Error("The staging Worker returned an incomplete or out-of-order benchmark batch.");
        }
        collected.push(...batchResults);nextIndex=batch.endIndex;batchNumber+=1;
      }
      result.textContent="All "+collected.length+"/"+totalQueries+" query pairs completed. Assembling provider summaries and the final receipt…";
      const receipt=await requestBatch("/admin/m15/benchmark/complete",{sourceId:selectedSourceId,results:collected});
      result.className="status "+(receipt.ok===true?"good":"bad");
      result.textContent=JSON.stringify(receipt,null,2);
    }catch(error){
      result.className="status bad";
      result.textContent="Benchmark stopped after "+collected.length+"/"+totalQueries+" query pairs. "+(error instanceof Error?error.message:"Unexpected request failure.")+" Re-enter the staging token and click Step 7 again to restart the read-only benchmark from the beginning.";
    }finally{
      secret="";token.value="";refresh();
    }
  });
  const saved=readRememberedSourceId();
  if(saved){sourceId.value=saved;refresh();}
  fetch("/admin/m15/benchmark/health",{cache:"no-store",credentials:"omit"}).then(r=>r.json()).then(data=>{
    health.className="status "+(data.ready?"good":"bad");
    health.textContent=data.ready
      ? "Staging is ready. Separate M15 AI Search instance and Qdrant collection are configured. Production AI Search remains untouched."
      : "Staging configuration is incomplete: "+JSON.stringify(data,null,2);
  }).catch(()=>{health.className="status bad";health.textContent="Could not check staging configuration."});
  refresh();
})();
</script></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, private",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  }});
}


interface M15AnswerEvidenceCandidate {
  rank: number;
  page: number | null;
  score: number | null;
  itemKey?: string;
  provenanceValid: boolean;
  text: string;
}

interface M15AnswerRetrieval {
  ok: boolean;
  elapsedMs: number;
  candidates: M15AnswerEvidenceCandidate[];
  provenanceViolationCount: number;
  errorType?: string;
  errorMessage?: string;
}

function m15AnswerProfile(): ProfileContext {
  const profile: StudentProfile = {
    version: 2,
    targetExam: "Physics source-grounding evaluation",
    recentTopics: [],
    recentSubjects: [],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 0,
    lastUpdatedAt: Date.now(),
  };
  return {
    profile,
    recentTopicHint: "",
    attentionTopicHint: "",
    revisionHint: "",
    recentConversation: [],
  };
}

async function retrieveM15AnswerEvidenceAiSearch(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
  item: M15Case,
): Promise<M15AnswerRetrieval> {
  const started = performance.now();
  try {
    const search = env.BRVIN_M15_BENCHMARK_AI_SEARCH;
    if (!search) throw new Error("The isolated M15 staging AI Search binding is missing.");
    const response = await search.search({
      messages: [{ role: "user", content: item.query }],
      ai_search_options: {
        cache: { enabled: false },
        retrieval: {
          max_num_results: 16,
          match_threshold: 0.3,
          retrieval_type: "hybrid",
          keyword_match_mode: "or",
          filters: { folder: { $in: [sourcePrefix(source.source_id)] } },
        },
        reranking: { enabled: true, model: "@cf/baai/bge-reranker-base", match_threshold: 0.4 },
      },
    });
    const candidates = (response.chunks ?? []).slice(0, TOP_K).map((chunk, index) => {
      const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
      const page = pageFromItemKey(key, source.source_id);
      const valid = page !== null;
      return {
        rank: index + 1,
        page,
        score: typeof chunk.score === "number" ? chunk.score : null,
        ...(valid ? { itemKey: key } : {}),
        provenanceValid: valid,
        text: valid && typeof chunk.text === "string" ? chunk.text.slice(0, 4_500) : "",
      };
    });
    return {
      ok: true,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      candidates,
      provenanceViolationCount: candidates.filter((candidate) => !candidate.provenanceValid).length,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      candidates: [],
      provenanceViolationCount: 0,
      errorType: error instanceof Error && error.name ? error.name.slice(0, 64) : "ProviderError",
      errorMessage: safeM15ProviderErrorMessage(error),
    };
  }
}

async function retrieveM15AnswerEvidenceQdrant(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
  item: M15Case,
): Promise<M15AnswerRetrieval> {
  const started = performance.now();
  try {
    const pilot = await createQdrantPilot(env, BENCHMARK_QDRANT_COLLECTION);
    const hits = await pilot.query({
      projectId: source.project_id,
      authorizedSourceIds: [source.source_id],
      query: item.query,
      limit: TOP_K,
      prefetchLimit: PREFETCH_LIMIT,
      ensureCollection: false,
    });
    const candidates = hits.slice(0, TOP_K).map((hit, index) => {
      const valid = hit.sourceId === source.source_id &&
        hit.itemKey.startsWith(sourcePrefix(source.source_id)) &&
        Number.isSafeInteger(hit.pdfPage) && hit.pdfPage >= 1 && hit.pdfPage <= SOURCE_PAGE_COUNT;
      return {
        rank: index + 1,
        page: valid ? hit.pdfPage : null,
        score: typeof hit.score === "number" ? hit.score : null,
        ...(valid ? { itemKey: hit.itemKey } : {}),
        provenanceValid: valid,
        text: valid && typeof hit.text === "string" ? hit.text.slice(0, 4_500) : "",
      };
    });
    return {
      ok: true,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      candidates,
      provenanceViolationCount: candidates.filter((candidate) => !candidate.provenanceValid).length,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      candidates: [],
      provenanceViolationCount: 0,
      errorType: error instanceof Error && error.name ? error.name.slice(0, 64) : "ProviderError",
      errorMessage: safeM15ProviderErrorMessage(error),
    };
  }
}

function normalizeM15Answer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/[−–—]/gu, "-")
    .replace(/[×·]/gu, "*")
    .replace(/²/gu, "2")
    .replace(/ₛ/gu, "s")
    .replace(/\\(?:times|cdot)/gu, "*")
    .replace(/\\(?:mathrm|text)\{([^}]+)\}/gu, "$1")
    .replace(/\\(?:left|right)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function m15AnswerHasUnitValue(answer: string, value: string, unitPattern: string): boolean {
  const normalized = normalizeM15Answer(answer);
  const number = value.replace(/\./gu, "\\.");
  return new RegExp("(?<![0-9.])" + number + "(?![0-9])\\s*(?:" + unitPattern + ")", "iu").test(normalized);
}

function m15AnswerHasSignedUnitValue(answer: string, value: string, unitPattern: string): boolean {
  const normalized = normalizeM15Answer(answer);
  const number = value.replace(/\./gu, "\\.");
  return new RegExp("-\\s*" + number + "(?![0-9])\\s*(?:" + unitPattern + ")", "iu").test(normalized);
}

function m15AnswerCompactMath(answer: string): string {
  return normalizeM15Answer(answer)
    .replace(/\\(?:frac)\{([^}]+)\}\{([^}]+)\}/gu, "$1/$2")
    .replace(/[_{}$^\\\s]/gu, "")
    .replace(/\*/gu, "");
}

function explicitlyAbstainsFromM15(answer: string): boolean {
  return /(?:not enough information|does not provide enough|doesn't provide enough|not supported by (?:the|this) source|not present in (?:the|this) source|not included in (?:the|this) source|cannot be determined from (?:the|this) source|can't be determined from (?:the|this) source|no relevant (?:source )?evidence|no information (?:is )?(?:provided|available) in (?:the|this) source|unable to answer from (?:the|this) source)/iu.test(answer);
}

function m15AnswerPageCitations(answer: string): number[] {
  const pages = new Set<number>();
  const patterns = [
    /\bpdf\s*(?:page|p\.?)\s*(\d+)\b/giu,
    /\bpage\s*(?:no\.?\s*)?(\d+)\b/giu,
    /\bp\.\s*(\d+)\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of answer.matchAll(pattern)) {
      const page = Number(match[1]);
      if (Number.isSafeInteger(page)) pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export function evaluateM15AnswerQuality(input: {
  queryId: string;
  answer: string;
  retrievedPages: number[];
  citedPages: number[];
  provenanceViolationCount: number;
  retrievalOk: boolean;
}): {
  answerCorrectness: { passed: boolean; checks: Array<{ id: string; passed: boolean }> };
  sourceGroundingCorrectness: boolean;
  citationCorrectness: boolean;
  mathematicalSymbolFidelity: boolean | null;
  abstentionCorrectness: boolean | null;
  irrelevantEvidenceResistanceDemonstrated: boolean | null;
  overallPass: boolean;
  failureCases: string[];
} {
  const answer = input.answer ?? "";
  const normalized = normalizeM15Answer(answer);
  const compact = m15AnswerCompactMath(answer);
  const check = (id: string, passed: boolean) => ({ id, passed });
  const pageTargets = input.queryId === "H01"
    ? [8]
    : M15_BENCHMARK_QUERY_SUITE.find((item) => item.id === input.queryId)?.expectedPages ?? [];
  const hasTargetEvidence = pageTargets.length > 0 &&
    pageTargets.every((page) => input.retrievedPages.includes(page));
  const noProvenanceViolations = input.provenanceViolationCount === 0;
  const isNegative = /^N0[1-4]$/u.test(input.queryId);
  let checks: Array<{ id: string; passed: boolean }> = [];
  let abstentionCorrectness: boolean | null = null;
  let irrelevantEvidenceResistanceDemonstrated: boolean | null = null;
  let mathApplicable = true;

  if (isNegative) {
    const abstains = explicitlyAbstainsFromM15(answer);
    const unsupportedCalculation = input.queryId === "N02"
      ? /(?:^|[^0-9])4\s*a(?:mp(?:ere)?s?)?(?:$|[^a-z])/iu.test(normalized)
      : input.queryId === "N03"
        ? /q\s*v\s*b|q\s*v\s*[*x]\s*b|q\(v\s*[x*]\s*b\)|lorentz force\s*=/iu.test(normalized)
        : input.queryId === "N04"
          ? /p\s*v\s*=\s*n\s*r\s*t|p\s*=\s*n\s*r\s*t\s*\/\s*v|n\s*r\s*t\s*\/\s*v/iu.test(normalized)
          : /c\s*=\s*(?:epsilon|ε)|(?:epsilon|ε)\s*0\s*a\s*\/\s*d/iu.test(normalized);
    checks = [
      check("explicitSourceAbstention", abstains),
      check("doesNotSupplyUnsupportedResult", !unsupportedCalculation),
      check("doesNotCiteUnrelatedPage", input.citedPages.length === 0),
    ];
    abstentionCorrectness = checks.every((item) => item.passed);
    irrelevantEvidenceResistanceDemonstrated = abstentionCorrectness && input.retrievedPages.length > 0;
    mathApplicable = false;
  } else {
    switch (input.queryId) {
      case "P01":
        checks = [
          check("statesNewtonSecondLawEquation", /(?:fnet|f)=ma|fnet=mass(?:x|\*)acceleration/iu.test(compact)),
          check("connectsNetForceMassAcceleration", /net force/iu.test(normalized) && /mass/iu.test(normalized) && /acceleration/iu.test(normalized)),
        ];
        break;
      case "P02":
        checks = [
          check("netForceSixNewtonsEast", /(?:6\s*(?:n|newtons?).{0,30}east|east.{0,30}6\s*(?:n|newtons?))/iu.test(normalized)),
          check("accelerationThreeMetresPerSecondSquared", m15AnswerHasUnitValue(answer, "3", "m\\s*\\/\\s*s2|m\\s*\\/\\s*s\\s*\\^\\s*2")),
          check("accelerationDirectionEast", /(?:3\s*m\s*\/\s*s2?.{0,40}east|east.{0,40}3\s*m\s*\/\s*s2?)/iu.test(normalized)),
        ];
        break;
      case "P03":
        checks = [
          check("accelerationThreeMetresPerSecondSquared", m15AnswerHasUnitValue(answer, "3", "m\\s*\\/\\s*s2|m\\s*\\/\\s*s\\s*\\^\\s*2")),
          check("forwardDirection", /forward|forwards/iu.test(normalized)),
        ];
        break;
      case "P04":
        checks = [check("netForceTenNewtons", m15AnswerHasUnitValue(answer, "10", "n\\b|newtons?\\b"))];
        break;
      case "P05":
        checks = [
          check("weightNineteenPointSixNewtons", m15AnswerHasUnitValue(answer, "19.6", "n\\b|newtons?\\b")),
          check("identifiesWeight", /weight/iu.test(normalized)),
        ];
        break;
      case "P06":
        checks = [
          check("massRemainsConstant", /mass.{0,70}(?:constant|unchanged|does not change|remains the same|independent of gravity)|(?:constant|unchanged).{0,50}mass/iu.test(normalized)),
          check("weightDependsOnLocalGravity", /weight.{0,90}(?:changes|varies|depends|proportional).{0,50}(?:gravity|g\b)|(?:gravity|g\b).{0,50}weight.{0,50}(?:changes|varies|depends)/iu.test(normalized)),
        ];
        mathApplicable = false;
        break;
      case "P07":
        checks = [
          check("kineticFrictionNinePointEightNewtons", m15AnswerHasUnitValue(answer, "9.8", "n\\b|newtons?\\b")),
          check("identifiesKineticFriction", /kinetic friction/iu.test(normalized)),
        ];
        break;
      case "P08":
        checks = [
          check("staticFrictionAdjusts", /static friction/iu.test(normalized) && /adjust|self.?adjust|var(?:y|ies)|changes? as needed/iu.test(normalized)),
          check("staticFrictionIsNotAlwaysAtMaximum", /not always|not necessarily|does not always/iu.test(normalized)),
          check("statesMaximumLimit", /maximum|up to|less than or equal|at most|≤|mu.?s.{0,20}(?:n|normal)/iu.test(normalized)),
        ];
        break;
      case "P09":
        checks = [
          check("downslopeComponentNineteenPointSixNewtons", m15AnswerHasUnitValue(answer, "19.6", "n\\b|newtons?\\b") && /downslope|down the slope/iu.test(normalized)),
          check("normalForceApproximatelyThirtyFourNewtons", /(?:33\.9[0-9]?|34(?:\.0+)?)\s*(?:n|newtons?)/iu.test(normalized)),
          check("identifiesNormalForce", /normal force/iu.test(normalized)),
        ];
        break;
      case "P10":
        checks = [
          check("finalSpeedFourMetresPerSecond", m15AnswerHasUnitValue(answer, "4", "m\\s*\\/\\s*s\\b")),
          check("usesWorkEnergyRelationship", /work.?energy|kinetic energy|change in kinetic energy|work is equal to/iu.test(normalized)),
        ];
        break;
      case "P11":
        checks = [
          check("changeInMomentumMinusFourPointFive", m15AnswerHasSignedUnitValue(answer, "4.5", "kg\\s*(?:[.*]\\s*)?m\\s*\\/\\s*s")),
          check("averageForceMinusNinetyNewtons", m15AnswerHasSignedUnitValue(answer, "90", "n\\b|newtons?\\b")),
          check("identifiesAverageForce", /average force/iu.test(normalized)),
          check("preservesNegativeDirection", m15AnswerHasSignedUnitValue(answer, "4.5", "kg\\s*(?:[.*]\\s*)?m\\s*\\/\\s*s") && m15AnswerHasSignedUnitValue(answer, "90", "n\\b|newtons?\\b")),
        ];
        break;
      case "P12":
        checks = [
          check("restoringForceEquationHasNegativeSign", /fs=-kx/iu.test(compact)),
          check("restoringForceMinusTenNewtons", m15AnswerHasSignedUnitValue(answer, "10", "n\\b|newtons?\\b")),
          check("elasticPotentialEnergyQuarterJoule", m15AnswerHasUnitValue(answer, "0.25", "j\\b|joules?\\b")),
        ];
        break;
      case "H01":
        checks = [
          check("sourceEquationHasNegativeRestoringForceSign", /fs=-kx/iu.test(compact)),
          check("explicitlyRejectsPositiveSignAsSourceEquation", /f_s\\s*=\\s*\\+\\s*k(?:\\s*(?:[×*x])\\s*x|\\s+x)?[\\s\\S]{0,90}\\bnot\\b/iu.test(normalized)),
          check("rendersCanonicalRestoringForceExpression", /f_s\\s*=\\s*-k(?:\\s*[×*]\\s*x|\\s*x|x)(?![a-z])/iu.test(normalized)),
        ];
        break;
      default:
        checks = [check("knownM15QueryId", false)];
        mathApplicable = false;
    }
  }

  const answerCorrectnessPassed = checks.length > 0 && checks.every((item) => item.passed);
  const sourceGroundingCorrectness = input.retrievalOk && noProvenanceViolations && (isNegative
input.citedPages.length === 0
    : hasTargetEvidence && answerCorrectnessPassed);
  const modelCitedPages = m15AnswerPageCitations(answer);
  const modelCitationPagesValid = isNegative
    ? modelCitedPages.length === 0
    : modelCitedPages.every((page) => pageTargets.includes(page));
  const citationCorrectness = modelCitationPagesValid && (isNegative
    ? input.citedPages.length === 0
    : pageTargets.length > 0 &&
      pageTargets.every((page) => input.citedPages.includes(page)) &&
      input.citedPages.every((page) => pageTargets.includes(page)) &&
      hasTargetEvidence);
  const mathematicalSymbolFidelity = mathApplicable
    ? checks.every((item) => item.passed)
    : null;
  const failureCases: string[] = [];
  if (!answerCorrectnessPassed) failureCases.push("answerCorrectness");
  if (!sourceGroundingCorrectness) failureCases.push("sourceGroundingCorrectness");
  if (!citationCorrectness) failureCases.push("citationCorrectness");
  if (mathematicalSymbolFidelity === false) failureCases.push("mathematicalSymbolFidelity");
  if (abstentionCorrectness === false) failureCases.push("abstentionCorrectness");
  if (!input.retrievalOk) failureCases.push("retrievalFailed");
  if (!noProvenanceViolations) failureCases.push("provenanceViolation");
  return {
    answerCorrectness: { passed: answerCorrectnessPassed, checks },
    sourceGroundingCorrectness,
    citationCorrectness,
    mathematicalSymbolFidelity,
    abstentionCorrectness,
    irrelevantEvidenceResistanceDemonstrated,
    overallPass: failureCases.length === 0,
    failureCases: [...new Set(failureCases)],
  };
}

async function runM15AnswerEvaluationQuery(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
  queryId: string,
): Promise<Record<string, unknown>> {
  if (env.ENVIRONMENT !== "staging" || env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("Consumer answer evaluation is restricted to the isolated staging Worker.");
  }
  if (source.source_sha256.toLowerCase() !== SOURCE_SHA256 ||
      source.file_name !== SOURCE_FILE_NAME ||
      source.status !== "ready" ||
      source.page_count !== SOURCE_PAGE_COUNT ||
      source.indexed_pages !== SOURCE_PAGE_COUNT ||
      source.ai_search_indexed_pages !== SOURCE_PAGE_COUNT ||
      source.qdrant_indexed_pages !== SOURCE_PAGE_COUNT ||
      source.qdrant_point_count < SOURCE_PAGE_COUNT ||
      !source.generation_id) {
    throw new Error("The fingerprint-pinned eight-page M15 source and both staging indexes must remain READY.");
  }
  if (!env.GCP_PROJECT_ID?.trim() || !env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim()) {
    throw new Error("Google service-account credentials required by the existing consumer Gemini generator are missing from staging.");
  }
  if (!env.BRVIN_M15_BENCHMARK_AI_SEARCH) {
    throw new Error("The dedicated M15 staging AI Search binding is missing.");
  }
  const item = M15_BENCHMARK_QUERY_SUITE.find((candidate) => candidate.id === queryId);
  if (!item) throw new Error("The requested query ID is not part of the fixed M15 17-query suite.");

  const [aiSearch, qdrant] = await Promise.all([
    retrieveM15AnswerEvidenceAiSearch(env, source, item),
    retrieveM15AnswerEvidenceQdrant(env, source, item),
  ]);

  const generate = async (retrieval: M15AnswerRetrieval) => {
    const passages = retrieval.candidates
      .filter((candidate) => candidate.provenanceValid && candidate.page !== null && candidate.text.trim().length > 0)
      .map((candidate) => ({ pdfPage: candidate.page!, text: candidate.text }));
    const sourceContext: GroundedGeminiSourceContext = {
      sourceLabel: "BRVIN M15 Physics Benchmark Source v1",
      passages,
    };
    const started = performance.now();
    try {
      const generation = await generateGeminiAnswer(
        env,
        item.query,
        m15AnswerProfile(),
        [],
        undefined,
        undefined,
        sourceContext,
      );
      const generationLatencyMs = Math.round((performance.now() - started) * 100) / 100;
      const expectedPages = item.category === "exact-symbol-near-miss" ? [8] : item.expectedPages;
      const availablePages = [...new Set(passages.map((passage) => passage.pdfPage))];
      const abstained = explicitlyAbstainsFromM15(generation.packet.answer);
      const citedPages = abstained ? [] : expectedPages.filter((page) => availablePages.includes(page));
      const citation = citedPages.length
        ? "\n\nSource: BRVIN M15 Physics Benchmark Source v1, PDF p. " + citedPages.join(", ") + "."
        : "";
      const generatedAnswer = generation.packet.answer.trim();
      const answerWithCitations = generatedAnswer + citation;
      const evaluation = evaluateM15AnswerQuality({
        queryId: item.id,
        answer: generatedAnswer,
        retrievedPages: availablePages,
        citedPages,
        provenanceViolationCount: retrieval.provenanceViolationCount,
        retrievalOk: retrieval.ok,
      });
      return {
        generatedAnswer,
        answerWithCitations,
        citedPages,
        modelCitedPages: m15AnswerPageCitations(generatedAnswer),
        generationLatencyMs,
        model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
        location: env.GEMINI_LOCATION?.trim() || "global",
        responseMode: generation.packet.responseMode,
        evaluation,
      };
    } catch (error) {
      return {
        generatedAnswer: "",
        answerWithCitations: "",
        citedPages: [],
        modelCitedPages: [],
        generationLatencyMs: Math.round((performance.now() - started) * 100) / 100,
        model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
        location: env.GEMINI_LOCATION?.trim() || "global",
        generationError: safeM15ProviderErrorMessage(error),
        evaluation: evaluateM15AnswerQuality({
          queryId: item.id,
          answer: "",
          retrievedPages: passages.map((passage) => passage.pdfPage),
          citedPages: [],
          provenanceViolationCount: retrieval.provenanceViolationCount,
          retrievalOk: retrieval.ok,
        }),
      };
    }
  };

  const [aiSearchGeneration, qdrantGeneration] = await Promise.all([
    generate(aiSearch),
    generate(qdrant),
  ]);
  const summarizeProvider = (retrieval: M15AnswerRetrieval, generation: Record<string, unknown>) => ({
    retrievalOk: retrieval.ok,
    retrievalLatencyMs: retrieval.elapsedMs,
    retrievedPages: retrieval.candidates.map((candidate) => candidate.page),
    provenanceViolationCount: retrieval.provenanceViolationCount,
    evidence: retrieval.candidates.map((candidate) => ({
      rank: candidate.rank,
      pdfPage: candidate.page,
      score: candidate.score,
      itemKey: candidate.itemKey ?? null,
      provenanceValid: candidate.provenanceValid,
      text: candidate.text,
    })),
    ...(retrieval.errorType ? { retrievalErrorType: retrieval.errorType } : {}),
    ...(retrieval.errorMessage ? { retrievalError: retrieval.errorMessage } : {}),
    ...generation,
  });
  return {
    queryId: item.id,
    category: item.category,
    query: item.query,
    expectedRetrievalPages: item.expectedPages,
    answerEvaluationExpectedPages: item.category === "exact-symbol-near-miss" ? [8] : item.expectedPages,
    retrievalExpectedNoMatch: item.expectedNoMatch,
    cloudflareAiSearch: summarizeProvider(aiSearch, aiSearchGeneration),
    qdrantVertex: summarizeProvider(qdrant, qdrantGeneration),
  };
}


function m15AnswerEvaluationPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>BRVIN M15 Consumer Answer Evaluation</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#090f1b;color:#e8eef8;padding:28px;min-height:100vh}
main{width:min(100%,920px);margin:0 auto;background:#111b2b;border:1px solid #2a3b54;border-radius:18px;padding:clamp(20px,4vw,34px)}
.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8ea6c7;font-weight:750}
h1{font-size:clamp(25px,4vw,34px);letter-spacing:-.03em;margin:9px 0}
p{color:#b9c7da;line-height:1.6}.notice{background:#17263a;border:1px solid #3b506b;padding:14px 16px;border-radius:12px;margin:18px 0}
label{display:block;margin:17px 0 7px;font-weight:650}
input{width:100%;padding:13px;border-radius:9px;border:1px solid #536985;background:#08111f;color:#fff;font:inherit}
.row{display:flex;gap:12px;flex-wrap:wrap}button{padding:13px 17px;border:0;border-radius:10px;background:#2763c9;color:#fff;font:inherit;font-weight:750;cursor:pointer;margin-top:18px}
button.secondary{background:#273850;border:1px solid #4a607d}button:disabled{opacity:.45;cursor:not-allowed}
.status{white-space:pre-wrap;overflow-wrap:anywhere;background:#080f1b;border:1px solid #2b3e58;padding:14px;border-radius:10px;margin-top:16px;color:#b7c6d9}
.good{color:#9ce4b4}.bad{color:#ffaaa6}.small{font-size:13px;color:#97abc5}
a{color:#8bb7ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
@media(max-width:600px){body{padding:12px}main{padding:18px}}
</style>
</head>
<body><main>
<div class="eyebrow">Isolated staging only · M15 · no index writes</div>
<h1>Consumer answer & abstention evaluation</h1>
<p>Runs the original 17 fixed M15 queries against both staging retrieval providers, then passes each provider's verified retrieved excerpts through the existing consumer-owned Gemini generator. It uses one query per request and writes no result data to D1.</p>
<div class="notice">
<strong>Evaluation rules</strong>
<p class="small">P01–P12 must be source-grounded and correct. N01–N04 must abstain even when unrelated passages are retrieved. H01 is not an abstention case: the source must correct the sign and identify F_s = -kx. Retrieved passages with invalid source-page provenance are not sent to Gemini.</p>
</div>
<label for="token">M15 staging operator token</label>
<input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the staging operator token">
<div class="row"><button class="secondary" id="load" type="button">Load pinned eight-page source (read only)</button></div>
<label for="sourceId">Pinned source ID</label>
<input id="sourceId" type="text" readonly placeholder="Load the registered M15 source">
<div class="notice small">The model and location are inherited from the staging Worker configuration. The token is held only in page memory for this run, is not stored in browser storage, and is cleared after completion.</div>
<div class="row"><button id="run" type="button" disabled>Run all 17 queries · both providers · Gemini</button><a href="/admin/m15/benchmark" style="align-self:center;margin-top:18px">Back to M15 retrieval benchmark</a></div>
<div id="progress" class="status" role="status" aria-live="polite">No answer-generation calls have been made.</div>
<div id="summary" class="status" hidden></div>
<div class="row"><button class="secondary" id="downloadJson" type="button" disabled>Download JSON results</button><button class="secondary" id="downloadMarkdown" type="button" disabled>Download Markdown report</button></div>
<details style="margin-top:18px"><summary>What this run does and does not do</summary><p class="small">Read-only queries to the dedicated M15 AI Search instance and Qdrant collection. Each provider is evaluated independently with the same Gemini model, source-only prompt, response schema and deterministic answer rubric. The report includes full retrieved text, page provenance, generated answers, citations, grading checks and latencies. It does not change production provider selection, BRVIN v2 RPC, source OCR, manifests, index contents or D1 records. The deterministic rubric is a first-pass gate and does not replace final human review of nuanced prose.</p></details>
</main>
<script>
(() => {
 const ids=["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10","P11","P12","N01","N02","N03","N04","H01"];
 const tokenInput=document.getElementById("token"), sourceInput=document.getElementById("sourceId");
 const loadButton=document.getElementById("load"), runButton=document.getElementById("run");
 const progress=document.getElementById("progress"), summary=document.getElementById("summary");
 const jsonButton=document.getElementById("downloadJson"), mdButton=document.getElementById("downloadMarkdown");
 let latestReport=null;
 function refresh(){runButton.disabled=sourceInput.value.trim().length===0||tokenInput.value.trim().length<32;}
 tokenInput.addEventListener("input",refresh);
 async function request(path,method,secret,body){
   const response=await fetch(path,{method,headers:{"authorization":"Bearer "+secret,...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});
   let data;try{data=await response.json()}catch{throw new Error("Staging returned a non-JSON response (HTTP "+response.status+").")}
   if(!response.ok||data.ok!==true)throw new Error(data.error||data.message||("Staging request failed (HTTP "+response.status+")."));
   return data;
 }
 loadButton.addEventListener("click",async()=>{
   const secret=tokenInput.value.trim();tokenInput.value="";refresh();
   if(secret.length<32){progress.className="status bad";progress.textContent="Enter the staging operator token first.";return;}
   loadButton.disabled=true;progress.className="status";progress.textContent="Reading the registered source row (no source/index writes)…";
   try{
     const data=await request("/admin/m15/benchmark/answers/source","GET",secret);
     sourceInput.value=data.source.sourceId||data.source.source_id||"";
     progress.className="status good";progress.textContent="Pinned M15 source loaded: "+sourceInput.value+". Status: "+(data.source.status||"ready")+". Pages: "+(data.source.pageCount||data.source.page_count||8)+".";
   }catch(error){progress.className="status bad";progress.textContent=error.message;}
   finally{loadButton.disabled=false;refresh();}
 });
 function providerSummary(key,results){
   const rows=results.map(x=>x[key]||{});
   const evaluations=rows.map(x=>x.evaluation||{});
   const passed=rows.filter(x=>x.evaluation&&x.evaluation.overallPass).length;
   const latencies=rows.map(x=>x.generationLatencyMs).filter(x=>typeof x==="number").sort((a,b)=>a-b);
   const avg=latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length*100)/100:null;
   const negativeRows=results.filter(x=>/^N0[1-4]$/u.test(x.queryId)).map(x=>x[key]?.evaluation||{});
   return {queryCount:rows.length,overallPassCount:passed,failedQueryIds:results.filter((x,i)=>!rows[i].evaluation||!rows[i].evaluation.overallPass).map(x=>x.queryId),answerCorrectCount:evaluations.filter(x=>x.answerCorrectness&&x.answerCorrectness.passed).length,sourceGroundingCorrectCount:evaluations.filter(x=>x.sourceGroundingCorrectness).length,citationCorrectCount:evaluations.filter(x=>x.citationCorrectness).length,mathSymbolFidelityApplicableCount:evaluations.filter(x=>x.mathematicalSymbolFidelity!==null&&x.mathematicalSymbolFidelity!==undefined).length,mathSymbolFidelityPassCount:evaluations.filter(x=>x.mathematicalSymbolFidelity===true).length,abstentionApplicableCount:evaluations.filter(x=>x.abstentionCorrectness!==null&&x.abstentionCorrectness!==undefined).length,abstentionPassCount:evaluations.filter(x=>x.abstentionCorrectness===true).length,irrelevantEvidenceChallengeCount:negativeRows.length,irrelevantEvidenceResistancePassCount:negativeRows.filter(x=>x.irrelevantEvidenceResistanceDemonstrated===true).length,negativeQueriesWithoutRetrievedEvidence:negativeRows.filter(x=>x.irrelevantEvidenceResistanceDemonstrated===false).length,averageGenerationLatencyMs:avg,medianGenerationLatencyMs:latencies.length?latencies[Math.floor((latencies.length-1)/2)]:null};
 }
 function makeMarkdown(report){
   let out="# BRVIN M15 Consumer Answer & Abstention Evaluation\n\n";
   out+="Run: "+report.runAt+"\nSource: "+report.sourceId+"\nModel: "+report.model+" ("+report.location+")\nCompleted query pairs: "+report.results.length+"/17\n\n";
   for(const key of ["cloudflareAiSearch","qdrantVertex"]){
     const s=report.summary[key];out+="## "+key+"\n\n";
     out+="Pass: "+s.overallPassCount+"/"+s.queryCount+"; failed: "+(s.failedQueryIds.join(", ")||"none")+"; average generation latency: "+s.averageGenerationLatencyMs+" ms; median: "+s.medianGenerationLatencyMs+" ms.\n\n";
     out+="| Query | Evidence pages | Answer | Grounding | Citation | Math | Abstention | Irrelevant-evidence challenge | Generation ms | Pass | Failures |\\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\\n";
     for(const result of report.results){
       const p=result[key]||{},e=p.evaluation||{},pages=(p.retrievedPages||[]).filter(x=>x!==null).join(", ");
       const v=x=>x===null||x===undefined?"N/A":x?"PASS":"FAIL";
       out+="| "+result.queryId+" | "+pages+" | "+v(e.answerCorrectness&&e.answerCorrectness.passed)+" | "+v(e.sourceGroundingCorrectness)+" | "+v(e.citationCorrectness)+" | "+v(e.mathematicalSymbolFidelity)+" | "+v(e.abstentionCorrectness)+" | "+v(e.irrelevantEvidenceResistanceDemonstrated)+" | "+(p.generationLatencyMs??"N/A")+" | "+v(e.overallPass)+" | "+((e.failureCases||[]).join(", ")||"—")+" |\\n";
     }
     out+="\n";
     for(const result of report.results){
       const p=result[key]||{},e=p.evaluation||{};
       out+="### "+result.queryId+" · "+result.query+"\n\n";
       out+="**Retrieved evidence and pages**\n\n";
       for(const candidate of p.evidence||[]) out+="- Rank "+candidate.rank+", PDF p. "+candidate.pdfPage+", score "+candidate.score+", provenance "+candidate.provenanceValid+"\n\n"+candidate.text+"\n\n";
       out+="**Generated answer**\n\n"+(p.answerWithCitations||p.generationError||"No generated answer.")+"\n\n";
       out+="**Model-supplied page references:** "+((p.modelCitedPages||[]).join(", ")||"none")+". **Appended source-page citations:** "+((p.citedPages||[]).join(", ")||"none")+".\n\n";
       out+="**Evaluation**\n\n"+JSON.stringify(e,null,2)+"\n\n";
     }
   }
   return out;
 }
 function download(name,mime,value){
   const blob=new Blob([value],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 runButton.addEventListener("click",async()=>{
   let secret=tokenInput.value.trim();const sourceId=sourceInput.value.trim();tokenInput.value="";refresh();
   if(secret.length<32||!sourceId)return;
   runButton.disabled=true;loadButton.disabled=true;progress.className="status";progress.textContent="Starting paired retrieval and Gemini generation. Each query is processed once for each provider.";
   summary.hidden=true;jsonButton.disabled=true;mdButton.disabled=true;latestReport=null;
   const results=[];let requestFailure=null;
   for(let i=0;i<ids.length;i++){
     progress.textContent="Evaluating "+ids[i]+" ("+(i+1)+"/17). Two Gemini generations are being run against the same query.";
     try{
       const response=await request("/admin/m15/benchmark/answers/run","POST",secret,{sourceId,queryId:ids[i]});
       results.push(response.result);
     }catch(error){requestFailure=ids[i]+": "+error.message;break;}
   }
   const model=results.length?((results[0].cloudflareAiSearch||{}).model||"gemini-3.8-flash"):"gemini-3.8-flash";
   const location=results.length?((results[0].cloudflareAiSearch||{}).location||"global"):"global";
   const report={benchmark:"brvin-m15-consumer-answer-evaluation",runAt:new Date().toISOString(),sourceId,model,location,queryCount:17,completedQueryPairs:results.length,complete:results.length===17&&!requestFailure,requestFailure,results,summary:{cloudflareAiSearch:providerSummary("cloudflareAiSearch",results),qdrantVertex:providerSummary("qdrantVertex",results)}};
   latestReport=report;
   const summaryText=JSON.stringify(report.summary,null,2);
   summary.hidden=false;summary.className="status";summary.textContent=summaryText;
   jsonButton.disabled=results.length===0;mdButton.disabled=results.length===0;
   progress.className="status "+(report.complete?"good":"bad");
   progress.textContent=report.complete?"Completed all 17 paired queries. Review exact failed IDs and download both reports.":"Stopped after "+results.length+"/17 pairs. "+(requestFailure||"The run did not complete.");
   secret="";
   loadButton.disabled=false;refresh();
 });
 jsonButton.addEventListener("click",()=>{if(latestReport)download("brvin-m15-consumer-answer-evaluation.json","application/json",JSON.stringify(latestReport,null,2));});
 mdButton.addEventListener("click",()=>{if(latestReport)download("brvin-m15-consumer-answer-evaluation.md","text/markdown",makeMarkdown(latestReport));});
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

export async function handleM15BenchmarkStagingRequest(
  request: Request,
  env: M15BenchmarkStagingEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ ok: false, error: "m15_staging_benchmark_disabled" }, 404);
  }
  if (url.pathname === "/admin/m15/benchmark" && request.method === "GET") {
    return m15BenchmarkAdminPage();
  }
  if (url.pathname === "/admin/m15/benchmark/answers" && request.method === "GET") {
    return m15AnswerEvaluationPage();
  }
  if (url.pathname === "/admin/m15/benchmark/health" && request.method === "GET") {
    return json({
      ok: true,
      ready: Boolean(env.DB && env.BRVIN_M14_CORPUS_BUCKET && env.GCP_CLIENT_EMAIL &&
        env.GCP_PRIVATE_KEY && env.BRVIN_M14_VERTEX_LOCATION && env.BRVIN_M14_VERTEX_MODEL &&
        env.BRVIN_M14_EMBEDDING_DIMENSIONS && env.BRVIN_M14_QDRANT_URL &&
        env.BRVIN_M14_QDRANT_API_KEY && env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION &&
        env.BRVIN_M15_BENCHMARK_AI_SEARCH && env.BRVIN_M14_ADMIN_TOKEN),
      environment: env.ENVIRONMENT,
      sourceBucketIsStaging: Boolean(env.BRVIN_M14_CORPUS_BUCKET && env.BRVIN_M14_CORPUS_BUCKET !== env.FATMAN_GCS_BUCKET),
      separateAiSearchBound: Boolean(env.BRVIN_M15_BENCHMARK_AI_SEARCH),
      qdrantCollectionConfigured: Boolean(env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION),
      secretsConfigured: {
        m14AdminToken: Boolean(env.BRVIN_M14_ADMIN_TOKEN),
        gcpClientEmail: Boolean(env.GCP_CLIENT_EMAIL),
        gcpPrivateKey: Boolean(env.GCP_PRIVATE_KEY),
        qdrantApiKey: Boolean(env.BRVIN_M14_QDRANT_API_KEY),
      },
    });
  }

  if (!url.pathname.startsWith("/admin/m15/benchmark/source/") &&
      url.pathname !== "/admin/m15/benchmark/run" &&
      url.pathname !== "/admin/m15/benchmark/complete" &&
      url.pathname !== "/admin/m15/benchmark/answers/source" &&
      url.pathname !== "/admin/m15/benchmark/answers/run") {
    return json({ ok: false, error: "not_found" }, 404);
  }
  if (!["GET","POST"].includes(request.method)) return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!await authenticated(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB) return json({ ok: false, error: "staging_database_missing" }, 503);

  // Answer evaluation is intentionally read-only: no schema setup, D1 writes,
  // source mutation, or index mutation occurs on either answer endpoint.
  if (url.pathname === "/admin/m15/benchmark/answers/source" && request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT * FROM m15_benchmark_sources WHERE source_sha256 = ? LIMIT 1",
    ).bind(SOURCE_SHA256).first<M15BenchmarkSourceRow>();
    if (!row) return json({ ok: false, error: "registered_benchmark_source_not_found" }, 404);
    return json({ ok: true, source: publicSource(row) });
  }

  if (url.pathname === "/admin/m15/benchmark/answers/run" && request.method === "POST") {
    let answerBody: { sourceId?: unknown; queryId?: unknown };
    try { answerBody = await request.json() as { sourceId?: unknown; queryId?: unknown }; }
    catch { return json({ ok: false, error: "invalid_json" }, 400); }
    if (!validUuid(answerBody.sourceId)) return json({ ok: false, error: "invalid_source_id" }, 400);
    if (typeof answerBody.queryId !== "string" ||
        !M15_BENCHMARK_QUERY_SUITE.some((item) => item.id === answerBody.queryId)) {
      return json({ ok: false, error: "invalid_m15_query_id" }, 400);
    }
    const row = await getSource(env, answerBody.sourceId);
    if (!row) return json({ ok: false, error: "benchmark_source_not_found" }, 404);
    try {
      const result = await runM15AnswerEvaluationQuery(env, row, answerBody.queryId);
      return json({ ok: true, result });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  await ensureSchema(env);

  if (url.pathname === "/admin/m15/benchmark/source/upload" && request.method === "POST") {
    return uploadSource(request, env);
  }

  if (url.pathname === "/admin/m15/benchmark/source/recover" && request.method === "GET") {
    // This endpoint can recover only the one fingerprint-pinned M15 source.
    // It is authenticated and read-only; it never creates, uploads or re-indexes a source.
    const row = await env.DB.prepare(
      "SELECT * FROM m15_benchmark_sources WHERE source_sha256 = ? LIMIT 1",
    ).bind(SOURCE_SHA256).first<M15BenchmarkSourceRow>();
    if (!row) return json({ ok: false, error: "registered_benchmark_source_not_found" }, 404);
    return json({ ok: true, source: publicSource(row), recovered: true });
  }

  if (url.pathname === "/admin/m15/benchmark/source/status" && request.method === "GET") {
    const sourceId = url.searchParams.get("sourceId") ?? "";
    const row = await getSource(env, sourceId);
    if (!row) return json({ ok: false, error: "benchmark_source_not_found" }, 404);
    const vision = row.vision_operation ? await inspectVision(env, row) : undefined;
    const latest = await getSource(env, sourceId) ?? row;
    return json({ ok: true, source: publicSource(latest), ...(vision ? { vision } : {}) });
  }

  let body: { sourceId?: unknown; startIndex?: unknown; results?: unknown };
  try { body = await request.json() as { sourceId?: unknown; startIndex?: unknown; results?: unknown }; }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!validUuid(body.sourceId)) return json({ ok: false, error: "invalid_source_id" }, 400);
  const row = await getSource(env, body.sourceId);
  if (!row) return json({ ok: false, error: "benchmark_source_not_found" }, 404);

  try {
    if (url.pathname === "/admin/m15/benchmark/source/ocr" && request.method === "POST") {
      if (row.status !== "uploaded") return json({ ok: true, result: { sourceId: row.source_id, status: row.status, alreadyStarted: true } });
      return json({ ok: true, result: await startVision(env, row) });
    }
    if (url.pathname === "/admin/m15/benchmark/source/corpus" && request.method === "POST") {
      const result = await buildCorpus(env, row);
      const latest = await getSource(env, row.source_id);
      return json({ ok: true, result, source: latest ? publicSource(latest) : undefined });
    }
    if (url.pathname === "/admin/m15/benchmark/source/qdrant" && request.method === "POST") {
      const result = await indexQdrant(env, row);
      const latest = await getSource(env, row.source_id);
      return json({ ok: true, result, source: latest ? publicSource(latest) : undefined });
    }
    if (url.pathname === "/admin/m15/benchmark/source/ai-search" && request.method === "POST") {
      const result = await indexAiSearch(env, row);
      const latest = await getSource(env, row.source_id);
      return json({ ok: true, result, source: latest ? publicSource(latest) : undefined });
    }
    if (url.pathname === "/admin/m15/benchmark/run" && request.method === "POST") {
      if (typeof body.startIndex !== "number" || !Number.isSafeInteger(body.startIndex)) {
        return json({ ok: false, error: "invalid_benchmark_batch_cursor" }, 400);
      }
      const result = await runM15BenchmarkSourceShadow(env, row, body.startIndex);
      return json({ ok: true, result });
    }
    if (url.pathname === "/admin/m15/benchmark/complete" && request.method === "POST") {
      const result = buildM15BenchmarkReceipt(env, row, body.results);
      return json({ ok: true, result });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}
