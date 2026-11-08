import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import type {
  FatmanImportJob,
  FatmanVisionOcrPage,
} from "../fatman/import";
import {
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
  getFatmanVisionOperation,
  listFatmanVisionOutputObjects,
} from "../fatman/import";
import {
  backfillBrvinM14CorpusFromStoredVision,
  type BrvinM14VisionBackfillResult,
} from "./m14-vision-backfill";

const PILOT_SOURCE_ID = "01238b3a-9902-4a42-90b4-574048ee4f00";
const PILOT_SOURCE_SHA256 = "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c";
const PILOT_VISION_OPERATION = "projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2";
const PILOT_PAGE_COUNT = 3;
const MAX_VISION_PAGE_TEXT_CHARS = 1_000_000;

interface M14RegistryRecord {
  source_id: string;
  source_object: string;
  source_sha256: string;
  expected_size: number;
  uploaded_bytes: number;
  status: string;
  vision_operation: string;
  indexed_pages: number;
  book_id: string;
  book_title: string;
  page_count: number;
  created_at: number;
  updated_at: number;
}

export interface M14StagingWorkerEnv extends Env {
  BRVIN_M14_ADMIN_TOKEN?: string;
}

type BackfillFunction = (
  env: Env,
  spec: {
    sourceId: string;
    sourcePdfSha256: string;
    visionOperationId: string;
    pageCount: number;
  },
  dependencies?: never,
) => Promise<BrvinM14VisionBackfillResult>;

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

function equalSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown backfill failure.";
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 300);
}

async function getRegisteredPhysicsJob(env: Env, sourceId: string): Promise<FatmanImportJob | null> {
  if (!env.DB) throw new Error("The isolated M14 staging D1 registry is not bound.");
  const row = await env.DB.prepare(
    "SELECT source_id, source_object, source_sha256, expected_size, uploaded_bytes, status, " +
    "vision_operation, indexed_pages, book_id, book_title, page_count, created_at, updated_at " +
    "FROM m14_source_registry WHERE source_id = ? LIMIT 1",
  ).bind(sourceId).first<M14RegistryRecord>();
  if (!row) return null;
  return {
    id: row.source_id,
    source_object: row.source_object,
    source_sha256: row.source_sha256,
    expected_size: Number(row.expected_size),
    uploaded_bytes: Number(row.uploaded_bytes),
    upload_session_uri: null,
    status: row.status,
    vision_operation: row.vision_operation,
    workflow_instance_id: null,
    indexed_pages: Number(row.indexed_pages),
    error_message: null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    book_id: row.book_id,
    book_title: row.book_title,
    page_count: Number(row.page_count),
  };
}

async function readStoredVisionPage(
  env: Env,
  sourceId: string,
  page: number,
): Promise<FatmanVisionOcrPage> {
  const job = await getRegisteredPhysicsJob(env, sourceId);
  if (!job) throw new Error("The Physics source is not registered in the isolated staging D1 registry.");
  const objectName = fatmanOutputObjectName(
    sourceId,
    page,
    fatmanVisionOutputPrefix(job),
  );
  const bucket = env.FATMAN_GCS_BUCKET?.trim();
  if (!bucket) throw new Error("The original source/Vision GCS bucket is not configured on the M14 staging Worker.");
  const token = await getGoogleAccessToken(env);
  const url = "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?alt=media";
  const response = await fetch(url, {
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("Could not read the original stored Vision OCR for PDF page " + page +
      " (HTTP " + response.status + ").");
  }
  const payload = await response.json() as {
    responses?: Array<{
      fullTextAnnotation?: {
        text?: string;
        pages?: Array<{ confidence?: number }>;
      };
      error?: { message?: string };
    }>;
    context?: { pageNumber?: number };
  };
  if (payload.context?.pageNumber && Number(payload.context.pageNumber) !== page) {
    throw new Error("The saved Vision OCR object does not match requested physical PDF page " + page + ".");
  }
  const annotation = payload.responses?.[0];
  if (annotation?.error?.message) {
    throw new Error("Saved Vision OCR reports an error on physical PDF page " + page + ".");
  }
  const rawText = annotation?.fullTextAnnotation?.text;
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Saved Vision OCR contains no readable text for physical PDF page " + page + ".");
  }
  if (rawText.length > MAX_VISION_PAGE_TEXT_CHARS) {
    throw new Error("Saved Vision OCR page " + page + " exceeds the one-million-character manifest limit.");
  }
  const confidence = annotation.fullTextAnnotation?.pages?.[0]?.confidence;
  return {
    rawText,
    ...(typeof confidence === "number" && Number.isFinite(confidence) &&
      confidence >= 0 && confidence <= 1 ? { pageConfidence: confidence } : {}),
  };
}

export async function handleM14StagingRequest(
  request: Request,
  env: M14StagingWorkerEnv,
  runBackfill: typeof backfillBrvinM14CorpusFromStoredVision = backfillBrvinM14CorpusFromStoredVision,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return json({
      ok: true,
      app: "parmar-ai-m14-staging",
      environment: env.ENVIRONMENT ?? "unset",
      pilotEnabled: env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() === "true",
      sourceRegistryBound: Boolean(env.DB),
      secretsConfigured: {
        gcpClientEmail: Boolean(env.GCP_CLIENT_EMAIL),
        gcpPrivateKey: Boolean(env.GCP_PRIVATE_KEY),
        m14AdminToken: Boolean(env.BRVIN_M14_ADMIN_TOKEN),
      },
      // Do not expose credential values, bucket names or source-document content.
    });
  }

  if (url.pathname !== "/admin/m14/backfill") return json({ ok: false, error: "not_found" }, 404);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ ok: false, error: "m14_staging_pilot_disabled" }, 404);
  }
  const configuredToken = env.BRVIN_M14_ADMIN_TOKEN?.trim() ?? "";
  if (configuredToken.length < 32) {
    return json({ ok: false, error: "m14_operator_secret_not_configured" }, 503);
  }
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!equalSecret(suppliedToken, configuredToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!payload || typeof payload !== "object" ||
      (payload as { confirmSourceId?: unknown }).confirmSourceId !== PILOT_SOURCE_ID) {
    return json({ ok: false, error: "source_confirmation_mismatch" }, 400);
  }

  if (!env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.GCP_PROJECT_ID || !env.FATMAN_GCS_BUCKET ||
      !env.BRVIN_M14_CORPUS_BUCKET) {
    return json({ ok: false, error: "staging_google_cloud_configuration_incomplete" }, 503);
  }

  try {
    const result = await runBackfill(env, {
      sourceId: PILOT_SOURCE_ID,
      sourcePdfSha256: PILOT_SOURCE_SHA256,
      visionOperationId: PILOT_VISION_OPERATION,
      pageCount: PILOT_PAGE_COUNT,
    }, {
      getJob: getRegisteredPhysicsJob,
      getVisionOperation: getFatmanVisionOperation,
      listVisionObjects: listFatmanVisionOutputObjects,
      readVisionPage: readStoredVisionPage,
    } as never);
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export default {
  async fetch(request: Request, env: M14StagingWorkerEnv): Promise<Response> {
    return handleM14StagingRequest(request, env);
  },
};
