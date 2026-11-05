import type { Env } from "../config/env";
import { ensureAnalyticsSchema, recordBrvinActivity } from "../analytics/db";
import { json } from "../http/response";
import {
  fatmanUploadStatus,
  getFatmanImportJob,
  startFatmanLibraryUpload,
} from "../fatman/import";
import { brvinMonthlyQueryLimit } from "./service-core";

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
    const billingMonth = new Date(now).toISOString().slice(0, 7);
    const [stats, collections, projects, books, bookAssignments, collectionAssignments, jobs, events, applications, environments, applicationGrants, projectUsage, fatmanUsage, retentionSummaryResult, eventSummaryResult] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS books, COALESCE(SUM(page_count),0) AS total_pages, " +
        "COALESCE(SUM(indexed_pages),0) AS indexed_pages, " +
        "SUM(CASE WHEN status='ready' AND indexed_pages=page_count THEN 1 ELSE 0 END) AS ready_books, " +
        "SUM(CASE WHEN status IN ('uploading','uploaded','processing') THEN 1 ELSE 0 END) AS active_books, " +
        "SUM(CASE WHEN status IN ('failed','delete_failed') THEN 1 ELSE 0 END) AS failed_books, " +
        "SUM(CASE WHEN status IN ('deleting','delete_failed') THEN 1 ELSE 0 END) AS deleting_books " +
        "FROM brvin_books"
      ).first<Record<string, number>>(),
      env.DB.prepare(
        "SELECT c.id,c.name,c.description,c.status,c.created_at,c.updated_at,COUNT(b.id) AS book_count," +
        "COALESCE(SUM(b.page_count),0) AS page_count,COALESCE(SUM(b.indexed_pages),0) AS indexed_pages " +
        "FROM brvin_collections c LEFT JOIN brvin_books b ON b.collection_id=c.id " +
        "GROUP BY c.id ORDER BY c.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT p.id,p.name,p.slug,p.description,p.owner_label,p.status,p.created_at,p.updated_at," +
        "(SELECT COUNT(DISTINCT pb.book_id) FROM brvin_project_books pb WHERE pb.project_id=p.id) AS direct_books," +
        "(SELECT COUNT(DISTINCT b.id) FROM brvin_project_collections pc JOIN brvin_books b ON b.collection_id=pc.collection_id WHERE pc.project_id=p.id) AS collection_books," +
        "(SELECT COUNT(*) FROM (" +
        " SELECT pb.book_id AS source_id FROM brvin_project_books pb WHERE pb.project_id=p.id" +
        " UNION SELECT b.id AS source_id FROM brvin_project_collections pc JOIN brvin_books b ON b.collection_id=pc.collection_id WHERE pc.project_id=p.id" +
        ") AS project_sources) AS source_count," +
        "(SELECT COUNT(*) FROM (" +
        " SELECT b.id AS source_id FROM brvin_project_books pb JOIN brvin_books b ON b.id=pb.book_id WHERE pb.project_id=p.id AND b.status='ready' AND b.page_count>0 AND b.indexed_pages=b.page_count" +
        " UNION SELECT b.id AS source_id FROM brvin_project_collections pc JOIN brvin_books b ON b.collection_id=pc.collection_id WHERE pc.project_id=p.id AND b.status='ready' AND b.page_count>0 AND b.indexed_pages=b.page_count" +
        ") AS ready_project_sources) AS ready_source_count," +
        "(SELECT COUNT(*) FROM brvin_application_project_grants ag WHERE ag.project_id=p.id AND ag.status='active') AS application_count " +
        "FROM brvin_projects p ORDER BY p.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT b.id,b.title,b.source_filename,b.page_count,b.indexed_pages,b.status,b.error_message,b.collection_id," +
        "b.search_prefix,b.source_type,b.vision_output_deleted_at,b.vision_output_deletion_started_at,b.created_at,b.updated_at,c.name AS collection_name," +
        "(SELECT e.event_type FROM brvin_activity_events e WHERE e.book_id=b.id AND e.event_type IN ('source.vision_ocr_delete_failed','source.vision_ocr_deleted') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS vision_cleanup_last_event_type," +
        "(SELECT e.message FROM brvin_activity_events e WHERE e.book_id=b.id AND e.event_type IN ('source.vision_ocr_delete_failed','source.vision_ocr_deleted') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS vision_cleanup_last_message," +
        "(SELECT e.created_at FROM brvin_activity_events e WHERE e.book_id=b.id AND e.event_type IN ('source.vision_ocr_delete_failed','source.vision_ocr_deleted') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS vision_cleanup_last_at " +
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
      env.DB.prepare(
        "SELECT a.id,a.slug,a.name,a.description,a.owner_label,a.repository_url,a.repository_default_branch,a.runtime_provider,a.status,a.created_at,a.updated_at," +
        "(SELECT COUNT(*) FROM brvin_application_environments e WHERE e.application_id=a.id AND e.status='active') AS active_environment_count," +
        "(SELECT COUNT(*) FROM brvin_application_project_grants g WHERE g.application_id=a.id AND g.status='active') AS active_project_count " +
        "FROM brvin_applications a ORDER BY a.name COLLATE NOCASE"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT e.id,e.application_id,e.environment_key,e.display_name,e.worker_name,e.worker_url,e.status,e.created_at,e.updated_at,e.revoked_at,e.revoked_by,a.status AS application_status,a.updated_at AS application_updated_at," +
        "(SELECT c.status FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_status," +
        "(SELECT c.ready FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_ready," +
        "(SELECT c.authorized_source_count FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_source_count," +
        "(SELECT c.failure_code FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_failure_code," +
        "(SELECT c.created_at FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_created_at," +
        "(SELECT c.completed_at FROM brvin_connection_checks c WHERE c.environment_id=e.id ORDER BY c.created_at DESC LIMIT 1) AS last_check_completed_at " +
        "FROM brvin_application_environments e JOIN brvin_applications a ON a.id=e.application_id ORDER BY e.application_id,e.environment_key"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT g.id,g.application_id,g.project_id,g.status,g.created_at,g.created_by,g.revoked_at,g.revoked_by," +
        "p.name AS project_name,p.slug AS project_slug,p.status AS project_status," +
        "a.name AS application_name,a.slug AS application_slug " +
        "FROM brvin_application_project_grants g JOIN brvin_projects p ON p.id=g.project_id " +
        "JOIN brvin_applications a ON a.id=g.application_id " +
        "ORDER BY g.created_at DESC"
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT project_id,query_count FROM brvin_project_search_usage WHERE billing_month=?"
      ).bind(billingMonth).all<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT query_count FROM fatman_search_usage WHERE billing_month=?"
      ).bind(billingMonth).first<Record<string, unknown>>(),
      env.DB.prepare(
        "SELECT " +
        "SUM(CASE WHEN source_type='pdf' AND status IN ('ready','archived') AND vision_output_deleted_at IS NULL THEN 1 ELSE 0 END) AS total_due," +
        "SUM(CASE WHEN source_type='pdf' AND status IN ('ready','archived') AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NOT NULL THEN 1 ELSE 0 END) AS running," +
        "SUM(CASE WHEN source_type='pdf' AND status IN ('ready','archived') AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NULL AND (" +
          "SELECT e.event_type FROM brvin_activity_events e WHERE e.book_id=brvin_books.id AND e.event_type IN ('source.vision_ocr_delete_failed','source.vision_ocr_deleted') ORDER BY e.created_at DESC,e.id DESC LIMIT 1" +
        ")='source.vision_ocr_delete_failed' THEN 1 ELSE 0 END) AS failed " +
        "FROM brvin_books"
      ).first<Record<string, number>>(),
      env.DB.prepare(
        "SELECT SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed," +
        "SUM(CASE WHEN status='warning' THEN 1 ELSE 0 END) AS warnings," +
        "SUM(CASE WHEN event_type='source.vision_ocr_delete_failed' THEN 1 ELSE 0 END) AS ocr_cleanup_failures," +
        "MAX(created_at) AS latest_at FROM brvin_activity_events WHERE created_at>=?"
      ).bind(now - 7 * 86_400_000).first<Record<string, number>>(),
    ]);

    const retentionSummaryRow = retentionSummaryResult ?? null;
    const eventSummaryRow = eventSummaryResult ?? null;

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

    const environmentsByApplication = new Map<string, Array<Record<string, unknown>>>();
    for (const row of environments.results ?? []) {
      const applicationId = String(row.application_id);
      const list = environmentsByApplication.get(applicationId) ?? [];
      const environmentStatus = String(row.status);
      const applicationStatus = String(row.application_status ?? "");
      const lastCheckStatus = String(row.last_check_status ?? "");
      const lastCheckedAt = row.last_check_completed_at === null || row.last_check_completed_at === undefined
        ? Number(row.last_check_created_at ?? 0) : Number(row.last_check_completed_at);
      const checkIsCurrent = lastCheckedAt >= Math.max(Number(row.updated_at ?? 0), Number(row.application_updated_at ?? 0)) && lastCheckedAt > 0;
      let connectionStatus = "pending";
      if (environmentStatus === "revoked") connectionStatus = "revoked";
      else if (environmentStatus === "disabled" || applicationStatus !== "active") connectionStatus = "disabled";
      else if (checkIsCurrent && lastCheckStatus === "connected") {
        connectionStatus = Number(row.last_check_ready ?? 0) === 1 ? "connected" : "connected_no_ready";
      } else if (checkIsCurrent && lastCheckStatus === "failed") connectionStatus = "failed";
      list.push({
        id: String(row.id),
        environmentKey: String(row.environment_key),
        displayName: String(row.display_name ?? ""),
        workerName: String(row.worker_name ?? ""),
        workerUrl: String(row.worker_url ?? ""),
        status: environmentStatus,
        connectionStatus,
        connectionLastCheckedAt: lastCheckedAt || null,
        connectionFailureCode: checkIsCurrent && lastCheckStatus === "failed" ? String(row.last_check_failure_code ?? "") : "",
        connectionReady: checkIsCurrent && lastCheckStatus === "connected" ? Number(row.last_check_ready ?? 0) === 1 : null,
        connectionAuthorizedSourceCount: checkIsCurrent && lastCheckStatus === "connected" ? Number(row.last_check_source_count ?? 0) : null,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
        revokedBy: row.revoked_by ? String(row.revoked_by) : null,
      });
      environmentsByApplication.set(applicationId, list);
    }

    const projectsByApplication = new Map<string, Array<Record<string, unknown>>>();
    const applicationsByProject = new Map<string, Array<Record<string, unknown>>>();
    for (const row of applicationGrants.results ?? []) {
      const applicationId = String(row.application_id);
      const projectId = String(row.project_id);
      const grant = {
        grantId: String(row.id),
        applicationId,
        projectId,
        status: String(row.status),
        createdAt: Number(row.created_at),
        createdBy: row.created_by ? String(row.created_by) : null,
        revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
        revokedBy: row.revoked_by ? String(row.revoked_by) : null,
        projectName: String(row.project_name),
        projectSlug: String(row.project_slug),
        projectStatus: String(row.project_status),
      };
      const appProjects = projectsByApplication.get(applicationId) ?? [];
      appProjects.push(grant);
      projectsByApplication.set(applicationId, appProjects);
      const projectApplications = applicationsByProject.get(projectId) ?? [];
      projectApplications.push({
        applicationId,
        name: String(row.application_name ?? ""),
        slug: String(row.application_slug ?? ""),
        grantId: String(row.id),
        status: String(row.status),
        createdAt: Number(row.created_at),
        revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
      });
      applicationsByProject.set(projectId, projectApplications);
    }

    const monthlyQueriesByProject = new Map<string, number>();
    for (const row of projectUsage.results ?? []) {
      monthlyQueriesByProject.set(String(row.project_id), Number(row.query_count ?? 0));
    }
    // Fatman's existing v1 requests have their own counter; preserve that separate accounting.
    if (fatmanUsage) monthlyQueriesByProject.set("fatman", Number(fatmanUsage.query_count ?? 0));
    const monthlyLimit = brvinMonthlyQueryLimit(env.BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT);
    const allEnvironments = [...environmentsByApplication.values()].flat();
    const connectionCounts = {
      connected: allEnvironments.filter(item => item.connectionStatus === "connected").length,
      connectedNoReady: allEnvironments.filter(item => item.connectionStatus === "connected_no_ready").length,
      failed: allEnvironments.filter(item => item.connectionStatus === "failed").length,
      pending: allEnvironments.filter(item => item.connectionStatus === "pending").length,
      disabled: allEnvironments.filter(item => item.connectionStatus === "disabled").length,
      revoked: allEnvironments.filter(item => item.connectionStatus === "revoked").length,
    };
    const retentionSummary = {
      totalDue: Number(retentionSummaryRow?.total_due ?? 0),
      running: Number(retentionSummaryRow?.running ?? 0),
      failed: Number(retentionSummaryRow?.failed ?? 0),
    };
    const eventSummary = {
      failed: Number(eventSummaryRow?.failed ?? 0),
      warnings: Number(eventSummaryRow?.warnings ?? 0),
      ocrCleanupFailures: Number(eventSummaryRow?.ocr_cleanup_failures ?? 0),
      latestAt: eventSummaryRow?.latest_at == null ? null : Number(eventSummaryRow.latest_at),
    };

    return json({
      ok: true,
      generatedAt: now,
      stats: {
        books: Number(stats?.books ?? 0), collections: collections.results?.length ?? 0,
        projects: projects.results?.length ?? 0, applications: applications.results?.length ?? 0,
        totalPages: Number(stats?.total_pages ?? 0),
        indexedPages: Number(stats?.indexed_pages ?? 0), readyBooks: Number(stats?.ready_books ?? 0),
        activeBooks: Number(stats?.active_books ?? 0), failedBooks: Number(stats?.failed_books ?? 0),
        deletingBooks: Number(stats?.deleting_books ?? 0),
      },
      operations: {
        billingMonth,
        monthlyQueryLimit: monthlyLimit,
        connections: connectionCounts,
        retention: retentionSummary,
        events: eventSummary,
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
        description: String(row.description ?? ""), ownerLabel: String(row.owner_label ?? ""),
        status: String(row.status),
        directBooks: Number(row.direct_books ?? 0), collectionBooks: Number(row.collection_books ?? 0),
        sourceCount: Number(row.source_count ?? 0), readySourceCount: Number(row.ready_source_count ?? 0),
        applicationCount: Number(row.application_count ?? 0),
        monthlyQueries: monthlyQueriesByProject.get(String(row.id)) ?? 0,
        monthlyLimit,
        monthlyRemaining: Math.max(0, monthlyLimit - (monthlyQueriesByProject.get(String(row.id)) ?? 0)),
        applications: applicationsByProject.get(String(row.id)) ?? [],
      })),
      applications: (applications.results ?? []).map((row) => ({
        id: String(row.id), slug: String(row.slug), name: String(row.name),
        description: String(row.description ?? ""), ownerLabel: String(row.owner_label ?? ""),
        repositoryUrl: String(row.repository_url ?? ""),
        repositoryDefaultBranch: String(row.repository_default_branch ?? "main"),
        runtimeProvider: String(row.runtime_provider ?? "cloudflare-workers"),
        status: String(row.status),
        activeEnvironmentCount: Number(row.active_environment_count ?? 0),
        activeProjectCount: Number(row.active_project_count ?? 0),
        environments: environmentsByApplication.get(String(row.id)) ?? [],
        projects: (projectsByApplication.get(String(row.id)) ?? []).map(grant => ({
          ...grant,
          monthlyQueries: monthlyQueriesByProject.get(String(grant.projectId)) ?? 0,
          monthlyLimit,
          monthlyRemaining: Math.max(0, monthlyLimit - (monthlyQueriesByProject.get(String(grant.projectId)) ?? 0)),
          usageScope: "shared_project",
        })),
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      })),
      books: (books.results ?? []).map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.source_filename ?? ""),
        pageCount: Number(row.page_count ?? 0), indexedPages: Number(row.indexed_pages ?? 0),
        status: String(row.status), error: row.error_message ? String(row.error_message) : undefined,
        collectionId: String(row.collection_id), collectionName: String(row.collection_name ?? "Unassigned"),
        searchPrefix: String(row.search_prefix), sourceType: String(row.source_type),
        visionOcrDeleted: row.vision_output_deleted_at !== null && row.vision_output_deleted_at !== undefined,
        visionOcrDeleting: row.vision_output_deletion_started_at !== null && row.vision_output_deletion_started_at !== undefined,
        visionOcrCleanupError: row.vision_cleanup_last_event_type === "source.vision_ocr_delete_failed" && row.vision_cleanup_last_message ? String(row.vision_cleanup_last_message) : undefined,
        visionOcrCleanupLastEvent: row.vision_cleanup_last_event_type ? String(row.vision_cleanup_last_event_type) : undefined,
        visionOcrCleanupLastAt: row.vision_cleanup_last_at == null ? null : Number(row.vision_cleanup_last_at),
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
    if ((candidate.status !== "ready" && candidate.status !== "archived") || candidate.import_status !== "completed" ||
        Number(candidate.indexed_pages) !== Number(candidate.page_count)) {
      throw new Error("OCR-only cleanup is available only after the book is ready or archived and all pages passed retrieval QA.");
    }
    if (candidate.vision_output_deleted_at) throw new Error("Vision OCR output has already been removed for this book.");
    if (candidate.vision_output_deletion_started_at) throw new Error("Vision OCR cleanup is already running for this book.");
    const reserved = await env.DB.prepare(
      "UPDATE brvin_books SET vision_output_deletion_started_at=?,updated_at=? " +
      "WHERE id=? AND status IN ('ready','archived') AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NULL"
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
  let body: { name?: unknown; description?: unknown; ownerLabel?: unknown; applicationId?: unknown; legacyClient?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid project details." }, 400); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const ownerLabel = body.ownerLabel === undefined ? "" : typeof body.ownerLabel === "string" ? body.ownerLabel.replace(/\s+/gu, " ").trim().slice(0, 120) : null;
  const slug = slugify(name);
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  if (!name || !slug || ownerLabel === null) return json({ ok: false, error: "Enter a valid project name and teacher/owner label." }, 400);
  if (applicationId && !/^[a-f0-9-]{36}$/iu.test(applicationId)) {
    return json({ ok: false, error: "Select a registered application." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    if (applicationId) {
      const application = await env.DB.prepare(
        "SELECT id FROM brvin_applications WHERE id=? AND status='active'"
      ).bind(applicationId).first<{ id: string }>();
      if (!application) return json({ ok: false, error: "The selected application is not active." }, 409);
    }
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    const statements = [
      env.DB.prepare(
        "INSERT INTO brvin_projects (id,name,slug,description,owner_label,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)"
      ).bind(id, name, slug, description, ownerLabel, now, now),
    ];
    if (applicationId) {
      statements.push(env.DB.prepare(
        "INSERT INTO brvin_application_project_grants (id,application_id,project_id,status,created_at,created_by) " +
        "VALUES (?,?,?,'active',?,'admin-dashboard')"
      ).bind(crypto.randomUUID().toLowerCase(), applicationId, id, now));
    } else if (body.legacyClient !== false) {
      // Preserve the historical v1 default for existing callers. The new teacher
      // workspace sends legacyClient:false so knowledge projects remain app-neutral
      // until an application is explicitly granted access.
      statements.push(env.DB.prepare(
        "INSERT INTO brvin_service_clients (client_id,project_id,created_at,updated_at) VALUES (?,?,?,?)"
      ).bind(slug, id, now, now));
    }
    await env.DB.batch(statements);
    await recordBrvinActivity(env, {
      projectId: id, agent: "BRVIN access control", phase: "governance",
      eventType: "project.created", status: "completed",
      message: applicationId
        ? "A new project was created and explicitly granted to its selected BRVIN application. It has no knowledge access until sources are assigned."
        : "A legacy project and its default private Worker identity were created. It has no knowledge access until sources are assigned.",
      details: { applicationId: applicationId || null, ownerLabel, legacyClient: !applicationId && body.legacyClient !== false },
    });
    return json({ ok: true, project: { id, name, slug, description, ownerLabel, applicationId: applicationId || null } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

function validBrvinApplicationSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(value);
}

function normalizedEnvironmentKey(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32).replace(/-+$/gu, "");
}

function normalizeGitHubRepositoryUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 300) return null;
  const match = value.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?\/?$/iu);
  if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") return null;
  return "https://github.com/" + match[1] + "/" + match[2].replace(/\.git$/iu, "");
}

function normalizeGitDefaultBranch(value: unknown): string | null {
  const branch = value === undefined || value === null || value === "" ? "main" : typeof value === "string" ? value.trim() : "";
  if (!branch || branch.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) ||
      branch.includes("..") || branch.includes("//") || branch.includes("@{") ||
      branch.endsWith("/") || branch.endsWith(".") || branch.endsWith(".lock")) return null;
  return branch;
}

function normalizeRuntimeProvider(value: unknown): string | null {
  const provider = value === undefined || value === null || value === "" ? "cloudflare-workers" : value;
  return provider === "cloudflare-workers" || provider === "other" ? provider : null;
}

function normalizeWorkerName(value: unknown): string | null {
  const name = value === undefined || value === null || value === "" ? "" : typeof value === "string" ? value.trim() : null;
  if (name === null || name.length > 63 || (name && !/^[a-z0-9][a-z0-9_-]*$/u.test(name))) return null;
  return name;
}

function normalizeWorkerUrl(value: unknown): string | null {
  const input = value === undefined || value === null || value === "" ? "" : typeof value === "string" ? value.trim() : null;
  if (input === null || input.length > 300) return null;
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch { return null; }
}

function normalizeWorkerMetadata(nameValue: unknown, urlValue: unknown): { workerName: string; workerUrl: string } | null {
  const workerName = normalizeWorkerName(nameValue);
  const workerUrl = normalizeWorkerUrl(urlValue);
  if (workerName === null || workerUrl === null || Boolean(workerName) !== Boolean(workerUrl)) return null;
  return { workerName, workerUrl };
}

type BrvinInitialEnvironment = {
  environmentKey: "production" | "staging" | "preview";
  displayName: string;
  workerName: string;
  workerUrl: string;
};

function parseBrvinInitialEnvironments(value: unknown): BrvinInitialEnvironment[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const seen = new Set<string>();
  const output: BrvinInitialEnvironment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const key = row.environmentKey;
    if (key !== "production" && key !== "staging" && key !== "preview") return null;
    if (seen.has(key)) return null;
    seen.add(key);
    const metadata = normalizeWorkerMetadata(row.workerName, row.workerUrl);
    if (!metadata) return null;
    const displayName = typeof row.displayName === "string"
      ? row.displayName.replace(/\s+/gu, " ").trim().slice(0, 80)
      : key.charAt(0).toUpperCase() + key.slice(1);
    output.push({ environmentKey: key, displayName: displayName || key, ...metadata });
  }
  return output.sort((a,b) => ["production","staging","preview"].indexOf(a.environmentKey) -
    ["production","staging","preview"].indexOf(b.environmentKey));
}

export async function createBrvinApplication(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: {
    name?: unknown; description?: unknown; ownerLabel?: unknown; slug?: unknown;
    repositoryUrl?: unknown; repositoryDefaultBranch?: unknown; runtimeProvider?: unknown; environments?: unknown;
  };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid application details." }, 400); }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const ownerLabel = body.ownerLabel === undefined ? "" : typeof body.ownerLabel === "string" ? body.ownerLabel.replace(/\s+/gu, " ").trim().slice(0, 120) : null;
  const slugInput = typeof body.slug === "string" && body.slug.trim() ? body.slug : name;
  const slug = slugify(slugInput);
  const repositoryUrl = normalizeGitHubRepositoryUrl(body.repositoryUrl);
  const repositoryDefaultBranch = normalizeGitDefaultBranch(body.repositoryDefaultBranch);
  const runtimeProvider = normalizeRuntimeProvider(body.runtimeProvider);
  const initialEnvironments = body.environments === undefined ? [] : parseBrvinInitialEnvironments(body.environments);
  if (!name || !slug || !validBrvinApplicationSlug(slug) || ownerLabel === null ||
      repositoryUrl === null || repositoryDefaultBranch === null || runtimeProvider === null ||
      (body.environments !== undefined && initialEnvironments === null)) {
    return json({ ok: false, error: "Enter a valid application profile, GitHub repository reference, default branch and deployment environments." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    const environments = (initialEnvironments ?? []).map(item => ({
      id: crypto.randomUUID().toLowerCase(), applicationId: id, ...item, status: "active" as const,
    }));
    const statements = [
      env.DB.prepare(
        "INSERT INTO brvin_applications (id,slug,name,description,owner_label,repository_url,repository_default_branch,runtime_provider,status,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,?,?,'active',?,?)"
      ).bind(id, slug, name, description, ownerLabel, repositoryUrl, repositoryDefaultBranch, runtimeProvider, now, now),
      ...environments.map(item => env.DB!.prepare(
        "INSERT INTO brvin_application_environments (id,application_id,environment_key,display_name,worker_name,worker_url,status,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,'active',?,?)"
      ).bind(item.id, id, item.environmentKey, item.displayName, item.workerName, item.workerUrl, now, now)),
    ];
    if (environments.length) await env.DB.batch(statements);
    else await statements[0].run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.created", status: "completed",
      message: environments.length
        ? "An application and its deployment environment identities were registered. Repository and Worker values are metadata only; every environment remains pending live connection verification."
        : "A BRVIN application record was created. No environment or project access is implied.",
      details: {
        applicationId: id, slug, ownerLabel, repositoryUrl, repositoryDefaultBranch,
        runtimeProvider, environmentIds: environments.map(item => item.id),
      },
    });
    return json({
      ok: true,
      application: { id, slug, name, description, ownerLabel, repositoryUrl, repositoryDefaultBranch, runtimeProvider, status: "active" },
      environments: environments.map(item => ({ ...item, connectionStatus: "pending" })),
    }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function updateBrvinApplication(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: {
    applicationId?: unknown; name?: unknown; description?: unknown; ownerLabel?: unknown;
    repositoryUrl?: unknown; repositoryDefaultBranch?: unknown; runtimeProvider?: unknown;
  };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid application details." }, 400); }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : null;
  const description = body.description === undefined ? undefined : typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
  const ownerLabel = body.ownerLabel === undefined ? undefined : typeof body.ownerLabel === "string" ? body.ownerLabel.replace(/\s+/gu, " ").trim().slice(0, 120) : null;
  const repositoryUrl = body.repositoryUrl === undefined ? undefined : normalizeGitHubRepositoryUrl(body.repositoryUrl);
  const repositoryDefaultBranch = body.repositoryDefaultBranch === undefined ? undefined : normalizeGitDefaultBranch(body.repositoryDefaultBranch);
  const runtimeProvider = body.runtimeProvider === undefined ? undefined : normalizeRuntimeProvider(body.runtimeProvider);
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || name === null || description === null || ownerLabel === null ||
      repositoryUrl === null || repositoryDefaultBranch === null || runtimeProvider === null ||
      (name !== undefined && (!name || !slugify(name))) ||
      (name === undefined && description === undefined && ownerLabel === undefined &&
       repositoryUrl === undefined && repositoryDefaultBranch === undefined && runtimeProvider === undefined)) {
    return json({ ok: false, error: "Enter valid application profile and repository/runtime details." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const current = await env.DB.prepare(
      "SELECT id,name,description,owner_label,repository_url,repository_default_branch,runtime_provider,status FROM brvin_applications WHERE id=?"
    ).bind(applicationId).first<{
      id: string; name: string; description: string; owner_label: string; repository_url: string;
      repository_default_branch: string; runtime_provider: string; status: string;
    }>();
    if (!current) return json({ ok: false, error: "Application not found." }, 404);
    const nextName = name ?? current.name;
    const nextDescription = description ?? current.description;
    const nextOwnerLabel = ownerLabel ?? current.owner_label ?? "";
    const nextRepositoryUrl = repositoryUrl ?? current.repository_url ?? "";
    const nextRepositoryDefaultBranch = repositoryDefaultBranch ?? current.repository_default_branch ?? "main";
    const nextRuntimeProvider = runtimeProvider ?? current.runtime_provider ?? "cloudflare-workers";
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_applications SET name=?,description=?,owner_label=?,repository_url=?,repository_default_branch=?,runtime_provider=?,updated_at=? WHERE id=?"
    ).bind(nextName, nextDescription, nextOwnerLabel, nextRepositoryUrl, nextRepositoryDefaultBranch, nextRuntimeProvider, now, applicationId).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.updated", status: "completed",
      message: "Application profile, repository and runtime metadata were updated.",
      details: { applicationId, ownerLabel: nextOwnerLabel, repositoryUrl: nextRepositoryUrl, runtimeProvider: nextRuntimeProvider },
    });
    return json({ ok: true, application: {
      id: applicationId, name: nextName, description: nextDescription, ownerLabel: nextOwnerLabel,
      repositoryUrl: nextRepositoryUrl, repositoryDefaultBranch: nextRepositoryDefaultBranch,
      runtimeProvider: nextRuntimeProvider, status: current.status,
    } });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function createBrvinApplicationEnvironment(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { applicationId?: unknown; environmentKey?: unknown; displayName?: unknown; workerName?: unknown; workerUrl?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid environment details." }, 400); }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const environmentKey = normalizedEnvironmentKey(typeof body.environmentKey === "string" ? body.environmentKey : "");
  const displayName = typeof body.displayName === "string" ? body.displayName.replace(/\s+/gu, " ").trim().slice(0, 80) : "";
  const workerMetadata = normalizeWorkerMetadata(body.workerName, body.workerUrl);
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !environmentKey || !validBrvinApplicationSlug(environmentKey) || !workerMetadata) {
    return json({ ok: false, error: "Choose an active application and enter a valid environment label and Worker metadata pair." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const application = await env.DB.prepare(
      "SELECT id FROM brvin_applications WHERE id=? AND status='active'"
    ).bind(applicationId).first<{ id: string }>();
    if (!application) return json({ ok: false, error: "The selected application is not active." }, 409);
    const id = crypto.randomUUID().toLowerCase(), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO brvin_application_environments (id,application_id,environment_key,display_name,worker_name,worker_url,status,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,'active',?,?)"
    ).bind(id, applicationId, environmentKey, displayName, workerMetadata.workerName, workerMetadata.workerUrl, now, now).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.environment_created", status: "completed",
      message: "A deployment environment identity and non-secret Worker metadata were registered. Live connection verification is still pending.",
      details: { applicationId, environmentId: id, environmentKey, workerName: workerMetadata.workerName, workerUrl: workerMetadata.workerUrl },
    });
    return json({ ok: true, environment: {
      id, applicationId, environmentKey, displayName, ...workerMetadata, status: "active", connectionStatus: "pending",
    } }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function updateBrvinApplicationEnvironment(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { environmentId?: unknown; displayName?: unknown; workerName?: unknown; workerUrl?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid environment details." }, 400); }
  const environmentId = typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  const displayName = body.displayName === undefined ? undefined
    : typeof body.displayName === "string" ? body.displayName.replace(/\s+/gu, " ").trim().slice(0, 80) : null;
  const workerMetadata = body.workerName === undefined && body.workerUrl === undefined
    ? undefined : normalizeWorkerMetadata(body.workerName, body.workerUrl);
  if (!/^[a-f0-9-]{36}$/iu.test(environmentId) || displayName === null || workerMetadata === null ||
      (displayName === undefined && workerMetadata === undefined)) {
    return json({ ok: false, error: "Enter a valid environment display name and Worker name/URL pair." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const current = await env.DB.prepare(
      "SELECT id,application_id,environment_key,display_name,worker_name,worker_url,status FROM brvin_application_environments WHERE id=?"
    ).bind(environmentId).first<{
      id: string; application_id: string; environment_key: string; display_name: string;
      worker_name: string; worker_url: string; status: string;
    }>();
    if (!current) return json({ ok: false, error: "Environment not found." }, 404);
    const nextDisplayName = displayName ?? current.display_name ?? "";
    const nextWorkerName = workerMetadata?.workerName ?? current.worker_name ?? "";
    const nextWorkerUrl = workerMetadata?.workerUrl ?? current.worker_url ?? "";
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_application_environments SET display_name=?,worker_name=?,worker_url=?,updated_at=? WHERE id=?"
    ).bind(nextDisplayName, nextWorkerName, nextWorkerUrl, now, environmentId).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.environment_metadata_updated", status: "completed",
      message: "Environment display and Worker metadata were updated. Connection status remains pending until M9 verification.",
      details: { applicationId: current.application_id, environmentId, environmentKey: current.environment_key },
    });
    return json({ ok: true, environment: {
      id: environmentId, applicationId: current.application_id, environmentKey: current.environment_key,
      displayName: nextDisplayName, workerName: nextWorkerName, workerUrl: nextWorkerUrl,
      status: current.status, connectionStatus: "pending",
    } });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function setBrvinApplicationStatus(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { applicationId?: unknown; status?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid application status." }, 400); }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const status = body.status;
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !["active", "suspended", "revoked"].includes(String(status))) {
    return json({ ok: false, error: "Choose a valid application and status." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const application = await env.DB.prepare(
      "SELECT id,status FROM brvin_applications WHERE id=?"
    ).bind(applicationId).first<{ id: string; status: string }>();
    if (!application) return json({ ok: false, error: "Application not found." }, 404);
    if (application.status === "revoked" && status !== "revoked") {
      return json({ ok: false, error: "A revoked application is permanent. Create a new application record instead." }, 409);
    }
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_applications SET status=?,updated_at=? WHERE id=?"
    ).bind(status, now, applicationId).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.status_changed", status: "completed",
      message: "Application status changed to " + String(status) + ".",
      details: { applicationId, previousStatus: application.status, status },
    });
    return json({ ok: true, applicationId, status });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function setBrvinEnvironmentStatus(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { environmentId?: unknown; status?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid environment status." }, 400); }
  const environmentId = typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  const status = body.status;
  if (!/^[a-f0-9-]{36}$/iu.test(environmentId) || !["active", "disabled", "revoked"].includes(String(status))) {
    return json({ ok: false, error: "Choose a valid environment and status." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const environment = await env.DB.prepare(
      "SELECT e.id,e.application_id,e.status,a.status AS application_status " +
      "FROM brvin_application_environments e JOIN brvin_applications a ON a.id=e.application_id WHERE e.id=?"
    ).bind(environmentId).first<{ id: string; application_id: string; status: string; application_status: string }>();
    if (!environment) return json({ ok: false, error: "Environment not found." }, 404);
    if (environment.status === "revoked" && status !== "revoked") {
      return json({ ok: false, error: "A revoked environment identity cannot be reactivated. Create a replacement identity." }, 409);
    }
    if (status === "active" && environment.application_status !== "active") {
      return json({ ok: false, error: "Activate the parent application before enabling this environment." }, 409);
    }
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_application_environments SET status=?,updated_at=?," +
      "revoked_at=CASE WHEN ?='revoked' THEN ? ELSE revoked_at END," +
      "revoked_by=CASE WHEN ?='revoked' THEN 'admin-dashboard' ELSE revoked_by END WHERE id=?"
    ).bind(status, now, status, now, status, environmentId).run();
    await recordBrvinActivity(env, {
      agent: "BRVIN application registry", phase: "governance",
      eventType: "application.environment_status_changed", status: "completed",
      message: "Environment " + environmentId + " status changed to " + String(status) + ".",
      details: { applicationId: environment.application_id, environmentId, previousStatus: environment.status, status },
    });
    return json({ ok: true, environmentId, status });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function grantBrvinApplicationProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { applicationId?: unknown; projectId?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid project grant." }, 400); }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !projectId || projectId.length > 128 || projectId !== body.projectId) {
    return json({ ok: false, error: "Choose a valid application and project." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const [application, project, existing] = await Promise.all([
      env.DB.prepare("SELECT id FROM brvin_applications WHERE id=? AND status='active'").bind(applicationId).first<{ id: string }>(),
      env.DB.prepare("SELECT id FROM brvin_projects WHERE id=? AND status='active'").bind(projectId).first<{ id: string }>(),
      env.DB.prepare("SELECT id FROM brvin_application_project_grants WHERE application_id=? AND project_id=? AND status='active'").bind(applicationId, projectId).first<{ id: string }>(),
    ]);
    if (!application) return json({ ok: false, error: "The selected application is not active." }, 409);
    if (!project) return json({ ok: false, error: "The selected project is not active." }, 409);
    if (existing) return json({ ok: true, applicationId, projectId, grantId: existing.id, alreadyGranted: true });
    const grantId = crypto.randomUUID().toLowerCase(), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO brvin_application_project_grants (id,application_id,project_id,status,created_at,created_by) " +
      "VALUES (?,?,?,'active',?,'admin-dashboard')"
    ).bind(grantId, applicationId, projectId, now).run();
    await recordBrvinActivity(env, {
      projectId, agent: "BRVIN application access control", phase: "governance",
      eventType: "application.project_granted", status: "completed",
      message: "The application was granted access to the selected project.",
      details: { applicationId, projectId, grantId },
    });
    return json({ ok: true, applicationId, projectId, grantId }, 201);
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 409); }
}

export async function revokeBrvinApplicationProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { applicationId?: unknown; projectId?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid project grant." }, 400); }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !projectId || projectId.length > 128 || projectId !== body.projectId) {
    return json({ ok: false, error: "Choose a valid application and project." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const existing = await env.DB.prepare(
      "SELECT id FROM brvin_application_project_grants WHERE application_id=? AND project_id=? AND status='active'"
    ).bind(applicationId, projectId).first<{ id: string }>();
    if (!existing) return json({ ok: false, error: "No active grant exists for this application and project." }, 404);
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_application_project_grants SET status='revoked',revoked_at=?,revoked_by='admin-dashboard' WHERE id=?"
    ).bind(now, existing.id).run();
    await recordBrvinActivity(env, {
      projectId, agent: "BRVIN application access control", phase: "governance",
      eventType: "application.project_revoked", status: "completed",
      message: "The application-project permission was revoked. Future retrieval requests will be denied.",
      details: { applicationId, projectId, grantId: existing.id },
    });
    return json({ ok: true, applicationId, projectId, grantId: existing.id });
  } catch (error) { return json({ ok: false, error: friendlyError(error) }, 502); }
}

export async function updateBrvinProject(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { projectId?: unknown; name?: unknown; description?: unknown; ownerLabel?: unknown; status?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid project details." }, 400); }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const status = body.status === undefined ? undefined : body.status;
  const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.replace(/\s+/gu, " ").trim().slice(0, 100) : "";
  const description = body.description === undefined ? undefined : typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";
  const ownerLabel = body.ownerLabel === undefined ? undefined : typeof body.ownerLabel === "string" ? body.ownerLabel.replace(/\s+/gu, " ").trim().slice(0, 120) : null;
  if (!projectId || projectId.length > 128 || projectId !== body.projectId ||
      (status !== undefined && !["active", "inactive"].includes(String(status))) ||
      (name !== undefined && (!name || !slugify(name))) || ownerLabel === null) {
    return json({ ok: false, error: "Enter a valid project name and status." }, 400);
  }
  try {
    await ensureAnalyticsSchema(env);
    const current = await env.DB.prepare(
      "SELECT id,name,description,owner_label,status FROM brvin_projects WHERE id=?"
    ).bind(projectId).first<{ id: string; name: string; description: string; owner_label: string; status: string }>();
    if (!current) return json({ ok: false, error: "Project not found." }, 404);
    const nextName = name ?? current.name;
    const nextDescription = description ?? current.description;
    const nextOwnerLabel = ownerLabel ?? current.owner_label ?? "";
    const nextStatus = String(status ?? current.status);
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE brvin_projects SET name=?,description=?,owner_label=?,status=?,updated_at=? WHERE id=?"
    ).bind(nextName, nextDescription, nextOwnerLabel, nextStatus, now, projectId).run();
    await recordBrvinActivity(env, {
      projectId, agent: "BRVIN access control", phase: "governance",
      eventType: "project.updated", status: "completed",
      message: "Project details or activation status were updated.",
      details: { previousStatus: current.status, status: nextStatus, ownerLabel: nextOwnerLabel },
    });
    return json({ ok: true, project: { id: projectId, name: nextName, description: nextDescription, ownerLabel: nextOwnerLabel, status: nextStatus } });
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
@media(max-width:680px){.shell{padding:13px 12px 30px}.top{align-items:flex-start;padding-bottom:14px}.brand-mark{width:34px;height:34px}.brand{font-size:18px}.brand-caption{font-size:10px}.actions{gap:6px}.actions .btn{padding:8px 9px;font-size:10px}.live{width:100%;justify-content:flex-end;font-size:10px}.app-layout{padding-top:13px;gap:16px}.sidebar{overflow-x:auto;white-space:nowrap;margin:0 -12px;padding:0 12px 10px}.nav-group{margin-right:12px}.nav-label{display:none}.nav-item{font-size:11px;padding:8px 10px;gap:6px}.nav-icon{width:auto}.page-heading{align-items:flex-start;flex-direction:column;margin:4px 0 16px}.page-heading h1{font-size:25px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.metric{padding:13px}.metric strong{font-size:22px}.overview-grid,.quick-grid,.collection-grid,.project-grid,.job-grid{grid-template-columns:1fr}.panel,.view-panel{padding:15px}.feature-panel{padding:18px}.feature-number{font-size:36px}.formgrid{grid-template-columns:1fr;gap:0}.steps{grid-template-columns:repeat(2,1fr)}.modal{padding:10px;align-items:flex-end}.modalbox{padding:18px;border-radius:18px 18px 12px 12px;max-height:92vh;width:100%}.management-actions{grid-template-columns:1fr}.management-actions .btn.danger{grid-column:auto}.table{min-width:680px}}</style></head><body><body><main class="shell"><header class="top"><div class="brand-wrap"><div class="brand-mark" aria-hidden="true">B</div><div><div class="brand">BRVIN</div><div class="brand-caption">Knowledge intelligence · परमार्थAI</div></div></div><div class="actions"><span class="live"><i></i><span id="live-label">LIVE · connecting</span></span><button class="btn" id="refresh" type="button">↻ Refresh</button><a class="btn" href="/admin">Admin home</a><button class="btn" id="logout" type="button">Sign out</button></div></header>
<div class="app-layout"><aside class="sidebar" aria-label="BRVIN navigation"><div class="nav-group"><div class="nav-label">Workspace</div><nav class="nav-list" aria-label="Workspace"><button class="nav-item active" type="button" data-view="overview"><span class="nav-icon">⌂</span>Overview</button><button class="nav-item" type="button" data-view="books"><span class="nav-icon">▤</span>Knowledge sources</button><button class="nav-item" type="button" data-view="collections"><span class="nav-icon">▧</span>Knowledge collections</button><button class="nav-item" type="button" data-view="projects"><span class="nav-icon">◫</span>Knowledge projects</button><button class="nav-item" type="button" data-view="operations"><span class="nav-icon">◷</span>Live operations</button></nav></div><div class="nav-group"><div class="nav-label">Administration</div><nav class="nav-list" aria-label="Administration"><button class="nav-item" type="button" data-view="governance"><span class="nav-icon">⚙</span>Governance</button><button class="nav-item" type="button" data-view="applications"><span class="nav-icon">◇</span>Applications</button></nav></div></aside>
<div class="workspace">
<section class="view active" id="view-overview" data-view-panel="overview"><div class="page-heading"><div><div class="eyebrow">BRVIN workspace</div><h1>Teacher knowledge, connected.</h1><p class="subtitle">Organise each teacher's digital brain, then grant independent applications exactly the knowledge they need.</p></div><div class="heading-actions"><button class="btn primary" id="open-upload" type="button">＋ Add knowledge source</button></div></div>
<div class="metrics" id="metrics"><div class="metric"><span>Knowledge sources</span><strong>—</strong><small>Across all collections</small></div><div class="metric"><span>Collections</span><strong>—</strong><small>Governed groups</small></div><div class="metric"><span>Projects</span><strong>—</strong><small>Independent consumers</small></div><div class="metric"><span>Indexed pages</span><strong>—</strong><small>Verified / total</small></div><div class="metric"><span>Active pipelines</span><strong>—</strong><small>Running now</small></div><div class="metric"><span>Needs attention</span><strong>—</strong><small>Failed or blocked</small></div></div>
<div class="overview-grid"><div class="stack"><section class="panel feature-panel"><div class="eyebrow">Knowledge library</div><div class="feature-number" id="overview-books">—</div><div class="feature-meta" id="overview-pages">Sources · indexed pages</div><p class="panel-copy">Your source documents stay in one place. Each project receives only the books or collections explicitly assigned to it.</p><div class="feature-actions"><button class="btn primary" type="button" data-view="books">Open knowledge sources</button><button class="btn" type="button" id="open-upload-secondary">Add a PDF</button></div></section><div class="quick-grid"><section class="quick-card"><div class="quick-symbol">◫</div><h3>Knowledge projects</h3><p>Each teacher gets a separate, governed knowledge workspace.</p><button class="text-link" type="button" data-view="projects">Manage teacher knowledge →</button></section><section class="quick-card"><div class="quick-symbol">◇</div><h3>Applications</h3><p>See which bots and apps are registered and which knowledge they can access.</p><button class="text-link" type="button" data-view="applications">Manage applications →</button></section></div></div><div class="stack"><section class="panel"><div class="panel-head"><h2>System overview</h2><span class="live"><i></i>Live</span></div><div class="pulse-row"><span>Ready sources</span><strong id="overview-ready">—</strong></div><div class="pulse-row"><span>Active pipelines</span><strong id="overview-running">—</strong></div><div class="pulse-row"><span>Needs attention</span><strong id="overview-attention">—</strong></div><div class="notice" id="overview-status-note">Pipeline activity and indexing status update automatically.</div><div class="feature-actions"><button class="btn" type="button" data-view="operations">View operations →</button></div></section><section class="panel"><div class="panel-head"><h2>Access model</h2></div><p class="panel-copy">BRVIN never exposes every book to every project by default. Direct book access and collection access are managed independently and combined for retrieval.</p><div class="notice">A book becomes available after indexing and retrieval QA pass, and only to explicitly authorised projects.</div><div class="feature-actions"><button class="btn" type="button" data-view="governance">Manage governance →</button></div></section></div></div></section>
<section class="view" id="view-books" data-view-panel="books"><div class="page-heading"><div><div class="eyebrow">Library</div><h1>Knowledge sources</h1><p class="subtitle">Books and documents indexed for your projects.</p></div><div class="heading-actions"><button class="btn danger" id="clear-brvin" type="button">Clear all imported books</button><button class="btn primary" type="button" id="open-upload-books">＋ Add source</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>All sources</h2><p id="book-count">Loading knowledge registry…</p></div><span class="muted" style="font-size:11px">Select Manage for source actions</span></div><div class="tablewrap"><table class="table"><thead><tr><th>Source</th><th>Collection</th><th>Indexed</th><th>Status</th><th>Project access</th><th>Actions</th></tr></thead><tbody id="books"><tr><td class="empty" colspan="6">Loading knowledge registry…</td></tr></tbody></table></div><div class="notice">The original PDF and searchable page index are retained independently. Google Vision OCR JSON is temporary processing output, but it may remain in private cloud storage when the required Google Cloud permissions do not allow cleanup; this does not affect retrieval from indexed pages. “Delete OCR files” keeps the PDF and searchable pages. “Delete book” removes the PDF, OCR output, indexed pages, project grants and registry records. Bulk clear preserves the protected built-in Fatman reference, project and collection definitions, and the audit trail.</div></section></section>
<section class="view" id="view-collections" data-view-panel="collections"><div class="page-heading"><div><div class="eyebrow">Organisation</div><h1>Collections</h1><p class="subtitle">Arrange sources into logical groups. A collection is not shared until assigned to a project.</p></div><div class="heading-actions"><button class="btn" type="button" data-view="governance">＋ Create collection</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Your collections</h2><p>Each collection can be connected to one or more projects.</p></div></div><div id="collections" class="collection-grid"><div class="empty">Loading collections…</div></div></section></section>
<section class="view" id="view-projects" data-view-panel="projects"><div class="page-heading"><div><div class="eyebrow">Teacher workspaces</div><h1>Knowledge projects</h1><p class="subtitle">One digital brain per teacher or learning use case. Applications receive access only through explicit grants.</p></div><div class="heading-actions"><button class="btn" type="button" data-view="governance">＋ Create project</button></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Teacher knowledge workspaces</h2><p>Review source readiness, assigned applications and monthly retrieval usage.</p></div></div><div id="projects" class="project-grid"><div class="empty">Loading projects…</div></div></section></section>
<section class="view" id="view-operations" data-view-panel="operations"><div class="page-heading"><div><div class="eyebrow">System activity</div><h1>Operations</h1><p class="subtitle">Monitor retrieval quota, application connections, ingestion failures and source retention.</p></div><div class="heading-actions"><span class="live"><i></i>5-second refresh · automatic</span><a class="btn" href="https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_ADMIN_RUNBOOK.md" target="_blank" rel="noopener noreferrer">Administrator runbook</a></div></div><section class="view-panel"><div class="panel-toolbar"><div><h2>Operational summary</h2><p>Live counts from the BRVIN registry and last seven days of activity.</p></div><button class="btn primary" id="storage-diagnostics" type="button">Run read-only storage check</button></div><div class="metrics" id="operations-metrics"><div class="metric"><span>Project searches</span><strong>—</strong><small>This month</small></div><div class="metric"><span>Connection failures</span><strong>—</strong><small>Active environments</small></div><div class="metric"><span>Failed events</span><strong>—</strong><small>Last seven days</small></div><div class="metric"><span>OCR cleanup failures</span><strong>—</strong><small>Manual retry may be needed</small></div></div><div class="notice" id="retention-note">Loading storage retention status…</div><div id="storage-diagnostic-result" class="notice" hidden aria-live="polite"></div><div class="muted" style="font-size:11px;margin-top:8px">Query allowances are enforced per knowledge project, not per application. When apps share a project, their requests consume that shared project allowance.</div></section><section class="view-panel"><div class="panel-toolbar"><div><h2>Live pipelines</h2><p>Active jobs and recoverable failures.</p></div></div><div id="jobs" class="job-grid"><div class="empty">No active processing jobs.</div></div></section><section class="view-panel"><div class="panel-toolbar"><div><h2>Specialist activity</h2><p>Actual workflow events · <span id="event-stamp">Waiting for events</span></p></div><div class="field" style="min-width:180px"><label for="event-filter">Filter activity</label><select id="event-filter"><option value="all">All recent events</option><option value="attention">Failures and warnings</option><option value="retention">Storage and OCR retention</option><option value="connections">Application connections</option><option value="ingestion">Upload and indexing</option><option value="governance">Grants and governance</option></select></div></div><div class="timeline" id="events"><div class="empty">Waiting for BRVIN events…</div></div></section></section>
<section class="view" id="view-governance" data-view-panel="governance"><div class="page-heading"><div><div class="eyebrow">Administration</div><h1>Knowledge setup</h1><p class="subtitle">Create teacher workspaces, organise source collections and control exactly which material each project can retrieve.</p></div></div><div class="overview-grid"><section class="view-panel"><div class="panel-toolbar"><div><h2>Create a teacher knowledge project</h2><p>Start with the teacher or customer label. You can connect applications and grant access separately.</p></div></div><div class="field"><label for="project-owner">Teacher / owner label</label><input id="project-owner" maxlength="120" placeholder="e.g. Teacher A · Mathematics"></div><div class="field"><label for="project-name">Knowledge project name</label><input id="project-name" maxlength="100" placeholder="e.g. Teacher A Mathematics"></div><div class="field"><label for="project-desc">Description</label><input id="project-desc" maxlength="500" placeholder="Subjects, methods or intended learning use"></div><div class="notice">Creating a knowledge project does not create an application, repository, Worker or legacy service credential. Connect an application separately and grant access when ready.</div><button class="btn primary" id="create-project" type="button">Create knowledge project</button></section><section class="view-panel"><div class="panel-toolbar"><div><h2>Create a collection</h2><p>Group sources by subject or purpose.</p></div></div><div class="field"><label for="collection-name">Collection name</label><input id="collection-name" maxlength="100" placeholder="Collection name"></div><div class="field"><label for="collection-desc">Description</label><input id="collection-desc" maxlength="500" placeholder="What belongs in this collection?"></div><button class="btn primary" id="create-collection" type="button">Create collection</button></section><section class="view-panel" style="grid-column:1/-1"><div class="panel-toolbar"><div><h2>Collection access</h2><p>Choose which collections a project can retrieve. This does not replace direct book assignments.</p></div></div><div class="formgrid"><div class="field"><label for="project-access">Project</label><select id="project-access"></select></div><div class="field"><label>Available collections</label><div class="checks" id="collection-checks"></div></div></div><button class="btn primary" id="save-project-access" type="button">Save collection access</button><div class="notice">Access is additive: projects receive content through direct book assignments and/or collection assignments. Empty projects have no BRVIN knowledge access.</div></section></div></section>
<section class="view" id="view-applications" data-view-panel="applications">
<div class="page-heading"><div><div class="eyebrow">Administration</div><h1>Applications</h1><p class="subtitle">Register independent bots and apps, track their deployment environments, and manage the teacher knowledge projects they are allowed to retrieve.</p></div></div>
<div class="overview-grid">
<section class="view-panel" style="grid-column:1/-1"><div class="panel-toolbar"><div><h2>Connect an existing application</h2><p>Register the app, its existing GitHub repository and one or more deployment environments in one step.</p></div></div>
<div class="formgrid">
 <div class="field"><label for="application-name">Application name</label><input id="application-name" maxlength="100" placeholder="e.g. SSC Mathematics Telegram Bot"></div>
 <div class="field"><label for="application-owner">Teacher / owner label</label><input id="application-owner" maxlength="120" placeholder="e.g. Teacher A · Mathematics"></div>
 <div class="field" style="grid-column:1/-1"><label for="application-desc">Purpose</label><input id="application-desc" maxlength="500" placeholder="What does this bot, website or assistant do?"></div>
 <div class="field"><label for="application-repository">Existing GitHub repository URL</label><input id="application-repository" maxlength="300" inputmode="url" placeholder="https://github.com/owner/repository"></div>
 <div class="field"><label for="application-branch">Default branch</label><input id="application-branch" maxlength="100" value="main" placeholder="main"></div>
 <div class="field"><label for="application-runtime">Runtime provider</label><select id="application-runtime"><option value="cloudflare-workers">Cloudflare Workers</option><option value="other">Other / not yet deployed on Workers</option></select></div>
</div>
<div class="panel-toolbar" style="margin-top:12px"><div><h3>Deployment environments</h3><p>BRVIN generates a separate immutable environment ID for each selected environment.</p></div></div>
<div class="overview-grid">
 <section class="tile">
  <label class="check"><input id="environment-production-enabled" type="checkbox" checked> Production</label>
  <div class="field"><label for="environment-production-worker">Worker name (optional)</label><input id="environment-production-worker" maxlength="63" placeholder="my-application"></div>
  <div class="field"><label for="environment-production-url">Worker URL (optional)</label><input id="environment-production-url" maxlength="300" inputmode="url" placeholder="https://my-application.example.workers.dev"></div>
 </section>
 <section class="tile">
  <label class="check"><input id="environment-staging-enabled" type="checkbox"> Staging</label>
  <div class="field"><label for="environment-staging-worker">Worker name (optional)</label><input id="environment-staging-worker" maxlength="63" placeholder="my-application-staging"></div>
  <div class="field"><label for="environment-staging-url">Worker URL (optional)</label><input id="environment-staging-url" maxlength="300" inputmode="url" placeholder="https://my-application-staging.example.workers.dev"></div>
 </section>
 <section class="tile">
  <label class="check"><input id="environment-preview-enabled" type="checkbox"> Preview</label>
  <div class="field"><label for="environment-preview-worker">Worker name (optional)</label><input id="environment-preview-worker" maxlength="63" placeholder="my-application-preview"></div>
  <div class="field"><label for="environment-preview-url">Worker URL (optional)</label><input id="environment-preview-url" maxlength="300" inputmode="url" placeholder="https://my-application-preview.example.workers.dev"></div>
 </section>
</div>
<div class="notice">This wizard stores metadata and creates BRVIN environment identities only. It does not create a GitHub repository, Cloudflare Worker, secret, binding or deployment. ChatGPT's GitHub authorization is separate: the repository must also be selected/accessible in its connected GitHub app. Every environment remains <strong>Pending connection</strong> until the live Service Binding verification milestone.</div>
<button class="btn primary" id="create-application" type="button">Register application and environments</button>
</section>
<section class="view-panel"><div class="panel-toolbar"><div><h2>Add another deployment environment</h2><p>Environment IDs are generated by BRVIN. This adds registry metadata only; it does not deploy a Worker.</p></div></div>
<div class="field"><label for="environment-application">Application</label><select id="environment-application"></select></div>
<div class="field"><label for="environment-key">Environment key</label><input id="environment-key" maxlength="32" placeholder="e.g. qa, canary, preview-2"></div>
<div class="field"><label for="environment-name">Display name</label><input id="environment-name" maxlength="80" placeholder="QA"></div>
<div class="field"><label for="environment-worker">Worker name (optional)</label><input id="environment-worker" maxlength="63" placeholder="my-application-qa"></div>
<div class="field"><label for="environment-url">Worker URL (optional)</label><input id="environment-url" maxlength="300" inputmode="url" placeholder="https://my-application-qa.example.workers.dev"></div>
<button class="btn primary" id="create-environment" type="button">Register environment</button>
</section>
<section class="view-panel" style="grid-column:1/-1"><div class="panel-toolbar"><div><h2>Grant project access</h2><p>Application grants and source-level book/collection grants are separate permissions.</p></div></div>
<div class="formgrid"><div class="field"><label for="grant-application">Application</label><select id="grant-application"></select></div><div class="field"><label for="grant-project">Project</label><select id="grant-project"></select></div></div>
<button class="btn primary" id="grant-project-button" type="button">Grant application access</button>
<div class="notice">Application grants are app-wide, not teacher-user-specific. A multi-teacher application must authenticate each user and enforce its user-to-project mapping server-side. Source-level direct-book and collection grants are a second, independent permission layer. Consumer GitHub access is separate from BRVIN.</div>
</section>
<section class="view-panel" style="grid-column:1/-1"><div class="panel-toolbar"><div><h2>Application registry</h2><p>Environment identities, lifecycle status and project grants. Revoked records remain in the audit history.</p></div></div>
<div id="applications-list" class="project-grid"><div class="empty">Loading application registry…</div></div>
</section>

<details class="view-panel legacy-settings" id="connect-wizard-panel" style="margin-top:14px">
 <summary style="cursor:pointer;font-size:12px;font-weight:700;color:#69717e">Legacy provider settings · not required for the current BRVIN workflow</summary>
 <div class="notice">These stored GitHub/Cloudflare settings belong to an earlier autonomous Project Factory proposal. Current application code and deployments are handled by ChatGPT through your separately authorized GitHub and Cloudflare connections. BRVIN does not provision repositories, deployment credentials or CI/CD. Do not reauthorize or delete these legacy settings as part of normal teacher/app onboarding.</div>
 <div class="panel-toolbar"><div><h2>Legacy provider connection status</h2><p>Read-only historical configuration; not part of teacher knowledge management.</p></div><button class="btn" id="connect-refresh" type="button">Refresh legacy status</button></div>
 <section class="tile" style="margin-bottom:12px">
  <div class="panel-toolbar"><div><h3>Historical provider preflight</h3><p>Optional read-only status for legacy BRVIN provider settings. This does not control or validate the GitHub/Cloudflare connections used by ChatGPT.</p></div><button class="btn" id="provider-capability-check" type="button">Check legacy status</button></div>
  <p id="provider-capability-result" class="muted" aria-live="polite">Not required for teacher knowledge management or application onboarding.</p>
 </section>
 <div class="overview-grid">
  <section class="tile">
   <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>GitHub App</strong><span class="pill" id="connect-github-status">Not connected</span></div>
   <p>Historical BRVIN GitHub App registration and installation metadata. Current consumer repositories are managed by ChatGPT's separate GitHub connection.</p>
   <button class="btn primary" id="github-register" type="button">Open BRVIN GitHub App settings</button>
   <p id="github-app-meta" class="muted">Checking the existing BRVIN GitHub App…</p>
   <p id="github-access-state" class="muted">Repository access has not been checked yet.</p>
   <p><a id="github-app-settings" href="https://github.com/settings/apps" target="_blank" rel="noreferrer">Open GitHub App permissions</a></p>
   <p><a id="github-installation-settings" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">Open BRVIN installation settings</a></p>
   <div class="notice">One-time GitHub approval: update the existing App with the requested permissions, approve the permission update, then set its installation repository access to <strong>All repositories</strong>. BRVIN will use short-lived GitHub App installation tokens automatically. No personal access token or per-project App installation is required.</div>
  </section>
  <section class="tile">
   <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>Cloudflare OAuth</strong><span class="pill" id="connect-cloudflare-status">Not configured</span></div>
   <p>Historical Cloudflare OAuth client metadata retained for compatibility. Current consumer Worker configuration and deployment are managed through ChatGPT's separate Cloudflare connection.</p>
   <div id="cf-client-credentials">
    <div class="field"><label for="cf-client-id">OAuth client ID</label><input id="cf-client-id" autocomplete="off" maxlength="160" placeholder="Cloudflare OAuth client ID"></div>
    <div class="field"><label for="cf-client-secret">OAuth client secret</label><input id="cf-client-secret" type="password" autocomplete="new-password" maxlength="500" placeholder="Shown once by Cloudflare"></div>
   </div>
   <div class="field"><label>Exact callback URL to register</label><input id="cf-callback-url" readonly value="Shown after page load"></div>
   <p id="cf-client-state" class="muted">Checking the encrypted OAuth client configuration…</p>
   <div class="field"><label for="cf-required-scopes">Required one-time Cloudflare OAuth scopes</label><textarea id="cf-required-scopes" rows="5" readonly spellcheck="false"></textarea></div>
   <button class="btn" id="cf-copy-required-scopes" type="button">Copy required scopes</button>
   <p class="notice">This is legacy OAuth configuration only. Do not expand permissions or reauthorize for current BRVIN application onboarding. Preserve the existing encrypted record unless a separately reviewed maintenance task establishes that it is unused.</p>
   <button class="btn primary" id="cf-save-client" type="button">Save OAuth client securely</button>
   <button class="btn" id="cf-authorize" type="button">Authorize / refresh BRVIN access</button>
   <button class="btn" id="cf-discover-workers" type="button">Discover Workers</button>
   <p class="muted" id="cf-worker-note">Must confirm that this same account contains the private brvin-service Worker.</p>
  </section>
 </div>
</details>
</section>
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
["Knowledge sources",s.books,"Across all teacher projects"],["Knowledge projects",s.projects,"Teacher digital brains"],["Applications",s.applications||0,"Independent consumer apps"],
["Collections",s.collections,"Governed groups"],["Indexed pages",s.indexedPages.toLocaleString()+" / "+s.totalPages.toLocaleString(),"Page-level coverage"],
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
function openProjectDetails(projectId){
 const project=(model?.projects||[]).find(item=>item.id===projectId);if(!project)return;
 const sources=(model?.books||[]).filter(book=>(book.projects||[]).some(link=>link.id===projectId));
 const collections=(model?.collections||[]).filter(collection=>(collection.projects||[]).some(link=>link.id===projectId));
 const grants=project.applications||[];
 const appById=new Map((model?.applications||[]).map(app=>[app.id,app]));
 const activeGrantIds=new Set(grants.filter(grant=>grant.status==="active").map(grant=>grant.applicationId));
 const grantableApps=project.status==="active"?(model?.applications||[]).filter(app=>app.status==="active"&&!activeGrantIds.has(app.id)):[];
 const events=(model?.events||[]).filter(event=>event.projectId===projectId).slice(0,8);
 const grantRows=grants.length?grants.map(grant=>{
  const app=appById.get(grant.applicationId);
  const label=app?.name||grant.name||grant.slug||grant.applicationId;
  const revoked=grant.status!=="active";
  return '<div class="pulse-row"><span><strong>'+esc(label)+'</strong><br><small>'+esc(grant.slug||app?.slug||"")+' · '+(revoked?"grant revoked":"grant active")+(grant.createdAt?' · granted '+esc(time(grant.createdAt)):"")+(grant.revokedAt?' · revoked '+esc(time(grant.revokedAt)):"")+'</small></span><span>'+statusPill(grant.status)+(revoked?'':' <button class="btn danger" data-project-grant-revoke="true" data-application-id="'+esc(grant.applicationId)+'" data-project-id="'+esc(projectId)+'">Revoke access</button>')+'</span></div>';
 }).join(""):'<div class="empty">No application has been granted this knowledge project.</div>';
 const grantControls=grantableApps.length
  ?'<div class="formgrid"><div class="field"><label for="project-grant-application">Grant to application</label><select id="project-grant-application">'+grantableApps.map(app=>'<option value="'+esc(app.id)+'">'+esc(app.name)+' · '+esc(app.slug)+'</option>').join("")+'</select></div><div class="field" style="justify-content:flex-end"><button class="btn primary" id="project-grant-button" type="button">Grant application access</button></div></div>'
  :'<div class="empty">Every active application already has a grant, or no active application is registered.</div>';
 $("modal-title").textContent=project.name;
 $("modal-body").innerHTML=
  '<div class="metrics" style="grid-template-columns:repeat(3,minmax(0,1fr))">'+
   '<div class="metric"><span>Ready sources</span><strong>'+Number(project.readySourceCount||0)+' / '+Number(project.sourceCount||0)+'</strong></div>'+
   '<div class="metric"><span>Applications</span><strong>'+Number(project.applicationCount||0)+'</strong></div>'+
   '<div class="metric"><span>Project searches this month</span><strong>'+Number(project.monthlyQueries||0).toLocaleString()+' / '+Number(project.monthlyLimit||800).toLocaleString()+'</strong><small>'+Number(project.monthlyRemaining??Math.max(0,Number(project.monthlyLimit||800)-Number(project.monthlyQueries||0))).toLocaleString()+' remaining · shared by all granted apps</small></div>'+
  '</div>'+
  '<p class="modal-subtitle">'+esc(project.ownerLabel||"Owner not assigned")+' · '+statusPill(project.status)+'</p>'+
  '<p class="muted">'+esc(project.description||"No description")+'</p>'+
  '<section class="view-panel" style="margin-top:12px"><div class="panel-toolbar"><div><h2>Application access</h2><p>These grants are application-wide. A multi-teacher app must map each signed-in user to an allowed project on its own server.</p></div></div>'+
   grantControls+grantRows+
  '</section>'+
  '<section class="view-panel" style="margin-top:12px"><div class="panel-toolbar"><div><h2>Knowledge sources</h2><p>Sources are included only through direct book grants or assigned collections, and only after indexing is ready.</p></div></div>'+
   (sources.length?sources.map(book=>'<div class="pulse-row"><span><strong>'+esc(book.title)+'</strong><br><small>'+esc(book.collectionName)+' · '+book.indexedPages+'/'+book.pageCount+' pages · direct and collection access are managed separately</small></span><span>'+statusPill(book.status)+' <button class="btn" data-project-book-access="'+esc(book.id)+'" type="button">Manage direct grants</button></span></div>').join(""):'<div class="empty">No assigned sources are visible for this project.</div>')+
  '</section>'+
  '<section class="view-panel" style="margin-top:12px"><div class="panel-toolbar"><div><h2>Collections</h2><p>Collection grants include eligible ready sources added later.</p></div></div>'+
   (collections.length?collections.map(collection=>'<div class="pulse-row"><span>'+esc(collection.name)+'</span><strong>'+Number(collection.bookCount||0)+' sources</strong></div>').join(""):'<div class="empty">No collections assigned.</div>')+
   (project.status==="active"?' <button class="btn" data-project-collection-access="'+esc(projectId)+'" type="button">Manage collection grants</button>':"")+
  '</section>'+
  '<section class="view-panel" style="margin-top:12px"><div class="panel-toolbar"><div><h2>Recent activity</h2><p>Project-scoped governance and ingestion events.</p></div></div>'+
   (events.length?events.map(event=>'<div class="pulse-row"><span>'+esc(event.message)+'</span><small>'+esc(time(event.createdAt))+'</small></div>').join(""):'<div class="empty">No project-scoped events in the current activity window.</div>')+
  '</section>';
 $("modal").classList.add("open");
 const grantButton=$("project-grant-button");
 if(grantButton)grantButton.addEventListener("click",async()=>{
  const applicationId=$("project-grant-application").value;
  if(!applicationId)return;
  grantButton.disabled=true;
  try{await post("applications/grants",{applicationId,projectId});await refresh();openProjectDetails(projectId);}
  catch(error){alert(error.message);grantButton.disabled=false;}
 });
 $("modal-body").querySelectorAll("[data-project-book-access]").forEach(button=>button.addEventListener("click",()=>editBookAccess(button.dataset.projectBookAccess)));
 $("modal-body").querySelectorAll("[data-project-collection-access]").forEach(button=>button.addEventListener("click",()=>{
  const selectedProjectId=button.dataset.projectCollectionAccess;
  if(!selectedProjectId)return;
  $("project-access").value=selectedProjectId;
  $("project-access").dispatchEvent(new Event("change"));
  $("modal").classList.remove("open");
  activateView("governance");
 }));
 $("modal-body").querySelectorAll("[data-project-grant-revoke]").forEach(button=>button.addEventListener("click",async()=>{
  if(!confirm("Revoke this application's access to "+project.name+"? Future retrieval requests will be denied."))return;
  button.disabled=true;
  try{await post("applications/grants/revoke",{applicationId:button.dataset.applicationId,projectId});await refresh();openProjectDetails(projectId);}
  catch(error){alert(error.message);button.disabled=false;}
 }));
}
function openProjectEditor(projectId){
 const project=(model?.projects||[]).find(item=>item.id===projectId);if(!project)return;
 $("modal-title").textContent="Knowledge project · "+project.name;
 $("modal-body").innerHTML=
  '<div class="field"><label for="edit-project-owner">Teacher / owner</label><input id="edit-project-owner" maxlength="120" value="'+esc(project.ownerLabel||"")+'" placeholder="Teacher or customer label"></div>'+
  '<div class="field"><label for="edit-project-name">Knowledge project name</label><input id="edit-project-name" maxlength="100" value="'+esc(project.name)+'"></div>'+
  '<div class="field"><label for="edit-project-description">Description</label><textarea id="edit-project-description" maxlength="500" rows="3">'+esc(project.description||"")+'</textarea></div>'+
  '<div class="modal-actions"><button class="btn primary" id="save-project-details" type="button">Save details</button></div>';
 $("modal").classList.add("open");
 $("save-project-details").addEventListener("click",async()=>{
  const button=$("save-project-details");button.disabled=true;
  try{
   const name=$("edit-project-name").value.trim();
   if(!name)throw new Error("Enter a knowledge project name.");
   await post("projects/update",{projectId:project.id,name,description:$("edit-project-description").value,ownerLabel:$("edit-project-owner").value});
   $("modal").classList.remove("open");await refresh();
  }catch(error){alert(error.message);button.disabled=false;}
 });
}
async function openApplicationHandoff(applicationId,environmentId){
  const app=(model?.applications||[]).find(item=>item.id===applicationId);
  const environment=(app?.environments||[]).find(item=>item.id===environmentId);
  if(!app||!environment)return;
  $("modal-title").textContent="ChatGPT integration handoff · "+(environment.displayName||environment.environmentKey);
  $("modal-body").innerHTML='<p class="muted">Generating a repository-specific, non-secret handoff from the latest saved application and environment metadata…</p>';
  $("modal").classList.add("open");
  try{
   const query="applications/handoff?"+new URLSearchParams({applicationId,environmentId}).toString();
   const handoff=await api(API+query);
   $("modal-body").innerHTML=
    '<div class="metrics" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+
     '<div class="metric"><span>Handoff revision</span><strong style="font-size:16px">'+esc(handoff.revision)+'</strong></div>'+
     '<div class="metric"><span>Generated</span><strong style="font-size:13px">'+esc(time(Date.parse(handoff.generatedAt)))+'</strong></div>'+
    '</div>'+
    '<p class="modal-subtitle" style="margin:0 0 14px">Generated from the current repository, application and environment records. Generate again after editing metadata to refresh this handoff.</p>'+
    '<div class="notice">This is a copyable engineering handoff only. ChatGPT must separately have access to the repository and the target Worker account must be confirmed. BRVIN does not create repositories, bindings, secrets or deployments. Connection remains Pending until M9 live verification.</div>'+
    '<div class="panel-toolbar" style="margin-top:16px"><div><h2>ChatGPT integration prompt</h2><p>Copy and paste this complete prompt into the engineering conversation that has access to the target repository.</p></div><button class="btn primary" id="copy-handoff-prompt" type="button">Copy prompt</button></div>'+
    '<textarea id="handoff-prompt" rows="16" readonly spellcheck="false" style="width:100%;font:11px/1.5 ui-monospace,monospace;white-space:pre;overflow:auto"></textarea>'+
    '<div class="panel-toolbar" style="margin-top:16px"><div><h2>Structured manifest</h2><p>Machine-readable manifest for review and record keeping.</p></div><button class="btn" id="copy-handoff-manifest" type="button">Copy manifest</button></div>'+
    '<textarea id="handoff-manifest" rows="14" readonly spellcheck="false" style="width:100%;font:11px/1.5 ui-monospace,monospace;white-space:pre;overflow:auto"></textarea>'+
    '<p id="handoff-copy-status" class="statusline" aria-live="polite"></p>';
   $("handoff-prompt").value=handoff.prompt;
   $("handoff-manifest").value=JSON.stringify(handoff.manifest,null,2);
   const copy=async(id,label)=>{
    const field=$(id);
    try{
     await navigator.clipboard.writeText(field.value);
     $("handoff-copy-status").textContent=label+" copied.";
    }catch{
     field.focus();field.select();
     $("handoff-copy-status").textContent="Clipboard access is unavailable. The "+label.toLowerCase()+" is selected; use Copy from your device.";
    }
   };
   $("copy-handoff-prompt").addEventListener("click",()=>copy("handoff-prompt","Prompt"));
   $("copy-handoff-manifest").addEventListener("click",()=>copy("handoff-manifest","Manifest"));
  }catch(error){
   $("modal-body").innerHTML='<p class="error">'+esc(error.message)+'</p><p class="muted">Check the saved GitHub repository URL and environment status, then regenerate.</p>';
  }
}
function openApplicationEditor(applicationId){
 const app=(model?.applications||[]).find(item=>item.id===applicationId);if(!app)return;
 $("modal-title").textContent="Application · "+app.name;
 $("modal-body").innerHTML=
  '<div class="field"><label for="edit-app-owner">Teacher / owner</label><input id="edit-app-owner" maxlength="120" value="'+esc(app.ownerLabel||"")+'"></div>'+
  '<div class="field"><label for="edit-app-name">Application name</label><input id="edit-app-name" maxlength="100" value="'+esc(app.name)+'"></div>'+
  '<div class="field"><label for="edit-app-description">Purpose</label><textarea id="edit-app-description" maxlength="500" rows="3">'+esc(app.description||"")+'</textarea></div>'+
  '<div class="field"><label for="edit-app-repository">GitHub repository URL</label><input id="edit-app-repository" maxlength="300" value="'+esc(app.repositoryUrl||"")+'" placeholder="https://github.com/owner/repository"></div>'+
  '<div class="field"><label for="edit-app-branch">Default branch</label><input id="edit-app-branch" maxlength="100" value="'+esc(app.repositoryDefaultBranch||"main")+'"></div>'+
  '<div class="field"><label for="edit-app-runtime">Runtime provider</label><select id="edit-app-runtime"><option value="cloudflare-workers"'+(app.runtimeProvider!=="other"?" selected":"")+'>Cloudflare Workers</option><option value="other"'+(app.runtimeProvider==="other"?" selected":"")+'>Other / not yet deployed on Workers</option></select></div>'+
  '<div class="notice">Repository and runtime references are metadata only. Saving them does not grant ChatGPT repository access or verify a Worker connection.</div>'+
  '<div class="modal-actions"><button class="btn primary" id="save-app-details" type="button">Save application details</button></div>';
 $("modal").classList.add("open");
 $("save-app-details").addEventListener("click",async()=>{
  const button=$("save-app-details");button.disabled=true;
  try{
   const name=$("edit-app-name").value.trim();
   if(!name)throw new Error("Enter an application name.");
   await post("applications/update",{
    applicationId:app.id,name,description:$("edit-app-description").value,ownerLabel:$("edit-app-owner").value,
    repositoryUrl:$("edit-app-repository").value,repositoryDefaultBranch:$("edit-app-branch").value,
    runtimeProvider:$("edit-app-runtime").value
   });
   $("modal").classList.remove("open");await refresh();
  }catch(error){alert(error.message);button.disabled=false;}
 });
}
function openEnvironmentEditor(applicationId,environmentId){
 const app=(model?.applications||[]).find(item=>item.id===applicationId);
 const environment=(app?.environments||[]).find(item=>item.id===environmentId);if(!app||!environment)return;
 $("modal-title").textContent="Environment · "+(environment.displayName||environment.environmentKey);
 $("modal-body").innerHTML=
  '<div class="field"><label>Environment key</label><input value="'+esc(environment.environmentKey)+'" disabled></div>'+
  '<div class="field"><label for="edit-env-display">Display name</label><input id="edit-env-display" maxlength="80" value="'+esc(environment.displayName||"")+'"></div>'+
  '<div class="field"><label for="edit-env-worker">Worker name</label><input id="edit-env-worker" maxlength="63" value="'+esc(environment.workerName||"")+'" placeholder="my-application-production"></div>'+
  '<div class="field"><label for="edit-env-url">Worker URL (HTTPS)</label><input id="edit-env-url" maxlength="300" value="'+esc(environment.workerUrl||"")+'" placeholder="https://my-application.example.workers.dev"></div>'+
  '<div class="notice">The environment identity is immutable. These values describe the runtime only; live connection remains Pending until M9 verification.</div>'+
  '<div class="modal-actions"><button class="btn primary" id="save-env-details" type="button">Save environment details</button></div>';
 $("modal").classList.add("open");
 $("save-env-details").addEventListener("click",async()=>{
  const button=$("save-env-details");button.disabled=true;
  try{
   await post("applications/environments/update",{
    environmentId:environment.id,displayName:$("edit-env-display").value,
    workerName:$("edit-env-worker").value,workerUrl:$("edit-env-url").value
   });
   $("modal").classList.remove("open");await refresh();
  }catch(error){alert(error.message);button.disabled=false;}
 });
}
function renderProjects(list){
 const previousProjectId=$("project-access").value;
 const selectedProjectIds=new Set([...$("project-checks").querySelectorAll("input:checked")].map(input=>input.value));
 $("projects").innerHTML=list.length?list.map(p=>{
  const apps=(p.applications||[]).filter(a=>a.status==="active").map(a=>a.name||a.slug).join(", ");
  const nextStatus=p.status==="active"?"inactive":"active";
  const action=p.status==="active"?"Deactivate":"Activate";
  const ready=Number(p.readySourceCount||0),total=Number(p.sourceCount||0);
  return '<article class="tile">'+
   '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><strong>'+esc(p.name)+'</strong><div class="muted" style="font-size:10px;margin-top:4px">'+esc(p.ownerLabel||"Owner not assigned")+'</div></div>'+statusPill(p.status)+'</div>'+
   '<p>'+esc(p.description||"No description")+'</p>'+
   '<div class="pulse-row"><span>Knowledge sources ready</span><strong>'+ready+' / '+total+'</strong></div>'+
   '<div class="pulse-row"><span>Books via collections</span><strong>'+Number(p.collectionBooks||0)+'</strong></div>'+
   '<div class="pulse-row"><span>Connected applications</span><strong>'+Number(p.applicationCount||0)+'</strong></div>'+
   '<div class="pulse-row"><span>Project searches this month</span><strong>'+Number(p.monthlyQueries||0).toLocaleString()+' / '+Number(p.monthlyLimit||800).toLocaleString()+'</strong></div>'+
    '<div class="bar" style="max-width:none"><i style="width:'+pct(Number(p.monthlyQueries||0),Number(p.monthlyLimit||800))+'%"></i></div>'+
    '<p><small>'+Number(p.monthlyRemaining??Math.max(0,Number(p.monthlyLimit||800)-Number(p.monthlyQueries||0))).toLocaleString()+' remaining · counts are shared across all apps granted to this project.</small></p>'+
   '<div style="margin-top:9px"><small>Apps with active permission: '+esc(apps||"None assigned")+'</small></div>'+
   '<div class="job-actions"><button class="btn primary" data-project-details="'+esc(p.id)+'" type="button">View details</button><button class="btn" data-project-edit="'+esc(p.id)+'" type="button">Edit details</button><button class="btn" data-project-access="'+esc(p.id)+'" type="button">Manage collections</button><button class="btn" data-project-status="'+esc(p.id)+'" data-status="'+nextStatus+'" type="button">'+action+'</button></div>'+
  '</article>';
 }).join(""):'<div class="empty" style="grid-column:1/-1">No knowledge projects yet. Create a teacher workspace to start organizing source material.</div>';
 $("project-checks").innerHTML=list.filter(p=>p.status==="active").map(p=>'<label class="check"><input type="checkbox" value="'+esc(p.id)+'"'+(selectedProjectIds.has(p.id)?" checked":"")+'> '+esc(p.name)+'</label>').join("")||'<span class="muted">No active projects. Create one below.</span>';
 $("project-access").innerHTML=list.filter(p=>p.status==="active").map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.ownerLabel||"No owner")+'</option>').join("");
 if(list.some(p=>p.id===previousProjectId&&p.status==="active"))$("project-access").value=previousProjectId;
 $("project-access").onchange=()=>{const p=list.find(item=>item.id===$("project-access").value);const allowed=new Set((model?.collections||[]).filter(col=>col.projects.some(link=>link.id===p?.id)).map(col=>col.id));$("collection-checks").querySelectorAll("input").forEach(input=>input.checked=allowed.has(input.value));};
 $("projects").querySelectorAll("[data-project-details]").forEach(button=>button.addEventListener("click",()=>openProjectDetails(button.dataset.projectDetails)));
 $("projects").querySelectorAll("[data-project-edit]").forEach(button=>button.addEventListener("click",()=>openProjectEditor(button.dataset.projectEdit)));
 $("projects").querySelectorAll("[data-project-access]").forEach(button=>button.addEventListener("click",()=>{
  $("project-access").value=button.dataset.projectAccess;
  $("project-access").dispatchEvent(new Event("change"));
  activateView("governance");
 }));
 $("projects").querySelectorAll("[data-project-status]").forEach(button=>button.addEventListener("click",async()=>{
  const project=list.find(item=>item.id===button.dataset.projectStatus);if(!project)return;
  const status=button.dataset.status;
  const message=status==="inactive"?"Deactivate "+project.name+"? Future retrieval requests will be denied. Existing source grants will be retained.":"Reactivate "+project.name+"?";
  if(!confirm(message))return;
  try{await post("projects/update",{projectId:project.id,status});await refresh();}catch(error){alert(error.message);}
 }));
}
async function verifyBrvinEnvironment(environmentId){
 let challenge=null,finalized=false;
 try{
  challenge=await post("connections/challenge",{environmentId});
  const response=await fetch(challenge.probeUrl,{
   method:"POST",mode:"cors",credentials:"omit",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({challengeId:challenge.challengeId,nonce:challenge.nonce})
  });
  let result={};try{result=await response.json();}catch{}
  if(!response.ok||result.ok!==true||typeof result.proof!=="string"){
   const error=new Error("The deployed Worker did not prove its private BRVIN identity.");
   error.failureCode="PROBE_REJECTED";throw error;
  }
  const completed=await post("connections/complete",{challengeId:challenge.challengeId,proof:result.proof});
  finalized=true;
  await refresh();
  alert(completed.status==="connected"
   ?"Connection verified. The application has "+completed.authorizedSourceCount+" ready authorised source(s)."
   :"Connection verified. The private BRVIN connection works, but this application currently has no ready authorised knowledge sources.");
 }catch(error){
  if(challenge?.challengeId&&!finalized){
   await post("connections/complete",{
    challengeId:challenge.challengeId,
    failureCode:error?.failureCode==="PROBE_REJECTED"?"PROBE_REJECTED":"PROBE_UNREACHABLE"
   }).catch(()=>undefined);
  }
  await refresh();
  alert(error?.message||"The BRVIN connection could not be verified.");
 }
}
function renderApplications(list){
 const active=list.filter(app=>app.status==="active");
 const previous={env:$("environment-application").value,grantApp:$("grant-application").value,grantProject:$("grant-project").value};
 const fill=(id,items,previousValue,emptyLabel)=>{
  const select=$(id);select.innerHTML=items.length?items.map(item=>'<option value="'+esc(item.value)+'">'+esc(item.label)+'</option>').join(""):'<option value="">'+emptyLabel+'</option>';
  if(items.some(item=>item.value===previousValue))select.value=previousValue;
 };
 const options=active.map(app=>({value:app.id,label:app.name+" · "+app.slug}));
 fill("environment-application",options,previous.env,"Register an active application first");
 fill("grant-application",options,previous.grantApp,"No active applications");
 fill("grant-project",(model?.projects||[]).filter(project=>project.status==="active").map(project=>({value:project.id,label:project.name+" · "+(project.ownerLabel||"No owner")})),previous.grantProject,"No active knowledge projects");
 const html=list.length?list.map(app=>{
  const appAction=app.status==="active"?"suspended":app.status==="suspended"?"active":null;
  const appActionLabel=app.status==="active"?"Suspend application":app.status==="suspended"?"Reactivate application":"Permanently revoked";
  const repositoryHtml=app.repositoryUrl
   ?'<a href="'+esc(app.repositoryUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(app.repositoryUrl)+'</a> · branch <strong>'+esc(app.repositoryDefaultBranch||"main")+'</strong>'
   :'No repository reference saved';
  const envHtml=app.environments.length?app.environments.map(environment=>{
   const next=environment.status==="active"?"disabled":environment.status==="disabled"?"active":null;
   const action=next?'<button class="btn" data-environment-status="'+esc(environment.id)+'" data-status="'+next+'">'+(next==="disabled"?"Disable":"Activate")+'</button>':"";
   const revoke=environment.status!=="revoked"?'<button class="btn danger" data-environment-status="'+esc(environment.id)+'" data-status="revoked">Revoke identity</button>':"";
   const connection=environment.connectionStatus==="revoked"?"Revoked":
    environment.connectionStatus==="disabled"?"Disabled":
    environment.connectionStatus==="connected"?"Connected":
    environment.connectionStatus==="connected_no_ready"?"Connected · no ready knowledge":
    environment.connectionStatus==="failed"?"Verification failed":"Pending connection";
   const checkNote=environment.connectionLastCheckedAt
    ?'<p><small>Last connection check: '+esc(time(environment.connectionLastCheckedAt))+
     (environment.connectionFailureCode?' · '+esc(environment.connectionFailureCode):
      (environment.connectionAuthorizedSourceCount!==null&&environment.connectionAuthorizedSourceCount!==undefined?' · '+esc(environment.connectionAuthorizedSourceCount)+' ready authorised source(s)':""))+'</small></p>'
    :'';
   const worker=environment.workerName?esc(environment.workerName):"Worker not specified";
   const workerUrl=environment.workerUrl?'<a href="'+esc(environment.workerUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(environment.workerUrl)+'</a>':"URL not specified";
   const edit=environment.status!=="revoked"?'<button class="btn" data-environment-edit="'+esc(environment.id)+'" data-application-id="'+esc(app.id)+'">Edit runtime details</button>':"";
   return '<div class="tile" style="margin-top:8px">'+
    '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>'+esc(environment.displayName||environment.environmentKey)+'</strong><span class="pill">'+connection+'</span></div>'+
    '<p><small>'+esc(environment.environmentKey)+' · '+esc(environment.id)+'</small></p>'+
    checkNote+
    '<div class="pulse-row"><span>Worker / runtime</span><strong>'+worker+'</strong></div>'+
    '<div class="pulse-row"><span>Runtime URL</span><span>'+workerUrl+'</span></div>'+
    '<div class="job-actions">'+edit+(app.status==="active"&&environment.status==="active"&&app.repositoryUrl?'<button class="btn primary" data-handoff="true" data-application-id="'+esc(app.id)+'" data-environment-id="'+esc(environment.id)+'" type="button">Generate ChatGPT handoff</button>':"")+(app.status==="active"&&environment.status==="active"&&environment.workerUrl?'<button class="btn" data-environment-verify="'+esc(environment.id)+'" type="button">Verify connection</button>':"")+action+revoke+'</div>'+
   '</div>';
  }).join(""):'<div class="empty">No deployment environments registered.</div>';
  const grantHtml=app.projects.length?app.projects.map(grant=>'<div class="pulse-row"><span><strong>'+esc(grant.projectName)+'</strong><br><small>'+esc(grant.projectSlug)+' · '+esc(grant.projectStatus)+' · granted '+esc(time(grant.createdAt))+'</small><br><small>'+Number(grant.monthlyQueries||0).toLocaleString()+' / '+Number(grant.monthlyLimit||800).toLocaleString()+' project searches this month · shared project counter</small></span><span>'+statusPill(grant.status)+(grant.status==="active"?' <button class="btn danger" data-grant-revoke="true" data-application-id="'+esc(app.id)+'" data-project-id="'+esc(grant.projectId)+'">Revoke access</button>':"")+'</span></div>').join(""):'<div class="empty">No knowledge projects granted. This application cannot retrieve BRVIN knowledge.</div>';
  const activeGrantProjectIds=new Set(app.projects.filter(grant=>grant.status==="active").map(grant=>grant.projectId));
  const grantableProjects=app.status==="active"?(model?.projects||[]).filter(project=>project.status==="active"&&!activeGrantProjectIds.has(project.id)):[];
  const inlineGrantHtml=app.status!=="active"
   ?'<div class="notice">Only an active application can receive additional project grants.</div>'
   :grantableProjects.length
    ?'<div data-app-grant-controls="'+esc(app.id)+'" class="formgrid"><div class="field"><label>Grant another knowledge project</label><select data-app-grant-select>'+grantableProjects.map(project=>'<option value="'+esc(project.id)+'">'+esc(project.name)+' · '+esc(project.ownerLabel||"No owner")+'</option>').join("")+'</select></div><div class="field" style="justify-content:flex-end"><button class="btn" data-app-grant="'+esc(app.id)+'" type="button">Grant selected project</button></div></div>'
    :'<div class="notice">No additional active knowledge projects are available to grant.</div>';
  return '<article class="tile">'+
   '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><strong>'+esc(app.name)+'</strong><p><small>'+esc(app.ownerLabel||"Owner not assigned")+' · '+esc(app.slug)+'</small></p></div>'+statusPill(app.status)+'</div>'+
   '<p>'+esc(app.description||"No description")+'</p>'+
   '<div class="pulse-row"><span>GitHub repository</span><span>'+repositoryHtml+'</span></div>'+
   '<div class="pulse-row"><span>Runtime provider</span><strong>'+esc(app.runtimeProvider==="other"?"Other / external":"Cloudflare Workers")+'</strong></div>'+
   '<div class="pulse-row"><span>Deployment environments</span><strong>'+app.environments.length+'</strong></div>'+
   '<div class="pulse-row"><span>Active knowledge grants</span><strong>'+app.activeProjectCount+'</strong></div>'+
   '<div class="notice">Repository and Worker references are metadata only. GitHub authorization is separate. Connection status reflects the last environment check; project access is governed by active application grants and source-level assignments.</div>'+
   '<div class="job-actions"><button class="btn" data-application-edit="'+esc(app.id)+'" type="button">Edit application</button>'+(appAction?'<button class="btn '+(appAction==="suspended"?"danger":"")+'" data-application-status="'+esc(app.id)+'" data-status="'+appAction+'">'+appActionLabel+'</button>':"")+'</div>'+
   '<div style="margin-top:14px"><strong>Environments</strong>'+envHtml+'</div><div style="margin-top:14px"><strong>Knowledge access</strong><p class="muted">Application-wide grants. Multi-teacher apps must enforce authenticated user-to-project access in their own server-side logic.</p>'+grantHtml+inlineGrantHtml+'</div></article>';
 }).join(""):'<div class="empty" style="grid-column:1/-1">No applications registered. Create the repository with ChatGPT or manually first, then register its existing URL here.</div>';
 $("applications-list").innerHTML=html;
 $("applications-list").querySelectorAll("[data-handoff]").forEach(button=>button.addEventListener("click",()=>openApplicationHandoff(button.dataset.applicationId,button.dataset.environmentId)));
 $("applications-list").querySelectorAll("[data-environment-verify]").forEach(button=>button.addEventListener("click",()=>verifyBrvinEnvironment(button.dataset.environmentVerify)));
 $("applications-list").querySelectorAll("[data-application-edit]").forEach(button=>button.addEventListener("click",()=>openApplicationEditor(button.dataset.applicationEdit)));
 $("applications-list").querySelectorAll("[data-environment-edit]").forEach(button=>button.addEventListener("click",()=>openEnvironmentEditor(button.dataset.applicationId,button.dataset.environmentEdit)));
 $("applications-list").querySelectorAll("[data-application-status]").forEach(button=>button.addEventListener("click",async()=>{
  const app=list.find(item=>item.id===button.dataset.applicationStatus);if(!app)return;
  const status=button.dataset.status;
  if(!confirm((status==="revoked"?"Permanently revoke ":"Suspend ")+app.name+"? Existing environments and grants are retained for audit; retrieval will fail while the application is not active."))return;
  try{await post("applications/status",{applicationId:app.id,status});await refresh();}catch(error){alert(error.message);}
 }));
 $("applications-list").querySelectorAll("[data-environment-status]").forEach(button=>button.addEventListener("click",async()=>{
  const status=button.dataset.status;
  if(status==="revoked"&&!confirm("Permanently revoke this environment identity? It cannot be reused or reactivated."))return;
  try{await post("applications/environments/status",{environmentId:button.dataset.environmentStatus,status});await refresh();}catch(error){alert(error.message);}
 }));
 $("applications-list").querySelectorAll("[data-grant-revoke]").forEach(button=>button.addEventListener("click",async()=>{
  if(!confirm("Revoke this application’s access to the selected project? Future retrieval requests will be denied."))return;
  button.disabled=true;
  try{await post("applications/grants/revoke",{applicationId:button.dataset.applicationId,projectId:button.dataset.projectId});await refresh();}catch(error){alert(error.message);button.disabled=false;}
 }));
 $("applications-list").querySelectorAll("[data-app-grant]").forEach(button=>button.addEventListener("click",async()=>{
  const controls=button.closest("[data-app-grant-controls]");
  const projectId=controls?.querySelector("[data-app-grant-select]")?.value;
  const applicationId=button.dataset.appGrant;
  if(!applicationId||!projectId)return;
  button.disabled=true;
  try{await post("applications/grants",{applicationId,projectId});await refresh();}catch(error){alert(error.message);button.disabled=false;}
 }));
}

function renderBooks(list,projects){$("book-count").textContent=list.length+" sources";$("books").innerHTML=list.length?list.map(b=>{const access=b.projects.map(p=>p.name).join(", ")||"No project access",progress=pct(b.indexedPages,b.pageCount),archived=b.status==="archived",manageLabel=archived?"Manage · archived":"Manage";const inspect=["uploading","uploaded","processing","failed","delete_failed"].includes(b.status)?'<button class="btn" data-inspect="'+esc(b.id)+'" type="button">Inspect</button> ':"";return '<tr><td class="source-name"><strong>'+esc(b.title)+'</strong><div class="muted">'+esc(b.filename)+'</div><div class="bar"><i style="width:'+progress+'%"></i></div></td><td>'+esc(b.collectionName)+'</td><td>'+b.indexedPages+'/'+b.pageCount+'</td><td>'+statusPill(b.status)+(b.error?'<div class="error" style="font-size:10px;margin-top:5px">'+esc(b.error)+'</div>':"")+'</td><td>'+esc(access)+'</td><td class="source-actions">'+inspect+'<button class="btn" data-manage="'+esc(b.id)+'" data-archived="'+archived+'" type="button">'+manageLabel+'</button></td></tr>';}).join(""):'<tr><td class="empty" colspan="6">No knowledge sources yet. Add the first PDF to start your library.</td></tr>';$("books").querySelectorAll("[data-inspect]").forEach(button=>button.addEventListener("click",()=>showImport(button.dataset.inspect)));$("books").querySelectorAll("[data-manage]").forEach(button=>button.addEventListener("click",()=>manageBook(button.dataset.manage)));}
function renderJobs(list){$("jobs").innerHTML=list.length?list.map(j=>{const deleting=j.status==="deleting"||j.status==="delete_failed",percent=j.status==="uploading"?pct(j.uploadedBytes,j.expectedBytes):pct(j.indexedPages,j.pageCount),label=deleting?"Removing AI Search pages and private PDF/OCR storage":j.status==="uploading"?fmtBytes(j.uploadedBytes)+" / "+fmtBytes(j.expectedBytes):j.indexedPages+" / "+j.pageCount+" pages";return '<div class="job-card"><div class="job-card-head"><strong>'+esc(j.title)+'</strong>'+statusPill(j.status)+'</div><p>'+esc(label)+(deleting?"":" · "+percent+"% · updated "+esc(time(j.updatedAt)))+'</p>'+(deleting?"":'<div class="bar" style="max-width:none"><i style="width:'+percent+'%"></i></div>')+(j.error?'<p class="error">'+esc(j.error)+'</p>':"")+'<div class="job-actions"><button class="btn" data-inspect="'+esc(j.id)+'" type="button">Inspect pipeline</button>'+(j.status==="failed"&&j.hasOcrOperation?'<button class="btn" data-resume="'+esc(j.id)+'" type="button">Resume</button>':"")+'</div></div>';}).join(""):'<div class="empty" style="grid-column:1/-1">No active processing or deletion jobs. New BRVIN operations will appear here.</div>';$("jobs").querySelectorAll("[data-inspect]").forEach(b=>b.addEventListener("click",()=>showImport(b.dataset.inspect)));$("jobs").querySelectorAll("[data-resume]").forEach(b=>b.addEventListener("click",()=>resumeImport(b.dataset.resume)));}
function detailText(details){if(!details||typeof details!=="object")return"";return Object.entries(details).map(([key,value])=>key+": "+(typeof value==="object"?JSON.stringify(value):String(value))).join(" · ").slice(0,700);}
function renderEvents(list){
 const filter=$("event-filter")?.value||"all";
 const filtered=(list||[]).filter(event=>{
  const phase=String(event.phase||"").toLowerCase(),type=String(event.type||"").toLowerCase(),status=String(event.status||"").toLowerCase();
  if(filter==="attention")return status==="failed"||status==="warning";
  if(filter==="retention")return phase==="retention"||type.includes("storage")||type.includes("vision_ocr");
  if(filter==="connections")return type.includes("connection")||type.includes("environment");
  if(filter==="ingestion")return ["upload","ocr","indexing","verification","processing","recovery"].includes(phase)||type.startsWith("book.")||type.startsWith("index.")||type.startsWith("ocr.");
  if(filter==="governance")return phase==="governance"||type.includes("grant")||type.includes("revok")||type.includes("application.");
  return true;
 });
 $("events").innerHTML=filtered.length?filtered.slice(0,60).map(e=>'<div class="event '+esc(e.status)+'"><i class="rail"></i><div><div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(e.agent)+' · '+esc(e.phase)+'</strong>'+statusPill(e.status)+'</div><p>'+esc(e.message)+'</p>'+(e.details?'<small>'+esc(detailText(e.details))+'</small><br>':"")+'<small>'+esc(time(e.createdAt))+' · '+esc(e.type)+'</small></div></div>').join(""):'<div class="empty">No events match this filter.</div>';
}
function renderOperations(data){
 const ops=data.operations||{},connections=ops.connections||{},retention=ops.retention||{},events=ops.events||{};
 const projectSearches=(data.projects||[]).reduce((total,project)=>total+Number(project.monthlyQueries||0),0);
 const cards=[
  ["Project searches",projectSearches.toLocaleString(),"This month · project counters"],
  ["Connection failures",Number(connections.failed||0),"Active environment checks"],
  ["Failed events",Number(events.failed||0),"Last seven days"],
  ["OCR cleanup failures",Number(retention.failed||0),"Paused for manual recovery"],
 ];
 $("operations-metrics").innerHTML=cards.map(([label,value,note])=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>').join("");
 let note;
 if(Number(retention.failed||0)>0){
  note=Number(retention.failed)+" source(s) have failed OCR-only cleanup. Their original PDFs, indexed pages and READY/archived status are retained. Automatic retries are paused; run the read-only storage check, correct GCS permissions, then use Manage → Retry Vision OCR cleanup.";
 }else if(Number(retention.running||0)>0){
  note=Number(retention.running)+" OCR cleanup job(s) are currently running. The source PDFs and indexed pages remain retained.";
 }else if(Number(retention.totalDue||0)>0){
  note=Number(retention.totalDue)+" ready/archived source(s) still have temporary Vision OCR output pending cleanup.";
 }else{
  note="No eligible temporary Vision OCR cleanup remains outstanding.";
 }
 $("retention-note").textContent=note;
}
function renderOverview(data){$("overview-books").textContent=String(data.stats.books);$("overview-pages").textContent=data.stats.indexedPages.toLocaleString()+" of "+data.stats.totalPages.toLocaleString()+" pages indexed";$("overview-ready").textContent=String(data.stats.readyBooks);$("overview-running").textContent=String(data.stats.activeBooks);$("overview-attention").textContent=String(data.stats.failedBooks);$("overview-status-note").textContent=data.stats.failedBooks?data.stats.failedBooks+" source(s) need attention. Open Operations to inspect the affected workflow.":data.stats.activeBooks?data.stats.activeBooks+" pipeline(s) are running. Processing continues automatically in the background.":"All tracked sources are stable. New processing events will appear here automatically.";}
function render(){if(!model)return;renderMetrics(model.stats);renderApplications(model.applications||[]);renderCollections(model.collections);renderProjects(model.projects);renderBooks(model.books,model.projects);renderJobs(model.jobs);renderEvents(model.events);renderOperations(model);renderOverview(model);$("live-label").textContent="LIVE · refreshed "+new Date(model.generatedAt).toLocaleTimeString();$("event-stamp").textContent="Last event "+(model.events[0]?time(model.events[0].createdAt):"—");}
let connectState=null;
async function refreshConnectState(){
 try{connectState=await api(API+"connect/status");renderConnectState();}
 catch(error){$("provider-capability-result").textContent="Connection status could not load: "+error.message;}
}
function renderConnectState(){
 if(!connectState)return;
 const github=connectState.github||{},cloudflare=connectState.cloudflare||{};
 $("connect-github-status").textContent=github.status||"not connected";
 $("connect-cloudflare-status").textContent=cloudflare.status||"not configured";
 $("github-app-meta").textContent=github.appName
  ?github.appName+" · "+(github.appUrl||github.appSlug||"")+(github.installationAccount?" · installed on "+github.installationAccount:"")
  :"No BRVIN GitHub App registered.";
 $("github-app-settings").href=github.appSettingsUrl||"https://github.com/settings/apps";
 $("github-installation-settings").href=github.installationUrl||"https://github.com/settings/installations";
 $("github-register").textContent=github.appSettingsUrl?"Open BRVIN App permissions":"Create BRVIN GitHub App";
 $("github-access-state").textContent=github.repositorySelection==="all"
  ?"All repositories are selected in the stored installation metadata. Run the live capability check to verify current installation permissions."
  :"One-time action: approve the expanded App permissions and set installation repository access to All repositories.";
 $("cf-required-scopes").value=(cloudflare.requiredScopes||[]).join(" ");
 $("cf-callback-url").value=cloudflare.callbackUrl||window.location.origin+"/admin/brvin/connect/cloudflare/callback";
 $("cf-client-credentials").hidden=cloudflare.oauthClientConfigured===true;
 $("cf-save-client").hidden=cloudflare.oauthClientConfigured===true;
 $("cf-client-state").textContent=cloudflare.oauthClientConfigured
  ?"Existing OAuth client "+(cloudflare.clientIdHint||"") +" is stored encrypted. Its secret does not need to be entered again."
  :"No OAuth client has been saved yet. Configure the existing BRVIN Connect client only if the encrypted client record is missing.";
 $("cf-worker-note").textContent=cloudflare.brvinServiceVisible
  ?"Same-account check passed · private brvin-service is visible in "+(cloudflare.accountId||"the BRVIN home account")+". OAuth currently grants "+(cloudflare.grantedScopes||[]).length+" scopes. "+(cloudflare.workerAdminScopeGranted?"Workers Admin is granted.":"BLOCKER: Workers Editor is not Workers Admin; BRVIN cannot create/delete new Workers until workers-scripts.admin is granted.")
  :"Authorize the Cloudflare account that hosts private brvin-service. The capability check itself does not create or change Workers.";
}
async function refresh(){try{model=await api(API+"overview");render();if($("connect-wizard-panel")?.open)await refreshConnectState();}catch(e){$("live-label").textContent="LIVE · connection issue";console.error(e);}}
async function runStorageDiagnostics(){
 const button=$("storage-diagnostics"),result=$("storage-diagnostic-result");
 button.disabled=true;result.hidden=false;result.textContent="Checking service-account permissions and bucket metadata without changing storage…";
 try{
  const response=await fetch(API+"diagnostics/storage",{method:"GET",credentials:"same-origin"});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw new Error(data.error||"Storage diagnostic failed (HTTP "+response.status+").");
  const perms=data.checks?.permissions||{},bucket=data.checks?.bucket||{};
  const objectMissing=perms.missingObjectPermissions||[];
  const lifecycleMissing=data.retentionLifecycleMissingPermissions||perms.lifecycleMissingPermissions||[];
  result.textContent=[
   "Service account: "+(data.serviceAccountEmail||"not configured"),
   "Bucket: "+(data.bucketName||"not configured"),
   "Core object access: "+(data.uploadStartReady?"READY":"BLOCKED"),
   "Missing object permissions: "+(objectMissing.length?objectMissing.join(", "):"none reported"),
   "Bucket metadata inspection: "+(bucket.ok?"available":"not available"),
   "30-day OCR lifecycle safety net: "+(data.retentionLifecycleReady?"READY":"NOT CONFIGURED"),
   "Lifecycle permissions still needed: "+(lifecycleMissing.length?lifecycleMissing.join(", "):"none reported"),
   data.note||""
  ].filter(Boolean).join("\n");
  result.style.whiteSpace="pre-wrap";
 }catch(error){result.textContent="Diagnostic could not complete: "+(error instanceof Error?error.message:String(error));}
 finally{button.disabled=false;}
}
$("storage-diagnostics").addEventListener("click",runStorageDiagnostics);
$("event-filter").addEventListener("change",()=>renderEvents(model?.events||[]));
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
function manageBook(id){
 const book=model?.books?.find(item=>item.id===id);if(!book)return;
 const canDelete=book.sourceType==="pdf"&&!book.visionOcrDeleting&&["ready","failed","delete_failed","completed","archived"].includes(book.status);
 const canArchive=book.sourceType==="pdf"&&book.status==="ready",canRestore=book.sourceType==="pdf"&&book.status==="archived";
 const canDeleteOcr=book.sourceType==="pdf"&&(book.status==="ready"||book.status==="archived")&&!book.visionOcrDeleted&&!book.visionOcrDeleting;
 const busyOcr=book.visionOcrDeleting,needsInspect=["uploading","uploaded","processing","failed","delete_failed"].includes(book.status);
 const failedOcr=Boolean(book.visionOcrCleanupError),ocrAction=failedOcr?"Retry Vision OCR cleanup":"Delete Vision OCR files only";
 $("modal-title").textContent=book.title;
 $("modal-body").innerHTML=
  '<p class="modal-subtitle" style="margin:0 0 16px">'+esc(book.collectionName)+' · '+book.indexedPages+'/'+book.pageCount+' pages indexed · '+esc(book.status.replaceAll("_"," "))+'</p>'+
  '<div class="management-actions">'+(needsInspect?'<button class="btn" id="manage-inspect" type="button">Inspect processing pipeline</button>':"")+
   (book.status==="deleting"?"":'<button class="btn" id="manage-access" type="button">Manage direct project access</button>')+
   (canArchive?'<button class="btn" id="manage-archive" data-book-archive type="button">Archive source</button>':"")+
   (canRestore?'<button class="btn" id="manage-restore" data-book-restore type="button">Restore source</button>':"")+
   (canDeleteOcr?'<button class="btn" id="manage-ocr" type="button">'+ocrAction+'</button>':busyOcr?'<span class="muted">Vision OCR cleanup is running…</span>':book.visionOcrDeleted?'<span class="muted">Vision OCR files marked as removed.</span>':"")+
   (canDelete?'<button class="btn danger" id="manage-delete" type="button">Delete this book permanently</button>':book.sourceType!=="pdf"?'<span class="muted">This built-in source is protected.</span>':"")+
  '</div>'+
  (failedOcr?'<div class="notice error" style="margin-top:12px">Last OCR cleanup failed: '+esc(book.visionOcrCleanupError)+'<br>Automatic retries are paused. Run the read-only storage check in Operations, correct the bucket permissions, then retry here. The original PDF, indexed pages and retrieval-ready status have been retained.</div>':"")+
  '<div class="notice">'+(book.status==="deleting"?"Full book deletion is already in progress. The source will disappear from this library when its background workflow completes.":"Direct project access is managed separately from collection access. Archiving pauses retrieval but retains stored data. Deleting the book is permanent and removes its searchable pages and imported storage.")+'</div>';
 $("modal").classList.add("open");
 if(needsInspect)$("manage-inspect").addEventListener("click",()=>showImport(id));
 if(book.status!=="deleting")$("manage-access").addEventListener("click",()=>editBookAccess(id));
 if(canArchive)$("manage-archive").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await archiveBook(id,"archive",button);});
 if(canRestore)$("manage-restore").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await archiveBook(id,"restore",button);});
 if(canDeleteOcr)$("manage-ocr").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await deleteVisionOutput(id,button);});
 if(canDelete)$("manage-delete").addEventListener("click",async event=>{const button=event.currentTarget;$("modal").classList.remove("open");await deleteBook(id,button);});
}
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
function activateView(view){const allowed=["overview","books","collections","projects","operations","governance","applications"];if(!allowed.includes(view))return;document.querySelectorAll("[data-view-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.viewPanel===view));document.querySelectorAll(".nav-item[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===view));}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>activateView(button.dataset.view)));
function openUpload(){activateView("books");$("upload-modal").classList.add("open");}
$("open-upload").addEventListener("click",openUpload);$("open-upload-secondary").addEventListener("click",openUpload);$("open-upload-books").addEventListener("click",openUpload);
$("close-upload").addEventListener("click",()=>$("upload-modal").classList.remove("open"));$("upload-modal").addEventListener("click",event=>{if(event.target===$("upload-modal"))$("upload-modal").classList.remove("open");});
$("close-upload").addEventListener("click",()=>$("upload-modal").classList.remove("open"));$("upload-modal").addEventListener("click",event=>{if(event.target===$("upload-modal"))$("upload-modal").classList.remove("open");});
$("clear-brvin").addEventListener("click",clearAllBrvinBooks);$("upload").addEventListener("click",uploadBook);$("refresh").addEventListener("click",()=>refresh());$("logout").addEventListener("click",async()=>{await fetch("/admin/logout",{method:"POST",credentials:"same-origin"});location.assign("/admin/login");});
$("create-project").addEventListener("click",async()=>{try{const name=$("project-name").value.trim();if(!name)throw new Error("Enter a knowledge project name.");await post("projects",{name,description:$("project-desc").value,ownerLabel:$("project-owner").value,legacyClient:false});$("project-name").value="";$("project-desc").value="";$("project-owner").value="";await refresh();}catch(e){alert(e.message);}});
$("create-application").addEventListener("click",async()=>{
 const button=$("create-application");button.disabled=true;
 try{
  const name=$("application-name").value.trim();if(!name)throw new Error("Enter an application name.");
  const keys=["production","staging","preview"];
  const environments=keys.filter(key=>$("environment-"+key+"-enabled").checked).map(key=>({
   environmentKey:key,
   displayName:key.charAt(0).toUpperCase()+key.slice(1),
   workerName:$("environment-"+key+"-worker").value.trim(),
   workerUrl:$("environment-"+key+"-url").value.trim()
  }));
  if(!environments.length)throw new Error("Select at least one deployment environment.");
  for(const item of environments){
   if(Boolean(item.workerName)!==Boolean(item.workerUrl))throw new Error("For "+item.environmentKey+", enter both the Worker name and HTTPS URL, or leave both blank.");
  }
  await post("applications",{
   name,description:$("application-desc").value,ownerLabel:$("application-owner").value,
   repositoryUrl:$("application-repository").value,repositoryDefaultBranch:$("application-branch").value,
   runtimeProvider:$("application-runtime").value,environments
  });
  $("application-name").value="";$("application-desc").value="";$("application-owner").value="";
  $("application-repository").value="";$("application-branch").value="main";
  $("application-runtime").value="cloudflare-workers";
  for(const key of keys){
   $("environment-"+key+"-enabled").checked=key==="production";
   $("environment-"+key+"-worker").value="";$("environment-"+key+"-url").value="";
  }
  await refresh();
 }catch(error){alert(error.message);}
 finally{button.disabled=false;}
});
$("create-environment").addEventListener("click",async()=>{
 const button=$("create-environment");button.disabled=true;
 try{
  const applicationId=$("environment-application").value;if(!applicationId)throw new Error("Select an active application.");
  const environmentKey=$("environment-key").value.trim();if(!environmentKey)throw new Error("Enter an environment key.");
  const workerName=$("environment-worker").value.trim(),workerUrl=$("environment-url").value.trim();
  if(Boolean(workerName)!==Boolean(workerUrl))throw new Error("Enter both the Worker name and HTTPS URL, or leave both blank.");
  await post("applications/environments",{applicationId,environmentKey,displayName:$("environment-name").value,workerName,workerUrl});
  $("environment-key").value="";$("environment-name").value="";$("environment-worker").value="";$("environment-url").value="";
  await refresh();
 }catch(error){alert(error.message);}
 finally{button.disabled=false;}
});
$("grant-project-button").addEventListener("click",async()=>{
 try{const applicationId=$("grant-application").value,projectId=$("grant-project").value;if(!applicationId||!projectId)throw new Error("Select an active application and project.");await post("applications/grants",{applicationId,projectId});await refresh();}
 catch(error){alert(error.message);}
});
$("connect-refresh").addEventListener("click",async()=>{await refresh();});$("connect-wizard-panel").addEventListener("toggle",()=>{if($("connect-wizard-panel").open)refreshConnectState();});
$("provider-capability-check").addEventListener("click",async()=>{
 try{
  $("provider-capability-result").textContent="Checking live GitHub App permissions, repository coverage and Cloudflare OAuth scopes…";
  const result=await api(API+"connect/capabilities");
  const github=result.github||{},cloudflare=result.cloudflare||{},install=github.installation||{};
  const parts=[];
  if(github.connected){
   const missingApp=github.missingAppPermissions||[];
   const missingInstall=install.missingPermissions||github.missingInstallationPermissions||[];
   parts.push("GitHub App permissions: "+(missingApp.length?"missing "+missingApp.join(", "):"passed")+".");
   parts.push("GitHub installation: "+(install.repositorySelection==="all"?"ALL repositories":"selected repositories only")+"; installation permissions "+(missingInstall.length?"missing "+missingInstall.join(", "):"passed")+".");
   if(github.settingsUrl)$("github-app-settings").href=github.settingsUrl;
   if(install.url)$("github-installation-settings").href=install.url;
   $("github-access-state").textContent=install.repositorySelection==="all"&&!missingApp.length&&!missingInstall.length
    ?"Verified: BRVIN App permissions are approved and the installation covers all repositories."
    :"Action required: open App permissions to approve missing scopes, then set installation repository access to All repositories.";
  }else{
   parts.push("GitHub: "+(github.error||"not connected")+".");
   $("github-access-state").textContent="BRVIN GitHub App permission state could not be verified.";
  }
  if(cloudflare.connected){
   const missing=cloudflare.missingScopes||[];
   parts.push("Cloudflare OAuth: "+(missing.length?"missing "+missing.length+" required scopes":"required scopes passed")+".");
   if(missing.length)parts.push("Missing scope IDs: "+missing.slice(0,14).join(", ")+(missing.length>14?" …":"")+".");
   if(missing.includes("account-api-tokens.write"))parts.push("Legacy Account API Tokens Write scope is missing.");
   else parts.push("Legacy Account API Tokens Write scope is present; live token provisioning was not tested.");
   parts.push("Workers Admin scope: "+(cloudflare.workerAdminScopeGranted?"present":"not granted")+". This is a legacy Project Factory capability, not part of the current knowledge-platform workflow.");
   if(cloudflare.projectFactoryReady!==true)parts.push("The historical Project Factory credential lifecycle is incomplete and is not an active BRVIN requirement.");
  }else parts.push("Cloudflare: "+(cloudflare.error||"not authorized")+".");
  $("provider-capability-result").textContent=parts.join(" ");
 }catch(error){$("provider-capability-result").textContent="Provider check failed: "+error.message;}
});
$("cf-copy-required-scopes").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText($("cf-required-scopes").value);$("cf-worker-note").textContent="Required OAuth scope IDs copied. Add them once to the existing BRVIN Connect OAuth client, then authorize again.";}
 catch(error){$("cf-worker-note").textContent="Clipboard copy unavailable. Select and copy the required scope text.";}
});
$("github-register").addEventListener("click",async()=>{
 try{
  const settingsUrl=connectState?.github?.appSettingsUrl;
  if(settingsUrl){window.open(settingsUrl,"_blank","noopener,noreferrer");return;}
  const data=await post("connect/github/manifest",{});
  const form=document.createElement("form");form.method="POST";form.action=data.action;form.target="_blank";
  const hidden=document.createElement("input");hidden.type="hidden";hidden.name="manifest";hidden.value=JSON.stringify(data.manifest);
  form.appendChild(hidden);document.body.appendChild(form);form.submit();form.remove();
 }catch(error){alert(error.message);}
});
$("cf-save-client").addEventListener("click",async()=>{
 try{
  const clientId=$("cf-client-id").value.trim(),clientSecret=$("cf-client-secret").value;
  if(!clientId||!clientSecret)throw new Error("Enter both Cloudflare OAuth client values.");
  const result=await post("connect/cloudflare/configure",{clientId,clientSecret});
  $("cf-client-secret").value="";$("cf-callback-url").value=result.redirectUri;
  $("cf-worker-note").textContent="Client credentials saved encrypted. Authorize BRVIN next.";
  await refreshConnectState();
 }catch(error){alert(error.message);}
});
$("cf-authorize").addEventListener("click",async()=>{
 try{const result=await post("connect/cloudflare/start",{});window.location.assign(result.authorizationUrl);}
 catch(error){alert(error.message);}
});
$("cf-discover-workers").addEventListener("click",async()=>{
 try{
  const result=await api(API+"connect/cloudflare/workers");
  const names=(result.workers||[]).map(worker=>worker.name);
  $("cf-worker-note").textContent="Same account verified · "+names.length+" Workers discovered · "+(names.includes("brvin-service")?"private brvin-service confirmed":"private brvin-service missing")+".";
  await refreshConnectState();
 }catch(error){$("cf-worker-note").textContent=error.message;alert(error.message);}
});
$("create-collection").addEventListener("click",async()=>{try{await post("collections",{name:$("collection-name").value,description:$("collection-desc").value});$("collection-name").value="";$("collection-desc").value="";await refresh();}catch(e){alert(e.message);}});
$("save-project-access").addEventListener("click",async()=>{try{const projectId=$("project-access").value;if(!projectId)throw new Error("Create or choose a project first.");const collectionIds=[...$("collection-checks").querySelectorAll("input:checked")].map(i=>i.value);await post("projects/collections",{projectId,collectionIds});await refresh();}catch(e){alert(e.message);}});
await refresh();setInterval(async()=>{await refresh();if(activeImportId&&$("modal").classList.contains("open"))await showImport(activeImportId).catch(()=>{});},5000);
</script></body></html>`;
