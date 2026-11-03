import type { Env } from "../config/env";
import { ensureAnalyticsSchema, recordVrainActivity } from "../analytics/db";
import { json } from "../http/response";
import {
  fatmanUploadStatus,
  getFatmanImportJob,
  startFatmanLibraryUpload,
} from "../fatman/import";

interface VrainBookRow {
  id: string; title: string; source_filename: string; page_count: number; indexed_pages: number;
  status: string; error_message: string | null; collection_id: string; search_prefix: string;
  source_type: string; created_at: number; updated_at: number;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
}

export function vrainAdminPage(): Response {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function vrainOverview(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
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
        "FROM vrain_books"
      ).first<Record<string, number>>(),
      env.DB.prepare(
        "SELECT c.id,c.name,c.description,c.status,c.created_at,c.updated_at,COUNT(b.id) AS book_count," +
        "COALESCE(SUM(b.page_count),0) AS page_count,COALESCE(SUM(b.indexed_pages),0) AS indexed_pages " +
        "FROM vrain_collections c LEFT JOIN vrain_books b ON b.collection_id=c.id " +
        "GROUP BY c.id ORDER BY c.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT p.id,p.name,p.slug,p.description,p.status,p.created_at,p.updated_at," +
        "(SELECT COUNT(DISTINCT pb.book_id) FROM vrain_project_books pb WHERE pb.project_id=p.id) AS direct_books," +
        "(SELECT COUNT(DISTINCT b.id) FROM vrain_project_collections pc JOIN vrain_books b ON b.collection_id=pc.collection_id WHERE pc.project_id=p.id) AS collection_books " +
        "FROM vrain_projects p ORDER BY p.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT b.id,b.title,b.source_filename,b.page_count,b.indexed_pages,b.status,b.error_message,b.collection_id," +
        "b.search_prefix,b.source_type,b.created_at,b.updated_at,c.name AS collection_name " +
        "FROM vrain_books b LEFT JOIN vrain_collections c ON c.id=b.collection_id " +
        "ORDER BY b.updated_at DESC LIMIT 200"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT pb.book_id,p.id AS project_id,p.name AS project_name FROM vrain_project_books pb " +
        "JOIN vrain_projects p ON p.id=pb.project_id WHERE p.status='active'"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT pc.collection_id,p.id AS project_id,p.name AS project_name FROM vrain_project_collections pc " +
        "JOIN vrain_projects p ON p.id=pc.project_id WHERE p.status='active'"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT j.id,j.status,j.uploaded_bytes,j.expected_size,j.indexed_pages,j.error_message,j.workflow_instance_id," +
        "j.vision_operation,j.created_at,j.updated_at,b.title,b.page_count,b.collection_id " +
        "FROM fatman_import_jobs j JOIN vrain_books b ON b.id=j.id " +
        "WHERE j.status IN ('uploading','uploaded','processing','failed') " +
        "ORDER BY j.updated_at DESC LIMIT 30"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT id,import_id,book_id,project_id,agent,phase,event_type,status,message,detail_json,created_at " +
        "FROM vrain_activity_events WHERE created_at>=? ORDER BY id DESC LIMIT 100"
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
        projects: directByBook.get(String(row.id)) ?? [],
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

export async function vrainImportStatus(env: Env, importId: string | null): Promise<Response> {
  if (!importId || !/^[a-f0-9-]{36}$/iu.test(importId)) return json({ ok: false, error: "Choose a valid book import." }, 400);
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job?.book_id) return json({ ok: false, error: "This VRAIN import could not be found." }, 404);
    const response = await fatmanUploadStatus(env, importId, true);
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) return json(payload, response.status);
    const events = await env.DB!.prepare(
      "SELECT id,agent,phase,event_type,status,message,detail_json,created_at FROM vrain_activity_events " +
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

export async function startVrainBookUpload(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
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
      "SELECT id FROM vrain_collections WHERE id=? AND status='active'"
    ).bind(collectionId).first<{ id: string }>();
    if (!collection) return json({ ok: false, error: "Choose an active VRAIN collection." }, 400);
    if (projectIds.length) {
      const placeholders = projectIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM vrain_projects WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...projectIds).all<{ id: string }>();
      if ((result.results ?? []).length !== projectIds.length) {
        return json({ ok: false, error: "One or more selected projects are unavailable." }, 400);
      }
    }

    const uploadPayload = {
      title: body.title, filename: body.filename, sha256: body.sha256, size: body.size,
      pageCount: body.pageCount, costConfirmed: body.costConfirmed,
    };
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(uploadPayload),
    });
    const response = await startFatmanLibraryUpload(env, forwarded);
    const payload = await response.clone().json() as { ok?: boolean; importId?: string; status?: string };
    if (!response.ok || payload.ok !== true || !payload.importId) return response;

    const now = Date.now();
    const statements = [
      env.DB.prepare("UPDATE vrain_books SET collection_id=?,updated_at=? WHERE id=?").bind(collectionId, now, payload.importId),
      env.DB.prepare("DELETE FROM vrain_project_books WHERE book_id=?").bind(payload.importId),
      env.DB.prepare("DELETE FROM vrain_project_collections WHERE project_id='fatman' AND collection_id=? AND ?='never'").bind(collectionId, "guard"),
    ];
    for (const projectId of projectIds) {
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO vrain_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
      ).bind(projectId, payload.importId, now));
    }
    await env.DB.batch(statements);
    await recordVrainActivity(env, {
      importId: payload.importId, bookId: payload.importId, agent: "VRAIN ingestion gateway",
      phase: "registration", eventType: "book.registered", status: "completed",
      message: "The knowledge source was registered in VRAIN and assigned to its selected collection and projects.",
      details: { collectionId, projectIds, status: payload.status ?? "uploading" },
    });
    return response;
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function createVrainProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
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
      "INSERT INTO vrain_projects (id,name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)"
    ).bind(id, name, slug, description, now, now).run();
    await recordVrainActivity(env, {
      projectId: id, agent: "VRAIN access control", phase: "governance",
      eventType: "project.created", status: "completed",
      message: "A new project identity was created. It has no knowledge access until sources are assigned.",
    });
    return json({ ok: true, project: { id, name, slug, description } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function createVrainCollection(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
  let body: { name?: unknown; description?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid collection details." }, 400); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!name) return json({ ok: false, error: "Enter a collection name." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO vrain_collections (id,name,description,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)"
    ).bind(id, name, description, now, now).run();
    await recordVrainActivity(env, {
      agent: "VRAIN knowledge governance", phase: "governance",
      eventType: "collection.created", status: "completed",
      message: "The knowledge collection was created and is not automatically shared with projects.",
      details: { collectionId: id, name },
    });
    return json({ ok: true, collection: { id, name, description } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function assignVrainBookProjects(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
  let body: { bookId?: unknown; projectIds?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid assignment details." }, 400); }
  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  const projectIds = Array.isArray(body.projectIds)
    ? [...new Set(body.projectIds.filter((value): value is string => typeof value === "string"))].slice(0, 50)
    : [];
  if (!/^[a-f0-9-]{36}$/iu.test(bookId)) return json({ ok: false, error: "Invalid book identifier." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const book = await env.DB.prepare("SELECT id FROM vrain_books WHERE id=?").bind(bookId).first<{ id: string }>();
    if (!book) return json({ ok: false, error: "Knowledge source not found." }, 404);
    if (projectIds.length) {
      const placeholders = projectIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM vrain_projects WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...projectIds).all<{ id: string }>();
      if ((result.results ?? []).length !== projectIds.length) return json({ ok: false, error: "One or more selected projects are unavailable." }, 400);
    }
    const now = Date.now();
    const statements = [env.DB.prepare("DELETE FROM vrain_project_books WHERE book_id=?").bind(bookId)];
    for (const projectId of projectIds) statements.push(env.DB.prepare(
      "INSERT INTO vrain_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
    ).bind(projectId, bookId, now));
    await env.DB.batch(statements);
    await recordVrainActivity(env, {
      bookId, agent: "VRAIN access control", phase: "governance", eventType: "book.access_updated",
      status: "completed", message: "Project access for this knowledge source was updated.",
      details: { projectIds },
    });
    return json({ ok: true, bookId, projectIds });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function assignVrainProjectCollections(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The VRAIN database is not configured." }, 503);
  let body: { projectId?: unknown; collectionIds?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid assignment details." }, 400); }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const collectionIds = Array.isArray(body.collectionIds)
    ? [...new Set(body.collectionIds.filter((value): value is string => typeof value === "string"))].slice(0, 50)
    : [];
  if (!projectId) return json({ ok: false, error: "Select a project." }, 400);
  try {
    await ensureAnalyticsSchema(env);
    const project = await env.DB.prepare("SELECT id FROM vrain_projects WHERE id=? AND status='active'").bind(projectId).first<{ id: string }>();
    if (!project) return json({ ok: false, error: "Project not found." }, 404);
    if (collectionIds.length) {
      const placeholders = collectionIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        "SELECT id FROM vrain_collections WHERE status='active' AND id IN (" + placeholders + ")"
      ).bind(...collectionIds).all<{ id: string }>();
      if ((result.results ?? []).length !== collectionIds.length) return json({ ok: false, error: "One or more collections are unavailable." }, 400);
    }
    const now = Date.now();
    const statements = [env.DB.prepare("DELETE FROM vrain_project_collections WHERE project_id=?").bind(projectId)];
    for (const collectionId of collectionIds) statements.push(env.DB.prepare(
      "INSERT INTO vrain_project_collections (project_id,collection_id,created_at,created_by) VALUES (?,?,?,'admin-dashboard')"
    ).bind(projectId, collectionId, now));
    await env.DB.batch(statements);
    await recordVrainActivity(env, {
      projectId, agent: "VRAIN access control", phase: "governance", eventType: "project.collections_updated",
      status: "completed", message: "The collections available to this project were updated.",
      details: { collectionIds },
    });
    return json({ ok: true, projectId, collectionIds });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VRAIN · Knowledge Intelligence</title>
<style>
:root{color-scheme:light;--bg:#f5f6f8;--panel:#fff;--ink:#151922;--muted:#707987;--line:#e5e8ed;--accent:#202a3a;--blue:#3769d6;--green:#16845b;--amber:#a86a09;--red:#b83a3a;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:14px}button,input,select,textarea{font:inherit}.shell{max-width:1480px;margin:auto;padding:26px 22px 58px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:22px}.eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:800}.brand{font-size:32px;font-weight:730;letter-spacing:-.055em;margin:4px 0}.subtitle{color:var(--muted);margin:0;line-height:1.5}.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:9px 12px;cursor:pointer;font-size:12px;font-weight:700}.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.btn:disabled{opacity:.45;cursor:wait}.live{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);font-weight:700}.live i{width:7px;height:7px;background:#18a36b;border-radius:50%;box-shadow:0 0 0 4px #18a36b1b}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:20px 0}.metric,.panel{background:var(--panel);border:1px solid var(--line);border-radius:15px;box-shadow:0 4px 22px #121c2b05}.metric{padding:15px}.metric span{display:block;color:var(--muted);font-size:11px}.metric strong{display:block;font-size:25px;letter-spacing:-.04em;margin-top:7px}.metric small{color:var(--muted);font-size:10px}.layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:14px}.panel{padding:17px;margin-bottom:14px;min-width:0}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.panel h2{font-size:14px;margin:0;letter-spacing:-.01em}.muted{color:var(--muted)}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field{display:flex;flex-direction:column;gap:6px;margin:10px 0}.field label{font-size:11px;font-weight:750;color:#4c5664}.field input,.field select,.field textarea{width:100%;border:1px solid #dfe3e9;background:#fff;border-radius:9px;padding:10px 11px;outline:none}.field input:focus,.field select:focus,.field textarea:focus{border-color:#8ea8e9;box-shadow:0 0 0 3px #3769d617}.drop{display:flex;align-items:center;justify-content:center;min-height:112px;border:1px dashed #bfc8d5;border-radius:12px;background:#fafbfd;text-align:center;padding:16px;cursor:pointer}.drop strong{display:block}.drop small{color:var(--muted)}.drop input{position:absolute;width:1px;height:1px;opacity:0}.checks{display:flex;gap:8px;flex-wrap:wrap;max-height:90px;overflow:auto;border:1px solid var(--line);padding:9px;border-radius:9px}.check{display:inline-flex;gap:6px;align-items:center;font-size:11px;color:#44505e}.file{font-size:11px;color:var(--muted);margin-top:6px;overflow-wrap:anywhere}.progress{height:7px;width:100%;margin-top:12px}.statusline{font-size:12px;color:var(--muted);min-height:20px;margin:8px 0}.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:11px}.step{border:1px solid var(--line);border-radius:9px;background:#fafbfd;padding:9px 7px;min-width:0}.step b{display:block;font-size:10px}.step small{display:block;font-size:9px;color:var(--muted);margin-top:4px}.step.active{background:#f2f6ff;border-color:#c6d5f8}.step.done{background:#f1faf5;border-color:#c4e6d2}.step.failed{background:#fff4f4;border-color:#f0caca}.tablewrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:11px}.table th,.table td{padding:10px 8px;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}.table th{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);white-space:nowrap}.pill{display:inline-block;padding:4px 7px;border-radius:99px;background:#eef1f5;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.pill.ready,.pill.completed{background:#e8f7ef;color:#17794f}.pill.failed{background:#fff0f0;color:#a63232}.pill.processing,.pill.uploading,.pill.uploaded,.pill.running{background:#eef4ff;color:#315da9}.pill.warning,.pill.needs_review{background:#fff6e9;color:#92600b}.collection-grid,.project-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.tile{border:1px solid var(--line);border-radius:11px;padding:12px;min-width:0}.tile strong{font-size:12px}.tile p{font-size:10px;color:var(--muted);line-height:1.5;margin:5px 0}.tile small{font-size:10px;color:var(--muted)}.timeline{display:flex;flex-direction:column;gap:0}.event{display:grid;grid-template-columns:10px 1fr;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f3}.event:last-child{border-bottom:0}.rail{width:7px;height:7px;border-radius:50%;background:#8da5d2;margin-top:4px}.event.failed .rail{background:var(--red)}.event.completed .rail{background:var(--green)}.event strong{font-size:11px}.event p{margin:3px 0;color:#566171;font-size:11px;line-height:1.45}.event small{font-size:9px;color:var(--muted)}.empty{text-align:center;padding:22px;color:var(--muted);font-size:11px}.bar{height:5px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:5px}.bar i{display:block;height:100%;background:var(--blue)}.notice{background:#f6f8fb;border:1px solid var(--line);padding:10px;border-radius:10px;color:#647083;font-size:10px;line-height:1.5;margin-top:10px}.error{color:var(--red)}.modal{display:none;position:fixed;inset:0;background:#0e172b60;z-index:20;padding:20px;overflow:auto}.modal.open{display:block}.modalbox{max-width:720px;margin:5vh auto;background:#fff;border-radius:16px;padding:18px;max-height:85vh;overflow:auto}.modalhead{display:flex;justify-content:space-between;align-items:center}.hide{display:none!important}@media(max-width:1050px){.metrics{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:620px){.shell{padding:17px 12px 40px}.brand{font-size:27px}.metrics{grid-template-columns:repeat(2,1fr)}.formgrid,.collection-grid,.project-grid{grid-template-columns:1fr}.steps{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="shell">
<header class="top"><div><div class="eyebrow">Parmar AI · Knowledge Infrastructure</div><h1 class="brand">VRAIN</h1><p class="subtitle">The central knowledge brain. One governed repository, selectively connected to each project.</p></div><div class="actions"><span class="live"><i></i><span id="live-label">LIVE · connecting</span></span><button class="btn" id="refresh">Refresh</button><a class="btn" href="/admin">Admin home</a><button class="btn" id="logout">Sign out</button></div></header>
<div class="metrics" id="metrics"><div class="metric"><span>Knowledge sources</span><strong>—</strong><small>Across all collections</small></div><div class="metric"><span>Collections</span><strong>—</strong><small>Governed groups</small></div><div class="metric"><span>Projects</span><strong>—</strong><small>Independent consumers</small></div><div class="metric"><span>Indexed pages</span><strong>—</strong><small>Verified / total</small></div><div class="metric"><span>Active pipelines</span><strong>—</strong><small>Running now</small></div><div class="metric"><span>Needs attention</span><strong>—</strong><small>Failed or blocked</small></div></div>
<div class="layout"><div>
<section class="panel"><div class="panel-head"><h2>Add knowledge source</h2><span class="muted" style="font-size:10px">PDF · up to 1 GB · 2,000 pages</span></div>
<div class="formgrid"><div class="field"><label for="book-title">Book / document name</label><input id="book-title" maxlength="160" placeholder="e.g. Indian Polity Reference"></div><div class="field"><label for="collection">Knowledge collection</label><select id="collection"></select></div></div>
<div class="field"><label>PDF document</label><label class="drop" for="pdf"><span><strong>Choose PDF from this device</strong><small>Private resumable upload · OCR costs may apply</small><input id="pdf" type="file" accept="application/pdf"></span></label><div class="file" id="file-info">No PDF selected.</div></div>
<div class="field"><label>Grant project access (optional)</label><div class="checks" id="project-checks"><span class="muted">Loading projects…</span></div></div>
<label class="check"><input type="checkbox" id="cost"> I understand Google Cloud Vision OCR may incur usage charges.</label>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="upload" disabled>Add to VRAIN</button><button class="btn" id="resume" disabled>Resume selected job</button></div><progress class="progress" id="progress" value="0" max="100"></progress><p class="statusline" id="upload-status" aria-live="polite">Choose a PDF to start. Processing continues on the server after upload completes.</p>
<div class="steps"><div class="step" id="step-upload"><b>01 · Secure upload</b><small>Private object storage</small></div><div class="step" id="step-ocr"><b>02 · Vision OCR</b><small>Document text detection</small></div><div class="step" id="step-index"><b>03 · Indexing</b><small>Page-level search</small></div><div class="step" id="step-qa"><b>04 · Retrieval QA</b><small>Source-page verification</small></div><div class="step" id="step-ready"><b>05 · Ready</b><small>Project access enabled</small></div></div>
<div class="notice">VRAIN does not automatically share every book with every project. A book is searchable only after indexing and retrieval QA pass, and only for projects explicitly assigned the book or its collection.</div></section>
<section class="panel"><div class="panel-head"><h2>Knowledge sources</h2><span class="muted" id="book-count">—</span></div><div class="tablewrap"><table class="table"><thead><tr><th>Source</th><th>Collection</th><th>Indexed</th><th>Status</th><th>Project access</th><th></th></tr></thead><tbody id="books"><tr><td class="empty" colspan="6">Loading knowledge registry…</td></tr></tbody></table></div></section>
<section class="panel"><div class="panel-head"><h2>Knowledge collections</h2><span class="muted">Logical organisation · not automatically shared</span></div><div id="collections" class="collection-grid"></div></section>
<section class="panel"><div class="panel-head"><h2>Connected projects</h2><span class="muted">Explicit knowledge access</span></div><div id="projects" class="project-grid"></div></section>
</div><div>
<section class="panel"><div class="panel-head"><h2>Live operations</h2><span class="live"><i></i>5-second refresh</span></div><div id="jobs"><div class="empty">No active processing jobs.</div></div></section>
<section class="panel"><div class="panel-head"><h2>Specialist activity</h2><span class="muted" id="event-stamp">Actual workflow events</span></div><div class="timeline" id="events"><div class="empty">Waiting for VRAIN events…</div></div></section>
<section class="panel"><div class="panel-head"><h2>Governance</h2></div>
<div class="field"><label for="project-name">Create project</label><input id="project-name" maxlength="100" placeholder="Project name"></div><div class="field"><label for="project-desc">Description</label><input id="project-desc" maxlength="500" placeholder="What will this platform use VRAIN for?"></div><button class="btn" id="create-project">Create project</button>
<div class="field" style="margin-top:17px"><label for="collection-name">Create collection</label><input id="collection-name" maxlength="100" placeholder="Collection name"></div><div class="field"><label for="collection-desc">Description</label><input id="collection-desc" maxlength="500" placeholder="What belongs in this collection?"></div><button class="btn" id="create-collection">Create collection</button>
<div class="field" style="margin-top:17px"><label for="project-access">Assign collections to project</label><select id="project-access"></select></div><div class="field"><label>Available collections</label><div class="checks" id="collection-checks"></div></div><button class="btn" id="save-project-access">Save collection access</button>
<p class="notice">Access is additive: projects receive content through direct book assignments and/or collection assignments. Empty projects have no VRAIN knowledge access.</p></section>
</div></div>
<p class="muted" style="font-size:10px;text-align:center;margin-top:16px">VRAIN · Administrator-only · Operational data refreshes automatically · Knowledge is never globally exposed by default</p>
</main>
<div class="modal" id="modal"><div class="modalbox"><div class="modalhead"><h2 id="modal-title">Book operations</h2><button class="btn" id="close-modal">Close</button></div><div id="modal-body"></div></div></div>
<script type="module">
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const $=id=>document.getElementById(id),API="/admin/api/vrain/",UPLOAD="/admin/api/vrain/upload/";
let model=null,selectedFile=null,activeImportId=null,uploadBusy=false,refreshLoop=null;
function say(message,error=false){$("upload-status").textContent=message;$("upload-status").classList.toggle("error",error);}
async function api(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin"});let data={};try{data=await response.json();}catch{}if(!response.ok||data.ok!==true)throw new Error(data.error||"Request failed (HTTP "+response.status+").");return data;}
function post(path,body){return api(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
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
function renderCollections(list){$("collections").innerHTML=list.length?list.map(c=>'<div class="tile"><strong>'+esc(c.name)+'</strong><p>'+esc(c.description||"No description")+'</p><small>'+c.bookCount+' sources · '+c.indexedPages+'/'+c.pageCount+' pages indexed · '+c.projects.length+' project links</small></div>').join(""):'<div class="empty">No collections yet.</div>';
 $("collection").innerHTML=list.filter(c=>c.status==="active").map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
 $("collection-checks").innerHTML=list.filter(c=>c.status==="active").map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.id)+'"> '+esc(c.name)+'</label>').join("")||'<span class="muted">Create a collection first.</span>';
}
function renderProjects(list){$("projects").innerHTML=list.length?list.map(p=>'<div class="tile"><strong>'+esc(p.name)+'</strong> '+statusPill(p.status)+'<p>'+esc(p.description||"No description")+'</p><small>Direct books: '+p.directBooks+' · via collections: '+p.collectionBooks+' · slug '+esc(p.slug)+'</small></div>').join(""):'<div class="empty">No projects have been registered.</div>';
 $("project-checks").innerHTML=list.filter(p=>p.status==="active").map(p=>'<label class="check"><input type="checkbox" value="'+esc(p.id)+'"> '+esc(p.name)+'</label>').join("")||'<span class="muted">No active projects. Create one below.</span>';
 $("project-access").innerHTML=list.filter(p=>p.status==="active").map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
}
function renderBooks(list,projects){$("book-count").textContent=list.length+" sources";$("books").innerHTML=list.length?list.map(b=>{
 const access=b.projects.map(p=>p.name).join(", ")||"No direct access";
 const progress=pct(b.indexedPages,b.pageCount);
 const action=b.status==="uploading"||b.status==="uploaded"||b.status==="processing"||b.status==="failed"
  ?'<button class="btn" data-view="'+esc(b.id)+'">Operations</button> ':"";
 const manage='<button class="btn" data-access="'+esc(b.id)+'">Access</button>';
 return '<tr><td><strong>'+esc(b.title)+'</strong><div class="muted">'+esc(b.filename)+'</div><div class="bar"><i style="width:'+progress+'%"></i></div></td><td>'+esc(b.collectionName)+'</td><td>'+b.indexedPages+'/'+b.pageCount+'</td><td>'+statusPill(b.status)+(b.error?'<div class="error">'+esc(b.error)+'</div>':"")+'</td><td>'+esc(access)+'</td><td>'+action+manage+'</td></tr>';
 }).join(""):'<tr><td class="empty" colspan="6">No knowledge sources yet. Add the first PDF above.</td></tr>';
 $("books").querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>showImport(button.dataset.view)));
 $("books").querySelectorAll("[data-access]").forEach(button=>button.addEventListener("click",()=>editBookAccess(button.dataset.access)));
}
function renderJobs(list){$("jobs").innerHTML=list.length?list.map(j=>{
 const percent=j.status==="uploading"?pct(j.uploadedBytes,j.expectedBytes):pct(j.indexedPages,j.pageCount);
 const label=j.status==="uploading"?fmtBytes(j.uploadedBytes)+" / "+fmtBytes(j.expectedBytes):j.indexedPages+" / "+j.pageCount+" pages";
 return '<div class="tile" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(j.title)+'</strong>'+statusPill(j.status)+'</div><p>'+esc(label)+' · '+percent+'% · updated '+esc(time(j.updatedAt))+'</p><div class="bar"><i style="width:'+percent+'%"></i></div>'+(j.error?'<p class="error">'+esc(j.error)+'</p>':"")+'<div style="margin-top:8px"><button class="btn" data-view="'+esc(j.id)+'">Inspect pipeline</button>'+(j.status==="failed"&&j.hasOcrOperation?'<button class="btn" data-resume="'+esc(j.id)+'" style="margin-left:5px">Resume</button>':"")+'</div></div>';
 }).join(""):'<div class="empty">No active processing jobs. New VRAIN operations will appear here.</div>';
 $("jobs").querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showImport(b.dataset.view)));
 $("jobs").querySelectorAll("[data-resume]").forEach(b=>b.addEventListener("click",()=>resumeImport(b.dataset.resume)));
}
function renderEvents(list){$("events").innerHTML=list.length?list.slice(0,60).map(e=>'<div class="event '+esc(e.status)+'"><i class="rail"></i><div><div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(e.agent)+' · '+esc(e.phase)+'</strong>'+statusPill(e.status)+'</div><p>'+esc(e.message)+'</p><small>'+esc(time(e.createdAt))+' · '+esc(e.type)+'</small></div></div>').join(""):'<div class="empty">No operation events recorded yet.</div>';}
function render(){if(!model)return;renderMetrics(model.stats);renderCollections(model.collections);renderProjects(model.projects);renderBooks(model.books,model.projects);renderJobs(model.jobs);renderEvents(model.events);$("live-label").textContent="LIVE · refreshed "+new Date(model.generatedAt).toLocaleTimeString();$("event-stamp").textContent="Last event "+(model.events[0]?time(model.events[0].createdAt):"—");}
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
 renderJob(job,d.pipeline);$("modal-title").textContent=job.bookTitle||"VRAIN operations";
 $("modal-body").innerHTML='<div class="metrics" style="grid-template-columns:repeat(3,1fr)"><div class="metric"><span>State</span><strong style="font-size:17px">'+esc(job.status)+'</strong></div><div class="metric"><span>Indexed</span><strong style="font-size:17px">'+job.indexedPages+'/'+job.expectedPages+'</strong></div><div class="metric"><span>Upload</span><strong style="font-size:17px">'+pct(job.uploadedBytes,job.expectedSize)+'%</strong></div></div><p class="muted">Vision OCR: '+esc(d.pipeline?.vision?.status||"not started")+' · Workflow: '+esc(d.pipeline?.workflow?.status||"not started")+'</p><div class="timeline">'+(d.events||[]).map(e=>'<div class="event '+esc(e.status)+'"><i class="rail"></i><div><strong>'+esc(e.agent)+' · '+esc(e.phase)+'</strong><p>'+esc(e.message)+'</p><small>'+esc(time(e.createdAt))+'</small></div></div>').join("")+'</div>';
 $("modal").classList.add("open");
 }catch(e){say(e.message,true);}}
async function editBookAccess(id){const book=model.books.find(b=>b.id===id);if(!book)return;const selected=new Set(book.projects.map(p=>p.id));
 $("modal-title").textContent="Project access · "+book.title;
 $("modal-body").innerHTML='<p class="muted">Choose exactly which projects can retrieve this source. Saving replaces its direct project assignments.</p><div class="checks" id="access-choices">'+model.projects.filter(p=>p.status==="active").map(p=>'<label class="check"><input type="checkbox" value="'+esc(p.id)+'" '+(selected.has(p.id)?"checked":"")+'> '+esc(p.name)+'</label>').join("")+'</div><button class="btn primary" id="save-book-access" style="margin-top:12px">Save access</button>';
 $("modal").classList.add("open");
 $("save-book-access").addEventListener("click",async()=>{const projectIds=[...$("access-choices").querySelectorAll("input:checked")].map(i=>i.value);try{await post("books/assign",{bookId:id,projectIds});$("modal").classList.remove("open");await refresh();}catch(e){alert(e.message);}});
}
async function showImportEvents(id){await showImport(id);}
async function resumeImport(id){try{await post("upload/"+encodeURIComponent(id)+"/resume",{});activeImportId=id;await showImport(id);await refresh();}catch(e){say(e.message,true);}}
$("close-modal").addEventListener("click",()=>$("modal").classList.remove("open"));
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))$("modal").classList.remove("open");});
$("pdf").addEventListener("change",()=>{selectedFile=$("pdf").files?.[0]||null;if(selectedFile&&!$("book-title").value.trim())$("book-title").value=selectedFile.name.replace(/\.pdf$/iu,"").replace(/[_-]+/gu," ").trim();$("file-info").textContent=selectedFile?selectedFile.name+" · "+fmtBytes(selectedFile.size):"No PDF selected.";$("upload").disabled=!selectedFile||uploadBusy;});
async function inspect(file){if(file.size<8||file.size>1024*1024*1024)throw new Error("Choose a PDF between 8 bytes and 1 GB.");const buffer=await file.arrayBuffer();if(new TextDecoder().decode(buffer.slice(0,5))!=="%PDF-")throw new Error("This file is not a valid PDF.");const digest=await crypto.subtle.digest("SHA-256",buffer);const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();const pdf=await pdfjsLib.getDocument({data:new Uint8Array(buffer)}).promise;const pageCount=pdf.numPages;await pdf.destroy();if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>2000)throw new Error("VRAIN currently supports 1–2,000 pages per PDF.");return{hash,pageCount};}
async function uploadBook(){if(!selectedFile)return;if(!$("cost").checked){say("Confirm the Google Cloud OCR cost notice first.",true);return;}if(!$("book-title").value.trim()){say("Enter the name of this knowledge source.",true);return;}uploadBusy=true;$("upload").disabled=true;try{say("Inspecting PDF, counting pages and verifying its SHA-256 fingerprint…");const meta=await inspect(selectedFile);const projectIds=[...$("project-checks").querySelectorAll("input:checked")].map(i=>i.value);const started=await post("upload/start",{title:$("book-title").value.trim(),filename:selectedFile.name,sha256:meta.hash,size:selectedFile.size,pageCount:meta.pageCount,costConfirmed:true,collectionId:$("collection").value,projectIds});activeImportId=started.importId;
 if(started.canResume){await resumeImport(activeImportId);return;}
 if(started.status==="processing"||started.status==="uploaded"||started.status==="completed"){await showImport(activeImportId);await refresh();return;}
 let offset=Number(started.uploadedBytes||0),total=selectedFile.size,chunk=8*1024*1024;$("progress").max=total;$("progress").value=offset;
 while(offset<total){say("Secure transfer: "+pct(offset,total)+"% · "+fmtBytes(offset)+" of "+fmtBytes(total));const response=await fetch(UPLOAD+encodeURIComponent(activeImportId)+"/chunk",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/octet-stream","x-fatman-chunk-start":String(offset),"x-fatman-total-size":String(total)},body:selectedFile.slice(offset,Math.min(total,offset+chunk))});let data={};try{data=await response.json();}catch{}if(response.status===409&&Number.isSafeInteger(Number(data.uploadedBytes))){offset=Number(data.uploadedBytes);continue;}if(!response.ok||data.ok!==true)throw new Error(data.error||"Secure PDF transfer failed.");offset=Number(data.uploadedBytes);$("progress").value=offset;}
 say("Upload complete. VRAIN is starting Vision OCR and indexing…");await post("upload/"+encodeURIComponent(activeImportId)+"/complete",{});await showImport(activeImportId);await refresh();
 }catch(e){say("The operation paused: "+e.message+" Select the same PDF again to resume when possible.",true);}finally{uploadBusy=false;$("upload").disabled=!selectedFile;}}
$("upload").addEventListener("click",uploadBook);$("refresh").addEventListener("click",()=>refresh());$("logout").addEventListener("click",async()=>{await fetch("/admin/logout",{method:"POST",credentials:"same-origin"});location.assign("/admin/login");});
$("create-project").addEventListener("click",async()=>{try{await post("projects",{name:$("project-name").value,description:$("project-desc").value});$("project-name").value="";$("project-desc").value="";await refresh();}catch(e){alert(e.message);}});
$("create-collection").addEventListener("click",async()=>{try{await post("collections",{name:$("collection-name").value,description:$("collection-desc").value});$("collection-name").value="";$("collection-desc").value="";await refresh();}catch(e){alert(e.message);}});
$("save-project-access").addEventListener("click",async()=>{try{const projectId=$("project-access").value;if(!projectId)throw new Error("Create or choose a project first.");const collectionIds=[...$("collection-checks").querySelectorAll("input:checked")].map(i=>i.value);await post("projects/collections",{projectId,collectionIds});await refresh();}catch(e){alert(e.message);}});
$("resume").addEventListener("click",()=>{if(activeImportId)resumeImport(activeImportId);});
async function tick(){await refresh();if(activeImportId)await showImportEvents(activeImportId).catch(()=>{});}
await refresh();refreshLoop=setInterval(refresh,5000);
</script></body></html>`;
