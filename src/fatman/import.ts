import type { Env } from "../config/env";
import { ensureAnalyticsSchema, getFatmanBookState, recordBrvinActivity, setFatmanBookState } from "../analytics/db";
import { getGoogleAccessToken } from "../auth/google";
import { json } from "../http/response";
import { nextAiSearchPage } from "./pagination";
import { fatmanExpectedPageCount, fatmanIndexPagePrefix, parseFatmanIndexPageKey } from "./library";

export const FATMAN_IMPORT_PAGES = 538;
export const FATMAN_IMPORT_SHA256 = "8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886";
const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const GCS_API = "https://storage.googleapis.com";
const VISION_API = "https://vision.googleapis.com/v1";
const BRVIN_SOURCE_PDF_ROOT = "brvin/source-pdfs/";
const BRVIN_TEMP_VISION_OCR_ROOT = "brvin/temporary-vision-ocr/";
const BRVIN_TEMP_VISION_OCR_RETENTION_DAYS = 30;

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
  book_id?: string | null;
  book_title?: string | null;
  page_count?: number | null;
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
  await env.DB.prepare(
    "UPDATE fatman_books SET status = ?, indexed_pages = COALESCE((SELECT indexed_pages FROM fatman_import_jobs WHERE id = ?), indexed_pages), " +
    "error_message = ?, updated_at = ? WHERE id = ?"
  ).bind(status, id, values.errorMessage ?? null, Date.now(), id).run();
  await env.DB.prepare(
    "UPDATE brvin_books SET status = ?, indexed_pages = COALESCE((SELECT indexed_pages FROM fatman_import_jobs WHERE id = ?), indexed_pages), " +
    "error_message = ?, updated_at = ? WHERE id = ?"
  ).bind(status, id, values.errorMessage ?? null, Date.now(), id).run();
  const eventJob = await getFatmanImportJob(env, id);
  if (eventJob?.book_id) {
    await recordBrvinActivity(env, {
      importId: id, bookId: eventJob.book_id, agent: "Workflow supervisor",
      phase: status === "processing" ? "processing" : "job",
      eventType: "job.status_changed", status,
      message: status === "processing" ? "The background processing workflow is active." : "Import status changed to " + status + ".",
      details: { indexedPages: Number(eventJob.indexed_pages), pageCount: fatmanExpectedPageCount(eventJob) },
    }).catch(() => undefined);
  }
}

export async function fatmanUploadStatus(env: Env, id?: string | null, includeLivePipelineStatus = false): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "D1 is required for Fatman imports." }, 503);
  if (id && !validId(id)) return json({ ok: false, error: "invalid_import_id" }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const job = id && validId(id)
      ? await getFatmanImportJob(env, id)
      : await env.DB.prepare("SELECT * FROM fatman_import_jobs WHERE book_id IS NULL ORDER BY created_at DESC LIMIT 1").first<FatmanImportJob>();
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
        expectedPages: fatmanExpectedPageCount(job),
        bookId: job.book_id ?? null,
        bookTitle: job.book_title ?? null,
        isLibraryBook: Boolean(job.book_id),
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

/**
 * Read-only production diagnostic for the reusable BRVIN upload path.
 * Does not create, overwrite, or delete any GCS objects.
 * It also does not update bucket rules or metadata.
 */
export async function diagnoseFatmanGcsUpload(env: Env): Promise<Response> {
  const checks: Record<string, unknown> = {
    bucketConfigured: Boolean(env.FATMAN_GCS_BUCKET?.trim()),
    serviceAccountConfigured: Boolean(env.GCP_CLIENT_EMAIL?.trim() && env.GCP_PRIVATE_KEY?.trim()),
    projectConfigured: Boolean(env.GCP_PROJECT_ID?.trim()),
  };
  let stage = "configuration";
  try {
    const bucketName = bucket(env);
    stage = "google_oauth";
    const token = await getGoogleAccessToken(env);
    checks.oauth = { ok: true };

    stage = "gcs_bucket_metadata";
    const metadataResponse = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "?fields=name,location,storageClass,projectNumber,lifecycle",
      { headers: { authorization: "Bearer " + token } },
    );
    const metadataText = await metadataResponse.text();
    let metadata: {
      name?: string;
      location?: string;
      storageClass?: string;
      projectNumber?: string;
      lifecycle?: { rule?: Array<{ action?: { type?: string }; condition?: { age?: number; matchesPrefix?: string[] } }> };
      error?: { message?: string };
    } = {};
    try { metadata = JSON.parse(metadataText) as typeof metadata; } catch { /* report HTTP status only */ }
    checks.bucket = metadataResponse.ok
      ? { ok: true, name: metadata.name ?? bucketName, location: metadata.location ?? null, storageClass: metadata.storageClass ?? null, projectNumber: metadata.projectNumber ?? null }
      : { ok: false, status: metadataResponse.status, error: metadata.error?.message ?? metadataText.slice(0, 240) };

    const lifecycleRules = metadata.lifecycle?.rule ?? [];
    const unsafeDeleteRules = lifecycleRules.filter((rule) => {
      if (rule.action?.type !== "Delete") return false;
      const prefixes = rule.condition?.matchesPrefix ?? [];
      return !prefixes.length || prefixes.some((value) => isUnsafeFatmanVisionLifecycleDeletePrefix(String(value)));
    });
    const matchingLifecycleRule = lifecycleRules.find((rule) =>
      rule.action?.type === "Delete" &&
      (rule.condition?.matchesPrefix ?? []).includes(BRVIN_TEMP_VISION_OCR_ROOT) &&
      Number(rule.condition?.age ?? Number.MAX_SAFE_INTEGER) <= BRVIN_TEMP_VISION_OCR_RETENTION_DAYS
    );
    const lifecycleRuleStatus = !metadataResponse.ok
      ? "not_verified"
      : unsafeDeleteRules.length
        ? "blocked_unsafe_delete_rule"
        : matchingLifecycleRule
          ? "installed"
          : "missing";
    const configuredLifecycleAgeDays = matchingLifecycleRule?.condition?.age ?? null;
    checks.lifecycleRule = {
      status: lifecycleRuleStatus,
      prefix: BRVIN_TEMP_VISION_OCR_ROOT,
      requiredMaxAgeDays: BRVIN_TEMP_VISION_OCR_RETENTION_DAYS,
      configuredAgeDays: configuredLifecycleAgeDays,
      unsafeDeleteRuleCount: unsafeDeleteRules.length,
    };

    stage = "gcs_object_permissions";
    const permissionUrl = new URL(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "/iam/testPermissions",
    );
    for (const permission of [
      "storage.objects.create",
      "storage.objects.get",
      "storage.objects.list",
      "storage.objects.delete",
      "storage.buckets.get",
      "storage.buckets.update",
    ]) permissionUrl.searchParams.append("permissions", permission);
    const permissionResponse = await fetch(permissionUrl, {
      headers: { authorization: "Bearer " + token },
    });
    const permissionText = await permissionResponse.text();
    let permissionData: { permissions?: string[]; error?: { message?: string } } = {};
    try { permissionData = JSON.parse(permissionText) as typeof permissionData; } catch { /* report HTTP status only */ }
    const granted = permissionData.permissions ?? [];
    const requiredObjectPermissions = ["storage.objects.create", "storage.objects.get", "storage.objects.list", "storage.objects.delete"];
    const missingObjectPermissions = requiredObjectPermissions.filter(permission => !granted.includes(permission));
    const lifecycleRuleGetGranted = granted.includes("storage.buckets.get");
    const lifecycleRuleUpdateGranted = granted.includes("storage.buckets.update");
    const lifecycleRuleManagementGranted = lifecycleRuleGetGranted && lifecycleRuleUpdateGranted;
    const coreObjectPermissionsPassed = permissionResponse.ok && missingObjectPermissions.length === 0;
    checks.permissions = permissionResponse.ok
      ? {
          ok: coreObjectPermissionsPassed,
          granted,
          requiredObjectPermissions,
          missingObjectPermissions,
          lifecycleRuleGetGranted,
          lifecycleRuleUpdateGranted,
          lifecycleRuleManagementGranted,
          lifecycleMissingPermissions: [
            ...(!lifecycleRuleGetGranted ? ["storage.buckets.get"] : []),
            ...(!lifecycleRuleUpdateGranted ? ["storage.buckets.update"] : []),
          ],
        }
      : { ok: false, status: permissionResponse.status, error: permissionData.error?.message ?? permissionText.slice(0, 240) };

    const lifecyclePermissionsReady = metadataResponse.ok && permissionResponse.ok && lifecycleRuleManagementGranted;
    const lifecycleRuleInstalled = lifecycleRuleStatus === "installed";
    return json({
      ok: coreObjectPermissionsPassed,
      stage: "complete",
      bucketName,
      serviceAccountEmail: env.GCP_CLIENT_EMAIL?.trim() || null,
      checks,
      uploadStartReady: coreObjectPermissionsPassed,
      retentionLifecycleReady: lifecyclePermissionsReady && lifecycleRuleInstalled,
      retentionLifecyclePermissionsReady: lifecyclePermissionsReady,
      retentionLifecycleRule: {
        status: lifecycleRuleStatus,
        prefix: BRVIN_TEMP_VISION_OCR_ROOT,
        requiredMaxAgeDays: BRVIN_TEMP_VISION_OCR_RETENTION_DAYS,
        configuredAgeDays: configuredLifecycleAgeDays,
      },
      retentionLifecycleMissingPermissions: [
        ...(!lifecycleRuleGetGranted ? ["storage.buckets.get"] : []),
        ...(!lifecycleRuleUpdateGranted ? ["storage.buckets.update"] : []),
      ],
      note: !metadataResponse.ok
        ? "Bucket metadata and lifecycle rules could not be read. Permission availability alone is not proof that the 30-day rule is installed."
        : lifecycleRuleStatus === "blocked_unsafe_delete_rule"
          ? "An existing Delete rule may overlap source PDFs. BRVIN will not alter lifecycle rules until a Google Cloud administrator reviews it."
          : lifecycleRuleStatus === "missing"
            ? "The exact 30-day OCR-prefix lifecycle rule is not installed. The scheduled retention supervisor will attempt to add it safely."
            : lifecycleRuleStatus === "not_verified"
              ? "The lifecycle rule could not be verified."
              : "The exact OCR-prefix lifecycle rule is installed. This diagnostic is read-only and does not modify bucket settings.",
    });
  } catch (error) {
    checks.failure = safeError(error);
    return json({ ok: false, stage, checks, error: safeError(error) }, 502);
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

/** Starts the reusable multi-book importer. The legacy 538-page hash-locked endpoint remains separate. */
export async function startFatmanLibraryUpload(env: Env, request: Request): Promise<Response> {
  if (!env.DB || !env.FATMAN_SEARCH || !env.FATMAN_IMPORT) {
    return json({ ok: false, error: "The book processing service is not fully configured. Contact the administrator." }, 503);
  }
  let body: { title?: unknown; filename?: unknown; sha256?: unknown; size?: unknown; pageCount?: unknown; costConfirmed?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ ok: false, error: "The upload details could not be read. Please try again." }, 400);
  }
  const title = typeof body.title === "string" ? body.title.replace(/\s+/gu, " ").trim().slice(0, 160) : "";
  const filenameRaw = typeof body.filename === "string" ? body.filename.trim() : "";
  const filename = filenameRaw.split(/[\\/]/u).pop()?.slice(0, 255) ?? "";
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toUpperCase() : "";
  const size = Number(body.size);
  const pageCount = Number(body.pageCount);
  if (!title) return json({ ok: false, error: "Enter a name for this book." }, 400);
  if (!/^[A-F0-9]{64}$/u.test(sha256)) return json({ ok: false, error: "The PDF fingerprint is invalid. Select the PDF again." }, 400);
  if (!Number.isSafeInteger(size) || size < 8 || size > MAX_PDF_BYTES) {
    return json({ ok: false, error: "Choose a PDF between 8 bytes and 1 GB." }, 413);
  }
  if (!filename || filename.length > 255) return json({ ok: false, error: "The PDF file name is invalid." }, 400);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 2_000) {
    return json({ ok: false, error: "This PDF must contain between 1 and 2,000 pages." }, 400);
  }
  if (body.costConfirmed !== true) {
    return json({ ok: false, error: "Confirm that you understand Google Cloud OCR may incur usage charges." }, 400);
  }
  if (!env.GCP_CLIENT_EMAIL?.trim() || !env.GCP_PRIVATE_KEY?.trim() || !env.GCP_PROJECT_ID?.trim()) {
    return json({ ok: false, error: "The secure PDF reader is not configured. Contact the administrator." }, 503);
  }

  try {
    const bucketName = bucket(env);
    await ensureAnalyticsSchema(env);
    const latest = await env.DB.prepare(
      "SELECT * FROM fatman_import_jobs WHERE source_sha256 = ? AND expected_size = ? AND book_id IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ).bind(sha256, size).first<FatmanImportJob>();

    if (latest && (latest.status === "uploaded" || latest.status === "processing" || latest.status === "completed")) {
      return json({
        ok: true, importId: latest.id, status: latest.status,
        uploadedBytes: Number(latest.uploaded_bytes), expectedSize: Number(latest.expected_size),
        expectedPages: fatmanExpectedPageCount(latest), bookTitle: latest.book_title ?? title,
      });
    }
    if (latest?.status === "uploading" && latest.upload_session_uri) {
      const token = await getGoogleAccessToken(env);
      try {
        const uploadedBytes = await probeUploadSession(latest.upload_session_uri, size, token);
        const status = uploadedBytes === size ? "uploaded" : "uploading";
        await env.DB.prepare("UPDATE fatman_import_jobs SET uploaded_bytes = ?, status = ?, updated_at = ? WHERE id = ?")
          .bind(uploadedBytes, status, Date.now(), latest.id).run();
        await env.DB.prepare("UPDATE fatman_books SET status = ?, updated_at = ? WHERE id = ?")
          .bind(status, Date.now(), latest.id).run();
        return json({
          ok: true, importId: latest.id, status, uploadedBytes, expectedSize: size,
          expectedPages: fatmanExpectedPageCount(latest), bookTitle: latest.book_title ?? title,
        });
      } catch (error) {
        const message = safeError(error);
        if (!/HTTP 404|HTTP 410|not found|expired/iu.test(message)) throw error;
        await env.DB.prepare("UPDATE fatman_import_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
          .bind("The previous secure upload expired. Select the same PDF to start a fresh transfer.", Date.now(), latest.id).run();
        await env.DB.prepare("UPDATE fatman_books SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
          .bind("The previous secure upload expired.", Date.now(), latest.id).run();
      }
    }
    if (latest?.status === "failed" && latest.vision_operation &&
        Number(latest.uploaded_bytes) === Number(latest.expected_size)) {
      return json({
        ok: true, importId: latest.id, status: "failed",
        uploadedBytes: Number(latest.uploaded_bytes), expectedSize: size,
        expectedPages: fatmanExpectedPageCount(latest), bookTitle: latest.book_title ?? title,
        canResume: true,
      });
    }

    const id = crypto.randomUUID().toLowerCase();
    const objectName = BRVIN_SOURCE_PDF_ROOT + id + "/source.pdf";
    const token = await getGoogleAccessToken(env);
    const response = await fetch(GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?uploadType=resumable&name=" + encodeURIComponent(objectName), {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": "application/pdf",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({
        name: objectName,
        metadata: { sha256, bookId: id, bookTitle: title, pageCount: String(pageCount), sourceFilename: filename },
      }),
    });
    if (!response.ok) throw await gcsError(response, "Could not start the secure PDF upload.");
    const sessionUri = response.headers.get("location");
    if (!sessionUri || !sessionUri.startsWith("https://")) throw new Error("Google Cloud Storage did not return a secure resumable upload session.");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO fatman_import_jobs (id, source_object, source_sha256, expected_size, uploaded_bytes, upload_session_uri, status, indexed_pages, created_at, updated_at, book_id, book_title, page_count) " +
        "VALUES (?, ?, ?, ?, 0, ?, 'uploading', 0, ?, ?, ?, ?, ?)"
      ).bind(id, objectName, sha256, size, sessionUri, now, now, id, title, pageCount),
      env.DB.prepare(
        "INSERT INTO fatman_books (id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'uploading', 0, ?, ?)"
      ).bind(id, title, filename, sha256, size, pageCount, now, now),
      env.DB.prepare(
        "INSERT INTO brvin_books (id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, collection_id, search_prefix, source_type, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'uploading', 0, 'general', ?, 'pdf', ?, ?)"
      ).bind(id, title, filename, sha256, size, pageCount, "brvin/books/" + id + "/pages/", now, now),
    ]);
    return json({ ok: true, importId: id, status: "uploading", uploadedBytes: 0, expectedSize: size, expectedPages: pageCount, bookTitle: title });
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
    if (job.book_id) {
      await env.DB!.prepare("UPDATE brvin_books SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, Date.now(), job.book_id).run();
      const previousMilestone = Math.floor(Number(job.uploaded_bytes) / Number(job.expected_size) * 20);
      const currentMilestone = Math.floor(uploadedBytes / total * 20);
      if (status === "uploaded" || currentMilestone > previousMilestone) {
        await recordBrvinActivity(env, {
          importId, bookId: job.book_id, agent: "Secure upload",
          phase: "upload", eventType: status === "uploaded" ? "upload.completed" : "upload.progress",
          status: status === "uploaded" ? "completed" : "running",
          message: status === "uploaded" ? "The PDF was transferred to private object storage." : "Secure PDF upload reached " + Math.floor(uploadedBytes / total * 100) + "%.",
          details: { uploadedBytes, expectedBytes: total, percent: Math.floor(uploadedBytes / total * 100) },
        }).catch(() => undefined);
      }
    }
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
    await db.prepare("UPDATE fatman_books SET status = 'processing', error_message = NULL, updated_at = ? WHERE id = (SELECT book_id FROM fatman_import_jobs WHERE id = ?)")
      .bind(Date.now(), importId).run();
    const refreshed = await getFatmanImportJob(env, importId);
    if (refreshed?.status !== "processing" || refreshed.workflow_instance_id !== workflowId) {
      return json({ ok: true, status: refreshed?.status ?? "unknown", importId });
    }
    try {
      await workflow.create({ id: workflowId, params: { importId } });
      if (job.book_id) await recordBrvinActivity(env, {
        importId, bookId: job.book_id, agent: "Workflow orchestrator", phase: "workflow",
        eventType: "workflow.started", status: "running",
        message: "The automated OCR, indexing and quality pipeline has started.",
        details: { workflowId },
      }).catch(() => undefined);
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
    await db.prepare("UPDATE fatman_books SET status = 'processing', error_message = NULL, updated_at = ? WHERE id = (SELECT book_id FROM fatman_import_jobs WHERE id = ?)")
      .bind(Date.now(), importId).run();
    const refreshed = await getFatmanImportJob(env, importId);
    if (refreshed?.status !== "processing" || refreshed.workflow_instance_id !== workflowId) {
      return json({ ok: true, status: refreshed?.status ?? "unknown", importId });
    }

    try {
      await workflow.create({ id: workflowId, params: { task: "resume_index", importId, runId } });
      if (job.book_id) await recordBrvinActivity(env, {
        importId, bookId: job.book_id, agent: "Recovery supervisor", phase: "recovery",
        eventType: "workflow.resumed", status: "running",
        message: "The saved OCR result is being reused to resume indexing and verification.",
        details: { workflowId, indexedPages: Number(job.indexed_pages) },
      }).catch(() => undefined);
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

export function fatmanImportObjectPrefix(job: Pick<FatmanImportJob, "source_object">): string {
  const slash = job.source_object.lastIndexOf("/");
  if (slash < 1) throw new Error("The import source object path is invalid.");
  return job.source_object.slice(0, slash + 1);
}

/** New imports use a global temporary root; old imports keep their legacy OCR subfolder. */
export function fatmanVisionOutputPrefix(job: Pick<FatmanImportJob, "id" | "source_object">): string {
  const sourcePrefix = fatmanImportObjectPrefix(job);
  if (sourcePrefix === BRVIN_SOURCE_PDF_ROOT + job.id + "/") return BRVIN_TEMP_VISION_OCR_ROOT + job.id + "/";
  return sourcePrefix + "ocr/";
}

export function fatmanOutputObjectName(importId: string, page: number, prefix = "fatman/imports/" + importId + "/"): string {
  return prefix + "ocr/output-" + page + "-to-" + page + ".json";
}

export async function readFatmanVisionOutput(env: Env, importId: string, page: number): Promise<string> {
  const job = await getFatmanImportJob(env, importId);
  if (!job) throw new Error("Fatman import job disappeared.");
  const objectName = fatmanOutputObjectName(importId, page, fatmanVisionOutputPrefix(job));
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

/**
 * Keep OCR JSON under one global temporary prefix so Cloud Storage expiry can
 * never match the separately stored source PDF tree. Existing unrelated
 * lifecycle rules are preserved; broad Delete rules are rejected fail-closed.
 */
export function isUnsafeFatmanVisionLifecycleDeletePrefix(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return true;
  const sourceRoots = [
    "brvin/source-pdfs/",
    "brvin/imports/",
    "fatman/source-pdfs/",
    "fatman/imports/",
  ];
  const overlapsSource = sourceRoots.some((root) => candidate.startsWith(root) || root.startsWith(candidate));
  if (!overlapsSource) return false;
  const legacyImportRoots = ["brvin/imports/", "fatman/imports/"];
  const legacyOcrOnly = legacyImportRoots.some((root) => {
    if (!candidate.startsWith(root)) return false;
    const segments = candidate.slice(root.length).split("/").filter(Boolean);
    return segments.length >= 2 && segments[1] === "ocr";
  });
  return !legacyOcrOnly;
}
export async function ensureFatmanVisionLifecycleRule(env: Env): Promise<{ configured: true; created: boolean; prefix: string; ageDays: number }> {
  const bucketName = bucket(env);
  const token = await getGoogleAccessToken(env);
  const prefix = BRVIN_TEMP_VISION_OCR_ROOT;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const metadataUrl = new URL(GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName));
    metadataUrl.searchParams.set("fields", "name,metageneration,lifecycle");
    const metadataResponse = await fetch(metadataUrl, { headers: { authorization: "Bearer " + token } });
    if (!metadataResponse.ok) throw await gcsError(metadataResponse, "Could not inspect the bucket lifecycle configuration.");
    const metadata = await metadataResponse.json() as {
      metageneration?: string | number;
      lifecycle?: { rule?: Array<{ action?: { type?: string }; condition?: { age?: number; matchesPrefix?: string[] } }> };
    };
    const rules = metadata.lifecycle?.rule ?? [];
    const unsafeRule = rules.some((rule) => {
      if (rule.action?.type !== "Delete") return false;
      const prefixes = rule.condition?.matchesPrefix ?? [];
      if (!prefixes.length) return true;
      return prefixes.some((value) => isUnsafeFatmanVisionLifecycleDeletePrefix(String(value)));
    });
    if (unsafeRule) {
      throw new Error("An existing bucket Delete rule is broader than the temporary Vision OCR prefix. No lifecycle changes were made because it may include source PDFs.");
    }
    const hasSafeRule = rules.some((rule) => rule.action?.type === "Delete" &&
      (rule.condition?.matchesPrefix ?? []).includes(prefix) &&
      Number(rule.condition?.age ?? Number.MAX_SAFE_INTEGER) <= BRVIN_TEMP_VISION_OCR_RETENTION_DAYS);
    if (hasSafeRule) return { configured: true, created: false, prefix, ageDays: BRVIN_TEMP_VISION_OCR_RETENTION_DAYS };
    if (rules.length >= 1000) throw new Error("The bucket already has the maximum number of lifecycle rules.");
    const nextRules = [...rules, { action: { type: "Delete" }, condition: { age: BRVIN_TEMP_VISION_OCR_RETENTION_DAYS, matchesPrefix: [prefix] } }];
    const patchUrl = new URL(GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName));
    patchUrl.searchParams.set("fields", "name,metageneration,lifecycle");
    if (metadata.metageneration !== undefined) patchUrl.searchParams.set("ifMetagenerationMatch", String(metadata.metageneration));
    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ lifecycle: { rule: nextRules } }),
    });
    if (patchResponse.status === 412 && attempt === 0) continue;
    if (!patchResponse.ok) throw await gcsError(patchResponse, "Could not add the temporary Vision OCR lifecycle rule.");
    const updated = await patchResponse.json() as { lifecycle?: { rule?: Array<{ action?: { type?: string }; condition?: { age?: number; matchesPrefix?: string[] } }> } };
    const verified = (updated.lifecycle?.rule ?? nextRules).some((rule) => rule.action?.type === "Delete" &&
      (rule.condition?.matchesPrefix ?? []).includes(prefix) && Number(rule.condition?.age ?? 0) === BRVIN_TEMP_VISION_OCR_RETENTION_DAYS);
    if (!verified) throw new Error("The temporary Vision OCR lifecycle rule could not be verified after update.");
    return { configured: true, created: true, prefix, ageDays: BRVIN_TEMP_VISION_OCR_RETENTION_DAYS };
  }
  throw new Error("The bucket lifecycle configuration changed concurrently; retry the retention setup.");
}
export async function submitFatmanVision(env: Env, importId: string): Promise<string> {
  const job = await getFatmanImportJob(env, importId);
  if (!job) throw new Error("Fatman import job not found.");
  if (job.vision_operation) return job.vision_operation;
  if (job.book_id) {
    try {
      const lifecycle = await ensureFatmanVisionLifecycleRule(env);
      await recordBrvinActivity(env, {
        importId, bookId: job.book_id, agent: "Storage retention supervisor",
        phase: "retention", eventType: lifecycle.created ? "storage.vision_ocr_expiry_configured" : "storage.vision_ocr_expiry_verified",
        status: "completed",
        message: "Google Cloud Storage expiry is restricted to the dedicated temporary Vision OCR prefix. Source PDFs use a separate prefix and are not covered by this rule.",
        details: lifecycle,
      }).catch(() => undefined);
    } catch (error) {
      await recordBrvinActivity(env, {
        importId, bookId: job.book_id, agent: "Storage retention supervisor",
        phase: "retention", eventType: "storage.vision_ocr_expiry_configuration_deferred",
        status: "warning",
        message: "The temporary OCR expiry rule could not be applied. The book can still be processed; post-READY cleanup will remove its OCR files.",
        details: { error: safeError(error), targetPrefix: BRVIN_TEMP_VISION_OCR_ROOT },
      }).catch(() => undefined);
      if (error instanceof Error && error.message.includes("existing bucket Delete rule is broader")) throw error;
    }
  }
  const request = {
    requests: [{
      inputConfig: { gcsSource: { uri: "gs://" + bucket(env) + "/" + job.source_object }, mimeType: "application/pdf" },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      outputConfig: { gcsDestination: { uri: "gs://" + bucket(env) + "/" + fatmanVisionOutputPrefix(job) }, batchSize: 1 },
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
  if (job.book_id) await recordBrvinActivity(env, {
    importId, bookId: job.book_id, agent: "Vision OCR specialist", phase: "ocr",
    eventType: "ocr.submitted", status: "running",
    message: "Google Cloud Vision accepted the asynchronous PDF text-detection job.",
    details: { operation: data.name, pageCount: fatmanExpectedPageCount(job) },
  }).catch(() => undefined);
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
  const job = await getFatmanImportJob(env, importId);
  if (!job) throw new Error("Fatman import job not found during cleanup.");
  const prefix = fatmanImportObjectPrefix(job);
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

export interface FatmanGcsPrefixDeletionResult {
  prefix: string;
  objectVersionsFound: number;
  objectVersionsDeleted: number;
  versioningEnabled: boolean;
  softDeleteRetentionSeconds: number;
  retentionPolicySeconds: number;
  retentionPolicyLocked: boolean;
  softDeletedObjects: number;
  latestHardDeleteTime: string | null;
}

/**
 * Delete every generation of a BRVIN import's private GCS objects.
 * relativePrefix is intentionally constrained to "" (PDF + OCR) or "ocr/" (OCR only).
 * Google Cloud Storage soft-delete policies may retain deleted generations until
 * hardDeleteTime; the result reports that retention rather than claiming immediate erasure.
 */
export async function deleteFatmanGcsObjectPrefix(
  env: Env,
  importId: string,
  relativePrefix: "" | "ocr/" = "",
): Promise<FatmanGcsPrefixDeletionResult> {
  if (!env.DB) throw new Error("D1 is required to resolve the BRVIN source object prefix.");
  const importJob = await getFatmanImportJob(env, importId);
  if (!importJob?.book_id || importJob.book_id !== importId) {
    throw new Error("The BRVIN import registry does not match this deletion request.");
  }
  const rootPrefix = fatmanImportObjectPrefix(importJob);
  const allowedRoots = ["brvin/source-pdfs/" + importId + "/", "brvin/imports/" + importId + "/", "fatman/imports/" + importId + "/"];
  if (!allowedRoots.includes(rootPrefix)) {
    throw new Error("Refusing to delete a GCS prefix outside this book's private import directory.");
  }
  if (relativePrefix !== "" && relativePrefix !== "ocr/") {
    throw new Error("The requested GCS deletion prefix is not allowed.");
  }

  const bucketName = bucket(env);
  const token = await getGoogleAccessToken(env);
  const bucketResponse = await fetch(
    GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) +
    "?fields=name,versioning,softDeletePolicy,retentionPolicy",
    { headers: { authorization: "Bearer " + token } },
  );
  if (!bucketResponse.ok) throw await gcsError(bucketResponse, "Could not inspect the private BRVIN storage policy.");
  const bucketInfo = await bucketResponse.json() as {
    versioning?: { enabled?: boolean };
    softDeletePolicy?: { retentionDurationSeconds?: string | number };
    retentionPolicy?: { retentionPeriod?: string | number; isLocked?: boolean };
  };
  const versioningEnabled = bucketInfo.versioning?.enabled === true;
  const softDeleteRetentionSeconds = Math.max(0, Number(bucketInfo.softDeletePolicy?.retentionDurationSeconds ?? 0) || 0);
  const retentionPolicySeconds = Math.max(0, Number(bucketInfo.retentionPolicy?.retentionPeriod ?? 0) || 0);
  const retentionPolicyLocked = bucketInfo.retentionPolicy?.isLocked === true;
  const objectPrefix = relativePrefix === "ocr/" ? fatmanVisionOutputPrefix(importJob) : rootPrefix;
  const allowedVisionPrefixes = [rootPrefix + "ocr/", BRVIN_TEMP_VISION_OCR_ROOT + importId + "/"];
  if (relativePrefix === "ocr/" && !allowedVisionPrefixes.includes(objectPrefix)) {
    throw new Error("The Vision OCR prefix does not match this book's isolated temporary directory.");
  }

  const objects: Array<{ name: string; generation: string; noncurrent: boolean }> = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({
      prefix: objectPrefix,
      maxResults: "1000",
      versions: "true",
      fields: "items(name,generation,timeDeleted),nextPageToken",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?" + query.toString(),
      { headers: { authorization: "Bearer " + token } },
    );
    if (!response.ok) throw await gcsError(response, "Could not inventory private BRVIN source and OCR objects.");
    const data = await response.json() as {
      items?: Array<{ name?: string; generation?: string | number; timeDeleted?: string }>;
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      if (!item.name?.startsWith(objectPrefix) || item.generation === undefined) continue;
      objects.push({
        name: item.name,
        generation: String(item.generation),
        noncurrent: Boolean(item.timeDeleted),
      });
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  let objectVersionsDeleted = 0;
  for (const object of objects) {
    const query = new URLSearchParams();
    // With versioning enabled, delete each exact generation. If versioning is
    // now disabled but old noncurrent generations remain, delete those by
    // generation as well; delete the current generation by name so soft-delete
    // policy can retain it according to the bucket's configured behavior.
    if (versioningEnabled || object.noncurrent) query.set("generation", object.generation);
    const encodedQuery = query.toString();
    const suffix = encodedQuery ? "?" + encodedQuery : "";
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) +
      "/o/" + encodeURIComponent(object.name) + suffix,
      { method: "DELETE", headers: { authorization: "Bearer " + token } },
    );
    if (response.status === 404) continue;
    if (!response.ok) throw await gcsError(response, "Could not delete a private BRVIN source or Vision OCR object.");
    objectVersionsDeleted += 1;
  }

  let softDeletedObjects = 0;
  let latestHardDeleteTime: string | null = null;
  if (softDeleteRetentionSeconds > 0) {
    let softPageToken = "";
    do {
      const query = new URLSearchParams({
        prefix: objectPrefix,
        maxResults: "1000",
        softDeleted: "true",
        fields: "items(name,generation,hardDeleteTime),nextPageToken",
      });
      if (softPageToken) query.set("pageToken", softPageToken);
      const response = await fetch(
        GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?" + query.toString(),
        { headers: { authorization: "Bearer " + token } },
      );
      if (!response.ok) throw await gcsError(response, "Could not verify Google Cloud Storage soft-delete retention.");
      const data = await response.json() as {
        items?: Array<{ name?: string; hardDeleteTime?: string }>;
        nextPageToken?: string;
      };
      for (const item of data.items ?? []) {
        if (!item.name?.startsWith(objectPrefix)) continue;
        softDeletedObjects += 1;
        if (item.hardDeleteTime && (!latestHardDeleteTime || item.hardDeleteTime > latestHardDeleteTime)) {
          latestHardDeleteTime = item.hardDeleteTime;
        }
      }
      softPageToken = data.nextPageToken ?? "";
    } while (softPageToken);
  }

  // Verify that no live/noncurrent object generations remain under the exact book prefix.
  let remainingVersions = 0;
  let verifyPageToken = "";
  do {
    const query = new URLSearchParams({
      prefix: objectPrefix,
      maxResults: "1000",
      versions: "true",
      fields: "items(name,generation),nextPageToken",
    });
    if (verifyPageToken) query.set("pageToken", verifyPageToken);
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?" + query.toString(),
      { headers: { authorization: "Bearer " + token } },
    );
    if (!response.ok) throw await gcsError(response, "Could not verify BRVIN source and OCR object deletion.");
    const data = await response.json() as {
      items?: Array<{ name?: string }>;
      nextPageToken?: string;
    };
    remainingVersions += (data.items ?? []).filter(item => item.name?.startsWith(objectPrefix)).length;
    verifyPageToken = data.nextPageToken ?? "";
  } while (verifyPageToken);
  if (remainingVersions > 0) {
    throw new Error("Google Cloud Storage still lists " + remainingVersions + " live object versions under this book's private prefix.");
  }

  return {
    prefix: objectPrefix,
    objectVersionsFound: objects.length,
    objectVersionsDeleted,
    versioningEnabled,
    softDeleteRetentionSeconds,
    retentionPolicySeconds,
    retentionPolicyLocked,
    softDeletedObjects,
    latestHardDeleteTime,
  };
}

export async function updateFatmanImportProgress(env: Env, indexedPages: number, importId?: string): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  if (importId) {
    await env.DB.prepare("UPDATE fatman_import_jobs SET indexed_pages = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
      .bind(indexedPages, Date.now(), importId).run();
    const job = await getFatmanImportJob(env, importId);
    if (job?.book_id) {
      await env.DB.prepare("UPDATE fatman_books SET indexed_pages = ?, status = 'processing', updated_at = ? WHERE id = ?")
        .bind(indexedPages, Date.now(), job.book_id).run();
      await env.DB.prepare("UPDATE brvin_books SET indexed_pages = ?, status = 'processing', updated_at = ? WHERE id = ?")
        .bind(indexedPages, Date.now(), job.book_id).run();
      await recordBrvinActivity(env, {
        importId, bookId: job.book_id, agent: "Page indexing specialist", phase: "indexing",
        eventType: "index.progress", status: "running",
        message: "Page indexing progress: " + indexedPages + " of " + fatmanExpectedPageCount(job) + " pages.",
        details: { indexedPages, pageCount: fatmanExpectedPageCount(job), percent: Math.floor(indexedPages / fatmanExpectedPageCount(job) * 100) },
      }).catch(() => undefined);
      return;
    }
  } else {
    await env.DB.prepare("UPDATE fatman_import_jobs SET indexed_pages = ?, updated_at = ? WHERE status = 'processing' AND book_id IS NULL")
      .bind(indexedPages, Date.now()).run();
  }
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
  const message = safeError(error);
  await env.DB.prepare("UPDATE fatman_import_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
    .bind(message, Date.now(), importId).run();
  await env.DB.prepare("UPDATE fatman_books SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
    .bind(message, Date.now(), importId).run();
  await env.DB.prepare("UPDATE brvin_books SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
    .bind(message, Date.now(), importId).run();
  const job = await getFatmanImportJob(env, importId).catch(() => null);
  if (job?.book_id) await recordBrvinActivity(env, {
    importId, bookId: job.book_id, agent: "Recovery supervisor", phase: "processing",
    eventType: "workflow.failed", status: "failed",
    message: "Processing stopped: " + message,
  }).catch(() => undefined);
}

export async function markFatmanImportCompleted(env: Env, importId: string): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const job = await getFatmanImportJob(env, importId);
  const pageCount = job ? fatmanExpectedPageCount(job) : FATMAN_IMPORT_PAGES;
  await env.DB.prepare("UPDATE fatman_import_jobs SET status = 'completed', indexed_pages = ?, error_message = NULL, updated_at = ? WHERE id = ?")
    .bind(pageCount, Date.now(), importId).run();
  if (job?.book_id) {
    await env.DB.prepare("UPDATE fatman_books SET status = 'ready', indexed_pages = ?, error_message = NULL, updated_at = ? WHERE id = ?")
      .bind(pageCount, Date.now(), job.book_id).run();
    await env.DB.prepare("UPDATE brvin_books SET status = 'ready', indexed_pages = ?, error_message = NULL, updated_at = ? WHERE id = ?")
      .bind(pageCount, Date.now(), job.book_id).run();
    await recordBrvinActivity(env, {
      importId, bookId: job.book_id, agent: "Retrieval QA verifier", phase: "verification",
      eventType: "book.ready", status: "completed",
      message: "The book passed page-grounded retrieval verification and is ready for project assignment.",
      details: { indexedPages: pageCount },
    }).catch(() => undefined);
    return;
  }
  await getFatmanBookState(env);
  await setFatmanBookState(env, { enabled: false, documentVersion: env.FATMAN_DOCUMENT_VERSION?.trim() ?? "", indexedPages: pageCount });
}

export async function listFatmanIndexPages(env: Env, importId?: string): Promise<Array<{ page: number; status: string; error?: string }>> {
  if (!env.FATMAN_SEARCH || !env.FATMAN_INSTANCE_NAME?.trim()) throw new Error("Fatman AI Search is not configured.");
  const job = importId ? await getFatmanImportJob(env, importId) : null;
  const expectedPages = job ? fatmanExpectedPageCount(job) : FATMAN_IMPORT_PAGES;
  const prefix = job ? fatmanIndexPagePrefix(job) : "fatman/pages/";
  const instance = env.FATMAN_SEARCH.get(env.FATMAN_INSTANCE_NAME.trim());
  const results: Array<{ page: number; status: string; error?: string }> = [];
  let page = 1;
  while (page <= 100) {
    const response = await instance.items.list({ page, per_page: 50, search: prefix, source: "builtin" });
    for (const item of response.result ?? []) {
      if (!item.key.startsWith(prefix)) continue;
      const parsed = parseFatmanIndexPageKey(item.key);
      if (!parsed || parsed.page < 1 || parsed.page > expectedPages) continue;
      if (job?.book_id && parsed.bookId !== job.book_id) continue;
      const pageNumber = parsed.page;
      const existing = results.find((candidate) => candidate.page === pageNumber);
      const candidate = { page: pageNumber, status: item.status, error: item.error ? safeError(item.error) : undefined };
      if (!existing || statusPriority(candidate.status) > statusPriority(existing.status)) {
        if (existing) results.splice(results.indexOf(existing), 1);
        results.push(candidate);
      }
    }
    const nextPage = nextAiSearchPage(response, page, 50);
    if (nextPage === null) break;
    page = nextPage;
  }
  return results.sort((a, b) => a.page - b.page);
}

function statusPriority(status: string): number {
  if (status === "completed") return 5;
  if (status === "queued" || status === "running") return 4;
  if (status === "error" || status === "skipped" || status === "outdated") return 3;
  return 0;
}
