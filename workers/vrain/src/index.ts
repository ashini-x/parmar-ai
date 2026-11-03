import type { Env, VrainDocument, VrainPassage } from "./types";
import {
  createResumableUpload,
  getObjectMetadata,
  probeUploadSession,
  uploadChunk,
} from "./google";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();


function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 300);
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
}

function validId(value: string): boolean {
  return /^[a-f0-9-]{36}$/iu.test(value);
}

async function bodyJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new VrainHttpError(415, "content_type_must_be_application_json");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 64 * 1024) {
    throw new VrainHttpError(413, "request_body_too_large");
  }
  try {
    return await request.json() as T;
  } catch {
    throw new VrainHttpError(400, "invalid_json_body");
  }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  if (!request.body) throw new VrainHttpError(400, "upload_chunk_body_required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("VRAIN upload chunk exceeds the configured size limit");
        throw new VrainHttpError(413, "chunk_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

async function ownerOnly(request: Request, env: Env): Promise<boolean> {
  const expected = env.VRAIN_ADMIN_TOKEN?.trim();
  return Boolean(expected) && constantTimeEqual(bearer(request), expected!);
}

async function apiKeyProject(
  request: Request,
  env: Env,
  requiredScope: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const supplied = bearer(request);
  if (!supplied.startsWith("vrn_live_") || supplied.length > 160) return null;
  const hash = await sha256Hex(supplied);
  const row = await env.DB.prepare(
    "SELECT p.id,p.name,p.slug,k.id AS key_id,k.scopes_json " +
    "FROM vrain_api_keys k JOIN vrain_projects p ON p.id=k.project_id " +
    "WHERE k.secret_hash=? AND k.status='active' AND p.status='active' " +
    "AND (k.expires_at IS NULL OR k.expires_at>?) LIMIT 1",
  ).bind(hash, Date.now()).first<{
    id: string; name: string; slug: string; key_id: string; scopes_json: string;
  }>();
  if (!row) return null;
  let scopes: unknown;
  try { scopes = JSON.parse(row.scopes_json); } catch { return null; }
  if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) return null;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO vrain_api_usage_windows(key_id,window_started_at,request_count) VALUES (?,?,1) " +
    "ON CONFLICT(key_id) DO UPDATE SET " +
    "request_count=CASE WHEN vrain_api_usage_windows.window_started_at<=? THEN 1 ELSE vrain_api_usage_windows.request_count+1 END, " +
    "window_started_at=CASE WHEN vrain_api_usage_windows.window_started_at<=? THEN excluded.window_started_at ELSE vrain_api_usage_windows.window_started_at END",
  ).bind(row.key_id, now, now - 60_000, now - 60_000).run();
  const usage = await env.DB.prepare("SELECT request_count FROM vrain_api_usage_windows WHERE key_id=?")
    .bind(row.key_id).first<{ request_count: number }>();
  if (Number(usage?.request_count ?? 0) > 120) {
    throw new VrainHttpError(429, "api_key_rate_limit_exceeded_120_requests_per_minute");
  }
  await env.DB.prepare("UPDATE vrain_api_keys SET last_used_at=? WHERE id=?")
    .bind(now, row.key_id).run();
  return { id: row.id, name: row.name, slug: row.slug };
}

async function recordEvent(
  env: Env,
  input: {
    documentId?: string;
    projectId?: string;
    specialist: string;
    stage: string;
    type: string;
    status: string;
    message: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO vrain_activity_events (job_id,document_id,project_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    input.documentId ?? null,
    input.documentId ?? null,
    input.projectId ?? null,
    input.specialist,
    input.stage,
    input.type,
    input.status,
    input.message,
    JSON.stringify(input.details ?? {}),
    Date.now(),
  ).run();
}

async function adminCreateProject(request: Request, env: Env): Promise<Response> {
  const input = await bodyJson<{ name?: unknown; description?: unknown }>(request);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const slugBase = slugify(name);
  if (!name || !slugBase) return json({ ok: false, error: "project_name_required" }, 400);
  const slug = slugBase + "-" + crypto.randomUUID().slice(0, 8);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO vrain_projects (id,name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)",
  ).bind(id, name, slug, description, now, now).run();
  await env.DB.prepare(
    "INSERT INTO vrain_audit_log(actor,action,target_type,target_id,detail_json,created_at) VALUES ('owner','project.create','project',?,?,?)",
  ).bind(id, JSON.stringify({ name, slug }), now).run();
  return json({ ok: true, project: { id, name, slug, description, status: "active", createdAt: now } }, 201);
}

async function adminCreateCollection(request: Request, env: Env): Promise<Response> {
  const input = await bodyJson<{ name?: unknown; description?: unknown; language?: unknown }>(request);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  if (!name) return json({ ok: false, error: "collection_name_required" }, 400);
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const language = typeof input.language === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(input.language)
    ? input.language : "und";
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO vrain_collections(id,name,description,language,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)",
  ).bind(id, name, description, language, now, now).run();
  await env.DB.prepare(
    "INSERT INTO vrain_audit_log(actor,action,target_type,target_id,detail_json,created_at) VALUES ('owner','collection.create','collection',?,?,?)",
  ).bind(id, JSON.stringify({ name, language }), now).run();
  return json({ ok: true, collection: { id, name, description, language } }, 201);
}

async function adminCreateKey(request: Request, env: Env, projectId: string): Promise<Response> {
  if (!validId(projectId)) return json({ ok: false, error: "invalid_project_id" }, 400);
  const project = await env.DB.prepare("SELECT id,name,slug FROM vrain_projects WHERE id=? AND status='active'")
    .bind(projectId).first<{ id: string; name: string; slug: string }>();
  if (!project) return json({ ok: false, error: "project_not_found" }, 404);
  const input = await bodyJson<{ scopes?: unknown; expiresAt?: unknown }>(request);
  const requested = Array.isArray(input.scopes) ? input.scopes : ["knowledge:read"];
  const allowed = new Set(["knowledge:read"]);
  const scopes = [...new Set(requested.filter((scope): scope is string => typeof scope === "string" && allowed.has(scope)))];
  if (!scopes.length || scopes.length !== requested.length) {
    return json({ ok: false, error: "only_knowledge_read_scope_is_available_to_consumer_keys" }, 400);
  }
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null ? null : Number(input.expiresAt);
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) {
    return json({ ok: false, error: "expiresAt_must_be_a_future_unix_millisecond_timestamp" }, 400);
  }
  const secret = "vrn_live_" + base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  const hash = await sha256Hex(secret);
  const prefix = secret.slice(0, 17);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO vrain_api_keys(id,project_id,key_prefix,secret_hash,scopes_json,status,expires_at,created_at) " +
    "VALUES (?,?,?,?,?,'active',?,?)",
  ).bind(id, projectId, prefix, hash, JSON.stringify(scopes), expiresAt, now).run();
  await env.DB.prepare(
    "INSERT INTO vrain_audit_log(actor,action,target_type,target_id,detail_json,created_at) VALUES ('owner','api_key.create','api_key',?,?,?)",
  ).bind(id, JSON.stringify({ projectId, prefix, scopes, expiresAt }), now).run();
  return json({
    ok: true,
    warning: "Copy this key now. Its secret is stored only as a hash and cannot be shown again.",
    key: secret,
    keyId: id,
    prefix,
    scopes,
    expiresAt,
  }, 201);
}

async function adminRevokeKey(env: Env, keyId: string): Promise<Response> {
  if (!validId(keyId)) return json({ ok: false, error: "invalid_key_id" }, 400);
  const now = Date.now();
  const result = await env.DB.prepare(
    "UPDATE vrain_api_keys SET status='revoked',revoked_at=? WHERE id=? AND status='active'",
  ).bind(now, keyId).run();
  if (!result.meta.changes) return json({ ok: false, error: "active_key_not_found" }, 404);
  await env.DB.prepare(
    "INSERT INTO vrain_audit_log(actor,action,target_type,target_id,created_at) VALUES ('owner','api_key.revoke','api_key',?,?)",
  ).bind(keyId, now).run();
  return json({ ok: true, revoked: true });
}

async function adminGrant(
  env: Env,
  projectId: string,
  resourceId: string,
  kind: "document" | "collection",
  remove: boolean,
): Promise<Response> {
  if (!validId(projectId) || !validId(resourceId)) return json({ ok: false, error: "invalid_resource_id" }, 400);
  const project = await env.DB.prepare("SELECT id FROM vrain_projects WHERE id=?")
    .bind(projectId).first<{ id: string }>();
  const resource = kind === "document"
    ? await env.DB.prepare("SELECT id FROM vrain_documents WHERE id=?").bind(resourceId).first<{ id: string }>()
    : await env.DB.prepare("SELECT id FROM vrain_collections WHERE id=?").bind(resourceId).first<{ id: string }>();
  if (!project || !resource) return json({ ok: false, error: "project_or_resource_not_found" }, 404);
  const table = kind === "document" ? "vrain_project_documents" : "vrain_project_collections";
  const column = kind === "document" ? "document_id" : "collection_id";
  const now = Date.now();
  if (remove) {
    await env.DB.prepare("DELETE FROM " + table + " WHERE project_id=? AND " + column + "=?")
      .bind(projectId, resourceId).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO " + table + "(project_id," + column + ",created_at) VALUES (?,?,?)")
      .bind(projectId, resourceId, now).run();
  }
  await env.DB.prepare(
    "INSERT INTO vrain_audit_log(actor,action,target_type,target_id,detail_json,created_at) VALUES ('owner',?,?,?, ?,?)",
  ).bind("project." + (remove ? "revoke_" : "grant_") + kind, kind, resourceId, JSON.stringify({ projectId }), now).run();
  return json({ ok: true, granted: !remove, projectId, resourceId, kind });
}

async function ensureSearchInstance(env: Env): Promise<void> {
  const name = env.VRAIN_SEARCH_INSTANCE?.trim() || "vrain-knowledge-v1";
  const instance = env.VRAIN_SEARCH.get(name);
  try {
    await instance.info();
    return;
  } catch (readError) {
    try {
      await env.VRAIN_SEARCH.create({ id: name });
      await env.VRAIN_SEARCH.get(name).info();
      return;
    } catch (createError) {
      try {
        // A simultaneous owner action may have created it between info() and create().
        await env.VRAIN_SEARCH.get(name).info();
        return;
      } catch {
        throw new Error("VRAIN AI Search instance could not be verified or created: " + safeMessage(createError || readError));
      }
    }
  }
}

async function adminStartDocument(request: Request, env: Env): Promise<Response> {
  const input = await bodyJson<{
    title?: unknown; filename?: unknown; sha256?: unknown; size?: unknown;
    pageCount?: unknown; collectionId?: unknown; language?: unknown;
  }>(request);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
  const filenameRaw = typeof input.filename === "string" ? input.filename.trim() : "";
  const filename = filenameRaw.split(/[\\/]/u).pop()?.slice(0, 255) ?? "";
  const sha256 = typeof input.sha256 === "string" ? input.sha256.toUpperCase() : "";
  const size = Number(input.size);
  const pageCount = Number(input.pageCount);
  const maxBytes = Math.min(1024 * 1024 * 1024, Number(env.VRAIN_MAX_PDF_BYTES ?? 1024 * 1024 * 1024));
  const maxPages = Math.min(10_000, Number(env.VRAIN_MAX_PDF_PAGES ?? 2_000));
  if (!title || !filename) return json({ ok: false, error: "title_and_pdf_filename_required" }, 400);
  if (!/^[A-F0-9]{64}$/u.test(sha256)) return json({ ok: false, error: "invalid_sha256_fingerprint" }, 400);
  if (!Number.isSafeInteger(size) || size < 8 || size > maxBytes) return json({ ok: false, error: "pdf_size_out_of_range", maxBytes }, 413);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > maxPages) return json({ ok: false, error: "pdf_page_count_out_of_range", maxPages }, 400);
  const collectionId = typeof input.collectionId === "string" ? input.collectionId : "";
  const collection = await env.DB.prepare("SELECT id FROM vrain_collections WHERE id=? AND status='active'")
    .bind(collectionId).first<{ id: string }>();
  if (!collection) return json({ ok: false, error: "active_collection_required" }, 400);
  const language = typeof input.language === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(input.language)
    ? input.language : "und";

  const duplicate = await env.DB.prepare(
    "SELECT id,title,status,page_count FROM vrain_documents WHERE source_sha256=? AND expected_size=? AND status NOT IN ('archived','failed') ORDER BY created_at DESC LIMIT 1",
  ).bind(sha256, size).first<{ id: string; title: string; status: string; page_count: number }>();
  if (duplicate) return json({ ok: true, duplicate: true, document: duplicate, message: "This exact PDF fingerprint is already registered." });

  await ensureSearchInstance(env);
  const id = crypto.randomUUID();
  const objectName = "vrain/imports/" + id + "/source.pdf";
  const metadata = await createResumableUpload(env, objectName, size, {
    sha256,
    documentId: id,
    title,
    pageCount: String(pageCount),
    sourceFilename: filename,
  });
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO vrain_documents(id,title,source_filename,source_sha256,expected_size,uploaded_bytes,gcs_object,gcs_upload_uri,page_count,collection_id,language,status,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,0,?,?,?,?,?,'uploading',?,?)",
      ).bind(id, title, filename, sha256, size, objectName, metadata, pageCount, collectionId, language, now, now),
      env.DB.prepare(
        "INSERT INTO vrain_jobs(id,document_id,state,stage,attempt,last_heartbeat_at,started_at) VALUES (?,?, 'uploading','upload',0,?,?)",
      ).bind(crypto.randomUUID(), id, now, now),
      env.DB.prepare(
        "INSERT INTO vrain_activity_events(job_id,document_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
        "VALUES (?,?, 'Secure upload','upload','upload.started','running','A resumable private Google Cloud Storage upload was created.',?,?)",
      ).bind(id, id, JSON.stringify({ expectedBytes: size, pageCount, sha256: "[stored privately]" }), now),
    ]);
  } catch (error) {
    // The private object upload session is orphaned if metadata persistence fails.
    throw error;
  }
  return json({ ok: true, documentId: id, status: "uploading", expectedBytes: size, uploadedBytes: 0 }, 201);
}

async function adminUploadChunk(request: Request, env: Env, documentId: string): Promise<Response> {
  if (!validId(documentId)) return json({ ok: false, error: "invalid_document_id" }, 400);
  const document = await env.DB.prepare("SELECT * FROM vrain_documents WHERE id=?")
    .bind(documentId).first<VrainDocument>();
  if (!document) return json({ ok: false, error: "document_not_found" }, 404);
  if (document.status !== "uploading" || !document.gcs_upload_uri) {
    return json({ ok: false, error: "document_not_accepting_upload_chunks", status: document.status }, 409);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/octet-stream")) {
    return json({ ok: false, error: "application_octet_stream_required" }, 415);
  }
  const start = Number(request.headers.get("x-vrain-chunk-start"));
  const total = Number(request.headers.get("x-vrain-total-size"));
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(start) || start < 0 || total !== Number(document.expected_size)) {
    return json({ ok: false, error: "invalid_chunk_range" }, 400);
  }
  if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) return json({ ok: false, error: "chunk_too_large" }, 413);
  const offset = await probeUploadSession(env, document.gcs_upload_uri, total);
  if (offset >= total) {
    const now = Date.now();
    await env.DB.prepare("UPDATE vrain_documents SET uploaded_bytes=?,status='uploaded',updated_at=? WHERE id=? AND status='uploading'")
      .bind(total, now, documentId).run();
    await recordEvent(env, {
      documentId, specialist: "Secure upload", stage: "upload", type: "upload.reconciled",
      status: "completed", message: "VRAIN reconciled a completed GCS upload after a lost client response.",
      details: { uploadedBytes: total, expectedBytes: total, recoveredFromRemoteOffset: true },
    });
    return json({ ok: true, uploadedBytes: total, expectedBytes: total, status: "uploaded", reconciled: true });
  }
  if (offset !== start) return json({ ok: false, error: "upload_offset_mismatch", uploadedBytes: offset }, 409);
  const bytes = await readBoundedBody(request, MAX_CHUNK_BYTES);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_CHUNK_BYTES || start + bytes.byteLength > total) {
    return json({ ok: false, error: "chunk_size_out_of_range" }, 413);
  }
  const result = await uploadChunk(env, document.gcs_upload_uri, bytes, start, total);
  await env.DB.prepare("UPDATE vrain_documents SET uploaded_bytes=?,status=?,updated_at=? WHERE id=? AND status='uploading'")
    .bind(result.uploadedBytes, result.complete ? "uploaded" : "uploading", Date.now(), documentId).run();
  await env.DB.prepare("UPDATE vrain_jobs SET stage='upload',last_heartbeat_at=? WHERE document_id=?")
    .bind(Date.now(), documentId).run();
  if (result.complete || Math.floor(result.uploadedBytes / total * 20) > Math.floor(Number(document.uploaded_bytes) / total * 20)) {
    await recordEvent(env, {
      documentId,
      specialist: "Secure upload",
      stage: "upload",
      type: result.complete ? "upload.completed" : "upload.progress",
      status: result.complete ? "completed" : "running",
      message: result.complete ? "The complete PDF was transferred to private GCS." : "Secure PDF upload reached " + Math.floor(result.uploadedBytes / total * 100) + "%.",
      details: { uploadedBytes: result.uploadedBytes, expectedBytes: total, percent: Math.floor(result.uploadedBytes / total * 100) },
    });
  }
  return json({ ok: true, uploadedBytes: result.uploadedBytes, expectedBytes: total, status: result.complete ? "uploaded" : "uploading" });
}

async function adminCompleteUpload(env: Env, documentId: string): Promise<Response> {
  if (!validId(documentId)) return json({ ok: false, error: "invalid_document_id" }, 400);
  const document = await env.DB.prepare("SELECT * FROM vrain_documents WHERE id=?")
    .bind(documentId).first<VrainDocument>();
  if (!document) return json({ ok: false, error: "document_not_found" }, 404);
  if (document.status === "processing" || document.status === "waiting_retry" || document.status === "ready") {
    return json({ ok: true, documentId, status: document.status, workflowId: document.workflow_instance_id });
  }
  if (document.status !== "uploaded" || !document.gcs_upload_uri ||
      Number(document.uploaded_bytes) !== Number(document.expected_size)) {
    return json({ ok: false, error: "upload_incomplete", uploadedBytes: document.uploaded_bytes, expectedBytes: document.expected_size }, 409);
  }
  const remote = await getObjectMetadata(env, document.gcs_object);
  if (remote.size !== Number(document.expected_size)) {
    return json({ ok: false, error: "gcs_object_size_mismatch", expectedBytes: document.expected_size, actualBytes: remote.size }, 409);
  }
  const workflowId = documentId + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const now = Date.now();
  const claimed = await env.DB.prepare(
    "UPDATE vrain_documents SET status='processing',workflow_instance_id=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='uploaded'",
  ).bind(workflowId, now, documentId).run();
  if (!claimed.meta.changes) {
    const current = await env.DB.prepare("SELECT status,workflow_instance_id FROM vrain_documents WHERE id=?")
      .bind(documentId).first<{ status: string; workflow_instance_id: string | null }>();
    return json({ ok: true, documentId, status: current?.status ?? "unknown", workflowId: current?.workflow_instance_id ?? null });
  }
  await env.DB.prepare(
    "UPDATE vrain_jobs SET state='processing',stage='source_verification',workflow_instance_id=?,last_heartbeat_at=?,next_retry_at=NULL WHERE document_id=?",
  ).bind(workflowId, now, documentId).run();
  try {
    await env.INGEST_WORKFLOW.create({ id: workflowId, params: { documentId } });
    await recordEvent(env, {
      documentId, specialist: "Workflow orchestrator", stage: "workflow", type: "workflow.started",
      status: "running", message: "VRAIN started integrity verification, Google Cloud Vision OCR, indexing, QA and publication.",
      details: { workflowId },
    });
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE vrain_documents SET status='waiting_retry',error_code='WORKFLOW_START',error_message=?,updated_at=? WHERE id=?")
        .bind(safeMessage(error), Date.now(), documentId),
      env.DB.prepare("UPDATE vrain_jobs SET state='waiting_retry',stage='workflow_start',next_retry_at=?,last_heartbeat_at=? WHERE document_id=?")
        .bind(Date.now() + 60_000, Date.now(), documentId),
    ]);
    return json({ ok: true, documentId, status: "waiting_retry", message: "VRAIN saved the job and will start it automatically." }, 202);
  }
  return json({ ok: true, documentId, status: "processing", workflowId }, 202);
}

async function adminJob(env: Env, documentId: string): Promise<Response> {
  if (!validId(documentId)) return json({ ok: false, error: "invalid_document_id" }, 400);
  const document = await env.DB.prepare("SELECT * FROM vrain_documents WHERE id=?")
    .bind(documentId).first<VrainDocument>();
  if (!document) return json({ ok: false, error: "document_not_found" }, 404);
  const job = await env.DB.prepare("SELECT * FROM vrain_jobs WHERE document_id=? ORDER BY started_at DESC LIMIT 1")
    .bind(documentId).first<Record<string, unknown>>();
  const events = await env.DB.prepare(
    "SELECT id,specialist,stage,event_type,status,message,detail_json,created_at FROM vrain_activity_events WHERE document_id=? ORDER BY id DESC LIMIT 100",
  ).bind(documentId).all<Record<string, unknown>>();
  return json({
    ok: true,
    document: {
      id: document.id, title: document.title, filename: document.source_filename,
      sha256: document.source_sha256, expectedBytes: Number(document.expected_size),
      uploadedBytes: Number(document.uploaded_bytes), pageCount: Number(document.page_count),
      indexedPages: Number(document.indexed_pages), language: document.language,
      collectionId: document.collection_id, status: document.status,
      visionOperation: document.vision_operation ? "configured" : null,
      workflowId: document.workflow_instance_id, errorCode: document.error_code,
      error: document.error_message, publishedAt: document.published_at,
      createdAt: document.created_at, updatedAt: document.updated_at,
    },
    job,
    events: (events.results ?? []).reverse().map((event) => ({
      id: event.id, specialist: event.specialist, stage: event.stage, type: event.event_type,
      status: event.status, message: event.message, details: safeJson(event.detail_json),
      createdAt: event.created_at,
    })),
    eta: await estimateEta(env, document),
  });
}

function safeJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function estimateEta(env: Env, document: VrainDocument): Promise<{ rangeMinutes: [number, number] | null; confidence: string; basis: string }> {
  if (document.status === "ready") return { rangeMinutes: [0, 0], confidence: "high", basis: "Published" };
  if (["failed", "archived"].includes(document.status)) return { rangeMinutes: null, confidence: "none", basis: "Not actively processing" };
  const remaining = Math.max(0, Number(document.page_count) - Number(document.indexed_pages));
  const samples = await env.DB.prepare(
    "SELECT AVG(CAST(json_extract(detail_json,'$.elapsedMs') AS REAL)) AS avg_ms " +
    "FROM vrain_activity_events WHERE event_type='index.page_completed' AND json_valid(detail_json)=1 " +
    "AND created_at>?",
  ).bind(Date.now() - 30 * 86_400_000).first<{ avg_ms: number | null }>();
  const secondsPerPage = Number(samples?.avg_ms ?? 0) > 0 ? Number(samples?.avg_ms) / 1000 : 3;
  const estimated = Math.ceil((remaining * secondsPerPage + 120) / 60);
  return {
    rangeMinutes: [Math.max(1, Math.floor(estimated * 0.7)), Math.max(2, Math.ceil(estimated * 1.6))],
    confidence: Number(samples?.avg_ms ?? 0) > 0 ? "medium" : "low",
    basis: "Remaining pages and observed page-index duration; OCR queue depth and provider throttling can change the range.",
  };
}

async function adminResume(env: Env, documentId: string): Promise<Response> {
  if (!validId(documentId)) return json({ ok: false, error: "invalid_document_id" }, 400);
  const document = await env.DB.prepare("SELECT * FROM vrain_documents WHERE id=?")
    .bind(documentId).first<VrainDocument>();
  if (!document) return json({ ok: false, error: "document_not_found" }, 404);
  if (!["waiting_retry", "failed"].includes(document.status)) {
    return json({ ok: false, error: "document_is_not_recoverable", status: document.status }, 409);
  }
  const workflowId = documentId + "-owner-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE vrain_documents SET status='waiting_retry',error_code=NULL,error_message=NULL,workflow_instance_id=?,updated_at=? WHERE id=?")
      .bind(workflowId, now, documentId),
    env.DB.prepare("UPDATE vrain_jobs SET state='waiting_retry',stage='owner_resume',workflow_instance_id=?,next_retry_at=?,last_heartbeat_at=? WHERE document_id=?")
      .bind(workflowId, now, now, documentId),
  ]);
  await recordEvent(env, {
    documentId, specialist: "Owner", stage: "recovery", type: "recovery.owner_resume",
    status: "warning", message: "The owner requested a new processing attempt after reviewing the blocker.",
  });
  return json({ ok: true, documentId, status: "waiting_retry", message: "The automatic recovery worker will resume this document on its next sweep." }, 202);
}

async function consumerSources(env: Env, projectId: string): Promise<Array<{ id: string; title: string; search_prefix: string; page_count: number }>> {
  const result = await env.DB.prepare(
    "SELECT DISTINCT d.id,d.title,d.page_count FROM vrain_documents d " +
    "LEFT JOIN vrain_project_documents pd ON pd.document_id=d.id AND pd.project_id=? " +
    "LEFT JOIN vrain_project_collections pc ON pc.project_id=? AND pc.collection_id=d.collection_id " +
    "WHERE d.status='ready' AND d.indexed_pages=d.page_count AND (pd.document_id IS NOT NULL OR pc.collection_id IS NOT NULL)",
  ).bind(projectId, projectId).all<{ id: string; title: string; search_prefix?: string; page_count: number }>();
  return (result.results ?? []).map((row) => ({
    ...row,
    search_prefix: "vrain/books/" + row.id + "/pages/",
  }));
}

async function consumerSourceList(project: { id: string; name: string; slug: string }, env: Env): Promise<Response> {
  const sources = await consumerSources(env, project.id);
  return json({
    ok: true, project: { name: project.name, slug: project.slug },
    sources: sources.map((source) => ({ id: source.id, title: source.title, pageCount: source.page_count })),
  });
}

async function consumerRetrieve(request: Request, project: { id: string; name: string; slug: string }, env: Env): Promise<Response> {
  const input = await bodyJson<{ query?: unknown; maxResults?: unknown }>(request);
  const query = typeof input.query === "string" ? input.query.trim().replace(/\u0000/gu, "").slice(0, 2_000) : "";
  if (!query) return json({ ok: false, error: "query_required" }, 400);
  const maxResults = Number.isSafeInteger(Number(input.maxResults))
    ? Math.min(12, Math.max(1, Number(input.maxResults))) : 8;
  const sources = await consumerSources(env, project.id);
  if (!sources.length) return json({ ok: true, project: project.slug, passages: [], searchedSources: 0 });
  const search = env.VRAIN_SEARCH.get(env.VRAIN_SEARCH_INSTANCE?.trim() || "vrain-knowledge-v1");
  const result = await search.search({
    messages: [{ role: "user", content: query }],
    ai_search_options: { retrieval: { max_num_results: 50, retrieval_type: "hybrid" } },
  });
  const scoreFloor = Math.min(1, Math.max(0, Number(env.VRAIN_MIN_RETRIEVAL_SCORE ?? "0.2")));
  const seen = new Set<string>();
  const passages: VrainPassage[] = [];
  const sortedSources = [...sources].sort((a, b) => b.search_prefix.length - a.search_prefix.length);
  for (const chunk of result.chunks ?? []) {
    const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
    const source = sortedSources.find((candidate) => key.startsWith(candidate.search_prefix));
    if (!source) continue;
    const match = /\/page-(\d{6})\.txt$/iu.exec(key);
    const page = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(page) || page < 1 || page > source.page_count) continue;
    const score = Number(chunk.score ?? chunk.scoring_details?.reranking_score ?? chunk.scoring_details?.vector_score);
    if (Number.isFinite(score) && score < scoreFloor) continue;
    const text = typeof chunk.text === "string" ? chunk.text.replace(/\u0000/gu, "").replace(/\s+/gu, " ").trim().slice(0, 4_500) : "";
    if (!text) continue;
    const id = typeof chunk.id === "string" && chunk.id ? chunk.id : key + ":" + text.slice(0, 80);
    if (seen.has(id)) continue;
    seen.add(id);
    passages.push({ id, documentId: source.id, title: source.title, page, text, score: Number.isFinite(score) ? score : 0 });
    if (passages.length >= maxResults) break;
  }
  passages.sort((a, b) => b.score - a.score);
  return json({
    ok: true,
    project: project.slug,
    passages,
    searchedSources: sources.length,
    citations: passages.map((passage) => ({ documentId: passage.documentId, title: passage.title, pdfPage: passage.page })),
  });
}

async function recoverDueJobs(env: Env): Promise<{ scanned: number; restarted: number }> {
  const now = Date.now();
  const rows = await env.DB.prepare(
    "SELECT j.id AS job_id,j.document_id,j.workflow_instance_id,j.state,j.stage,d.status AS document_status " +
    "FROM vrain_jobs j JOIN vrain_documents d ON d.id=j.document_id " +
    "WHERE (j.state='waiting_retry' AND COALESCE(j.next_retry_at,0)<=?) " +
    "OR (j.state='processing' AND j.last_heartbeat_at<? AND d.status='processing') " +
    "ORDER BY COALESCE(j.next_retry_at,j.last_heartbeat_at) ASC LIMIT 25",
  ).bind(now, now - 30 * 60_000).all<{
    job_id: string; document_id: string; workflow_instance_id: string | null; state: string; stage: string; document_status: string;
  }>();
  let restarted = 0;
  for (const row of rows.results ?? []) {
    if (row.state === "processing" && row.workflow_instance_id) {
      try {
        const current = await env.INGEST_WORKFLOW.get(row.workflow_instance_id);
        const status = await current.status();
        if (!["errored", "terminated", "complete", "completed"].includes(status.status)) continue;
      } catch (error) {
        // Only rebuild when the instance is genuinely missing/expired. A transient
        // status API outage must not cause two active workflows for the same source.
        if (!/not found|does not exist|no such instance|expired|http 404|status 404/iu.test(safeMessage(error))) continue;
      }
    }
    const workflowId = row.document_id + "-recovery-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const claim = await env.DB.prepare(
      "UPDATE vrain_jobs SET state='processing',stage='recovery_dispatch',workflow_instance_id=?,next_retry_at=NULL,last_heartbeat_at=? " +
      "WHERE id=? AND (state='waiting_retry' OR (state='processing' AND last_heartbeat_at<?))",
    ).bind(workflowId, now, row.job_id, now - 30 * 60_000).run();
    if (!claim.meta.changes) continue;
    await env.DB.prepare(
      "UPDATE vrain_documents SET status='processing',workflow_instance_id=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?",
    ).bind(workflowId, now, row.document_id).run();
    try {
      await env.INGEST_WORKFLOW.create({ id: workflowId, params: { documentId: row.document_id } });
      await recordEvent(env, {
        documentId: row.document_id, specialist: "Recovery supervisor", stage: "recovery",
        type: "recovery.workflow_restarted", status: "running",
        message: "VRAIN detected a stopped or waiting job and resumed it from its durable document checkpoint.",
        details: { previousWorkflowId: row.workflow_instance_id, workflowId },
      });
      restarted += 1;
    } catch (error) {
      await env.DB.batch([
        env.DB.prepare("UPDATE vrain_jobs SET state='waiting_retry',stage='recovery_dispatch',next_retry_at=?,last_heartbeat_at=?,error_message=? WHERE id=? AND workflow_instance_id=?")
          .bind(now + 5 * 60_000, now, safeMessage(error), row.job_id, workflowId),
        env.DB.prepare("UPDATE vrain_documents SET status='waiting_retry',error_message=?,updated_at=? WHERE id=? AND workflow_instance_id=?")
          .bind(safeMessage(error), now, row.document_id, workflowId),
      ]);
    }
  }
  return { scanned: rows.results?.length ?? 0, restarted };
}

async function ownerRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/v1/admin/projects" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,name,slug,description,status,created_at,updated_at FROM vrain_projects ORDER BY created_at DESC")
      .all<Record<string, unknown>>();
    return json({ ok: true, projects: result.results ?? [] });
  }
  if (path === "/v1/admin/projects" && request.method === "POST") return adminCreateProject(request, env);
  if (path === "/v1/admin/collections" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,name,description,language,status,created_at,updated_at FROM vrain_collections ORDER BY name COLLATE NOCASE")
      .all<Record<string, unknown>>();
    return json({ ok: true, collections: result.results ?? [] });
  }
  if (path === "/v1/admin/collections" && request.method === "POST") return adminCreateCollection(request, env);
  const keyCreate = /^\/v1\/admin\/projects\/([a-f0-9-]{36})\/keys$/iu.exec(path);
  if (keyCreate && request.method === "POST") return adminCreateKey(request, env, keyCreate[1]);
  const keyRevoke = /^\/v1\/admin\/keys\/([a-f0-9-]{36})$/iu.exec(path);
  if (keyRevoke && request.method === "DELETE") return adminRevokeKey(env, keyRevoke[1]);
  const keyList = /^\/v1\/admin\/projects\/([a-f0-9-]{36})\/keys$/iu.exec(path);
  if (keyList && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id,key_prefix,scopes_json,status,expires_at,last_used_at,created_at,revoked_at FROM vrain_api_keys WHERE project_id=? ORDER BY created_at DESC",
    ).bind(keyList[1]).all<Record<string, unknown>>();
    return json({ ok: true, keys: result.results ?? [] });
  }
  const collectionGrant = /^\/v1\/admin\/projects\/([a-f0-9-]{36})\/collections\/([a-f0-9-]{36})$/iu.exec(path);
  if (collectionGrant && ["PUT", "DELETE"].includes(request.method)) {
    return adminGrant(env, collectionGrant[1], collectionGrant[2], "collection", request.method === "DELETE");
  }
  const documentGrant = /^\/v1\/admin\/projects\/([a-f0-9-]{36})\/documents\/([a-f0-9-]{36})$/iu.exec(path);
  if (documentGrant && ["PUT", "DELETE"].includes(request.method)) {
    return adminGrant(env, documentGrant[1], documentGrant[2], "document", request.method === "DELETE");
  }
  if (path === "/v1/admin/documents" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id,title,source_filename,page_count,indexed_pages,collection_id,language,status,error_code,error_message,created_at,updated_at,published_at FROM vrain_documents ORDER BY updated_at DESC LIMIT 200",
    ).all<Record<string, unknown>>();
    return json({ ok: true, documents: result.results ?? [] });
  }
  if (path === "/v1/admin/documents/start" && request.method === "POST") return adminStartDocument(request, env);
  const chunk = /^\/v1\/admin\/documents\/([a-f0-9-]{36})\/chunks$/iu.exec(path);
  if (chunk && request.method === "PUT") return adminUploadChunk(request, env, chunk[1]);
  const complete = /^\/v1\/admin\/documents\/([a-f0-9-]{36})\/complete$/iu.exec(path);
  if (complete && request.method === "POST") return adminCompleteUpload(env, complete[1]);
  const jobs = /^\/v1\/admin\/jobs\/([a-f0-9-]{36})$/iu.exec(path);
  if (jobs && request.method === "GET") return adminJob(env, jobs[1]);
  const resume = /^\/v1\/admin\/jobs\/([a-f0-9-]{36})\/resume$/iu.exec(path);
  if (resume && request.method === "POST") return adminResume(env, resume[1]);
  return json({ ok: false, error: "not_found" }, 404);
}

async function consumerRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const required = path === "/v1/knowledge/retrieve" || path === "/v1/knowledge/sources"
    ? "knowledge:read" : "";
  if (!required) return json({ ok: false, error: "not_found" }, 404);
  const project = await apiKeyProject(request, env, required);
  if (!project) return json({ ok: false, error: "invalid_or_unauthorized_api_key" }, 401);
  if (path === "/v1/knowledge/sources" && request.method === "GET") return consumerSourceList(project, env);
  if (path === "/v1/knowledge/retrieve" && request.method === "POST") return consumerRetrieve(request, project, env);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}

export class VrainHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    if (url.pathname === "/health" && request.method === "GET") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: true, service: "vrain-engine", environment: env.ENVIRONMENT ?? "unknown",
          database: "connected", workflow: Boolean(env.INGEST_WORKFLOW),
          searchBinding: Boolean(env.VRAIN_SEARCH),
          googleVisionConfigured: Boolean(env.GCP_CLIENT_EMAIL && env.GCP_PRIVATE_KEY && env.GCP_PROJECT_ID),
          timestamp: Date.now(),
        });
      } catch (error) {
        return json({ ok: false, service: "vrain-engine", error: safeMessage(error) }, 503);
      }
    }

    if (url.pathname.startsWith("/v1/admin/")) {
      if (!(await ownerOnly(request, env))) return json({ ok: false, error: "owner_authentication_required" }, 401);
      try { return await ownerRoute(request, env, url); }
      catch (error) {
        const status = error instanceof VrainHttpError ? error.status : 502;
        return json({ ok: false, error: safeMessage(error) }, status);
      }
    }

    if (url.pathname.startsWith("/v1/knowledge/")) {
      try { return await consumerRoute(request, env, url); }
      catch (error) {
        const status = error instanceof VrainHttpError ? error.status : 502;
        return json({ ok: false, error: safeMessage(error) }, status);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(recoverDueJobs(env).catch((error) => {
      console.error("vrain_recovery_sweep_failed", safeMessage(error));
    }));
  },
};

