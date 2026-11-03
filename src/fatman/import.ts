import type { Env } from "../config/env";
import { ensureAnalyticsSchema, getFatmanBookState, setFatmanBookState } from "../analytics/db";
import { getGoogleAccessToken } from "../auth/google";
import { json } from "../http/response";

export const FATMAN_IMPORT_PAGES = 538;
export const FATMAN_IMPORT_SHA256 = "8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886";
const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const GCS_API = "https://storage.googleapis.com";
const VISION_API = "https://vision.googleapis.com/v1";

export interface FatmanImportJob {
  id: string;
  source_object: string;
  source_sha256: string;
  expected_size: number;
  uploaded_bytes: number;
  upload_session_uri: string | null;
  status: "uploading" | "uploaded" | "processing" | "completed" | "failed" | string;
  vision_operation: string | null;
  workflow_instance_id: string | null;
  indexed_pages: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

function bucket(env: Env): string {
  const value = env.FATMAN_GCS_BUCKET?.trim();
  if (!value || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)) {
    throw new Error("Fatman OCR bucket is not configured on the Worker.");
  }
  return value;
}

function validId(value: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(value);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll("\r", " ").replaceAll("\n", " ").slice(0, 240);
}

export async function getFatmanImportJob(env: Env, id: string): Promise<FatmanImportJob | null> {
  if (!env.DB) throw new Error("D1 is required for Fatman imports.");
  await ensureAnalyticsSchema(env);
  return env.DB.prepare("SELECT * FROM fatman_import_jobs WHERE id = ?").bind(id).first<FatmanImportJob>();
}

export async function setFatmanImportStatus(
  env: Env,
  id: string,
  status: string,
  values: { visionOperation?: string | null; workflowInstanceId?: string | null; indexedPages?: number; errorMessage?: string | null } = {},
): Promise<void> {
  if (!env.DB) throw new Error("D1 is required for Fatman imports.");
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    "UPDATE fatman_import_jobs SET status = ?, vision_operation = COALESCE(?, vision_operation), " +
    "workflow_instance_id = COALESCE(?, workflow_instance_id), indexed_pages = COALESCE(?, indexed_pages), " +
    "error_message = ?, updated_at = ? WHERE id = ?"
  ).bind(status, values.visionOperation ?? null, values.workflowInstanceId ?? null, values.indexedPages ?? null,
    values.errorMessage ?? null, Date.now(), id).run();
}

export async function fatmanUploadStatus(env: Env, id?: string | null, includeLivePipelineStatus = false): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "D1 is required for Fatman imports." }, 503);
  if (id && !validId(id)) return json({ ok: false, error: "invalid_import_id" }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const job = id && validId(id)
      ? await getFatmanImportJob(env, id)
      : await env.DB.prepare("SELECT * FROM fatman_import_jobs ORDER BY created_at DESC LIMIT 1").first<FatmanImportJob>();
    let pipeline: { vision: Record<string, unknown>; workflow: Record<string, unknown> } | undefined;
    if (includeLivePipelineStatus) {
      const vision: Record<string, unknown> = job?.vision_operation
        ? { status: "unknown", operation: job.vision_operation }
        : { status: "not_started" };
      const workflow: Record<string, unknown> = job?.workflow_instance_id
        ? { status: "unknown", id: job.workflow_instance_id }
        : { status: "not_started" };
      if (job?.vision_operation && job.status !== "completed") {
        try {
          const result = await getFatmanVisionOperation(env, job.vision_operation);
          vision.status = result.done ? "completed" : "running";
          if (result.error) vision.error = result.error;
        } catch (error) {
          vision.status = "unknown";
          vision.error = safeError(error);
        }
      } else if (job?.vision_operation && job.status === "completed") {
        vision.status = "completed";
      }
      if (job?.workflow_instance_id && env.FATMAN_IMPORT) {
        try {
          const instance = await env.FATMAN_IMPORT.get(job.workflow_instance_id);
          const result = await instance.status();
          workflow.status = result.status;
          if (result.error?.message) workflow.error = safeError(result.error.message);
        } catch (error) {
          workflow.status = "unknown";
          workflow.error = safeError(error);
        }
      }
      pipeline = { vision, workflow };
    }
    return json({
      ok: true,
      import: job ? {
        id: job.id,
        status: job.status,
        expectedSize: Number(job.expected_size),
        uploadedBytes: Number(job.uploaded_bytes),
        indexedPages: Number(job.indexed_pages),
        expectedPages: FATMAN_IMPORT_PAGES,
        hasVisionOperation: Boolean(job.vision_operation),
        workflowInstanceId: job.workflow_instance_id ?? null,
        createdAt: Number(job.created_at),
        canResume: job.status === "failed" && Boolean(job.vision_operation) &&
          Number(job.uploaded_bytes) === Number(job.expected_size),
        error: job.error_message ?? undefined,
        updatedAt: Number(job.updated_at),
      } : null,
      serviceAccountEmail: env.GCP_CLIENT_EMAIL?.trim() || null,
      bucketConfigured: Boolean(env.FATMAN_GCS_BUCKET?.trim()),
      ...(pipeline ? { pipeline } : {}),
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

async function gcsError(response: Response, fallback: string): Promise<Error> {
  const text = (await response.text().catch(() => "")).slice(0, 800);
  let detail = "";
  try {
    const data = JSON.parse(text) as { error?: { message?: string } };
    detail = data.error?.message ?? "";
  } catch {
    detail = text.replace(/\s+/gu, " ").trim();
  }
  return new Error(detail ? fallback + " " + detail : fallback + " (HTTP " + response.status + ").");
}

async function probeUploadSession(sessionUri: string, expectedSize: number, token: string): Promise<number> {
  const response = await fetch(sessionUri, {
    method: "PUT",
    headers: { authorization: "Bearer " + token, "content-range": "bytes */" + expectedSize },
    body: new Uint8Array(),
  });
  if (response.status === 200 || response.status === 201) return expectedSize;
  if (response.status !== 308) throw await gcsError(response, "Could not resume the Google Cloud Storage upload.");
  const range = response.headers.get("range");
  if (!range) return 0;
  const match = range.match(/bytes=0-(\d+)/u);
  return match ? Math.min(expectedSize, Number(match[1]) + 1) : 0;
}

export async function startFatmanUpload(env: Env, request: Request): Promise<Response> {
  if (!env.DB || !env.FATMAN_SEARCH || !env.FATMAN_IMPORT) {
    return json({ ok: false, error: "Fatman import storage, database, search, or Workflow is not configured." }, 503);
  }
  let body: { sha256?: unknown; size?: unknown; quotaConfirmed?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toUpperCase() : "";
  const size = Number(body.size);
  if (sha256 !== FATMAN_IMPORT_SHA256) return json({ ok: false, error: "This is not the reviewed Fatman PDF." }, 400);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PDF_BYTES) {
    return json({ ok: false, error: "PDF size must be between 1 byte and 1 GB." }, 413);
  }
  if (body.quotaConfirmed !== true) {
    return json({ ok: false, error: "Confirm that at least 538 free Vision OCR units remain before importing." }, 400);
  }
  if (!env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim() || !env.GCP_PROJECT_ID?.trim()) {
    return json({ ok: false, error: "Google Cloud service account credentials are not configured on the Worker." }, 503);
  }
  try {
    const bucketName = bucket(env);
    await ensureAnalyticsSchema(env);
    const latest = await env.DB!.prepare(
      "SELECT * FROM fatman_import_jobs WHERE source_sha256 = ? AND expected_size = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(sha256, size).first<FatmanImportJob>();

    if (latest && (latest.status === "uploaded" || latest.status === "processing" || latest.status === "completed")) {
      return json({ ok: true, importId: latest.id, status: latest.status, uploadedBytes: Number(latest.uploaded_bytes), expectedSize: size });
    }
    if (latest?.status === "uploading" && latest.upload_session_uri) {
      const token = await getGoogleAccessToken(env);
      try {
        const uploadedBytes = await probeUploadSession(latest.upload_session_uri, size, token);
        const status = uploadedBytes === size ? "uploaded" : "uploading";
        await env.DB!.prepare("UPDATE fatman_import_jobs SET uploaded_bytes = ?, status = ?, updated_at = ? WHERE id = ?")
          .bind(uploadedBytes, status, Date.now(), latest.id).run();
        return json({ ok: true, importId: latest.id, status, uploadedBytes, expectedSize: size });
      } catch (error) {
        const message = safeError(error);
        if (!/HTTP 404|HTTP 410|not found|expired/iu.test(message)) throw error;
        await env.DB!.prepare("UPDATE fatman_import_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
          .bind("The resumable upload expired. Start again with the same PDF.", Date.now(), latest.id).run();
      }
    }
    if (latest?.status === "failed" && Number(latest.uploaded_bytes) === size) {
      await env.DB!.prepare("UPDATE fatman_import_jobs SET status = 'uploaded', error_message = NULL, updated_at = ? WHERE id = ?")
        .bind(Date.now(), latest.id).run();
      return json({ ok: true, importId: latest.id, status: "uploaded", uploadedBytes: size, expectedSize: size });
    }

    const id = crypto.randomUUID().toLowerCase();
    const objectName = "fatman/imports/" + id + "/source.pdf";
    const token = await getGoogleAccessToken(env);
    const response = await fetch(GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?uploadType=resumable&name=" + encodeURIComponent(objectName), {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": "application/pdf",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name: objectName, metadata: { sha256 } }),
    });
    if (!response.ok) throw await gcsError(response, "Could not start the private PDF upload.");
    const sessionUri = response.headers.get("location");
    if (!sessionUri || !sessionUri.startsWith("https://")) throw new Error("Google Cloud Storage did not return a resumable upload session.");
    await env.DB!.prepare(
      "INSERT INTO fatman_import_jobs (id, source_object, source_sha256, expected_size, uploaded_bytes, upload_session_uri, status, indexed_pages, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, 0, ?, 'uploading', 0, ?, ?)"
    ).bind(id, objectName, sha256, size, sessionUri, Date.now(), Date.now()).run();
    const state = await getFatmanBookState(env);
    await setFatmanBookState(env, { enabled: false, documentVersion: env.FATMAN_DOCUMENT_VERSION?.trim() ?? "", indexedPages: state.indexedPages });
    return json({ ok: true, importId: id, status: "uploading", uploadedBytes: 0, expectedSize: size });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function uploadFatmanChunk(env: Env, request: Request, importId: string): Promise<Response> {
  if (!validId(importId) || !env.DB) return json({ ok: false, error: "invalid_import_id" }, 400);
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job) return json({ ok: false, error: "import_not_found" }, 404);
    if (job.status !== "uploading" || !job.upload_session_uri) {
      return json({ ok: false, error: "import_not_receiving_chunks", status: job.status }, 409);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/octet-stream")) {
      return json({ ok: false, error: "application_octet_stream_required" }, 415);
    }
    const start = Number(request.headers.get("x-fatman-chunk-start"));
    const total = Number(request.headers.get("x-fatman-total-size"));
    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(start) || start < 0 || total !== Number(job.expected_size)) {
      return json({ ok: false, error: "invalid_chunk_range" }, 400);
    }
    if (Number.isFinite(declaredLength) && declaredLength > 8 * 1024 * 1024) {
      return json({ ok: false, error: "chunk_too_large" }, 413);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024 || start + bytes.byteLength > total) {
      return json({ ok: false, error: "chunk_size_out_of_range" }, 413);
    }
    const token = await getGoogleAccessToken(env);
    const remoteOffset = await probeUploadSession(job.upload_session_uri, total, token);
    if (remoteOffset === total) {
      await env.DB!.prepare("UPDATE fatman_import_jobs SET uploaded_bytes = ?, status = 'uploaded', updated_at = ? WHERE id = ?")
        .bind(total, Date.now(), importId).run();
      return json({ ok: true, uploadedBytes: total, status: "uploaded" });
    }
    if (start !== remoteOffset) return json({ ok: false, error: "upload_offset_mismatch", uploadedBytes: remoteOffset }, 409);
    const end = start + bytes.byteLength - 1;
    const response = await fetch(job.upload_session_uri, {
      method: "PUT",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/pdf",
        "content-range": "bytes " + start + "-" + end + "/" + total,
      },
      body: bytes,
    });
    let uploadedBytes: number;
    let status = "uploading";
    if (response.status === 200 || response.status === 201) {
      uploadedBytes = total;
      status = "uploaded";
    } else if (response.status === 308) {
      const range = response.headers.get("range");
      const match = range?.match(/bytes=0-(\d+)/u);
      uploadedBytes = match ? Math.min(total, Number(match[1]) + 1) : 0;
    } else {
      throw await gcsError(response, "Google Cloud Storage rejected an upload chunk.");
    }
    await env.DB!.prepare("UPDATE fatman_import_jobs SET uploaded_bytes = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(uploadedBytes, status, Date.now(), importId).run();
    return json({ ok: true, uploadedBytes, status });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function completeFatmanUpload(env: Env, importId: string): Promise<Response> {
  if (!validId(importId)) return json({ ok: false, error: "invalid_import_id" }, 400);
  const db = env.DB;
  const workflow = env.FATMAN_IMPORT;
  if (!db || !workflow) return json({ ok: false, error: "fatman_workflow_not_configured" }, 503);
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job) return json({ ok: false, error: "import_not_found" }, 404);
    if (job.status === "completed") {
      return json({ ok: true, status: job.status, importId, indexedPages: Number(job.indexed_pages) });
    }
    if (job.status === "processing") {
      if (!job.workflow_instance_id) return json({ ok: false, error: "workflow_instance_missing" }, 409);
      try {
        await workflow.get(job.workflow_instance_id);
      } catch {
        try {
          await workflow.create({ id: job.workflow_instance_id, params: { importId } });
        } catch (error) {
          return json({ ok: false, error: safeError(error) }, 502);
        }
      }
      return json({ ok: true, status: "processing", importId, indexedPages: Number(job.indexed_pages) });
    }
    if (job.status !== "uploaded" || Number(job.uploaded_bytes) !== Number(job.expected_size)) {
      return json({ ok: false, error: "pdf_upload_incomplete", uploadedBytes: Number(job.uploaded_bytes), expectedSize: Number(job.expected_size) }, 409);
    }
    const workflowId = importId + "-" + crypto.randomUUID().slice(0, 8);
    await db.prepare("UPDATE fatman_import_jobs SET status = 'processing', workflow_instance_id = ?, error_message = NULL, updated_at = ? WHERE id = ? AND status = 'uploaded'")
      .bind(workflowId, Date.now(), importId).run();
    const refreshed = await getFatmanImportJob(env, importId);
    if (refreshed?.status !== "processing" || refreshed.workflow_instance_id !== workflowId) {
      return json({ ok: true, status: refreshed?.status ?? "unknown", importId });
    }
    try {
      await workflow.create({ id: workflowId, params: { importId } });
    } catch (error) {
      try {
        await workflow.get(workflowId);
      } catch {
        await db.prepare("UPDATE fatman_import_jobs SET status = 'uploaded', workflow_instance_id = NULL, error_message = ?, updated_at = ? WHERE id = ? AND workflow_instance_id = ?")
          .bind(safeError(error), Date.now(), importId, workflowId).run();
        throw error;
      }
    }
    return json({ ok: true, status: "processing", importId });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function resumeFatmanImport(env: Env, importId: string): Promise<Response> {
  if (!validId(importId)) return json({ ok: false, error: "invalid_import_id" }, 400);
  const db = env.DB;
  const workflow = env.FATMAN_IMPORT;
  if (!db || !workflow) return json({ ok: false, error: "fatman_workflow_not_configured" }, 503);
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job) return json({ ok: false, error: "import_not_found" }, 404);
    if (job.status !== "failed" || !job.vision_operation ||
        Number(job.uploaded_bytes) !== Number(job.expected_size)) {
      return json({ ok: false, error: "This import has no complete saved OCR result to resume." }, 409);
    }

    const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    const workflowId = importId + "-" + runId + "-resume";
    await db.prepare(
      "UPDATE fatman_import_jobs SET status = 'processing', workflow_instance_id = ?, error_message = NULL, updated_at = ? " +
      "WHERE id = ? AND status = 'failed' AND vision_operation IS NOT NULL AND uploaded_bytes = expected_size"
    ).bind(workflowId, Date.now(), importId).run();
    const refreshed = await getFatmanImportJob(env, importId);
    if (refreshed?.status !== "processing" || refreshed.workflow_instance_id !== workflowId) {
      return json({ ok: true, status: refreshed?.status ?? "unknown", importId });
    }

    try {
      await workflow.create({ id: workflowId, params: { task: "resume_index", importId, runId } });
    } catch (error) {
      try {
        await workflow.get(workflowId);
      } catch {
        await db.prepare(
          "UPDATE fatman_import_jobs SET status = 'failed', error_message = ?, updated_at = ? " +
          "WHERE id = ? AND workflow_instance_id = ?"
        ).bind(safeError(error), Date.now(), importId, workflowId).run();
        throw error;
      }
    }
    return json({ ok: true, status: "processing", importId, indexedPages: Number(job.indexed_pages) });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function startFatmanImportWorkflow(env: Env, importId: string, workflowId: string): Promise<void> {
  if (!env.FATMAN_IMPORT) throw new Error("Fatman Workflow binding is missing.");
  await env.FATMAN_IMPORT.create({ id: workflowId, params: { importId } });
}

export function gcsBucketName(env: Env): string {
  return bucket(env);
}

export function fatmanOutputObjectName(importId: string, page: number): string {
  return "fatman/imports/" + importId + "/ocr/output-" + page + "-to-" + page + ".json";
}

export async function readFatmanVisionOutput(env: Env, importId: string, page: number): Promise<string> {
  const job = await getFatmanImportJob(env, importId);
  if (!job) throw new Error("Fatman import job disappeared.");
  const objectName = fatmanOutputObjectName(importId, page);
  const token = await getGoogleAccessToken(env);
  const response = await fetch(GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName) + "?alt=media", {
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) throw await gcsError(response, "Could not read Vision OCR output for page " + page + ".");
  const payload = await response.json() as { responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>; context?: { pageNumber?: number } };
  if (payload.context?.pageNumber && Number(payload.context.pageNumber) !== page) {
    throw new Error("Google Vision returned OCR for an unexpected PDF page.");
  }
  const annotation = payload.responses?.[0];
  if (annotation?.error?.message) throw new Error("Vision OCR failed on PDF page " + page + ": " + annotation.error.message);
  const text = annotation?.fullTextAnnotation?.text?.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("Google Vision returned no readable text for PDF page " + page + ".");
  return text.slice(0, 120_000);
}

export async function submitFatmanVision(env: Env, importId: string): Promise<string> {
  const job = await getFatmanImportJob(env, importId);
  if (!job) throw new Error("Fatman import job not found.");
  if (job.vision_operation) return job.vision_operation;
  const request = {
    requests: [{
      inputConfig: { gcsSource: { uri: "gs://" + bucket(env) + "/" + job.source_object }, mimeType: "application/pdf" },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      outputConfig: { gcsDestination: { uri: "gs://" + bucket(env) + "/fatman/imports/" + importId + "/ocr/" }, batchSize: 1 },
    }],
  };
  const token = await getGoogleAccessToken(env);
  const response = await fetch(VISION_API + "/files:asyncBatchAnnotate", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await gcsError(response, "Could not start Google Vision PDF OCR.");
  const data = await response.json() as { name?: string };
  if (!data.name) throw new Error("Google Vision did not return an OCR operation ID.");
  await setFatmanImportStatus(env, importId, "processing", { visionOperation: data.name, errorMessage: null });
  return data.name;
}

export async function getFatmanVisionOperation(env: Env, operationName: string): Promise<{ done: boolean; error?: string }> {
  const token = await getGoogleAccessToken(env);
  const response = await fetch(VISION_API + "/" + operationName, {
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) throw await gcsError(response, "Could not check Google Vision OCR progress.");
  const data = await response.json() as { done?: boolean; error?: { message?: string } };
  if (data.error?.message) throw new Error("Google Vision OCR failed: " + data.error.message);
  return { done: data.done === true };
}

export async function cleanupFatmanGcsObjects(env: Env, importId: string): Promise<string[]> {
  const bucketName = bucket(env);
  const token = await getGoogleAccessToken(env);
  const prefix = "fatman/imports/" + importId + "/";
  let pageToken = "";
  const objectNames: string[] = [];
  do {
    const query = new URLSearchParams({ prefix, maxResults: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?" + query.toString(), {
      headers: { authorization: "Bearer " + token },
    });
    if (!response.ok) throw await gcsError(response, "Could not list temporary OCR objects for cleanup.");
    const data = await response.json() as { items?: Array<{ name: string }>; nextPageToken?: string };
    objectNames.push(...(data.items ?? []).map((item) => item.name));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return objectNames;
}

export async function updateFatmanImportProgress(env: Env, indexedPages: number): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare("UPDATE fatman_import_jobs SET indexed_pages = ?, updated_at = ? WHERE status = 'processing'")
    .bind(indexedPages, Date.now()).run();
  const state = await getFatmanBookState(env);
  await setFatmanBookState(env, {
    enabled: false,
    documentVersion: env.FATMAN_DOCUMENT_VERSION?.trim() ?? "",
    indexedPages: Math.max(state.indexedPages, indexedPages),
  });
}

export async function markFatmanImportFailed(env: Env, importId: string, error: unknown): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare("UPDATE fatman_import_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
    .bind(safeError(error), Date.now(), importId).run();
}

export async function markFatmanImportCompleted(env: Env, importId: string): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare("UPDATE fatman_import_jobs SET status = 'completed', indexed_pages = ?, error_message = NULL, updated_at = ? WHERE id = ?")
    .bind(FATMAN_IMPORT_PAGES, Date.now(), importId).run();
  const state = await getFatmanBookState(env);
  await setFatmanBookState(env, { enabled: false, documentVersion: env.FATMAN_DOCUMENT_VERSION?.trim() ?? "", indexedPages: FATMAN_IMPORT_PAGES });
}

export async function listFatmanIndexPages(env: Env): Promise<Array<{ page: number; status: string; error?: string }>> {
  if (!env.FATMAN_SEARCH || !env.FATMAN_INSTANCE_NAME?.trim()) throw new Error("Fatman AI Search is not configured.");
  const instance = env.FATMAN_SEARCH.get(env.FATMAN_INSTANCE_NAME.trim());
  const results: Array<{ page: number; status: string; error?: string }> = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const response = await instance.items.list({ page, per_page: 50, source: "builtin" });
    for (const item of response.result ?? []) {
      const match = item.key.match(/^fatman\/pages\/page-(\d{1,6})\.txt$/u);
      if (!match) continue;
      const pageNumber = Number(match[1]);
      if (pageNumber < 1 || pageNumber > FATMAN_IMPORT_PAGES) continue;
      const existing = results.find((candidate) => candidate.page === pageNumber);
      const candidate = { page: pageNumber, status: item.status, error: item.error ? safeError(item.error) : undefined };
      if (!existing || statusPriority(candidate.status) > statusPriority(existing.status)) {
        if (existing) results.splice(results.indexOf(existing), 1);
        results.push(candidate);
      }
    }
    totalPages = Number(response.result_info?.total_pages ?? page);
    page += 1;
  }
  return results.sort((a, b) => a.page - b.page);
}

function statusPriority(status: string): number {
  if (status === "completed") return 5;
  if (status === "queued" || status === "running") return 4;
  if (status === "error" || status === "skipped" || status === "outdated") return 3;
  return 0;
}
