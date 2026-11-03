import type { Env } from "../config/env";
import { ensureAnalyticsSchema, recordBrvinActivity } from "../analytics/db";
import { json } from "../http/response";
import {
  fatmanUploadStatus,
  getFatmanImportJob,
  startFatmanLibraryUpload,
} from "../fatman/import";

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
}

const BRVIN_INLINE_SCRIPT_START = '<script type="module">';
const BRVIN_INLINE_SCRIPT_END = "</script>";

function brvinClientScriptSource(): string {
  const start = HTML.indexOf(BRVIN_INLINE_SCRIPT_START);
  if (start < 0) throw new Error("BRVIN client script marker is missing.");
  const bodyStart = start + BRVIN_INLINE_SCRIPT_START.length;
  const end = HTML.indexOf(BRVIN_INLINE_SCRIPT_END, bodyStart);
  if (end < 0) throw new Error("BRVIN client script closing marker is missing.");
  return HTML.slice(bodyStart, end);
}

export function brvinAdminPage(): Response {
  const start = HTML.indexOf(BRVIN_INLINE_SCRIPT_START);
  const end = HTML.indexOf(BRVIN_INLINE_SCRIPT_END, start);
  if (start < 0 || end < 0) throw new Error("BRVIN client script markers are missing.");
  const html = HTML.slice(0, start) +
    '<script src="/admin/brvin/app.js" defer></script>' +
    HTML.slice(end + BRVIN_INLINE_SCRIPT_END.length);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function brvinAdminScript(): Response {
  const body = brvinClientScriptSource();
  // Deliver a same-origin classic script rather than an inline ES module.
  // This avoids inline-module restrictions in mobile browsers and makes the
  // dashboard client independently observable in network diagnostics.
  const script = [
    "(async function brvinBoot(){",
    body,
    "})().catch(function(error){",
    "  var label=document.getElementById('live-label');",
    "  if(label) label.textContent='LIVE · startup error';",
    "  console.error('BRVIN dashboard startup failed',error);",
    "});",
  ].join("\n");
  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function brvinOverview(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  try {
    await ensureAnalyticsSchema(env);
    const now = Date.now();
    const [stats, collections, projects, books, bookAssignments, collectionAssignments, jobs, events] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS books, COALESCE(SUM(page_count),0) AS total_pages, " +
        "COALESCE(SUM(indexed_pages),0) AS indexed_pages, " +
        "SUM(CASE WHEN status='ready' AND indexed_pages=page_count THEN 1 ELSE 0 END) AS ready_books, " +
        "SUM(CASE WHEN status IN ('uploading','uploaded','processing') THEN 1 ELSE 0 END) AS active_books, " +
        "SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_books " +
        "FROM brvin_books"
      ).first<Record<string, number>>(),
      env.DB.prepare(
        "SELECT c.id,c.name,c.description,c.status,c.created_at,c.updated_at,COUNT(b.id) AS book_count," +
        "COALESCE(SUM(b.page_count),0) AS page_count,COALESCE(SUM(b.indexed_pages),0) AS indexed_pages " +
        "FROM brvin_collections c LEFT JOIN brvin_books b ON b.collection_id=c.id " +
        "GROUP BY c.id ORDER BY c.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT p.id,p.name,p.slug,p.description,p.status,p.created_at,p.updated_at," +
        "(SELECT COUNT(DISTINCT pb.book_id) FROM brvin_project_books pb WHERE pb.project_id=p.id) AS direct_books," +
        "(SELECT COUNT(DISTINCT b.id) FROM brvin_project_collections pc JOIN brvin_books b ON b.collection_id=pc.collection_id WHERE pc.project_id=p.id) AS collection_books " +
        "FROM brvin_projects p ORDER BY p.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT b.id,b.title,b.source_filename,b.page_count,b.indexed_pages,b.status,b.error_message,b.collection_id," +
        "b.search_prefix,b.source_type,b.vision_output_deleted_at,b.vision_output_deletion_started_at,b.created_at,b.updated_at,c.name AS collection_name " +
        "FROM brvin_books b LEFT JOIN brvin_collections c ON c.id=b.collection_id " +
        "ORDER BY b.updated_at DESC LIMIT 200"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT pb.book_id,p.id AS project_id,p.name AS project_name FROM brvin_project_books pb " +
        "JOIN brvin_projects p ON p.id=pb.project_id WHERE p.status='active'"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT pc.collection_id,p.id AS project_id,p.name AS project_name FROM brvin_project_collections pc " +
        "JOIN brvin_projects p ON p.id=pc.project_id WHERE p.status='active'"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT j.id,j.status,j.uploaded_bytes,j.expected_size,j.indexed_pages,j.error_message,j.workflow_instance_id," +
        "j.vision_operation,j.created_at,j.updated_at,b.title,b.page_count,b.collection_id " +
        "FROM fatman_import_jobs j JOIN brvin_books b ON b.id=j.id " +
        "WHERE j.status IN ('uploading','uploaded','processing','failed','deleting','delete_failed') " +
        "ORDER BY j.updated_at DESC LIMIT 30"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT id,import_id,book_id,project_id,agent,phase,event_type,status,message,detail_json,created_at " +
        "FROM brvin_activity_events WHERE created_at>=? ORDER BY id DESC LIMIT 100"
      ).bind(now - 7 * 86_400_000).all<Record<string, unknown>>(),
    ]);

    const directByBook = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of bookAssignments.results ?? []) {
      const id = String(row.book_id);
      const list = directByBook.get(id) ?? [];
      list.push({ id: String(row.project_id), name: String(row.project_name) });
      directByBook.set(id, list);
    }
    const collectionProjectMap = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of collectionAssignments.results ?? []) {
      const id = String(row.collection_id);
      const list = collectionProjectMap.get(id) ?? [];
      list.push({ id: String(row.project_id), name: String(row.project_name) });
      collectionProjectMap.set(id, list);
    }

    return json({
      ok: true,
      generatedAt: now,
      stats: {
        books: Number(stats?.books ?? 0), collections: collections.results?.length ?? 0,
        projects: projects.results?.length ?? 0, totalPages: Number(stats?.total_pages ?? 0),
        indexedPages: Number(stats?.indexed_pages ?? 0), readyBooks: Number(stats?.ready_books ?? 0),
        activeBooks: Number(stats?.active_books ?? 0), failedBooks: Number(stats?.failed_books ?? 0),
      },
      collections: (collections.results ?? []).map((row) => ({
        id: String(row.id), name: String(row.name), description: String(row.description ?? ""),
        status: String(row.status), bookCount: Number(row.book_count ?? 0),
        pageCount: Number(row.page_count ?? 0), indexedPages: Number(row.indexed_pages ?? 0),
        projects: collectionProjectMap.get(String(row.id)) ?? [],
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      })),
      projects: (projects.results ?? []).map((row) => ({
        id: String(row.id), name: String(row.name), slug: String(row.slug),
        description: String(row.description ?? ""), status: String(row.status),
        directBooks: Number(row.direct_books ?? 0), collectionBooks: Number(row.collection_books ?? 0),
      })),
      books: (books.results ?? []).map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.source_filename ?? ""),
        pageCount: Number(row.page_count ?? 0), indexedPages: Number(row.indexed_pages ?? 0),
        status: String(row.status), error: row.error_message ? String(row.error_message) : undefined,
        collectionId: String(row.collection_id), collectionName: String(row.collection_name ?? "Unassigned"),
        searchPrefix: String(row.search_prefix), sourceType: String(row.source_type),
        visionOcrDeleted: row.vision_output_deleted_at !== null && row.vision_output_deleted_at !== undefined,
        visionOcrDeleting: row.vision_output_deletion_started_at !== null && row.vision_output_deletion_started_at !== undefined,
        directProjects: directByBook.get(String(row.id)) ?? [],
        collectionProjects: collectionProjectMap.get(String(row.collection_id)) ?? [],
        projects: [...(directByBook.get(String(row.id)) ?? []), ...(collectionProjectMap.get(String(row.collection_id)) ?? []).filter(project =>
          !(directByBook.get(String(row.id)) ?? []).some(direct => direct.id === project.id))],
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      })),
      jobs: (jobs.results ?? []).map((row) => ({
        id: String(row.id), title: String(row.title), status: String(row.status),
        uploadedBytes: Number(row.uploaded_bytes ?? 0), expectedBytes: Number(row.expected_size ?? 0),
        indexedPages: Number(row.indexed_pages ?? 0), pageCount: Number(row.page_count ?? 0),
        error: row.error_message ? String(row.error_message) : undefined,
        workflowId: row.workflow_instance_id ? String(row.workflow_instance_id) : undefined,
        hasOcrOperation: Boolean(row.vision_operation), updatedAt: Number(row.updated_at),
      })),
      events: (events.results ?? []).map((row) => ({
        id: Number(row.id), importId: row.import_id ? String(row.import_id) : undefined,
        bookId: row.book_id ? String(row.book_id) : undefined,
        projectId: row.project_id ? String(row.project_id) : undefined,
        agent: String(row.agent), phase: String(row.phase), type: String(row.event_type),
        status: String(row.status), message: String(row.message),
        details: parseDetails(row.detail_json), createdAt: Number(row.created_at),
      })),
    });
  } catch (error) {
    return json({ ok: false, error: friendlyError(error) }, 502);
  }
}

function parseDetails(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

interface BrvinDeletionCandidate {
  id: string;
  title: string;
  status: string;
  source_type: string;
  search_prefix: string;
  import_status: string;
  uploaded_bytes: number;
  expected_size: number;
  indexed_pages: number;
  page_count: number;
  vision_output_deleted_at: number | null;
  vision_output_deletion_started_at: number | null;
}

const DELETABLE_BOOK_STATUSES = ["ready", "failed", "completed", "delete_failed", "archived"];
const DELETABLE_IMPORT_STATUSES = ["completed", "failed", "delete_failed"];

async function findBrvinDeletionCandidate(env: Env, bookId: string): Promise<BrvinDeletionCandidate | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    "SELECT b.id,b.title,b.status,b.source_type,b.search_prefix,b.indexed_pages,b.page_count," +
    "j.status AS import_status,j.uploaded_bytes,j.expected_size,b.vision_output_deleted_at,b.vision_output_deletion_started_at " +
    "FROM brvin_books b JOIN fatman_import_jobs j ON j.id=b.id AND j.book_id=b.id WHERE b.id=? LIMIT 1"
  ).bind(bookId).first<BrvinDeletionCandidate>();
}

async function startBrvinDeletionWorkflow(
  env: Env,
  candidate: BrvinDeletionCandidate,
  mode: "book" | "vision_output",
): Promise<{ workflowId: string; status: "deleting" | "vision_output_deleting" }> {
  if (!env.DB || !env.FATMAN_IMPORT || !env.FATMAN_SEARCH || !env.FATMAN_INSTANCE_NAME?.trim()) {
    throw new Error("BRVIN deletion services are not fully configured.");
  }
  if (candidate.source_type !== "pdf") {
    throw new Error("Built-in or legacy knowledge sources are protected from imported-book deletion.");
  }
  if (!/^[a-f0-9-]{36}$/iu.test(candidate.id) ||
      !["brvin/books/" + candidate.id + "/pages/", "fatman/books/" + candidate.id + "/pages/"].includes(candidate.search_prefix)) {
    throw new Error("The book's registered search prefix is invalid; deletion was refused.");
  }
  if (Number(candidate.uploaded_bytes) !== Number(candidate.expected_size) || Number(candidate.expected_size) <= 0) {
    throw new Error("The original PDF upload is incomplete; finish or repair the upload before deleting this book.");
  }

  const workflowId = candidate.id + (mode === "book" ? "-delete-" : "-ocr-delete-") +
    crypto.randomUUID().replaceAll("-", "").slice(0, 12);

  if (mode === "vision_output") {
    if (candidate.status !== "ready" || candidate.import_status !== "completed" ||
        Number(candidate.indexed_pages) !== Number(candidate.page_count)) {
      throw new Error("OCR-only cleanup is available only after the book is ready and all pages passed retrieval QA.");
    }
    if (candidate.vision_output_deleted_at) throw new Error("Vision OCR output has already been removed for this book.");
    if (candidate.vision_output_deletion_started_at) throw new Error("Vision OCR cleanup is already running for this book.");
    const reserved = await env.DB.prepare(
      "UPDATE brvin_books SET vision_output_deletion_started_at=?,updated_at=? " +
      "WHERE id=? AND status='ready' AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NULL"
    ).bind(Date.now(), Date.now(), candidate.id).run();
    if ((reserved.meta?.changes ?? 0) !== 1) throw new Error("The book changed state. Refresh the dashboard and retry.");
    try {
      await env.FATMAN_IMPORT.create({
        id: workflowId,
        params: { importId: candidate.id, task: "delete_vision_output" },
      });
    } catch (error) {
      await env.DB.prepare(
        "UPDATE brvin_books SET vision_output_deletion_started_at=NULL,updated_at=? WHERE id=? AND vision_output_deleted_at IS NULL"
      ).bind(Date.now(), candidate.id).run().catch(() => undefined);
      throw error;
    }
    await recordBrvinActivity(env, {
      importId: candidate.id, bookId: candidate.id, agent: "Storage retention supervisor",
      phase: "retention", eventType: "source.vision_ocr_deletion_requested", status: "info",
      message: "An administrator requested deletion of saved Google Vision OCR output only. The original PDF and indexed pages will be retained.",
      details: { mode: "vision_output_only", originalPdfRetained: true, indexedPagesRetained: true },
    }).catch(() => undefined);
    return { workflowId, status: "vision_output_deleting" };
  }

  if (candidate.vision_output_deletion_started_at) {
    throw new Error("Vision OCR cleanup is running. Wait for it to finish before deleting the full book.");
  }
  if (!DELETABLE_BOOK_STATUSES.includes(candidate.status) ||
      !DELETABLE_IMPORT_STATUSES.includes(candidate.import_status)) {
    throw new Error("This book is uploading or processing. Wait until its workflow finishes before deleting it.");
  }

  const now = Date.now();
  const transition = await env.DB.batch([
    env.DB.prepare(
      "UPDATE brvin_books SET status='deleting',error_message=NULL,updated_at=? " +
      "WHERE id=? AND source_type='pdf' AND status=?"
    ).bind(now, candidate.id, candidate.status),
    env.DB.prepare(
      "UPDATE fatman_import_jobs SET status='deleting',workflow_instance_id=?,error_message=NULL,updated_at=? " +
      "WHERE id=? AND book_id=? AND status=? AND uploaded_bytes=expected_size"
    ).bind(workflowId, now, candidate.id, candidate.id, candidate.import_status),
  ]);
  const bookChanges = Number(transition[0]?.meta?.changes ?? 0);
  const importChanges = Number(transition[1]?.meta?.changes ?? 0);
  if (bookChanges !== 1 || importChanges !== 1) {
    await env.DB.batch([
      env.DB.prepare("UPDATE brvin_books SET status=?,updated_at=? WHERE id=? AND status='deleting'")
        .bind(candidate.status, Date.now(), candidate.id),
      env.DB.prepare("UPDATE fatman_import_jobs SET status=?,workflow_instance_id=NULL,updated_at=? WHERE id=? AND status='deleting' AND workflow_instance_id=?")
        .bind(candidate.import_status, Date.now(), candidate.id, workflowId),
    ]);
    throw new Error("The book changed state during deletion setup. Refresh the dashboard and try again.");
  }

  try {
    await env.FATMAN_IMPORT.create({
      id: workflowId,
      params: { importId: candidate.id, task: "delete_book" },
    });
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE brvin_books SET status=?,error_message=NULL,updated_at=? WHERE id=? AND status='deleting'")
        .bind(candidate.status, Date.now(), candidate.id),
      env.DB.prepare("UPDATE fatman_import_jobs SET status=?,workflow_instance_id=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='deleting' AND workflow_instance_id=?")
        .bind(candidate.import_status, Date.now(), candidate.id, workflowId),
    ]);
    throw error;
  }

  await recordBrvinActivity(env, {
    importId: candidate.id, bookId: candidate.id, agent: "Deletion supervisor",
    phase: "deletion", eventType: "book.deletion_requested", status: "running",
    message: "An administrator requested complete deletion of this book, its private PDF, Vision OCR output, indexed pages, access grants and BRVIN registry records.",
    details: {
      title: candidate.title,
      mode: "full_book",
      searchPrefix: candidate.search_prefix,
      gcsPrefix: "book-specific import prefix",
    },
  }).catch(() => undefined);
  return { workflowId, status: "deleting" };
}

export async function deleteBrvinBook(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { bookId?: unknown; confirmTitle?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid deletion request." }, 400); }
  const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
  const confirmTitle = typeof body.confirmTitle === "string" ? body.confirmTitle.trim() : "";
  if (!/^[a-f0-9-]{36}$/iu.test(bookId)) return json({ ok: false, error: "Choose a valid BRVIN book." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const candidate = await findBrvinDeletionCandidate(env, bookId);
    if (!candidate) return json({ ok: false, error: "This imported BRVIN book or its import record could not be found." }, 404);
    if (confirmTitle !== candidate.title) return json({ ok: false, error: "The confirmation title does not match the book name." }, 400);
    const result = await startBrvinDeletionWorkflow(env, candidate, "book");
    return json({ ok: true, bookId, title: candidate.title, ...result }, 202);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function deleteBrvinVisionOutput(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { bookId?: unknown; confirmTitle?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid OCR cleanup request." }, 400); }
  const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
  const confirmTitle = typeof body.confirmTitle === "string" ? body.confirmTitle.trim() : "";
  if (!/^[a-f0-9-]{36}$/iu.test(bookId)) return json({ ok: false, error: "Choose a valid BRVIN book." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const candidate = await findBrvinDeletionCandidate(env, bookId);
    if (!candidate) return json({ ok: false, error: "This imported BRVIN book or its import record could not be found." }, 404);
    if (confirmTitle !== candidate.title) return json({ ok: false, error: "The confirmation title does not match the book name." }, 400);
    if (candidate.vision_output_deleted_at) return json({ ok: false, error: "Vision OCR output has already been removed for this book." }, 409);
    const result = await startBrvinDeletionWorkflow(env, candidate, "vision_output");
    return json({ ok: true, bookId, title: candidate.title, ...result }, 202);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

/**
 * Archive/restore imported PDFs without deleting the source, OCR output, index, or project grants.
 * Project retrieval only exposes status='ready', so this status change is the access gate.
 */
export async function archiveBrvinBook(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { bookId?: unknown; action?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ ok: false, error: "Invalid archive request." }, 400); }
  const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
  const action = body.action === "archive" || body.action === "restore" ? body.action : null;
  if (!/^[a-f0-9-]{36}$/iu.test(bookId)) return json({ ok: false, error: "Choose a valid imported book." }, 400);
  if (!action) return json({ ok: false, error: "Choose archive or restore." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const candidate = await env.DB.prepare(
      "SELECT b.id,b.title,b.status,b.source_type,b.indexed_pages,b.page_count,b.vision_output_deletion_started_at," +
      "j.status AS import_status,j.uploaded_bytes,j.expected_size,f.status AS fatman_status " +
      "FROM brvin_books b JOIN fatman_import_jobs j ON j.id=b.id AND j.book_id=b.id " +
      "JOIN fatman_books f ON f.id=b.id WHERE b.id=? LIMIT 1"
    ).bind(bookId).first<{
      id: string; title: string; status: string; source_type: string;
      indexed_pages: number; page_count: number; vision_output_deletion_started_at: number | null;
      import_status: string; uploaded_bytes: number; expected_size: number; fatman_status: string;
    }>();
    if (!candidate) return json({ ok: false, error: "This imported book or its paired import records could not be found." }, 404);
    if (candidate.source_type !== "pdf") return json({ ok: false, error: "Built-in and legacy knowledge sources cannot be archived or restored here." }, 409);
    const expectedStatus = action === "archive" ? "ready" : "archived";
    const nextStatus = action === "archive" ? "archived" : "ready";
    if (candidate.status !== expectedStatus || candidate.fatman_status !== expectedStatus) {
      return json({ ok: false, error: action === "archive" ? "Only a fully ready book can be archived." : "Only an archived book can be restored." }, 409);
    }
    if (candidate.import_status !== "completed" || Number(candidate.expected_size) <= 0 ||
        Number(candidate.uploaded_bytes) !== Number(candidate.expected_size) ||
        Number(candidate.indexed_pages) !== Number(candidate.page_count) || Number(candidate.page_count) <= 0) {
      return json({ ok: false, error: "The complete PDF and verified page index are required before changing archive state." }, 409);
    }
    if (candidate.vision_output_deletion_started_at !== null && candidate.vision_output_deletion_started_at !== undefined) {
      return json({ ok: false, error: "Wait for OCR file cleanup to finish before changing archive state." }, 409);
    }
    const now = Date.now();
    const updates = await env.DB.batch([
      env.DB.prepare("UPDATE brvin_books SET status=?,updated_at=? WHERE id=? AND source_type='pdf' AND status=? AND vision_output_deletion_started_at IS NULL").bind(nextStatus, now, bookId, expectedStatus),
      env.DB.prepare("UPDATE fatman_books SET status=?,updated_at=? WHERE id=? AND status=?").bind(nextStatus, now, bookId, expectedStatus),
    ]);
    const bookChanges = Number(updates[0]?.meta?.changes ?? 0);
    const fatmanChanges = Number(updates[1]?.meta?.changes ?? 0);
    if (bookChanges !== 1 || fatmanChanges !== 1) {
      const rollback = [];
      if (bookChanges === 1) rollback.push(
        env.DB.prepare("UPDATE brvin_books SET status=?,updated_at=? WHERE id=? AND status=?").bind(expectedStatus, Date.now(), bookId, nextStatus),
      );
      if (fatmanChanges === 1) rollback.push(
        env.DB.prepare("UPDATE fatman_books SET status=?,updated_at=? WHERE id=? AND status=?").bind(expectedStatus, Date.now(), bookId, nextStatus),
      );
      if (rollback.length) await env.DB.batch(rollback).catch(() => undefined);
      return json({ ok: false, error: "The book changed state during this request. Refresh the library and try again." }, 409);
    }
    await recordBrvinActivity(env, {
      importId: bookId, bookId, agent: "BRVIN archive control", phase: "governance",
      eventType: action === "archive" ? "book.archived" : "book.restored", status: "completed",
      message: action === "archive"
        ? "The book was archived. Its source PDF, Vision OCR output, indexed pages and project grants were retained; retrieval is disabled until restoration."
        : "The archived book was restored. Its retained indexed pages and existing project grants are available to assigned projects again.",
      details: { action, title: candidate.title, sourceRetained: true, ocrOutputRetained: true, indexedPagesRetained: true, projectGrantsRetained: true, retrievalAvailable: action === "restore" },
    });
    return json({ ok: true, bookId, title: candidate.title, status: nextStatus, retrievalAvailable: action === "restore",
      retained: ["source_pdf", "vision_ocr_output", "ai_search_pages", "project_grants"] });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}
export async function clearBrvinKnowledgeSources(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { confirmation?: unknown; expectedCount?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid clear request." }, 400); }
  if (body.confirmation !== "DELETE ALL BRVIN BOOKS") {
    return json({ ok: false, error: "Type DELETE ALL BRVIN BOOKS exactly to confirm this operation." }, 400);
  }
  const expectedCount = Number(body.expectedCount);
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > 100) {
    return json({ ok: false, error: "Bulk clear handles up to 100 imported books per confirmation. Clear the library in batches of 100 or delete individual books." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const result = await env.DB.prepare(
      "SELECT b.id,b.title,b.status,b.source_type,b.search_prefix,b.indexed_pages,b.page_count," +
      "j.status AS import_status,j.uploaded_bytes,j.expected_size,b.vision_output_deleted_at,b.vision_output_deletion_started_at " +
      "FROM brvin_books b JOIN fatman_import_jobs j ON j.id=b.id AND j.book_id=b.id " +
      "WHERE b.source_type='pdf' ORDER BY b.created_at"
    ).all<BrvinDeletionCandidate>();
    const candidates = result.results ?? [];
    if (candidates.length !== expectedCount) {
      return json({ ok: false, error: "The source count changed since the confirmation prompt. Refresh and try again.", currentCount: candidates.length }, 409);
    }
    const active = candidates.filter(candidate =>
      !DELETABLE_BOOK_STATUSES.includes(candidate.status) ||
      !DELETABLE_IMPORT_STATUSES.includes(candidate.import_status) ||
      candidate.vision_output_deletion_started_at !== null
    );
    if (active.length) {
      return json({
        ok: false,
        error: "One or more books are still uploading or processing. Wait for those workflows to finish, then clear all sources.",
        activeBooks: active.map(candidate => ({ id: candidate.id, title: candidate.title, status: candidate.status })),
      }, 409);
    }
    const started: Array<{ id: string; title: string; workflowId: string }> = [];
    const errors: Array<{ id: string; title: string; error: string }> = [];
    for (const candidate of candidates) {
      try {
        const result = await startBrvinDeletionWorkflow(env, candidate, "book");
        started.push({ id: candidate.id, title: candidate.title, workflowId: result.workflowId });
      } catch (error) {
        errors.push({ id: candidate.id, title: candidate.title, error: friendlyError(error) });
      }
    }
    if (!started.length && errors.length) {
      return json({ ok: false, error: "No book deletion workflows could be started.", errors }, 409);
    }
    return json({
      ok: true,
      complete: errors.length === 0,
      startedCount: started.length,
      failedToStartCount: errors.length,
      started,
      errors,
      note: "Only imported PDF books are included. The built-in Fatman source, project and collection definitions, and audit events are preserved. Each book is independently deleted by its background workflow.",
    }, 202);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function brvinImportStatus(env: Env, importId: string | null): Promise<Response> {
  if (!importId || !/^[a-f0-9-]{36}$/iu.test(importId)) return json({ ok: false, error: "Choose a valid book import." }, 400);
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job?.book_id) return json({ ok: false, error: "This BRVIN import could not be found." }, 404);
    const response = await fatmanUploadStatus(env, importId, true);
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) return json(payload, response.status);
    const events = await env.DB!.prepare(
      "SELECT id,agent,phase,event_type,status,message,detail_json,created_at FROM brvin_activity_events " +
      "WHERE import_id=? ORDER BY id DESC LIMIT 100"
    ).bind(importId).all<Record<string, unknown>>();
    return json({
      ...payload,
      events: (events.results ?? []).map((row) => ({
        id: Number(row.id), agent: String(row.agent), phase: String(row.phase),
        type: String(row.event_type), status: String(row.status), message: String(row.message),
        details: parseDetails(row.detail_json), createdAt: Number(row.created_at),
      })),
    });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function startBrvinBookUpload(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "The upload details could not be read." }, 400); }

  const collectionId = typeof body.collectionId === "string" ? body.collectionId : "general";
  const projectIds = Array.isArray(body.projectIds)
    ? [...new Set(body.projectIds.filter((value): value is string => typeof value === "string"))].slice(0, 50)
    : [];
  try {
    await ensureAnalyticsSchema(env);
    const collection = await env.DB.prepare(
      "SELECT id FROM brvin_collections WHERE id=? AND status='active'"
    ).bind(collectionId).first<{ id: string }>();
    if (!collection) return json({ ok: false, error: "Choose an active BRVIN collection." }, 400);
    if (projectIds.length) {
      const placeholders = projectIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM brvin_projects WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...projectIds).all<{ id: string }>();
      if ((result.results ?? []).length !== projectIds.length) {
        return json({ ok: false, error: "One or more selected projects are unavailable." }, 400);
      }
    }

    const uploadPayload = {
      title: body.title, filename: body.filename, sha256: body.sha256, size: body.size,
      pageCount: body.pageCount, costConfirmed: body.costConfirmed,
    };
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set("content-type", "application/json");
    forwardedHeaders.delete("content-length");
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(uploadPayload),
    });
    const response = await startFatmanLibraryUpload(env, forwarded);
    const payload = await response.clone().json() as { ok?: boolean; importId?: string; status?: string };
    if (!response.ok || payload.ok !== true || !payload.importId) return response;

    const now = Date.now();
    const statements = [
      env.DB.prepare("UPDATE brvin_books SET collection_id=?,updated_at=? WHERE id=?").bind(collectionId, now, payload.importId),
      env.DB.prepare("DELETE FROM brvin_project_books WHERE book_id=?").bind(payload.importId),
    ];
    for (const projectId of projectIds) {
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO brvin_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
      ).bind(projectId, payload.importId, now));
    }
    await env.DB.batch(statements);
    await recordBrvinActivity(env, {
      importId: payload.importId, bookId: payload.importId, agent: "BRVIN ingestion gateway",
      phase: "registration", eventType: "book.registered", status: "completed",
      message: "The knowledge source was registered in BRVIN and assigned to its selected collection and projects.",
      details: { collectionId, projectIds, status: payload.status ?? "uploading" },
    });
    return response;
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function createBrvinProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { name?: unknown; description?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid project details." }, 400); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const slug = slugify(name);
  if (!name || !slug) return json({ ok: false, error: "Enter a valid project name." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO brvin_projects (id,name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)"
    ).bind(id, name, slug, description, now, now).run();
    await recordBrvinActivity(env, {
      projectId: id, agent: "BRVIN access control", phase: "governance",
      eventType: "project.created", status: "completed",
      message: "A new project identity was created. It has no knowledge access until sources are assigned.",
    });
    return json({ ok: true, project: { id, name, slug, description } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function createBrvinCollection(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { name?: unknown; description?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid collection details." }, 400); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!name) return json({ ok: false, error: "Enter a collection name." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO brvin_collections (id,name,description,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)"
    ).bind(id, name, description, now, now).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN knowledge governance", phase: "governance",
      eventType: "collection.created", status: "completed",
      message: "The knowledge collection was created and is not automatically shared with projects.",
      details: { collectionId: id, name },
    });
    return json({ ok: true, collection: { id, name, description } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function assignBrvinBookProjects(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { bookId?: unknown; projectIds?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid assignment details." }, 400); }
  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  const projectIds = Array.isArray(body.projectIds)
    ? [...new Set(body.projectIds.filter((value): value is string => typeof value === "string"))].slice(0, 50)
    : [];
  if (!/^[a-f0-9-]{36}$/iu.test(bookId)) return json({ ok: false, error: "Invalid book identifier." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const book = await env.DB.prepare("SELECT id FROM brvin_books WHERE id=?").bind(bookId).first<{ id: string }>();
    if (!book) return json({ ok: false, error: "Knowledge source not found." }, 404);
    if (projectIds.length) {
      const placeholders = projectIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM brvin_projects WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...projectIds).all<{ id: string }>();
      if ((result.results ?? []).length !== projectIds.length) return json({ ok: false, error: "One or more selected projects are unavailable." }, 400);
    }
    const now = Date.now();
    const statements = [env.DB.prepare("DELETE FROM brvin_project_books WHERE book_id=?").bind(bookId)];
    for (const projectId of projectIds) statements.push(env.DB.prepare(
      "INSERT INTO brvin_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
    ).bind(projectId, bookId, now));
    await env.DB.batch(statements);
    await recordBrvinActivity(env, {
      bookId, agent: "BRVIN access control", phase: "governance", eventType: "book.access_updated",
      status: "completed", message: "Project access for this knowledge source was updated.",
      details: { projectIds },
    });
    return json({ ok: true, bookId, projectIds });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function assignBrvinProjectCollections(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { projectId?: unknown; collectionIds?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid assignment details." }, 400); }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const collectionIds = Array.isArray(body.collectionIds)
    ? [...new Set(body.collectionIds.filter((value): value is string => typeof value === "string"))].slice(0, 50)
    : [];
  if (!projectId) return json({ ok: false, error: "Select a project." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare("SELECT id FROM brvin_projects WHERE id=? AND status='active'").bind(projectId).first<{ id: string }>();
    if (!project) return json({ ok: false, error: "Project not found." }, 404);
    if (collectionIds.length) {
      const placeholders = collectionIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM brvin_collections WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...collectionIds).all<{ id: string }>();
      if ((result.results ?? []).length !== collectionIds.length) return json({ ok: false, error: "One or more collections are unavailable." }, 400);
    }
    const now = Date.now();
    const statements = [env.DB.prepare("DELETE FROM brvin_project_collections WHERE project_id=?").bind(projectId)];
    for (const collectionId of collectionIds) statements.push(env.DB.prepare(
      "INSERT INTO brvin_project_collections (project_id,collection_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
    ).bind(projectId, collectionId, now));
    await env.DB.batch(statements);
    await recordBrvinActivity(env, {
      projectId, agent: "BRVIN access control", phase: "governance", eventType: "project.collections_updated",
      status: "completed", message: "The collections available to this project were updated.",
      details: { collectionIds },
    });
    return json({ ok: true, projectId, collectionIds });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BRVIN · Knowledge Intelligence</title>
<style>:root{color-scheme:light;--bg:#f5f5f7;--surface:#fff;--ink:#17191f;--muted:#737985;--line:#e7e8ec;--blue:#2764d8;--green:#16835b;--red:#b33b3b;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:14px}button,input,select,textarea{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #2f6fe44a;outline-offset:2px}
.shell{max-width:1600px;margin:auto;padding:22px 26px 42px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:2px 0 20px;border-bottom:1px solid var(--line)}.brand-wrap{display:flex;align-items:center;gap:12px}.brand-mark{width:38px;height:38px;border-radius:12px;background:#20232b;color:#fff;display:grid;place-items:center;font-size:15px;font-weight:750}.brand{font-size:20px;font-weight:720;letter-spacing:-.055em;margin:0}.brand-caption{font-size:11px;color:var(--muted);margin-top:3px}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.btn{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:9px 13px;font-size:12px;font-weight:650;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px}.btn:hover{background:#f7f8fa;border-color:#d6d9df}.btn.primary{background:#20232b;color:#fff;border-color:#20232b}.btn.primary:hover{background:#343944}.btn.danger{color:#a52f2f;background:#fff;border-color:#efd6d6}.btn:disabled{opacity:.45;cursor:wait}.live{display:inline-flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);font-weight:650;white-space:nowrap}.live i{width:7px;height:7px;background:#20a36c;border-radius:50%;box-shadow:0 0 0 4px #20a36c18}
.app-layout{display:grid;grid-template-columns:214px minmax(0,1fr);gap:34px;padding-top:24px;align-items:start}.sidebar{position:sticky;top:18px;display:flex;flex-direction:column;gap:22px}.nav-label{font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;color:#9a9eaa;padding:0 12px 8px}.nav-list{display:flex;flex-direction:column;gap:3px}.nav-item{width:100%;display:flex;align-items:center;gap:11px;text-align:left;background:transparent;border:0;border-radius:10px;padding:10px 12px;color:#626875;font-size:13px;font-weight:600}.nav-item:hover{background:#eceef2;color:#252933}.nav-item.active{background:#e9ebf0;color:#171a22;font-weight:720}.nav-icon{width:17px;text-align:center;font-size:14px;color:#89909c}.workspace{min-width:0;max-width:1220px;width:100%}.view{display:none}.view.active{display:block;animation:appear .2s ease}@keyframes appear{from{opacity:.45;transform:translateY(3px)}to{opacity:1;transform:none}}
.page-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin:4px 0 22px}.eyebrow{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#9298a4;font-weight:760}.page-heading h1{font-size:29px;letter-spacing:-.055em;line-height:1.1;margin:6px 0 7px;font-weight:720}.subtitle{color:var(--muted);margin:0;line-height:1.55;font-size:13px}.heading-actions{display:flex;gap:8px;flex-wrap:wrap}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px}.metric{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 17px}.metric span{display:block;color:var(--muted);font-size:11px}.metric strong{display:block;font-size:25px;letter-spacing:-.045em;margin-top:8px;font-weight:690}.metric small{display:block;color:#9298a3;font-size:10px;margin-top:4px}
.overview-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);gap:13px}.stack{display:flex;flex-direction:column;gap:13px}.panel,.view-panel{background:#fff;border:1px solid var(--line);border-radius:15px;padding:19px;min-width:0}.panel-head,.panel-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.panel h2,.panel-toolbar h2{font-size:14px;margin:0;letter-spacing:-.02em;font-weight:700}.panel-copy,.panel-toolbar p{font-size:11px;color:var(--muted);line-height:1.55;margin:6px 0 0}.feature-panel{padding:22px}.feature-number{font-size:42px;line-height:1;letter-spacing:-.06em;font-weight:720;margin:22px 0 5px}.feature-meta{color:var(--muted);font-size:11px}.feature-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.quick-card,.tile,.job-card{border:1px solid var(--line);background:#fff;border-radius:13px;padding:16px;min-width:0}.quick-symbol{width:30px;height:30px;border-radius:9px;background:#f0f1f4;display:grid;place-items:center;margin-bottom:13px}.quick-card h3{font-size:13px;margin:0 0 5px}.quick-card p,.tile p,.job-card p{font-size:11px;color:var(--muted);line-height:1.5;margin:6px 0}.text-link{border:0;background:transparent;padding:0;color:#315fb6;font-weight:680;font-size:11px}.pulse-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #eff0f2;font-size:12px}.pulse-row:last-child{border:0}.pulse-row span:first-child{color:var(--muted)}.notice{background:#f8f9fb;border:1px solid var(--line);padding:12px 13px;border-radius:11px;color:#747b87;font-size:11px;line-height:1.55;margin-top:14px}.muted{color:var(--muted)}
.view-panel+.view-panel{margin-top:13px}.tablewrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:12px;min-width:720px}.table th,.table td{padding:13px 10px;border-bottom:1px solid #eff0f2;text-align:left;vertical-align:middle}.table th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8b919c;font-weight:700;white-space:nowrap}.table tbody tr:last-child td{border:0}.table td strong{font-size:12px;font-weight:680}.source-name{max-width:280px;overflow-wrap:anywhere}.source-name .muted{font-size:10px;margin-top:4px}.source-actions{white-space:nowrap}.collection-grid,.project-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.tile strong{font-size:13px;font-weight:700}.tile small{font-size:10px;color:#8c929d;line-height:1.5}.pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:99px;background:#f0f1f4;color:#656c78;font-size:9px;font-weight:750;text-transform:uppercase;letter-spacing:.045em;white-space:nowrap}.pill.ready,.pill.completed{background:#eaf6ef;color:#17784f}.pill.failed,.pill.delete_failed{background:#fff0f0;color:#a63232}.pill.archived{background:#eef0f4;color:#566273}.pill.deleting{background:#fff6e9;color:#92600b}.pill.processing,.pill.uploading,.pill.uploaded,.pill.running{background:#edf3ff;color:#315da9}.pill.warning,.pill.needs_review{background:#fff6e9;color:#92600b}.bar{height:4px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:6px;max-width:150px}.bar i{display:block;height:100%;background:var(--blue)}.empty{text-align:center;padding:30px 16px;color:#9298a3;font-size:12px}.error{color:var(--red)}
.field{display:flex;flex-direction:column;gap:7px;margin:13px 0}.field label{font-size:11px;font-weight:680;color:#5d6470}.field input,.field select,.field textarea{width:100%;border:1px solid #e0e2e7;background:#fff;border-radius:10px;padding:11px 12px;outline:none;color:var(--ink)}.field input:focus,.field select:focus,.field textarea:focus{border-color:#91a9e4;box-shadow:0 0 0 3px #3769d617}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.checks{display:flex;gap:10px;flex-wrap:wrap;max-height:120px;overflow:auto;border:1px solid var(--line);padding:11px;border-radius:10px}.check{display:inline-flex;gap:7px;align-items:center;font-size:11px;color:#515967}.drop{display:flex;align-items:center;justify-content:center;min-height:118px;border:1px dashed #c5cad4;border-radius:12px;background:#fafbfc;text-align:center;padding:18px;cursor:pointer}.drop:hover{background:#f6f8fb;border-color:#9da8bd}.drop strong{display:block;font-size:13px}.drop small{display:block;color:var(--muted);font-size:11px;margin-top:5px}.drop input{position:absolute;width:1px;height:1px;opacity:0}.file{font-size:11px;color:var(--muted);margin-top:7px;overflow-wrap:anywhere}.progress{height:6px;width:100%;margin-top:12px}.statusline{font-size:11px;color:var(--muted);min-height:18px;margin:8px 0}.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:14px}.step{border:1px solid var(--line);border-radius:10px;background:#fafbfd;padding:11px 9px;min-width:0}.step b{display:block;font-size:10px}.step small{display:block;font-size:9px;color:var(--muted);margin-top:5px;line-height:1.4}.step.active{background:#f2f6ff;border-color:#c6d5f8}.step.done{background:#f1faf5;border-color:#c4e6d2}.step.failed{background:#fff4f4;border-color:#f0caca}
.timeline{display:flex;flex-direction:column}.event{display:grid;grid-template-columns:10px minmax(0,1fr);gap:11px;padding:13px 0;border-bottom:1px solid #eff0f2}.event:last-child{border:0}.rail{width:7px;height:7px;border-radius:50%;background:#98a8c7;margin-top:5px}.event.failed .rail{background:var(--red)}.event.completed .rail{background:var(--green)}.event strong{font-size:11px}.event p{margin:5px 0;color:#5d6572;font-size:11px;line-height:1.5}.event small{font-size:10px;color:#8c929d;line-height:1.5}.job-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.job-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.job-card strong{font-size:12px}.job-actions{display:flex;gap:7px;margin-top:11px}
.modal{display:none;position:fixed;inset:0;background:#11182766;z-index:30;padding:18px;align-items:center;justify-content:center;backdrop-filter:blur(5px)}.modal.open{display:flex}.modalbox{width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border:1px solid #ffffff90;border-radius:19px;padding:22px;box-shadow:0 24px 80px #11182730}.modalbox.wide{width:min(820px,100%)}.modalhead{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:18px}.modalhead h2{font-size:18px;letter-spacing:-.035em;margin:0;font-weight:710}.modal-subtitle{font-size:11px;color:var(--muted);margin:-10px 0 16px}.modal-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.management-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.management-actions .btn{justify-content:flex-start;padding:12px}.management-actions .btn.danger{grid-column:1/-1}.footer-note{font-size:10px;color:#989eaa;text-align:center;margin:26px 0 0}
@media(max-width:1050px){.shell{padding:18px}.app-layout{grid-template-columns:1fr;gap:20px}.sidebar{position:static;display:block;border-bottom:1px solid var(--line);padding-bottom:13px}.nav-group{display:inline-block;vertical-align:top;margin-right:18px}.nav-label{padding:0 8px 6px}.nav-list{flex-direction:row;gap:4px}.nav-item{width:auto;white-space:nowrap;padding:9px 11px}.workspace{max-width:none}.overview-grid{grid-template-columns:1fr 1fr}}
@media(max-width:680px){.shell{padding:13px 12px 30px}.top{align-items:flex-start;padding-bottom:14px}.brand-mark{width:34px;height:34px}.brand{font-size:18px}.brand-caption{font-size:10px}.actions{gap:6px}.actions .btn{padding:8px 9px;font-size:10px}.live{width:100%;justify-content:flex-end;font-size:10px}.app-layout{padding-top:13px;gap:16px}.sidebar{overflow-x:auto;white-space:nowrap;margin:0 -12px;padding:0 12px 10px}.nav-group{margin-right:12px}.nav-label{display:none}.nav-item{font-size:11px;padding:8px 10px;gap:6px}.nav-icon{width:auto}.page-heading{align-items:flex-start;flex-direction:column;margin:4px 0 16px}.page-heading h1{font-size:25px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.metric{padding:13px}.metric strong{font-size:22px}.overview-grid,.quick-grid,.collection-grid,.project-grid,.job-grid{grid-template-columns:1fr}.panel,.view-panel{padding:15px}.feature-panel{padding:18px}.feature-number{font-size:36px}.formgrid{grid-template-columns:1fr;gap:0}.steps{grid-template-columns:repeat(2,1fr)}.modal{padding:10px;align-items:flex-end}.modalbox{padding:18px;border-radius:18px 18px 12px 12px;max-height:92vh;width:100%}.management-actions{grid-template-columns:1fr}.management-actions .btn.danger{grid-column:auto}.table{min-width:680px}}</style></head><body><body><main class="shell"><header class="top"><div class="brand-wrap"><div class="brand-mark" aria-hidden="true">B</div><div><div class="brand">BRVIN</div><div class="brand-caption">Knowledge intelligence · Parmar AI</div></div></div><div class="actions"><span class="live"><i></i><span id="live-label">LIVE · connecting</span></span><button class="btn" id="refresh" type="button">↻ Refresh</button><a class="btn" href="/admin">Admin home</a><button class="btn" id="logout" type="button">Sign out</button></div></header>
<div class="app-layout"><aside class="sidebar" aria-label="BRVIN navigation"><div class="nav-group"><div class="nav-label">Workspace</div><nav class="nav-list" aria-label="Workspace"><button class="nav-item active" type="button" data-view="overview"><span class="nav-icon">⌂</span>Overview</button><button class="nav-item" type="button" data-view="books"><span class="nav-icon">▤</span>Knowledge sources</button><button class="nav-item" type="button" data-view="collections"><span class="nav-icon">▧</span>Knowledge collections</button><button class="nav-item" type="button" data-view="projects"><span class="nav-icon">◫</span>Projects</button><button class="nav-item" type="button" data-view="operations"><span class="nav-icon">◷</span>Live operations</button></nav></div><div class="nav-group"><div class="nav-label">Administration</div><nav class="nav-list" aria-label="Administration"><button class="nav-item" type="button" data-view="governance"><span class="nav-icon">⚙</span>Governance</button></nav></div></aside>
<div class="workspace">
<section class="view active" id="view-overview" data-view-panel="overview"><div class="page-heading"><div><div class="eyebrow">BRVIN workspace</div><h1>Knowledge, organised.</h1><p class="subtitle">A single governed library, connected to projects with intention.</p></div><div class="heading-actions"><button class="btn primary" id="open-upload" type="button">＋ Add knowledge source</button></div></div>
<div class="metrics" id="metrics"><div class="metric"><span>Knowledge sources</span><strong>—</strong><small>Across all collections</small></div><div class="metric"><span>Collections</span><strong>—</strong><small>Governed groups</small></div><div class="metric"><span>Projects</span><strong>—</strong><small>Independent consumers</small></div><div class="metric"><span>Indexed pages</span><strong>—</strong><small>Verified / total</small></div><div class="metric"><span>Active pipelines</span><strong>—</strong><small>Running now</small></div><div class="metric"><span>Needs attention</span><strong>—</strong><small>Failed or blocked</small></div></div>
<div class="overview-grid"><div class="stack"><section class="panel feature-panel"><div class="eyebrow">Knowledge library</div><div class="feature-number" id="overview-books">—</div><div class="feature-meta" id="overview-pages">Sources · indexed pages</div><p class="panel-copy">Your source documents stay in one place. Each project receives only the books or collections explicitly assigned to it.</p><div class="feature-actions"><button class="btn primary" type="button" data-view="books">Open knowledge sources</button><button class="btn" type="button" id="open-upload-secondary">Add a PDF</button></div></section><div class="quick-grid"><section class="quick-card"><div class="quick-symbol">▧</div><h3>Collections</h3><p>Group related books without automatically sharing them.</p><button class="text-link" type="button" data-view="collections">View collections →</button></section><section class="quick-card"><div class="quick-symbol">◫</div><h3>Projects</h3><p>Control which project can use BRVIN knowledge.</p><button class="text-link" type="button" data-view="projects">View projects →</button></section></div></div><div class="stack"><section class="panel"><div class="panel-head"><h2>System overview</h2><span class="live"><i></i>Live</span></div><div class="pulse-row"><span>Ready sources</span><strong id="overview-ready">—</strong></div><div class="pulse-row"><span>Active pipelines</span><strong id="overview-running">—</strong></div><div class="pulse-row"><span>Needs attention</span><strong id="overview-attention">—</strong></div><div class="notice" id="overview-status-note">Pipeline activity and indexing status update automatically.</div><div class="feature-actions"><button class="btn" type="button" data-view="operations">View operations →</button></div></section><section class="panel"><div class="panel-head"><h2>Access model</h2></div><p class="panel-copy">BRVIN never exposes every book to every project by default. Direct book access and collection access are managed independently and combined for retrieval.</p><div class="notice">A book becomes available after indexing and retrieval QA pass, and only to explicitly authorised projects.</div><div class="feature-actions"><button class="btn" type="button" data-view="governance">Manage governance →</button></div></section></div></div></section>
<section class="view" id="view-books" data-view-panel="books"><div class="page-heading"><div><div class="eyebrow">Library</div><h1>Knowledge sources</h1><p class="subtitle">Books and documents indexed for your projects.</p></div><div class="heading-actions"><button class="btn danger" id="clear-brvin" type="button">Clear imported books</button><button class="btn primary" type="button" id="open-upload-books">＋ Add source</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>All sources</h2><p id="book-count">Loading knowledge registry…</p></div><span class="muted" style="font-size:11px">Select Manage for source actions</span></div><div class="tablewrap"><table class="table"><thead><tr><th>Source</th><th>Collection</th><th>Indexed</th><th>Status</th><th>Project access</th><th>Actions</th></tr></thead><tbody id="books"><tr><td class="empty" colspan="6">Loading knowledge registry…</td></tr></tbody></table></div><div class="notice">The original PDF and searchable page index are retained independently. Google Vision OCR JSON is temporary processing output, but it may remain in private cloud storage when the required Google Cloud permissions do not allow cleanup; this does not affect retrieval from indexed pages. “Delete OCR files” keeps the PDF and searchable pages. “Delete book” removes the PDF, OCR output, indexed pages, project grants and registry records. Bulk clear preserves the protected built-in Fatman reference, project and collection definitions, and the audit trail.</div></section></section>
<section class="view" id="view-collections" data-view-panel="collections"><div class="page-heading"><div><div class="eyebrow">Organisation</div><h1>Collections</h1><p class="subtitle">Arrange sources into logical groups. A collection is not shared until assigned to a project.</p></div><div class="heading-actions"><button class="btn" type="button" data-view="governance">＋ Create collection</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Your collections</h2><p>Each collection can be connected to one or more projects.</p></div></div><div id="collections" class="collection-grid"><div class="empty">Loading collections…</div></div></section></section>
<section class="view" id="view-projects" data-view-panel="projects"><div class="page-heading"><div><div class="eyebrow">Knowledge consumers</div><h1>Projects</h1><p class="subtitle">Manage the project spaces that can retrieve BRVIN knowledge.</p></div><div class="heading-actions"><button class="btn" type="button" data-view="governance">＋ Create project</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Connected projects</h2><p>Direct book access and collection access are additive.</p></div></div><div id="projects" class="project-grid"><div class="empty">Loading projects…</div></div></section></section>
<section class="view" id="view-operations" data-view-panel="operations"><div class="page-heading"><div><div class="eyebrow">System activity</div><h1>Operations</h1><p class="subtitle">Follow ingestion, indexing, retrieval checks and cleanup workflows.</p></div><div class="heading-actions"><span class="live"><i></i>5-second refresh · automatic</span></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Live pipelines</h2><p>Active jobs and recoverable failures.</p></div></div><div id="jobs" class="job-grid"><div class="empty">No active processing jobs.</div></div></section><section class="view-panel"><div class="panel-toolbar"><div><h2>Specialist activity</h2><p>Actual workflow events · <span id="event-stamp">Waiting for events</span></p></div></div><div class="timeline" id="events"><div class="empty">Waiting for BRVIN events…</div></div></section></section>
<section class="view" id="view-governance" data-view-panel="governance"><div class="page-heading"><div><div class="eyebrow">Administration</div><h1>Governance</h1><p class="subtitle">Create projects and collections, then explicitly grant collection access.</p></div></div><div class="overview-grid"><section class="view-panel"><div class="panel-toolbar"><div><h2>Create a project</h2><p>A project is an isolated knowledge consumer.</p></div></div><div class="field"><label for="project-name">Project name</label><input id="project-name" maxlength="100" placeholder="Project name"></div><div class="field"><label for="project-desc">Description</label><input id="project-desc" maxlength="500" placeholder="What will this platform use BRVIN for?"></div><button class="btn primary" id="create-project" type="button">Create project</button></section><section class="view-panel"><div class="panel-toolbar"><div><h2>Create a collection</h2><p>Group sources by subject or purpose.</p></div></div><div class="field"><label for="collection-name">Collection name</label><input id="collection-name" maxlength="100" placeholder="Collection name"></div><div class="field"><label for="collection-desc">Description</label><input id="collection-desc" maxlength="500" placeholder="What belongs in this collection?"></div><button class="btn primary" id="create-collection" type="button">Create collection</button></section><section class="view-panel" style="grid-column:1/-1"><div class="panel-toolbar"><div><h2>Collection access</h2><p>Choose which collections a project can retrieve. This does not replace direct book assignments.</p></div></div><div class="formgrid"><div class="field"><label for="project-access">Project</label><select id="project-access"></select></div><div class="field"><label>Available collections</label><div class="checks" id="collection-checks"></div></div></div><button class="btn primary" id="save-project-access" type="button">Save collection access</button><div class="notice">Access is additive: projects receive content through direct book assignments and/or collection assignments. Empty projects have no BRVIN knowledge access.</div></section></div></section>
</div></div><p class="footer-note">BRVIN · Administrator-only · Operational data refreshes automatically · Knowledge is never globally exposed by default</p></main>
<div class="modal" id="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title"><div class="modalbox wide"><div class="modalhead"><div><div class="eyebrow">Secure ingestion</div><h2 id="upload-modal-title">Add knowledge source</h2></div><button class="btn" id="close-upload" type="button">Close</button></div><p class="modal-subtitle">Upload a private PDF. BRVIN handles OCR, indexing and retrieval verification in the background.</p><div class="formgrid"><div class="field"><label for="book-title">Book / document name</label><input id="book-title" maxlength="160" placeholder="e.g. Indian Polity Reference"></div><div class="field"><label for="collection">Knowledge collection</label><select id="collection"></select></div></div><div class="field"><label>PDF document</label><label class="drop" for="pdf"><span><strong>Choose PDF from this device</strong><small>Private resumable upload · up to 1 GB · 2,000 pages · OCR costs may apply</small><input id="pdf" type="file" accept="application/pdf"></span></label><div class="file" id="file-info">No PDF selected.</div></div><div class="field"><label>Grant project access (optional)</label><div class="checks" id="project-checks"><span class="muted">Loading projects…</span></div></div><label class="check"><input type="checkbox" id="cost"> I understand Google Cloud Vision OCR may incur usage charges.</label><div class="modal-actions"><button class="btn primary" id="upload" disabled type="button">Add to BRVIN</button></div><progress class="progress" id="progress" value="0" max="100"></progress><p class="statusline" id="upload-status" aria-live="polite">Choose a PDF to start. Processing continues on the server after upload completes.</p><div class="steps"><div class="step" id="step-upload"><b>01 · Secure upload</b><small>Private object storage</small></div><div class="step" id="step-ocr"><b>02 · Vision OCR</b><small>Document text detection</small></div><div class="step" id="step-index"><b>03 · Indexing</b><small>Page-level search</small></div><div class="step" id="step-qa"><b>04 · Retrieval QA</b><small>Source-page verification</small></div><div class="step" id="step-ready"><b>05 · Ready</b><small>Project access enabled</small></div></div><div class="notice">BRVIN does not automatically share every book with every project. A book is searchable only after indexing and retrieval QA pass, and only for projects explicitly assigned the book or its collection.</div></div></div>
<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modalbox"><div class="modalhead"><h2 id="modal-title">Book operations</h2><button class="btn" id="close-modal" type="button">Close</button></div><div id="modal-body"></div></div></div><script type="module">
const $=id=>document.getElementById(id),API="/admin/api/brvin/",UPLOAD="/admin/api/brvin/upload/";
let model=null,selectedFile=null,activeImportId=null,uploadBusy=false;
function say(message,error=false){$("upload-status").textContent=message;$("upload-status").classList.toggle("error",error);}
async function api(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin"});let data={};try{data=await response.json();}catch{}if(!response.ok||data.ok!==true)throw new Error(data.error||"Request failed (HTTP "+response.status+").");return data;}
function post(path,body){return api(API+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
function esc(value){return String(value??"").replace(/[&<>"']/gu,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmtBytes(value){let n=Number(value||0);if(n<1024)return n+" B";const u=["KB","MB","GB"];let i=0;n/=1024;while(n>=1024&&i<u.length-1){n/=1024;i++;}return n.toFixed(1)+" "+u[i];}
function time(value){return value?new Date(Number(value)).toLocaleString():"—";}
function pct(a,b){return b?Math.max(0,Math.min(100,Math.floor(a/b*100))):0;}
function statusPill(s){return '<span class="pill '+esc(s)+'">'+esc(String(s||"unknown").replaceAll("_"," "))+"</span>";}
function renderMetrics(s){$("metrics").innerHTML=[
["Knowledge sources",s.books,"Across all collections"],["Collections",s.collections,"Governed groups"],["Projects",s.projects,"Independent consumers"],
["Indexed pages",s.indexedPages.toLocaleString()+" / "+s.totalPages.toLocaleString(),"Page-level coverage"],
["Active pipelines",s.activeBooks,"Running now"],["Needs attention",s.failedBooks,"Failed or blocked"]
].map(x=>'<div class="metric"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div>').join("");}
function renderCollections(list){
 const previousCollectionId=$("collection").value;
 const selectedCollectionIds=new Set([...$("collection-checks").querySelectorAll("input:checked")].map(input=>input.value));
 const selectedCollectionId=list.some(c=>c.id===previousCollectionId&&c.status==="active")
  ?previousCollectionId
  :(list.some(c=>c.id==="general"&&c.status==="active")?"general":(list.find(c=>c.status==="active")?.id||""));
 $("collections").innerHTML=list.length?list.map(c=>'<div class="tile"><strong>'+esc(c.name)+'</strong><p>'+esc(c.description||"No description")+'</p><small>'+c.bookCount+' sources · '+c.indexedPages+'/'+c.pageCount+' pages indexed · '+c.projects.length+' project links</small></div>').join(""):'<div class="empty">No collections yet.</div>';
 $("collection").innerHTML=list.filter(c=>c.status==="active").map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
 $("collection").value=selectedCollectionId;
 $("collection-checks").innerHTML=list.filter(c=>c.status==="active").map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.id)+'"'+(selectedCollectionIds.has(c.id)?" checked":"")+'> '+esc(c.name)+'</label>').join("")||'<span class="muted">Create a collection first.</span>';
}
function renderProjects(list){
 const previousProjectId=$("project-access").value;
 const selectedProjectIds=new Set([...$("project-checks").querySelectorAll("input:checked")].map(input=>input.value));
 $("projects").innerHTML=list.length?list.map(p=>'<div class="tile"><strong>'+esc(p.name)+'</strong> '+statusPill(p.status)+'<p>'+esc(p.description||"No description")+'</p><small>Direct books: '+p.directBooks+' · via collections: '+p.collectionBooks+' · slug '+esc(p.slug)+'</small></div>').join(""):'<div class="empty">No projects have been registered.</div>';
 $("project-checks").innerHTML=list.filter(p=>p.status==="active").map(p=>'<label class="check"><input type="checkbox" value="'+esc(p.id)+'"'+(selectedProjectIds.has(p.id)?" checked":"")+'> '+esc(p.name)+'</label>').join("")||'<span class="muted">No active projects. Create one below.</span>';
 $("project-access").innerHTML=list.filter(p=>p.status==="active").map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
 if(list.some(p=>p.id===previousProjectId&&p.status==="active"))$("project-access").value=previousProjectId;
 $("project-access").onchange=()=>{const p=list.find(item=>item.id===$("project-access").value);const allowed=new Set((model?.collections||[]).filter(c=>c.projects.some(link=>link.id===p?.id)).map(c=>c.id));$("collection-checks").querySelectorAll("input").forEach(input=>input.checked=allowed.has(input.value));};
}
function renderBooks(list,projects){$("book-count").textContent=list.length+" sources";$("books").innerHTML=list.length?list.map(b=>{const access=b.projects.map(p=>p.name).join(", ")||"No project access",progress=pct(b.indexedPages,b.pageCount);const inspect=["uploading","uploaded","processing","failed","delete_failed"].includes(b.status)?'<button class="btn" data-inspect="'+esc(b.id)+'" type="button">Inspect</button> ':"";return '<tr><td class="source-name"><strong>'+esc(b.title)+'</strong><div class="muted">'+esc(b.filename)+'</div><div class="bar"><i style="width:'+progress+'%"></i></div></td><td>'+esc(b.collectionName)+'</td><td>'+b.indexedPages+'/'+b.pageCount+'</td><td>'+statusPill(b.status)+(b.error?'<div class="error" style="font-size:10px;margin-top:5px">'+esc(b.error)+'</div>':"")+'</td><td>'+esc(access)+'</td><td class="source-actions">'+inspect+'<button class="btn" data-manage="'+esc(b.id)+'" type="button">Manage</button></td></tr>';}).join(""):'<tr><td class="empty" colspan="6">No knowledge sources yet. Add the first PDF to start your library.</td></tr>';$("books").querySelectorAll("[data-inspect]").forEach(button=>button.addEventListener("click",()=>showImport(button.dataset.inspect)));$("books").querySelectorAll("[data-manage]").forEach(button=>button.addEventListener("click",()=>manageBook(button.dataset.manage)));}
function renderJobs(list){$("jobs").innerHTML=list.length?list.map(j=>{const deleting=j.status==="deleting"||j.status==="delete_failed",percent=j.status==="uploading"?pct(j.uploadedBytes,j.expectedBytes):pct(j.indexedPages,j.pageCount),label=deleting?"Removing AI Search pages and private PDF/OCR storage":j.status==="uploading"?fmtBytes(j.uploadedBytes)+" / "+fmtBytes(j.expectedBytes):j.indexedPages+" / "+j.pageCount+" pages";return '<div class="job-card"><div class="job-card-head"><strong>'+esc(j.title)+'</strong>'+statusPill(j.status)+'</div><p>'+esc(label)+(deleting?"":" · "+percent+"% · updated "+esc(time(j.updatedAt)))+'</p>'+(deleting?"":'<div class="bar" style="max-width:none"><i style="width:'+percent+'%"></i></div>')+(j.error?'<p class="error">'+esc(j.error)+'</p>':"")+'<div class="job-actions"><button class="btn" data-inspect="'+esc(j.id)+'" type="button">Inspect pipeline</button>'+(j.status==="failed"&&j.hasOcrOperation?'<button class="btn" data-resume="'+esc(j.id)+'" type="button">Resume</button>':"")+'</div></div>';}).join(""):'<div class="empty" style="grid-column:1/-1">No active processing or deletion jobs. New BRVIN operations will appear here.</div>';$("jobs").querySelectorAll("[data-inspect]").forEach(b=>b.addEventListener("click",()=>showImport(b.dataset.inspect)));$("jobs").querySelectorAll("[data-resume]").forEach(b=>b.addEventListener("click",()=>resumeImport(b.dataset.resume)));}
function detailText(details){if(!details||typeof details!=="object")return"";return Object.entries(details).map(([key,value])=>key+": "+(typeof value==="object"?JSON.stringify(value):String(value))).join(" · ").slice(0,700);}
function renderEvents(list){$("events").innerHTML=list.length?list.slice(0,60).map(e=>'<div class="event '+esc(e.status)+'"><i class="rail"></i><div><div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(e.agent)+' · '+esc(e.phase)+'</strong>'+statusPill(e.status)+'</div><p>'+esc(e.message)+'</p>'+(e.details?'<small>'+esc(detailText(e.details))+'</small><br>':"")+'<small>'+esc(time(e.createdAt))+' · '+esc(e.type)+'</small></div></div>').join(""):'<div class="empty">No operation events recorded yet.</div>';}
function renderOverview(data){$("overview-books").textContent=String(data.stats.books);$("overview-pages").textContent=data.stats.indexedPages.toLocaleString()+" of "+data.stats.totalPages.toLocaleString()+" pages indexed";$("overview-ready").textContent=String(data.stats.readyBooks);$("overview-running").textContent=String(data.stats.activeBooks);$("overview-attention").textContent=String(data.stats.failedBooks);$("overview-status-note").textContent=data.stats.failedBooks?data.stats.failedBooks+" source(s) need attention. Open Operations to inspect the affected workflow.":data.stats.activeBooks?data.stats.activeBooks+" pipeline(s) are running. Processing continues automatically in the background.":"All tracked sources are stable. New processing events will appear here automatically.";}
function render(){if(!model)return;renderMetrics(model.stats);renderCollections(model.collections);renderProjects(model.projects);renderBooks(model.books,model.projects);renderJobs(model.jobs);renderEvents(model.events);renderOverview(model);$("live-label").textContent="LIVE · refreshed "+new Date(model.generatedAt).toLocaleTimeString();$("event-stamp").textContent="Last event "+(model.events[0]?time(model.events[0].createdAt):"—");}
async function refresh(){try{model=await api(API+"overview");render();}catch(e){$("live-label").textContent="LIVE · connection issue";console.error(e);}}
function stage(id,state){$("step-"+id).className="step"+(state?" "+state:"");}
function renderJob(job,pipeline){const uploaded=job.uploadedBytes>=job.expectedSize&&job.expectedSize>0;const ocr=pipeline?.vision?.status||"not_started";const status=job.status;
 stage("upload",uploaded?"done":status==="uploading"?"active":"");
 stage("ocr",ocr==="completed"||job.indexedPages>0?"done":uploaded?"active":"");
 stage("index",status==="completed"?"done":job.indexedPages>0?"active":"");
 stage("qa",status==="completed"?"done":status==="failed"?"failed":job.indexedPages===job.expectedPages?"active":"");
 stage("ready",status==="completed"?"done":"");
 $("progress").max=status==="uploading"?job.expectedSize:job.expectedPages;
 $("progress").value=status==="uploading"?job.uploadedBytes:job.indexedPages;
}
async function showImport(id){activeImportId=id;try{const d=await api(API+"status?id="+encodeURIComponent(id));const job=d.import;if(!job)throw new Error("Import not found.");
 $("upload-modal").classList.remove("open");renderJob(job,d.pipeline);$("modal-title").textContent=job.bookTitle||"BRVIN operations";
 $("modal-body").innerHTML='<div class="metrics" style="grid-template-columns:repeat(3,1fr)"><div class="metric"><span>State</span><strong style="font-size:17px">'+esc(job.status)+'</strong></div><div class="metric"><span>Indexed</span><strong style="font-size:17px">'+job.indexedPages+'/'+job.expectedPages+'</strong></div><div class="metric"><span>Upload</span><strong style="font-size:17px">'+pct(job.uploadedBytes,job.expectedSize)+'%</strong></div></div><p class="muted">Vision OCR: '+esc(d.pipeline?.vision?.status||"not started")+' · Workflow: '+esc(d.pipeline?.workflow?.status||"not started")+'</p><div class="timeline">'+(d.events||[]).map(e=>'<div class="event '+esc(e.status)+'"><i class="rail"></i><div><strong>'+esc(e.agent)+' · '+esc(e.phase)+'</strong><p>'+esc(e.message)+'</p>'+(e.details?'<small>'+esc(detailText(e.details))+'</small><br>':"")+'<small>'+esc(time(e.createdAt))+'</small></div></div>').join("")+'</div>';
 $("modal").classList.add("open");
 }catch(e){say(e.message,true);}}
function manageBook(id){const book=model?.books?.find(item=>item.id===id);if(!book)return;const canDelete=book.sourceType==="pdf"&&!book.visionOcrDeleting&&["ready","failed","delete_failed","completed","archived"].includes(book.status),canArchive=book.sourceType==="pdf"&&book.status==="ready",canRestore=book.sourceType==="pdf"&&book.status==="archived",canDeleteOcr=book.sourceType==="pdf"&&book.status==="ready"&&!book.visionOcrDeleted&&!book.visionOcrDeleting,busyOcr=book.visionOcrDeleting,needsInspect=["uploading","uploaded","processing","failed","delete_failed"].includes(book.status);$("modal-title").textContent=book.title;$("modal-body").innerHTML='<p class="modal-subtitle" style="margin:0 0 16px">'+esc(book.collectionName)+' · '+book.indexedPages+'/'+book.pageCount+' pages indexed · '+esc(book.status.replaceAll("_"," "))+'</p><div class="management-actions">'+(needsInspect?'<button class="btn" id="manage-inspect" type="button">Inspect processing pipeline</button>':'')+(book.status==="deleting"?"":'<button class="btn" id="manage-access" type="button">Manage direct project access</button>')+(canArchive?'<button class="btn" id="manage-archive" type="button">Archive source</button>':'')+(canRestore?'<button class="btn" id="manage-restore" type="button">Restore source</button>':'')+(canDeleteOcr?'<button class="btn" id="manage-ocr" type="button">Delete Vision OCR files only</button>':busyOcr?'<span class="muted">Vision OCR cleanup is running…</span>':book.visionOcrDeleted?'<span class="muted">Vision OCR files marked as removed.</span>':'')+(canDelete?'<button class="btn danger" id="manage-delete" type="button">Delete this book permanently</button>':book.sourceType!=="pdf"?'<span class="muted">This built-in source is protected.</span>':'')+'</div><div class="notice">'+(book.status==="deleting"?"Full book deletion is already in progress. The source will disappear from this library when its background workflow completes.":"Direct project access is managed separately from collection access. Archiving pauses retrieval but retains stored data. Deleting the book is permanent and removes its searchable pages and imported storage.")+'</div>';$("modal").classList.add("open");if(needsInspect)$("manage-inspect").addEventListener("click",()=>showImport(id));if(book.status!=="deleting")$("manage-access").addEventListener("click",()=>editBookAccess(id));if(canArchive)$("manage-archive").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await archiveBook(id,"archive",button);});if(canRestore)$("manage-restore").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await archiveBook(id,"restore",button);});if(canDeleteOcr)$("manage-ocr").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await deleteVisionOutput(id,button);});if(canDelete)$("manage-delete").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await deleteBook(id,button);});}
async function editBookAccess(id){const book=model.books.find(b=>b.id===id);if(!book)return;const selected=new Set((book.directProjects||[]).map(p=>p.id));
 $("modal-title").textContent="Project access · "+book.title;
 $("modal-body").innerHTML='<p class="muted">Choose exactly which projects can retrieve this source. Saving replaces its direct project assignments.</p><div class="checks" id="access-choices">'+model.projects.filter(p=>p.status==="active").map(p=>'<label class="check"><input type="checkbox" value="'+esc(p.id)+'" '+(selected.has(p.id)?"checked":"")+'> '+esc(p.name)+'</label>').join("")+'</div><button class="btn primary" id="save-book-access" style="margin-top:12px">Save access</button>';
 $("modal").classList.add("open");
 $("save-book-access").addEventListener("click",async()=>{const projectIds=[...$("access-choices").querySelectorAll("input:checked")].map(i=>i.value);try{await post("books/assign",{bookId:id,projectIds});$("modal").classList.remove("open");await refresh();}catch(e){alert(e.message);}});
}
async function resumeImport(id){try{await post("upload/"+encodeURIComponent(id)+"/resume",{});activeImportId=id;await showImport(id);await refresh();}catch(e){say(e.message,true);}}
$("close-modal").addEventListener("click",()=>$("modal").classList.remove("open"));
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))$("modal").classList.remove("open");});
$("pdf").addEventListener("change",()=>{selectedFile=$("pdf").files?.[0]||null;if(selectedFile&&!$("book-title").value.trim())$("book-title").value=selectedFile.name.replace(/\.pdf$/iu,"").replace(/[_-]+/gu," ").trim();$("file-info").textContent=selectedFile?selectedFile.name+" · "+fmtBytes(selectedFile.size):"No PDF selected.";$("upload").disabled=!selectedFile||uploadBusy;});
function countSimplePdfPages(buffer){
 if(buffer.byteLength>32*1024*1024)return 0;
 const source=new TextDecoder("latin1").decode(buffer);
 const leafPages=source.match(/\\/Type\\s*\\/Page\\b/gu)?.length??0;
 if(leafPages>0)return leafPages;
 const pageTree=source.match(/\\/Type\\s*\\/Pages\\b[\\s\\S]{0,8192}?\\/Count\\s+(\\d+)/u);
 return pageTree?Number(pageTree[1]):0;
}
async function inspect(file){
 if(file.size<8||file.size>1024*1024*1024)throw new Error("Choose a PDF between 8 bytes and 1 GB.");
 const buffer=await file.arrayBuffer();
 if(new TextDecoder().decode(buffer.slice(0,5))!=="%PDF-")throw new Error("This file is not a valid PDF.");
 const digest=await crypto.subtle.digest("SHA-256",buffer);
 const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
 let pageCount=0;
 try{
  // PDF.js is optional for dashboard startup. Load it only when a PDF is selected,
  // so a blocked/slow third-party CDN cannot prevent BRVIN's D1 dashboard from connecting.
  const pdfjsLib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/"+pdfjsLib.version+"/pdf.worker.min.mjs";
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(buffer)}).promise;
  pageCount=pdf.numPages;
  await pdf.destroy();
 }catch(pdfError){
  pageCount=countSimplePdfPages(buffer);
  if(!pageCount){
   const detail=pdfError instanceof Error?pdfError.message:String(pdfError);
   throw new Error("The browser PDF reader could not inspect this file ("+detail+"), and its page tree could not be verified by the fallback counter.");
  }
 }
 if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>2000)throw new Error("BRVIN currently supports 1–2,000 pages per PDF.");
 return{hash,pageCount};
}
async function uploadBook(){
 if(!selectedFile)return;
 if(!$("cost").checked){say("Confirm the Google Cloud OCR cost notice first.",true);return;}
 if(!$("book-title").value.trim()){say("Enter the name of this knowledge source.",true);return;}
 uploadBusy=true;$("upload").disabled=true;
 let phase="PDF inspection";
 try{
  say("Inspecting PDF, counting pages and verifying its SHA-256 fingerprint…");
  const meta=await inspect(selectedFile);
  const projectIds=[...$("project-checks").querySelectorAll("input:checked")].map(i=>i.value);
  phase="starting the secure upload";
  const started=await post("upload/start",{title:$("book-title").value.trim(),filename:selectedFile.name,sha256:meta.hash,size:selectedFile.size,pageCount:meta.pageCount,costConfirmed:true,collectionId:$("collection").value,projectIds});
  activeImportId=started.importId;
  if(started.canResume){await resumeImport(activeImportId);return;}
  if(started.status==="uploaded"){
   phase="starting OCR and page indexing";
   await post("upload/"+encodeURIComponent(activeImportId)+"/complete",{});
  }
  if(started.status==="processing"||started.status==="uploaded"||started.status==="completed"){
   await showImport(activeImportId);await refresh();return;
  }
  let offset=Number(started.uploadedBytes||0),total=selectedFile.size,chunk=8*1024*1024;
  $("progress").max=total;$("progress").value=offset;
  phase="transferring the PDF to private storage";
  while(offset<total){
   say("Secure transfer: "+pct(offset,total)+"% · "+fmtBytes(offset)+" of "+fmtBytes(total));
   const response=await fetch(UPLOAD+encodeURIComponent(activeImportId)+"/chunk",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/octet-stream","x-fatman-chunk-start":String(offset),"x-fatman-total-size":String(total)},body:selectedFile.slice(offset,Math.min(total,offset+chunk))});
   let data={};try{data=await response.json();}catch{}
   if(response.status===409&&Number.isSafeInteger(Number(data.uploadedBytes))){offset=Number(data.uploadedBytes);continue;}
   if(!response.ok||data.ok!==true)throw new Error(data.error||"Secure PDF transfer failed (HTTP "+response.status+").");
   offset=Number(data.uploadedBytes);$("progress").value=offset;
  }
  phase="starting OCR and page indexing";
  say("Upload complete. BRVIN is starting Vision OCR and indexing…");
  await post("upload/"+encodeURIComponent(activeImportId)+"/complete",{});
  await showImport(activeImportId);await refresh();
 }catch(e){
  const message=e instanceof Error?e.message:String(e);
  console.error("BRVIN upload failed during "+phase,e);
  say("The operation paused during "+phase+": "+message+" Select the same PDF again to resume when possible.",true);
 }finally{uploadBusy=false;$("upload").disabled=!selectedFile;}
}
async function archiveBook(bookId,action,button){
 const book=model?.books?.find(item=>item.id===bookId);
 if(!book)return;
 const isArchive=action==="archive";
 const message=isArchive
  ?"Archive “"+book.title+"”? The PDF, OCR output, indexed pages and project assignments will be retained. Projects will stop retrieving it until you restore it."
  :"Restore “"+book.title+"”? Existing project assignments will become active for retrieval again."; 
 if(!confirm(message))return;
 button.disabled=true;
 try{
  await post("books/archive",{bookId,action});
  alert(isArchive
   ?"“"+book.title+"” is archived. Its data remains stored and the book can be restored later."
   :"“"+book.title+"” is restored and available to its previously assigned projects.");
  await refresh();
 }catch(error){alert(error.message);button.disabled=false;}
}
async function deleteBook(bookId,button){
 const book=model?.books?.find(item=>item.id===bookId);
 if(!book)return;
 if(!confirm("Permanently remove this book from BRVIN?\\n\\nThis deletes its AI Search pages, private PDF, Google Vision OCR files, project grants and BRVIN/import records. Google Cloud soft-delete policy may retain object generations temporarily."))return;
 const typed=prompt("Type the exact document name to confirm deletion:\\n"+book.title);
 if(typed!==book.title){alert("The document name did not match. Nothing was deleted.");return;}
 button.disabled=true;
 try{
  const result=await post("books/delete",{bookId,confirmTitle:typed});
  alert("Deletion started for “"+book.title+"”. BRVIN will remove its search pages and private PDF/OCR objects in the background. The dashboard will show the deletion status.");
  await refresh();
 }catch(error){alert(error.message);button.disabled=false;}
}
async function deleteVisionOutput(bookId,button){
 const book=model?.books?.find(item=>item.id===bookId);
 if(!book)return;
 if(!confirm("Delete only the saved Google Vision OCR JSON files for “"+book.title+"”?\\n\\nThe original private PDF and indexed/searchable pages will remain. Rebuilding the OCR output later requires another Google Vision OCR job and may incur charges."))return;
 const typed=prompt("Type the exact document name to confirm OCR cleanup:\\n"+book.title);
 if(typed!==book.title){alert("The document name did not match. Nothing was deleted.");return;}
 button.disabled=true;
 try{
  await post("books/delete-vision-output",{bookId,confirmTitle:typed});
  alert("Vision OCR file cleanup started. The original PDF and indexed book are being retained.");
  await refresh();
 }catch(error){alert(error.message);button.disabled=false;}
}
async function clearAllBrvinBooks(){
 const books=(model?.books||[]).filter(book=>book.sourceType==="pdf");
 if(!books.length){alert("There are no imported BRVIN books to clear.");return;}
 if(books.length>100){alert("Bulk clear handles up to 100 books per confirmation. This library has "+books.length+" imported books. Delete them in batches of 100 or use the individual Delete book actions.");return;}
 if(!confirm("Start deletion for all "+books.length+" imported BRVIN PDF books?\\n\\nThis removes their AI Search items, private PDFs, Vision OCR output, project grants and book/import records. The built-in 538-page Fatman reference, projects, collections and audit trail are preserved. Google Cloud Storage may retain recoverable copies until the soft-delete period ends. Active uploads or processing jobs will block this operation."))return;
 const typed=prompt('Type exactly DELETE ALL BRVIN BOOKS to confirm.');
 if(typed!=="DELETE ALL BRVIN BOOKS"){alert("Confirmation did not match. Nothing was deleted.");return;}
 const button=$("clear-brvin");button.disabled=true;
 try{
  const result=await post("clear",{confirmation:typed,expectedCount:books.length});
  alert("Bulk deletion started for "+result.startedCount+" of "+books.length+" books. "+(result.failedToStartCount?result.failedToStartCount+" could not start; see the returned errors. ":"")+"Each book is being deleted by its own background workflow. Check the status column and Specialist activity for completion.");
  await refresh();
 }catch(error){alert(error.message);}
 finally{button.disabled=false;}
}
function activateView(view){const allowed=["overview","books","collections","projects","operations","governance"];if(!allowed.includes(view))return;document.querySelectorAll("[data-view-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.viewPanel===view));document.querySelectorAll(".nav-item[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===view));}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>activateView(button.dataset.view)));
function openUpload(){activateView("books");$("upload-modal").classList.add("open");}
$("open-upload").addEventListener("click",openUpload);$("open-upload-secondary").addEventListener("click",openUpload);$("open-upload-books").addEventListener("click",openUpload);
$("close-upload").addEventListener("click",()=>$("upload-modal").classList.remove("open"));$("upload-modal").addEventListener("click",event=>{if(event.target===$("upload-modal"))$("upload-modal").classList.remove("open");});
$("close-upload").addEventListener("click",()=>$("upload-modal").classList.remove("open"));$("upload-modal").addEventListener("click",event=>{if(event.target===$("upload-modal"))$("upload-modal").classList.remove("open");});
$("clear-brvin").addEventListener("click",clearAllBrvinBooks);$("upload").addEventListener("click",uploadBook);$("refresh").addEventListener("click",()=>refresh());$("logout").addEventListener("click",async()=>{await fetch("/admin/logout",{method:"POST",credentials:"same-origin"});location.assign("/admin/login");});
$("create-project").addEventListener("click",async()=>{try{await post("projects",{name:$("project-name").value,description:$("project-desc").value});$("project-name").value="";$("project-desc").value="";await refresh();}catch(e){alert(e.message);}});
$("create-collection").addEventListener("click",async()=>{try{await post("collections",{name:$("collection-name").value,description:$("collection-desc").value});$("collection-name").value="";$("collection-desc").value="";await refresh();}catch(e){alert(e.message);}});
$("save-project-access").addEventListener("click",async()=>{try{const projectId=$("project-access").value;if(!projectId)throw new Error("Create or choose a project first.");const collectionIds=[...$("collection-checks").querySelectorAll("input:checked")].map(i=>i.value);await post("projects/collections",{projectId,collectionIds});await refresh();}catch(e){alert(e.message);}});
await refresh();setInterval(async()=>{await refresh();if(activeImportId&&$("modal").classList.contains("open"))await showImport(activeImportId).catch(()=>{});},5000);
</script></body></html>`;
