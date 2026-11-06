import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import {
  brvinImportStatus,
  startBrvinBookUpload,
} from "./admin";
import {
  completeFatmanUpload,
  resumeFatmanImport,
  uploadFatmanChunk,
} from "../fatman/import";

export interface BrvinTeachersManagementProps {
  /** Supplied only by the trusted same-account service binding configuration. */
  applicationEnvironmentId?: string;
}

type ManagementCaller = {
  applicationId: string;
  environmentId: string;
};

type ManagementFailure = { ok: false; code: string; message: string; retryable?: boolean };
type RpcResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | ManagementFailure;

type TenantInput = { tenantReference?: unknown };
type ProjectInput = TenantInput & { projectId?: unknown };
type CollectionInput = ProjectInput & { collectionId?: unknown };

const TENANT_REFERENCE = /^TCH-[0-9]{6,}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

function failure(code: string, message: string, retryable = false): ManagementFailure {
  return { ok: false, code, message, ...(retryable ? { retryable: true } : {}) };
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/gu, "").replace(/\s+/gu, " ").trim().slice(0, max);
}

export function isValidBrvinTeachersTenantReference(value: unknown): value is string {
  return typeof value === "string" && TENANT_REFERENCE.test(value);
}

export function hierarchicalReference(parent: string, kind: "PRJ" | "COL" | "SRC", sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("Reference sequence must be a positive integer.");
  return parent + "-" + kind + "-" + String(sequence).padStart(3, "0");
}

async function hashRequest(values: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.join("\\n")));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function validRequestId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length >= 8 && normalized.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : "";
}

function slugPart(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 44) || "classroom";
}

async function jsonResponse(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try {
    const value = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch {
    body = { ok: false, error: "BRVIN returned an unreadable response." };
  }
  return { status: response.status, body };
}

async function nextReferenceSequence(env: Env, scopeKey: string): Promise<number> {
  if (!env.DB) throw new Error("BRVIN database is not configured.");
  const row = await env.DB.prepare(
    "INSERT INTO brvin_reference_sequences(scope_key,current_value,updated_at) VALUES(?,1,?) " +
    "ON CONFLICT(scope_key) DO UPDATE SET current_value=current_value+1,updated_at=excluded.updated_at " +
    "RETURNING current_value",
  ).bind(scopeKey, Date.now()).first<{ current_value: number }>();
  const sequence = Number(row?.current_value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("BRVIN reference allocation failed.");
  return sequence;
}

async function resolveCaller(env: Env, environmentId: unknown): Promise<ManagementCaller | null> {
  if (!env.DB || typeof environmentId !== "string" || !UUID.test(environmentId)) return null;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    "SELECT e.id AS environment_id,e.status AS environment_status,e.worker_name," +
    "a.id AS application_id,a.slug AS application_slug,a.status AS application_status " +
    "FROM brvin_application_environments e JOIN brvin_applications a ON a.id=e.application_id " +
    "WHERE e.id=? LIMIT 1",
  ).bind(environmentId).first<{
    environment_id: string;
    environment_status: string;
    worker_name: string;
    application_id: string;
    application_slug: string;
    application_status: string;
  }>();
  if (!row || row.application_slug !== "brvin-teachers" || row.worker_name !== "brvin-teachers" ||
      row.application_status !== "active" || row.environment_status !== "active") return null;
  return { applicationId: row.application_id, environmentId: row.environment_id };
}

async function resolveOwnedProject(
  env: Env,
  caller: ManagementCaller,
  tenantReference: string,
  projectId: string,
): Promise<{ id: string; projectRef: string; name: string; description: string } | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT p.id,p.project_ref,p.name,p.description FROM brvin_projects p " +
    "JOIN brvin_application_project_grants g ON g.project_id=p.id " +
    "WHERE p.id=? AND p.owner_application_id=? AND p.owner_tenant_ref=? " +
    "AND p.status='active' AND g.application_id=? AND g.status='active' LIMIT 1",
  ).bind(projectId, caller.applicationId, tenantReference, caller.applicationId).first<{
    id: string; project_ref: string; name: string; description: string;
  }>();
  return row ? { id: row.id, projectRef: row.project_ref, name: row.name, description: row.description } : null;
}

async function resolveOwnedCollection(
  env: Env,
  caller: ManagementCaller,
  tenantReference: string,
  collectionId: string,
): Promise<{ id: string; collectionRef: string; originProjectId: string; name: string } | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT id,collection_ref,origin_project_id,name FROM brvin_collections " +
    "WHERE id=? AND owner_application_id=? AND owner_tenant_ref=? AND status='active' LIMIT 1",
  ).bind(collectionId, caller.applicationId, tenantReference).first<{
    id: string; collection_ref: string; origin_project_id: string; name: string;
  }>();
  return row ? {
    id: row.id, collectionRef: row.collection_ref,
    originProjectId: row.origin_project_id, name: row.name,
  } : null;
}

async function recordManagementActivity(
  env: Env,
  input: { projectId?: string; bookId?: string; importId?: string; eventType: string; message: string; details?: Record<string, unknown> },
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO brvin_activity_events(import_id,book_id,project_id,agent,phase,event_type,status,message,detail_json,created_at) " +
    "VALUES(?,?,?,'BRVIN Teachers management','governance',?,'completed',?,?,?)",
  ).bind(
    input.importId ?? null, input.bookId ?? null, input.projectId ?? null,
    input.eventType, input.message, JSON.stringify(input.details ?? {}), Date.now(),
  ).run();
}

async function finishSourceIdentity(
  env: Env,
  caller: ManagementCaller,
  tenantReference: string,
  collectionId: string,
  sourceId: string,
): Promise<{ sourceReference: string; sourceId: string } | null> {
  if (!env.DB) return null;
  const existing = await env.DB.prepare(
    "SELECT id,owner_application_id,owner_tenant_ref,origin_collection_id,source_ref " +
    "FROM brvin_books WHERE id=? LIMIT 1",
  ).bind(sourceId).first<{
    id: string; owner_application_id: string | null; owner_tenant_ref: string | null;
    origin_collection_id: string | null; source_ref: string | null;
  }>();
  if (!existing) return null;
  if ((existing.owner_application_id && existing.owner_application_id !== caller.applicationId) ||
      (existing.owner_tenant_ref && existing.owner_tenant_ref !== tenantReference) ||
      (existing.origin_collection_id && existing.origin_collection_id !== collectionId)) return null;
  if (existing.source_ref) return { sourceReference: existing.source_ref, sourceId };

  const collection = await resolveOwnedCollection(env, caller, tenantReference, collectionId);
  if (!collection) return null;
  const scopeKey = "collection:" + collectionId + ":sources";
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO brvin_reference_sequences(scope_key,current_value,updated_at) " +
      "SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM brvin_books WHERE id=? AND source_ref IS NULL) " +
      "ON CONFLICT(scope_key) DO UPDATE SET current_value=current_value+1,updated_at=excluded.updated_at",
    ).bind(scopeKey, now, sourceId),
    env.DB.prepare(
      "UPDATE brvin_books SET owner_application_id=?,owner_tenant_ref=?,origin_collection_id=?,source_ref=(" +
      "SELECT ? || '-SRC-' || printf('%03d',current_value) FROM brvin_reference_sequences WHERE scope_key=?),updated_at=? " +
      "WHERE id=? AND source_ref IS NULL",
    ).bind(caller.applicationId, tenantReference, collectionId, collection.collectionRef, scopeKey, now, sourceId),
  ]);
  const updated = await env.DB.prepare("SELECT source_ref FROM brvin_books WHERE id=?").bind(sourceId).first<{ source_ref: string | null }>();
  return updated?.source_ref ? { sourceReference: updated.source_ref, sourceId } : null;
}

async function authorizeSource(
  env: Env,
  caller: ManagementCaller,
  tenantReference: string,
  projectId: string,
  collectionId: string,
  importId: string,
): Promise<boolean> {
  if (!env.DB || !UUID.test(importId)) return false;
  const project = await resolveOwnedProject(env, caller, tenantReference, projectId);
  const collection = await resolveOwnedCollection(env, caller, tenantReference, collectionId);
  if (!project || !collection) return false;
  const row = await env.DB.prepare(
    "SELECT b.id FROM brvin_books b " +
    "JOIN brvin_project_collections pc ON pc.collection_id=b.collection_id AND pc.project_id=? " +
    "WHERE b.id=? AND b.owner_application_id=? AND b.owner_tenant_ref=? " +
    "AND b.origin_collection_id=? AND b.collection_id=? LIMIT 1",
  ).bind(projectId, importId, caller.applicationId, tenantReference, collectionId, collectionId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function listTeacherProjects(
  env: Env,
  caller: ManagementCaller,
  tenantReference: string,
): Promise<RpcResult<{ projects: Array<Record<string, unknown>> }>> {
  if (!env.DB) return failure("BRVIN_UNAVAILABLE", "BRVIN database is not configured.", true);
  const result = await env.DB.prepare(
    "SELECT p.id,p.project_ref,p.name,p.subject,p.description,p.status,p.updated_at," +
    "(SELECT COUNT(*) FROM brvin_project_collections pc JOIN brvin_collections c ON c.id=pc.collection_id " +
    " WHERE pc.project_id=p.id AND c.status='active') AS collection_count," +
    "(SELECT COUNT(DISTINCT b.id) FROM brvin_project_collections pc " +
    " JOIN brvin_books b ON b.collection_id=pc.collection_id " +
    " WHERE pc.project_id=p.id AND b.status<>'archived') AS source_count " +
    "FROM brvin_projects p JOIN brvin_application_project_grants g ON g.project_id=p.id " +
    "WHERE p.owner_application_id=? AND p.owner_tenant_ref=? AND p.status='active' " +
    "AND g.application_id=? AND g.status='active' ORDER BY p.created_at DESC,p.id",
  ).bind(caller.applicationId, tenantReference, caller.applicationId).all<{
    id: string; project_ref: string; name: string; subject: string; description: string; status: string;
    updated_at: number; collection_count: number; source_count: number;
  }>();
  return {
    ok: true,
    projects: (result.results ?? []).map(row => ({
      id: row.id, reference: row.project_ref, name: row.name, subject: row.subject, description: row.description,
      status: row.status, collectionCount: Number(row.collection_count), sourceCount: Number(row.source_count),
      updatedAt: Number(row.updated_at),
    })),
  };
}

async function createTeacherProject(
  env: Env,
  caller: ManagementCaller,
  input: TenantInput & { name?: unknown; subject?: unknown; description?: unknown; ownerLabel?: unknown; requestId?: unknown },
): Promise<RpcResult<{ project: Record<string, unknown> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference)) {
    return failure("INVALID_REQUEST", "A valid teacher reference is required.");
  }
  const tenantReference = input.tenantReference;
  const name = cleanText(input.name, 100);
  const subject = cleanText(input.subject, 80);
  const description = cleanText(input.description, 500);
  const ownerLabel = cleanText(input.ownerLabel, 120);
  const requestId = validRequestId(input.requestId);
  if (!name || !subject || !requestId) return failure("INVALID_REQUEST", "Enter a project name, subject and stable request ID.");
  const requestHash = await hashRequest([name, subject, description, ownerLabel]);
  const existing = await env.DB.prepare(
    "SELECT id,project_ref,name,slug,description,subject,management_request_hash FROM brvin_projects " +
    "WHERE owner_application_id=? AND owner_tenant_ref=? AND management_request_id=? LIMIT 1",
  ).bind(caller.applicationId, tenantReference, requestId).first<{
    id: string; project_ref: string; name: string; slug: string; description: string;
    subject: string; management_request_hash: string | null;
  }>();
  if (existing) {
    if (existing.management_request_hash !== requestHash) return failure("IDEMPOTENCY_CONFLICT", "This request ID was already used with different project details.");
    return { ok: true, project: { id: existing.id, reference: existing.project_ref, name: existing.name, subject: existing.subject, slug: existing.slug, description: existing.description } };
  }

  try {
    const id = crypto.randomUUID().toLowerCase();
    const sequence = await nextReferenceSequence(env, "tenant:" + caller.applicationId + ":" + tenantReference + ":projects");
    const projectReference = hierarchicalReference(tenantReference, "PRJ", sequence);
    const slug = "tch-" + tenantReference.slice(4).toLowerCase() + "-" + slugPart(name) + "-" + id.slice(0, 8);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO brvin_projects(id,name,slug,description,owner_label,status,created_at,updated_at,owner_application_id,owner_tenant_ref,project_ref,management_request_id,management_request_hash,subject) " +
        "VALUES(?,?,?,?,?,'active',?,?,?,?,?,?,?,?)",
      ).bind(id, name, slug, description, ownerLabel, now, now, caller.applicationId, tenantReference, projectReference, requestId, requestHash, subject),
      env.DB.prepare(
        "INSERT INTO brvin_application_project_grants(id,application_id,project_id,status,created_at,created_by) VALUES(?,?,?,'active',?,'brvin-teachers-management')",
      ).bind(crypto.randomUUID().toLowerCase(), caller.applicationId, id, now),
      env.DB.prepare(
        "INSERT INTO brvin_activity_events(project_id,agent,phase,event_type,status,message,detail_json,created_at) " +
        "VALUES(?,'BRVIN Teachers management','governance','teacher_project.created','completed',?,?,?)",
      ).bind(id, "A teacher-owned knowledge project was created and granted to the registered BRVIN Teachers application.", JSON.stringify({ tenantReference, projectReference, applicationId: caller.applicationId }), now),
    ]);
    return { ok: true, project: { id, reference: projectReference, name, subject, description, slug } };
  } catch {
    const retry = await env.DB.prepare(
      "SELECT id,project_ref,name,slug,description,subject,management_request_hash FROM brvin_projects WHERE owner_application_id=? AND owner_tenant_ref=? AND management_request_id=? LIMIT 1",
    ).bind(caller.applicationId, tenantReference, requestId).first<{ id: string; project_ref: string; name: string; slug: string; description: string; subject: string; management_request_hash: string | null }>();
    if (retry) {
      if (retry.management_request_hash !== requestHash) return failure("IDEMPOTENCY_CONFLICT", "This request ID was already used with different project details.");
      return { ok: true, project: { id: retry.id, reference: retry.project_ref, name: retry.name, subject: retry.subject, slug: retry.slug, description: retry.description } };
    }
    return failure("MANAGEMENT_WRITE_FAILED", "BRVIN could not create the teacher project. The request can be retried safely.", true);
  }
}

async function listTeacherCollections(
  env: Env,
  caller: ManagementCaller,
  input: ProjectInput,
): Promise<RpcResult<{ collections: Array<Record<string, unknown>> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) || typeof input.projectId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher and project reference are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  if (!project) return failure("PROJECT_NOT_FOUND", "The requested teacher classroom is unavailable.");
  const result = await env.DB.prepare(
    "SELECT c.id,c.collection_ref,c.name,c.description,c.origin_project_id,c.status," +
    "CASE WHEN c.origin_project_id=? THEN 1 ELSE 0 END AS is_owned," +
    "(SELECT COUNT(*) FROM brvin_books b WHERE b.origin_collection_id=c.id AND b.status<>'archived') AS source_count " +
    "FROM brvin_project_collections pc JOIN brvin_collections c ON c.id=pc.collection_id " +
    "WHERE pc.project_id=? AND c.owner_application_id=? AND c.owner_tenant_ref=? AND c.status='active' " +
    "ORDER BY c.name COLLATE NOCASE,c.id",
  ).bind(project.id, project.id, caller.applicationId, input.tenantReference).all<{
    id: string; collection_ref: string; name: string; description: string; origin_project_id: string;
    status: string; is_owned: number; source_count: number;
  }>();
  return {
    ok: true,
    collections: (result.results ?? []).map(row => ({
      id: row.id, reference: row.collection_ref, name: row.name, description: row.description,
      originProjectId: row.origin_project_id, ownership: Number(row.is_owned) === 1 ? "owned" : "shared",
      sourceCount: Number(row.source_count), status: row.status,
    })),
  };
}

async function createTeacherCollection(
  env: Env,
  caller: ManagementCaller,
  input: ProjectInput & { name?: unknown; description?: unknown; requestId?: unknown },
): Promise<RpcResult<{ collection: Record<string, unknown> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) || typeof input.projectId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher and project reference are required.");
  }
  const tenantReference = input.tenantReference;
  const name = cleanText(input.name, 100);
  const description = cleanText(input.description, 500);
  const requestId = validRequestId(input.requestId);
  if (!name || !requestId) return failure("INVALID_REQUEST", "Enter a collection name and stable request ID.");
  const project = await resolveOwnedProject(env, caller, tenantReference, input.projectId);
  if (!project) return failure("PROJECT_NOT_FOUND", "The requested teacher classroom is unavailable.");
  const requestHash = await hashRequest([project.id, name, description]);
  const existing = await env.DB.prepare(
    "SELECT id,collection_ref,name,description,origin_project_id,management_request_hash FROM brvin_collections WHERE owner_application_id=? AND owner_tenant_ref=? AND management_request_id=? LIMIT 1",
  ).bind(caller.applicationId, tenantReference, requestId).first<{
    id: string; collection_ref: string; name: string; description: string;
    origin_project_id: string; management_request_hash: string | null;
  }>();
  if (existing) {
    if (existing.management_request_hash !== requestHash || existing.origin_project_id !== project.id) {
      return failure("IDEMPOTENCY_CONFLICT", "This request ID was already used with different collection details.");
    }
    return { ok: true, collection: { id: existing.id, reference: existing.collection_ref, name: existing.name, description: existing.description } };
  }
  try {
    const id = crypto.randomUUID().toLowerCase();
    const sequence = await nextReferenceSequence(env, "project:" + project.id + ":collections");
    const collectionReference = hierarchicalReference(project.projectRef, "COL", sequence);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO brvin_collections(id,name,description,status,created_at,updated_at,owner_application_id,owner_tenant_ref,origin_project_id,collection_ref,management_request_id,management_request_hash) " +
        "VALUES(?,?,?,'active',?,?,?,?,?,?,?,?)",
      ).bind(id, name, description, now, now, caller.applicationId, tenantReference, project.id, collectionReference, requestId, requestHash),
      env.DB.prepare(
        "INSERT INTO brvin_project_collections(project_id,collection_id,created_at,created_by) VALUES(?,?,?,'brvin-teachers-management')",
      ).bind(project.id, id, now),
      env.DB.prepare(
        "INSERT INTO brvin_activity_events(project_id,agent,phase,event_type,status,message,detail_json,created_at) " +
        "VALUES(?,'BRVIN Teachers management','governance','teacher_collection.created','completed',?,?,?)",
      ).bind(project.id, "A teacher-owned knowledge collection was created and granted to its originating classroom.", JSON.stringify({ tenantReference, collectionReference, collectionId: id }), now),
    ]);
    return { ok: true, collection: { id, reference: collectionReference, name, description, originProjectId: project.id } };
  } catch {
    const retry = await env.DB.prepare(
      "SELECT id,collection_ref,name,description,origin_project_id,management_request_hash FROM brvin_collections WHERE owner_application_id=? AND owner_tenant_ref=? AND management_request_id=? LIMIT 1",
    ).bind(caller.applicationId, tenantReference, requestId).first<{ id: string; collection_ref: string; name: string; description: string; origin_project_id: string; management_request_hash: string | null }>();
    if (retry) {
      if (retry.management_request_hash !== requestHash || retry.origin_project_id !== project.id) {
        return failure("IDEMPOTENCY_CONFLICT", "This request ID was already used with different collection details.");
      }
      return { ok: true, collection: { id: retry.id, reference: retry.collection_ref, name: retry.name, description: retry.description } };
    }
    return failure("MANAGEMENT_WRITE_FAILED", "BRVIN could not create the teacher collection. The request can be retried safely.", true);
  }
}

async function updateTeacherProject(
  env: Env,
  caller: ManagementCaller,
  input: ProjectInput & { name?: unknown; subject?: unknown; description?: unknown },
): Promise<RpcResult<{ project: Record<string, unknown> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) || typeof input.projectId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher and classroom are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  if (!project) return failure("PROJECT_NOT_FOUND", "The requested teacher classroom is unavailable.");
  const name = cleanText(input.name, 100);
  const subject = cleanText(input.subject, 80);
  const description = cleanText(input.description, 500);
  if (!name || !subject) return failure("INVALID_REQUEST", "Enter a classroom name and subject.");
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE brvin_projects SET name=?,subject=?,description=?,updated_at=? WHERE id=? AND owner_application_id=? AND owner_tenant_ref=?",
  ).bind(name, subject, description, now, project.id, caller.applicationId, input.tenantReference).run();
  await recordManagementActivity(env, {
    projectId: project.id, eventType: "teacher_project.renamed",
    message: "The teacher classroom display details were updated; its project ID and reference remain unchanged.",
    details: { tenantReference: input.tenantReference, projectId: project.id },
  });
  return { ok: true, project: { id: project.id, reference: project.projectRef, name, subject, description } };
}

async function updateTeacherCollection(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput & { name?: unknown; description?: unknown },
): Promise<RpcResult<{ collection: Record<string, unknown> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher, originating classroom and collection are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  const collection = await resolveOwnedCollection(env, caller, input.tenantReference, input.collectionId);
  if (!project || !collection) return failure("RESOURCE_NOT_FOUND", "The classroom or collection is unavailable.");
  if (collection.originProjectId !== project.id) {
    return failure("COLLECTION_OWNER_REQUIRED", "Only the originating classroom can rename this collection.");
  }
  const name = cleanText(input.name, 100);
  const description = cleanText(input.description, 500);
  if (!name) return failure("INVALID_REQUEST", "Enter a collection name.");
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE brvin_collections SET name=?,description=?,updated_at=? WHERE id=? AND owner_application_id=? AND owner_tenant_ref=? AND origin_project_id=?",
  ).bind(name, description, now, collection.id, caller.applicationId, input.tenantReference, project.id).run();
  await recordManagementActivity(env, {
    projectId: project.id, eventType: "teacher_collection.renamed",
    message: "The teacher collection display details were updated; its origin and reference remain unchanged.",
    details: { tenantReference: input.tenantReference, collectionId: collection.id },
  });
  return { ok: true, collection: { id: collection.id, reference: collection.collectionRef, name, description, originProjectId: project.id } };
}

async function changeCollectionGrant(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput,
  grant: boolean,
): Promise<RpcResult<{ projectId: string; collectionId: string }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher, classroom and collection are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  const collection = await resolveOwnedCollection(env, caller, input.tenantReference, input.collectionId);
  if (!project || !collection) return failure("RESOURCE_NOT_FOUND", "The classroom or collection is unavailable.");
  if (!grant && collection.originProjectId === project.id) {
    return failure("ORIGIN_GRANT_REQUIRED", "A collection must remain granted to its originating classroom.");
  }
  if (grant) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO brvin_project_collections(project_id,collection_id,created_at,created_by) VALUES(?,?,?,'brvin-teachers-management')",
    ).bind(project.id, collection.id, Date.now()).run();
    await recordManagementActivity(env, {
      projectId: project.id, eventType: "teacher_collection.shared",
      message: "A teacher-owned collection was shared with another classroom belonging to the same teacher.",
      details: { tenantReference: input.tenantReference, collectionId: collection.id },
    });
  } else {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM brvin_project_collections WHERE project_id=? AND collection_id=?").bind(project.id, collection.id),
      env.DB.prepare(
        "DELETE FROM brvin_project_books WHERE project_id=? AND book_id IN " +
        "(SELECT id FROM brvin_books WHERE collection_id=? OR origin_collection_id=?)",
      ).bind(project.id, collection.id, collection.id),
    ]);
    await recordManagementActivity(env, {
      projectId: project.id, eventType: "teacher_collection.revoked",
      message: "Collection and direct source grants for this collection were revoked from the classroom.",
      details: { tenantReference: input.tenantReference, collectionId: collection.id },
    });
  }
  return { ok: true, projectId: project.id, collectionId: collection.id };
}

async function listTeacherSources(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput,
): Promise<RpcResult<{ sources: Array<Record<string, unknown>> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher, classroom and collection are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  const collection = await resolveOwnedCollection(env, caller, input.tenantReference, input.collectionId);
  if (!project || !collection) return failure("RESOURCE_NOT_FOUND", "The classroom or collection is unavailable.");
  const grant = await env.DB.prepare(
    "SELECT 1 AS allowed FROM brvin_project_collections WHERE project_id=? AND collection_id=? LIMIT 1",
  ).bind(project.id, collection.id).first<{ allowed: number }>();
  if (!grant) return failure("COLLECTION_NOT_GRANTED", "This collection is not available to the selected classroom.");
  const result = await env.DB.prepare(
    "SELECT id,source_ref,title,source_filename,page_count,status,indexed_pages,error_message,created_at,updated_at " +
    "FROM brvin_books WHERE owner_application_id=? AND owner_tenant_ref=? AND origin_collection_id=? " +
    "ORDER BY created_at DESC,id DESC",
  ).bind(caller.applicationId, input.tenantReference, collection.id).all<{
    id: string; source_ref: string | null; title: string; source_filename: string; page_count: number;
    status: string; indexed_pages: number; error_message: string | null; created_at: number; updated_at: number;
  }>();
  return {
    ok: true,
    sources: (result.results ?? []).map(row => ({
      id: row.id, reference: row.source_ref ?? null, title: row.title, filename: row.source_filename,
      pageCount: Number(row.page_count), status: row.status, indexedPages: Number(row.indexed_pages),
      error: row.error_message, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    })),
  };
}

async function startTeacherSourceUpload(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput & { title?: unknown; filename?: unknown; sha256?: unknown; size?: unknown; pageCount?: unknown; costConfirmed?: unknown },
): Promise<RpcResult<{ source: Record<string, unknown>; upload: Record<string, unknown> }>> {
  if (!env.DB || !isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string") {
    return failure("INVALID_REQUEST", "A valid teacher, classroom and collection are required.");
  }
  const project = await resolveOwnedProject(env, caller, input.tenantReference, input.projectId);
  const collection = await resolveOwnedCollection(env, caller, input.tenantReference, input.collectionId);
  if (!project || !collection) return failure("RESOURCE_NOT_FOUND", "The classroom or collection is unavailable.");
  if (collection.originProjectId !== project.id) {
    return failure("COLLECTION_OWNER_REQUIRED", "PDF sources can be added only from the collection's originating classroom.");
  }
  const grant = await env.DB.prepare(
    "SELECT 1 AS allowed FROM brvin_project_collections WHERE project_id=? AND collection_id=? LIMIT 1",
  ).bind(project.id, collection.id).first<{ allowed: number }>();
  if (!grant) return failure("COLLECTION_NOT_GRANTED", "Grant the collection to this classroom before uploading a source.");

  const uploadRequest = new Request("https://brvin-internal.invalid/management/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      collectionId: collection.id, projectIds: [], title: input.title, filename: input.filename,
      sha256: input.sha256, size: input.size, pageCount: input.pageCount, costConfirmed: input.costConfirmed,
    }),
  });
  const forwarded = await jsonResponse(await startBrvinBookUpload(env, uploadRequest, {
    preserveExistingProjectGrants: true,
  }));
  if (forwarded.status < 200 || forwarded.status >= 300 || forwarded.body.ok !== true ||
      typeof forwarded.body.importId !== "string") {
    return failure(
      String(forwarded.body.error ?? "SOURCE_UPLOAD_START_FAILED"),
      "BRVIN could not start the secure source upload: " + cleanText(forwarded.body.error, 160),
      forwarded.status >= 500,
    );
  }
  const source = await finishSourceIdentity(env, caller, input.tenantReference, collection.id, forwarded.body.importId);
  if (!source) return failure("SOURCE_OWNERSHIP_CONFLICT", "The imported source is already associated with a different owner or origin collection.");
  await recordManagementActivity(env, {
    projectId: project.id, bookId: source.sourceId, importId: source.sourceId,
    eventType: "teacher_source.registered",
    message: "A teacher source was registered in its originating collection and secure ingestion was started.",
    details: { tenantReference: input.tenantReference, collectionId: collection.id, sourceReference: source.sourceReference },
  });
  return {
    ok: true,
    source: { id: source.sourceId, reference: source.sourceReference, collectionId: collection.id, collectionReference: collection.collectionRef },
    upload: forwarded.body,
  };
}

async function uploadTeacherSourceChunk(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput & { importId?: unknown; start?: unknown; totalSize?: unknown; bytes?: unknown },
): Promise<RpcResult<{ upload: Record<string, unknown> }>> {
  if (!isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string" ||
      typeof input.importId !== "string" || !Number.isSafeInteger(input.start) ||
      !Number.isSafeInteger(input.totalSize)) {
    return failure("INVALID_REQUEST", "The source upload chunk details are invalid.");
  }
  const authorized = await authorizeSource(env, caller, input.tenantReference, input.projectId, input.collectionId, input.importId);
  if (!authorized) return failure("SOURCE_NOT_AUTHORIZED", "This source upload is not available to the selected classroom.");
  let bytes: ArrayBuffer;
  if (input.bytes instanceof ArrayBuffer) bytes = input.bytes;
  else if (ArrayBuffer.isView(input.bytes)) {
    const view = input.bytes as ArrayBufferView;
    bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  } else return failure("INVALID_REQUEST", "The source chunk bytes are missing.");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_CHUNK_BYTES) return failure("CHUNK_SIZE_INVALID", "Source chunks must be between 1 byte and 8 MiB.");
  const request = new Request("https://brvin-internal.invalid/management/chunk", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-fatman-chunk-start": String(input.start),
      "x-fatman-total-size": String(input.totalSize),
    },
    body: bytes,
  });
  const result = await jsonResponse(await uploadFatmanChunk(env, request, input.importId));
  return result.status >= 200 && result.status < 300 && result.body.ok === true
    ? { ok: true, upload: result.body }
    : failure(String(result.body.error ?? "CHUNK_UPLOAD_FAILED"), "BRVIN could not accept this upload chunk: " + cleanText(result.body.error, 160), result.status >= 500);
}

async function manageSourceLifecycle(
  env: Env,
  caller: ManagementCaller,
  input: CollectionInput & { importId?: unknown },
  action: "complete" | "resume" | "status",
): Promise<RpcResult<{ result: Record<string, unknown> }>> {
  if (!isValidBrvinTeachersTenantReference(input.tenantReference) ||
      typeof input.projectId !== "string" || typeof input.collectionId !== "string" ||
      typeof input.importId !== "string") {
    return failure("INVALID_REQUEST", "The source lifecycle request is invalid.");
  }
  const authorized = await authorizeSource(env, caller, input.tenantReference, input.projectId, input.collectionId, input.importId);
  if (!authorized) return failure("SOURCE_NOT_AUTHORIZED", "This source is not available to the selected classroom.");
  const response = action === "complete"
    ? await completeFatmanUpload(env, input.importId)
    : action === "resume"
      ? await resumeFatmanImport(env, input.importId)
      : await brvinImportStatus(env, input.importId);
  const result = await jsonResponse(response);
  return result.status >= 200 && result.status < 300 && result.body.ok === true
    ? { ok: true, result: result.body }
    : failure(String(result.body.error ?? "SOURCE_OPERATION_FAILED"), "BRVIN could not complete this source operation: " + cleanText(result.body.error, 160), result.status >= 500);
}

export class BrvinTeachersManagementApi extends WorkerEntrypoint<Env, BrvinTeachersManagementProps> {
  private async caller(): Promise<ManagementCaller | null> {
    return resolveCaller(this.env, this.ctx.props?.applicationEnvironmentId);
  }

  async health(): Promise<RpcResult<{ application: string; management: string }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    return { ok: true, application: "brvin-teachers", management: "ready" };
  }

  async listTeacherProjects(input: TenantInput): Promise<RpcResult<{ projects: Array<Record<string, unknown>> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    if (!isValidBrvinTeachersTenantReference(input?.tenantReference)) return failure("INVALID_REQUEST", "A valid teacher reference is required.");
    try { return await listTeacherProjects(this.env, caller, input.tenantReference); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not list this teacher's classrooms.", true); }
  }

  async createTeacherProject(input: TenantInput & { name?: unknown; subject?: unknown; description?: unknown; ownerLabel?: unknown; requestId?: unknown }): Promise<RpcResult<{ project: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await createTeacherProject(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not create this classroom.", true); }
  }

  async listTeacherCollections(input: ProjectInput): Promise<RpcResult<{ collections: Array<Record<string, unknown>> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await listTeacherCollections(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not list this classroom's collections.", true); }
  }

  async createTeacherCollection(input: ProjectInput & { name?: unknown; description?: unknown; requestId?: unknown }): Promise<RpcResult<{ collection: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await createTeacherCollection(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not create this collection.", true); }
  }

  async updateTeacherProject(input: ProjectInput & { name?: unknown; subject?: unknown; description?: unknown }): Promise<RpcResult<{ project: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await updateTeacherProject(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not update this classroom.", true); }
  }

  async updateTeacherCollection(input: CollectionInput & { name?: unknown; description?: unknown }): Promise<RpcResult<{ collection: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await updateTeacherCollection(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not update this collection.", true); }
  }

  async grantTeacherCollection(input: CollectionInput): Promise<RpcResult<{ projectId: string; collectionId: string }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await changeCollectionGrant(this.env, caller, input ?? {}, true); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not share this collection.", true); }
  }

  async revokeTeacherCollection(input: CollectionInput): Promise<RpcResult<{ projectId: string; collectionId: string }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await changeCollectionGrant(this.env, caller, input ?? {}, false); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not revoke this collection.", true); }
  }

  async listTeacherSources(input: CollectionInput): Promise<RpcResult<{ sources: Array<Record<string, unknown>> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await listTeacherSources(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not list this collection's sources.", true); }
  }

  async startTeacherSourceUpload(input: CollectionInput & { title?: unknown; filename?: unknown; sha256?: unknown; size?: unknown; pageCount?: unknown; costConfirmed?: unknown }): Promise<RpcResult<{ source: Record<string, unknown>; upload: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await startTeacherSourceUpload(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not start this source upload.", true); }
  }

  async uploadTeacherSourceChunk(input: CollectionInput & { importId?: unknown; start?: unknown; totalSize?: unknown; bytes?: unknown }): Promise<RpcResult<{ upload: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await uploadTeacherSourceChunk(this.env, caller, input ?? {}); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not upload this source chunk.", true); }
  }

  async completeTeacherSourceUpload(input: CollectionInput & { importId?: unknown }): Promise<RpcResult<{ result: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await manageSourceLifecycle(this.env, caller, input ?? {}, "complete"); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not complete this upload.", true); }
  }

  async resumeTeacherSourceUpload(input: CollectionInput & { importId?: unknown }): Promise<RpcResult<{ result: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await manageSourceLifecycle(this.env, caller, input ?? {}, "resume"); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not resume this import.", true); }
  }

  async getTeacherSourceStatus(input: CollectionInput & { importId?: unknown }): Promise<RpcResult<{ result: Record<string, unknown> }>> {
    const caller = await this.caller();
    if (!caller) return failure("APPLICATION_ENVIRONMENT_NOT_REGISTERED", "The BRVIN Teachers application environment is not registered or active.");
    try { return await manageSourceLifecycle(this.env, caller, input ?? {}, "status"); }
    catch { return failure("BRVIN_UNAVAILABLE", "BRVIN could not read this import status.", true); }
  }
}
