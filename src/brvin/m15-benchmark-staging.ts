import type { AiSearchInstance, Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import {
  getFatmanVisionOperation,
  type FatmanImportJob,
  type FatmanVisionOcrPage,
} from "../fatman/import";
import { fatmanIndexPageKey } from "../fatman/library";
import { persistBrvinPageCorpus } from "./corpus-store";
import { readBrvinCorpusGeneration } from "./corpus-reader";
import { indexBrvinCorpusGeneration } from "./m14-pilot-runner";
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
    "generation_id TEXT, qdrant_point_count INTEGER NOT NULL DEFAULT 0, ai_search_indexed_pages INTEGER NOT NULL DEFAULT 0, " +
    "error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
  ).run();
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
  const nearMiss = results.filter((item) => item.category === "exact-symbol-near-miss");
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
    expectedPageTargets: expectedPages,
    coveredExpectedPageTargets: coveredPages,
    expectedPageCoverageRate: expectedPages ? coveredPages / expectedPages : 0,
    allExpectedPagesCovered: expectedPages > 0 && coveredPages === expectedPages,
    expectedPageCandidateCount: expectedPageCandidates,
    positivePageLabelPrecisionAt5: positiveSlots ? expectedPageCandidates / positiveSlots : 0,
    allSuitePageLabelPrecisionAt5: allSlots ? expectedPageCandidates / allSlots : 0,
    // Presence is not a relevance judgment. These fields deliberately avoid calling all nearest neighbours false positives.
    outOfCorpusQueryCount: noMatch.length,
    outOfCorpusQueriesWithCandidates: noMatch.filter((item) => item.result.resultCount > 0).length,
    outOfCorpusCandidatePresenceRate: noMatch.length
      ? noMatch.filter((item) => item.result.resultCount > 0).length / noMatch.length
      : 0,
    outOfCorpusCandidateCount: noMatch.reduce((sum, item) => sum + item.result.resultCount, 0),
    exactSymbolNearMissCount: nearMiss.length,
    exactSymbolNearMissWithCandidates: nearMiss.filter((item) => item.result.resultCount > 0).length,
    exactSymbolNearMissCandidateCount: nearMiss.reduce((sum, item) => sum + item.result.resultCount, 0),
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
  if (row.status !== "corpus_ready" && row.status !== "qdrant_ready" && row.status !== "ai_search_ready") {
    throw new Error("Build and verify the eight-page corpus before Qdrant indexing.");
  }
  const corpus = await getVerifiedCorpus(env, row);
  const pilot = await createQdrantPilot(env, BENCHMARK_QDRANT_COLLECTION);
  await pilot.ensureCollection();
  const indexed = await indexBrvinCorpusGeneration(pilot, row.project_id, corpus);
  if (indexed.sourceId !== row.source_id || indexed.pageCount !== SOURCE_PAGE_COUNT ||
      indexed.pointCount !== indexed.chunkCount || indexed.pointCount < SOURCE_PAGE_COUNT ||
      new Set(indexed.pointIds).size !== indexed.pointCount) {
    throw new Error("Qdrant did not confirm every deterministic benchmark point.");
  }
  await env.DB.prepare(
    "UPDATE m15_benchmark_sources SET qdrant_point_count = ?, status = CASE WHEN ai_search_indexed_pages = ? THEN 'ready' ELSE 'qdrant_ready' END, error_message = NULL, updated_at = ? WHERE source_id = ?",
  ).bind(indexed.pointCount, SOURCE_PAGE_COUNT, Date.now(), row.source_id).run();
  return {
    sourceId: indexed.sourceId,
    projectId: row.project_id,
    generationId: indexed.generationId,
    collection: BENCHMARK_QDRANT_COLLECTION,
    pageCount: indexed.pageCount,
    chunkCount: indexed.chunkCount,
    pointCount: indexed.pointCount,
    embeddingModelIds: indexed.embeddingModelIds,
    embeddingModelVersions: indexed.embeddingModelVersions,
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
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
  let uploaded = 0;
  for (const page of pages) {
    const key = page.stableItemKey;
    if (!key.startsWith(sourcePrefix(row.source_id))) {
      throw new Error("A source page key escaped the exact M15 source prefix; AI Search indexing was stopped.");
    }
    await search.items.uploadAndPoll(key, page.rawOcrText, {
      metadata: {
        source_id: row.source_id,
        project_id: row.project_id,
        pdf_page: page.pdfPage,
        benchmark: "brvin-m15-physics-v1",
      },
      pollIntervalMs: 1000,
      timeoutMs: 120000,
    });
    uploaded += 1;
    await env.DB.prepare(
      "UPDATE m15_benchmark_sources SET ai_search_indexed_pages = ?, status = 'ai_search_indexing', updated_at = ? WHERE source_id = ?",
    ).bind(uploaded, Date.now(), row.source_id).run();
  }
  const listing = await search.items.list({ per_page: 50 });
  const matching = (listing.result ?? []).filter((item) => item.key?.startsWith(sourcePrefix(row.source_id)));
  if (matching.length !== SOURCE_PAGE_COUNT || matching.some((item) => item.status !== "completed")) {
    throw new Error("The isolated AI Search instance did not confirm all eight source-page text items as completed.");
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
    };
  }
}

export async function runM15BenchmarkSourceShadow(
  env: M15BenchmarkStagingEnv,
  source: M15BenchmarkSourceRow,
): Promise<Record<string, unknown>> {
  if (!env.BRVIN_M15_BENCHMARK_AI_SEARCH) throw new Error("The separate M15 staging AI Search binding is missing.");
  if (source.status !== "ready" || source.page_count !== SOURCE_PAGE_COUNT ||
      source.indexed_pages !== SOURCE_PAGE_COUNT ||
      source.ai_search_indexed_pages !== SOURCE_PAGE_COUNT || source.qdrant_point_count < SOURCE_PAGE_COUNT) {
    throw new Error("Both isolated staging indexes must be READY for all eight physical pages before paired evaluation.");
  }
  const pilot = await createQdrantPilot(env, BENCHMARK_QDRANT_COLLECTION);
  const results: M15ShadowQueryResult[] = [];
  for (const item of M15_BENCHMARK_QUERY_SUITE) {
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
    interpretation: "This is a 17-query retrieval-only benchmark. Positive expected-page metrics are page-label proxies, not independent passage qrels. Candidate presence on N01-N04 and H01 is not automatically a false positive: reviewers must grade returned passages against the source. H01 is a separate exact-symbol near-miss because the source contains the opposite restoring-force sign. Qdrant RRF scores are ranking values, not confidence probabilities. The benchmark does not invoke Gemini answer generation or prove answer abstention. The paired evaluation performs search/query calls only and has zero index side effects.",
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
  const buttons = Object.fromEntries(["upload","ocr","status","corpus","qdrant","aisearch","benchmark"].map(id=>[id,document.getElementById(id)]));
  let sourceStatus = "";
  function refresh() {
    const authReady = token.value.trim().length >= 32;
    const hasSource = /^[0-9a-f-]{36}$/i.test(sourceId.value.trim());
    buttons.upload.disabled = !authReady || !file.files.length;
    buttons.ocr.disabled = !authReady || !hasSource || !ocrConfirm.checked || sourceStatus !== "uploaded";
    buttons.status.disabled = !authReady || !hasSource;
    buttons.corpus.disabled = !authReady || !hasSource || sourceStatus !== "ocr_completed";
    buttons.qdrant.disabled = !authReady || !hasSource || !["corpus_ready","qdrant_ready","ai_search_ready","ready"].includes(sourceStatus);
    buttons.aisearch.disabled = !authReady || !hasSource || !["corpus_ready","qdrant_ready","ai_search_ready","ai_search_indexing","ready"].includes(sourceStatus);
    buttons.benchmark.disabled = !authReady || !hasSource || sourceStatus !== "ready";
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
      if(data.source?.sourceId){sourceId.value=data.source.sourceId;sourceStatus=data.source.status;sessionStorage.setItem("brvinM15BenchmarkSourceId",sourceId.value);}
      if(data.sourceId&&!sourceId.value){sourceId.value=data.sourceId;sessionStorage.setItem("brvinM15BenchmarkSourceId",sourceId.value);}
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
  buttons.corpus.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/corpus","POST",{sourceId:sourceId.value},"Validating all eight Vision JSON files, persisting immutable page manifests/chunks, and reading them back for hash and page-provenance verification.");
  });
  buttons.qdrant.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/qdrant","POST",{sourceId:sourceId.value},"Creating/verifying the dedicated Qdrant collection and indexing deterministic Vertex-embedded chunks. This is a staging index write.");
  });
  buttons.aisearch.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/source/ai-search","POST",{sourceId:sourceId.value},"Uploading the eight stored OCR page texts to the separate M15 AI Search staging instance. This does not use the production AI Search instance.");
  });
  buttons.benchmark.addEventListener("click",async()=>{
    await call("/admin/m15/benchmark/run","POST",{sourceId:sourceId.value},"Running the 17 fixed query cases against both staging indexes. This action performs query/search only and does not modify either index.");
  });
  const saved=sessionStorage.getItem("brvinM15BenchmarkSourceId");
  if(saved&&/^[0-9a-f-]{36}$/i.test(saved)){sourceId.value=saved;refresh();}
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
      url.pathname !== "/admin/m15/benchmark/run") {
    return json({ ok: false, error: "not_found" }, 404);
  }
  if (!["GET","POST"].includes(request.method)) return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!await authenticated(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB) return json({ ok: false, error: "staging_database_missing" }, 503);
  await ensureSchema(env);

  if (url.pathname === "/admin/m15/benchmark/source/upload" && request.method === "POST") {
    return uploadSource(request, env);
  }

  if (url.pathname === "/admin/m15/benchmark/source/status" && request.method === "GET") {
    const sourceId = url.searchParams.get("sourceId") ?? "";
    const row = await getSource(env, sourceId);
    if (!row) return json({ ok: false, error: "benchmark_source_not_found" }, 404);
    const vision = row.vision_operation ? await inspectVision(env, row) : undefined;
    const latest = await getSource(env, sourceId) ?? row;
    return json({ ok: true, source: publicSource(latest), ...(vision ? { vision } : {}) });
  }

  let body: { sourceId?: unknown };
  try { body = await request.json() as { sourceId?: unknown }; }
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
      const result = await runM15BenchmarkSourceShadow(env, row);
      return json({ ok: true, result });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}
