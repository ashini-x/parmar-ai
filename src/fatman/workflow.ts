import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../config/env";
import { runFatmanReleaseQaForEnv } from "./release-qa-runner";
import { ensureAnalyticsSchema, recordBrvinActivity, setFatmanBookState } from "../analytics/db";
import { FATMAN_PAGE_RETRY_LIMIT, fatmanPageRetryDelay, isTransientFatmanIndexError, shouldPauseAutomaticVisionCleanupRetry } from "./recovery-policy";
import { buildFatmanBookVerificationPages, buildFatmanRetrievalProbes, FATMAN_VERIFICATION_PAGES, isRetryableFatmanQualityFailure } from "./quality";
import { retrieveFatmanContext } from "./retrieval";
import { getGoogleAccessToken } from "../auth/google";
import { fatmanExpectedPageCount, fatmanIndexPageKey } from "./library";
import type { FatmanImportJob } from "./import";
import {
  cleanupFatmanGcsObjects,
  deleteFatmanGcsObjectPrefix,
  ensureFatmanVisionLifecycleRule,
  fatmanImportObjectPrefix,
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
  gcsBucketName,
  getFatmanImportJob,
  getFatmanVisionOperation,
  listFatmanIndexPages,
  listFatmanVisionOutputObjects,
  markFatmanImportCompleted,
  markFatmanImportFailed,
  readFatmanVisionOutput,
  resumeFatmanImport,
  setFatmanImportStatus,
  submitFatmanVision,
  updateFatmanImportProgress,
} from "./import";

interface FatmanImportParams {
  importId: string;
  task?: "resume_index" | "index_chunk" | "repair_chunk" | "cleanup_chunk" | "monitor" | "retry_page" | "quality_check" | "release_qa" | "parmarbot_test" | "delete_book" | "delete_vision_output";
  startPage?: number;
  endPage?: number;
  objectNames?: string[];
  pages?: number[];
  runId?: string;
  monitorSequence?: number;
  repairPass?: number;
  page?: number;
  retryAttempt?: number;
}

function fatmanParamsFromPayload(payload: unknown): FatmanImportParams {
  let value: unknown = payload;
  if (typeof value === "string") {
    const raw = value.trim();
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("The Fatman import workflow received invalid parameters.");
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Fatman import workflow received invalid parameters.");
  }
  const record = value as Record<string, unknown>;
  const importId = record.importId;
  const task = record.task;
  if (typeof importId !== "string" || !/^[a-f0-9-]{36}$/i.test(importId)) {
    throw new Error("The Fatman import workflow received an invalid import ID.");
  }
  if (task !== undefined && task !== "resume_index" && task !== "index_chunk" && task !== "repair_chunk" &&
      task !== "cleanup_chunk" && task !== "monitor" && task !== "retry_page" && task !== "quality_check" && task !== "release_qa" && task !== "parmarbot_test" && task !== "delete_book" && task !== "delete_vision_output") {
    throw new Error("The Fatman import workflow received an invalid task.");
  }
  return {
    importId,
    task: task as FatmanImportParams["task"],
    startPage: typeof record.startPage === "number" ? record.startPage : undefined,
    endPage: typeof record.endPage === "number" ? record.endPage : undefined,
    objectNames: Array.isArray(record.objectNames) && record.objectNames.every((name) => typeof name === "string")
      ? record.objectNames as string[]
      : undefined,
    pages: Array.isArray(record.pages) && record.pages.every((page) => typeof page === "number")
      ? record.pages as number[]
      : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    monitorSequence: typeof record.monitorSequence === "number" ? record.monitorSequence : undefined,
    repairPass: typeof record.repairPass === "number" ? record.repairPass : undefined,
    page: typeof record.page === "number" ? record.page : undefined,
    retryAttempt: typeof record.retryAttempt === "number" ? record.retryAttempt : undefined,
  };
}


async function indexOcrPage(env: Env, job: FatmanImportJob, page: number): Promise<{ page: number; status: string }> {
  const instanceName = env.FATMAN_INSTANCE_NAME?.trim();
  if (!instanceName || !env.FATMAN_SEARCH) throw new Error("Fatman AI Search is not configured.");
  const instance = env.FATMAN_SEARCH.get(instanceName);
  const key = fatmanIndexPageKey(job, page);
  const found = await instance.items.list({ search: key, per_page: 50, source: "builtin" });
  const exact = (found.result ?? []).filter((item) => item.key === key);
  const keep = exact.find((item) => item.status === "completed") ??
    exact.find((item) => item.status === "queued" || item.status === "running");
  for (const item of exact) {
    if (item.id === keep?.id) continue;
    await instance.items.delete(item.id);
  }
  if (keep) return { page, status: keep.status };
  const text = await readFatmanVisionOutput(env, job.id, page);
  const title = job.book_title?.trim() || "Fatman 2nd Edition 2026";
  const content = title + " | PDF page " + page + "\n\n" + text;
  // The shared AI Search instance has no custom_metadata schema. Cloudflare
  // rejects undeclared metadata fields with invalid_metadata_format. Provenance
  // is already losslessly carried by the page key (book UUID + PDF page), while
  // the BRVIN registry (D1) owns title and access-control metadata.
  const indexed = await instance.items.upload(key, content);
  if (indexed.status === "error" || indexed.status === "skipped" || indexed.status === "outdated") {
    throw new Error(indexed.error ? String(indexed.error) : "AI Search rejected PDF page " + page + " with status " + indexed.status + ".");
  }
  return { page, status: indexed.status };
}

/**
 * Autonomous BRVIN recovery supervisor.
 *
 * A deployment can remediate a known permanent indexing defect while a saved
 * Vision OCR result is still available. This supervisor detects only the
 * previously observed invalid_metadata_format failure, waits until the
 * current Workflow instance is terminal, and resumes the existing source
 * without another PDF upload or another Vision OCR charge. It is deliberately
 * capped at two resume events per import to avoid retry loops.
 */
export async function runBrvinRecoverySupervisor(env: Env): Promise<{
  scanned: number; resumed: number; waiting: number; exhausted: number;
}> {
  if (!env.DB || !env.FATMAN_IMPORT) {
    return { scanned: 0, resumed: 0, waiting: 0, exhausted: 0 };
  }
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(
    "SELECT j.id,j.status AS import_status,j.workflow_instance_id,j.error_message AS import_error," +
    "j.updated_at,b.status AS book_status,b.error_message AS book_error " +
    "FROM fatman_import_jobs j JOIN brvin_books b ON b.id=j.book_id " +
    "WHERE j.book_id IS NOT NULL AND j.vision_operation IS NOT NULL " +
    "AND j.uploaded_bytes=j.expected_size " +
    "AND (j.status='failed' OR (j.status='processing' AND b.status='failed')) " +
    "AND (COALESCE(j.error_message,'') LIKE '%invalid_metadata_format%' " +
    "OR COALESCE(b.error_message,'') LIKE '%invalid_metadata_format%') " +
    "ORDER BY j.updated_at ASC LIMIT 20",
  ).all<{
    id: string;
    import_status: string;
    workflow_instance_id: string | null;
    import_error: string | null;
    updated_at: number;
    book_status: string;
    book_error: string | null;
  }>();
  const candidates = result.results ?? [];
  let resumed = 0;
  let waiting = 0;
  let exhausted = 0;
  for (const candidate of candidates) {
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM brvin_activity_events WHERE import_id=? AND event_type='workflow.resumed'",
    ).bind(candidate.id, Date.now() - 60 * 60 * 1000).first<{ count: number }>();
    const resumeCount = Number(attempts?.count ?? 0);
    if (resumeCount >= 2) {
      const prior = await env.DB.prepare(
        "SELECT id FROM brvin_activity_events WHERE import_id=? AND event_type='workflow.recovery_exhausted' LIMIT 1",
      ).bind(candidate.id).first<{ id: number }>();
      if (!prior) {
        await recordBrvinActivity(env, {
          importId: candidate.id,
          agent: "Recovery supervisor",
          phase: "recovery",
          eventType: "workflow.recovery_exhausted",
          status: "failed",
          message: "The automatic metadata-compatibility recovery limit was reached. The saved OCR result is preserved; no further retry loop was started.",
          details: { resumeCount, reason: "invalid_metadata_format" },
        }).catch(() => undefined);
      }
      exhausted += 1;
      continue;
    }

    if (candidate.import_status === "processing") {
      if (!candidate.workflow_instance_id) {
        waiting += 1;
        continue;
      }
      let workflowState: { status: string; error?: { message?: string } };
      try {
        workflowState = await (await env.FATMAN_IMPORT.get(candidate.workflow_instance_id)).status();
      } catch {
        waiting += 1;
        continue;
      }
      const terminal = ["errored", "failed", "terminated", "complete", "completed"].includes(
        String(workflowState.status).toLowerCase(),
      );
      if (!terminal) {
        waiting += 1;
        continue;
      }
      const errorMessage = workflowState.error?.message ??
        candidate.book_error ?? candidate.import_error ?? "The previous indexing workflow ended before the book became ready.";
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE fatman_import_jobs SET status='failed',error_message=?,updated_at=? " +
          "WHERE id=? AND status='processing' AND workflow_instance_id=?",
        ).bind(errorMessage, Date.now(), candidate.id, candidate.workflow_instance_id),
        env.DB.prepare(
          "UPDATE brvin_books SET status='failed',error_message=?,updated_at=? WHERE id=? AND status='failed'",
        ).bind(errorMessage, Date.now(), candidate.id),
      ]);
    }

    const response = await resumeFatmanImport(env, candidate.id);
    let payload: { ok?: boolean; status?: string; error?: string; importId?: string } = {};
    try { payload = await response.json() as typeof payload; } catch { /* retain empty payload */ }
    if (response.ok && payload.ok === true && payload.status === "processing") {
      resumed += 1;
      await recordBrvinActivity(env, {
        importId: candidate.id,
        agent: "Recovery supervisor",
        phase: "recovery",
        eventType: "workflow.auto_recovery_started",
        status: "running",
        message: "The supervisor restarted page indexing from the saved Vision OCR output after the AI Search metadata contract was corrected.",
        details: { resumeCount: resumeCount + 1, ocrReused: true, pdfReuploaded: false },
      }).catch(() => undefined);
    } else {
      waiting += 1;
      await recordBrvinActivity(env, {
        importId: candidate.id,
        agent: "Recovery supervisor",
        phase: "recovery",
        eventType: "workflow.auto_recovery_deferred",
        status: "warning",
        message: "The supervisor deferred automatic recovery because the import state changed or the workflow could not be restarted safely.",
        details: { httpStatus: response.status, error: payload.error ?? null },
      }).catch(() => undefined);
    }
  }
  return { scanned: candidates.length, resumed, waiting, exhausted };
}

async function startBrvinVisionOutputCleanup(env: Env, importId: string, trigger: string): Promise<{ started: boolean; reason?: string; workflowId?: string }> {
  if (!env.DB || !env.FATMAN_IMPORT) return { started: false, reason: "retention_services_unavailable" };
  const now = Date.now();
  const reserved = await env.DB.prepare(
    "UPDATE brvin_books SET vision_output_deletion_started_at=?,updated_at=? " +
    "WHERE id=? AND source_type='pdf' AND status IN ('ready','archived') " +
    "AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NULL " +
    "AND EXISTS (SELECT 1 FROM fatman_import_jobs j JOIN fatman_books f ON f.id=j.id " +
      "WHERE j.id=brvin_books.id AND j.book_id=brvin_books.id AND j.status='completed' " +
      "AND j.uploaded_bytes=j.expected_size AND j.indexed_pages=brvin_books.page_count " +
      "AND f.status=brvin_books.status AND f.indexed_pages=f.page_count)"
  ).bind(now, now, importId).run();
  if ((reserved.meta?.changes ?? 0) !== 1) return { started: false, reason: "not_ready_or_already_cleaned" };
  const workflowId = importId + "-ocr-cleanup-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  try {
    await env.FATMAN_IMPORT.create({ id: workflowId, params: { importId, task: "delete_vision_output" } });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE brvin_books SET vision_output_deletion_started_at=NULL,updated_at=? " +
      "WHERE id=? AND status='ready' AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at=?"
    ).bind(Date.now(), importId, now).run().catch(() => undefined);
    await recordBrvinActivity(env, {
      importId, bookId: importId, agent: "Storage retention supervisor", phase: "retention",
      eventType: "source.vision_ocr_auto_cleanup_deferred", status: "warning",
      message: "The book is ready and its PDF/search index are retained, but the temporary Vision OCR cleanup workflow could not be started. The scheduled retention supervisor will retry.",
      details: { trigger, error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { started: false, reason: "workflow_create_failed" };
  }
  await recordBrvinActivity(env, {
    importId, bookId: importId, agent: "Storage retention supervisor", phase: "retention",
    eventType: "source.vision_ocr_auto_cleanup_started", status: "running",
    message: "Retrieval QA passed. The original PDF, persistent indexed OCR text and project grants are retained; temporary Google Vision JSON is being removed.",
    details: { trigger, workflowId, sourcePdfRetained: true, searchIndexRetained: true, projectGrantsRetained: true },
  }).catch(() => undefined);
  return { started: true, workflowId };
}

/**
 * Retry post-READY OCR cleanup and maintain a 30-day lifecycle safety net for
 * the dedicated temporary Vision prefix. Existing ready books are migrated too.
 */
export async function runBrvinVisionRetentionSupervisor(env: Env): Promise<{ scanned: number; started: number; deferred: number; paused: number; lifecycleRule: string }> {
  if (!env.DB || !env.FATMAN_IMPORT) return { scanned: 0, started: 0, deferred: 0, paused: 0, lifecycleRule: "not_configured" };
  await ensureAnalyticsSchema(env);
  const candidates = await env.DB.prepare(
    "SELECT b.id,b.title,b.updated_at FROM brvin_books b " +
    "JOIN fatman_import_jobs j ON j.id=b.id AND j.book_id=b.id " +
    "JOIN fatman_books f ON f.id=b.id " +
    "WHERE b.source_type='pdf' AND b.status IN ('ready','archived') AND f.status=b.status " +
    "AND j.status='completed' AND j.uploaded_bytes=j.expected_size " +
    "AND j.indexed_pages=b.page_count AND f.indexed_pages=f.page_count " +
    "AND b.vision_output_deleted_at IS NULL AND b.vision_output_deletion_started_at IS NULL " +
    "AND b.updated_at<=? ORDER BY b.updated_at ASC LIMIT 25"
  ).bind(Date.now() - 4 * 60 * 1000).all<{ id: string; title: string; updated_at: number }>();
  const rows = candidates.results ?? [];
  // Verify/install the bucket-level safety net independently of pending books.
  // This keeps retention protection active even when all current OCR outputs
  // have already been cleaned and the candidate list is empty.
  let lifecycleRule = "verified";
  try {
    const lifecycle = await ensureFatmanVisionLifecycleRule(env);
    lifecycleRule = lifecycle.created ? "created" : "verified";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 400);
    lifecycleRule = "deferred: " + message.slice(0, 220);
    if (rows.length) {
      for (const candidate of rows) {
        const prior = await env.DB.prepare(
          "SELECT id FROM brvin_activity_events WHERE book_id=? AND event_type='storage.vision_ocr_expiry_configuration_deferred' AND created_at>=? LIMIT 1"
        ).bind(candidate.id, Date.now() - 24 * 60 * 60 * 1000).first<{ id: number }>();
        if (!prior) await recordBrvinActivity(env, {
          importId: candidate.id, bookId: candidate.id, agent: "Storage retention supervisor",
          phase: "retention", eventType: "storage.vision_ocr_expiry_configuration_deferred", status: "warning",
          message: "Direct post-READY OCR cleanup remains active, but the 30-day GCS lifecycle safety-net rule could not be inspected or installed. Review the bucket permissions and existing Delete rules.",
          details: { error: message, targetPrefix: "brvin/temporary-vision-ocr/", requiredPermissions: ["storage.buckets.get", "storage.buckets.update"] },
        }).catch(() => undefined);
      }
    } else {
      const prior = await env.DB.prepare(
        "SELECT id FROM brvin_activity_events WHERE book_id IS NULL AND event_type='storage.vision_ocr_expiry_configuration_deferred' AND created_at>=? LIMIT 1"
      ).bind(Date.now() - 24 * 60 * 60 * 1000).first<{ id: number }>();
      if (!prior) await recordBrvinActivity(env, {
        agent: "Storage retention supervisor", phase: "retention",
        eventType: "storage.vision_ocr_expiry_configuration_deferred", status: "warning",
        message: "The 30-day GCS OCR lifecycle safety-net rule could not be inspected or installed. Direct cleanup will still run when eligible documents are processed; review bucket permissions and existing Delete rules.",
        details: { error: message, targetPrefix: "brvin/temporary-vision-ocr/", requiredPermissions: ["storage.buckets.get", "storage.buckets.update"] },
      }).catch(() => undefined);
    }
  }
  let started = 0;
  let deferred = 0;
  let paused = 0;
  for (const candidate of rows) {
    const failures = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM brvin_activity_events WHERE book_id=? AND event_type='source.vision_ocr_delete_failed'"
    ).bind(candidate.id).first<{ count: number }>();
    // A failed GCS deletion is usually an IAM/retention-policy issue, not a
    // transient index issue. Stop unattended retries after the first failure;
    // the administrator can diagnose storage permissions and explicitly retry.
    if (shouldPauseAutomaticVisionCleanupRetry(Number(failures?.count ?? 0))) { paused += 1; continue; }
    const result = await startBrvinVisionOutputCleanup(env, candidate.id, "scheduled_retention_supervisor");
    if (result.started) started += 1;
    else if (result.reason === "workflow_create_failed") deferred += 1;
  }
  return { scanned: rows.length, started, deferred, paused, lifecycleRule };
}
export class FatmanImportWorkflow extends WorkflowEntrypoint<Env, FatmanImportParams> {
  async run(event: WorkflowEvent<FatmanImportParams>, step: WorkflowStep): Promise<void> {
    const params = fatmanParamsFromPayload(event.payload);
    const importId = params.importId;
    let importedBook: FatmanImportJob | null = null;
    let expectedPages = 538;
    try {
      const importJob = await getFatmanImportJob(this.env, importId);
      if (!importJob || Number(importJob.uploaded_bytes) !== Number(importJob.expected_size)) {
        throw new Error("The complete private PDF upload could not be verified.");
      }
      importedBook = importJob;
      expectedPages = fatmanExpectedPageCount(importJob);
      if (importJob.book_id) await recordBrvinActivity(this.env, {
        importId, bookId: importJob.book_id, agent: "Workflow orchestrator",
        phase: "workflow", eventType: "workflow.claimed", status: "running",
        message: "The BRVIN processing workflow accepted this book and is coordinating its specialist stages.",
        details: { expectedPages, task: params.task ?? "ingest" },
      }).catch(() => undefined);

      if (params.task === "delete_vision_output") {
        if (!importJob.book_id || importJob.book_id !== importId) {
          throw new Error("Vision-output deletion is only available for a registered BRVIN PDF.");
        }
        const source = await this.env.DB!.prepare(
          "SELECT status,source_type,vision_output_deleted_at,vision_output_deletion_started_at FROM brvin_books WHERE id=? LIMIT 1"
        ).bind(importId).first<{
          status: string;
          source_type: string;
          vision_output_deleted_at: number | null;
          vision_output_deletion_started_at: number | null;
        }>();
        if (!source || source.source_type !== "pdf" || (source.status !== "ready" && source.status !== "archived") ||
            source.vision_output_deleted_at || !source.vision_output_deletion_started_at) {
          throw new Error("The book is not in the reserved OCR-only deletion state.");
        }
        const deletion = await step.do("delete private Google Vision OCR output", async () =>
          deleteFatmanGcsObjectPrefix(this.env, importId, "ocr/"));
        await step.do("persist Vision OCR deletion state", async () => {
          const updated = await this.env.DB!.prepare(
            "UPDATE brvin_books SET vision_output_deleted_at=?,vision_output_deletion_started_at=NULL,updated_at=? " +
            "WHERE id=? AND status IN ('ready','archived') AND vision_output_deleted_at IS NULL AND vision_output_deletion_started_at IS NOT NULL"
          ).bind(Date.now(), Date.now(), importId).run();
          if ((updated.meta?.changes ?? 0) !== 1) {
            throw new Error("The BRVIN OCR deletion marker could not be finalized safely.");
          }
          return { visionOutputDeleted: true };
        });
        await step.do("record Vision OCR output deletion", async () => {
          await recordBrvinActivity(this.env, {
            importId, bookId: importId, agent: "Storage retention supervisor",
            phase: "retention", eventType: "source.vision_ocr_deleted", status: "completed",
            message: "Google Vision OCR JSON output was removed from the private GCS OCR prefix. The original PDF and indexed search pages remain available.",
            details: { ...deletion },
          });
          return deletion;
        });
        return;
      }

      if (params.task === "delete_book") {
        if (!importJob.book_id || importJob.book_id !== importId) {
          throw new Error("This deletion request does not match a registered BRVIN book.");
        }
        const book = await this.env.DB!.prepare(
          "SELECT id,title,source_type,search_prefix,status FROM brvin_books WHERE id=? LIMIT 1"
        ).bind(importId).first<{
          id: string; title: string; source_type: string; search_prefix: string; status: string;
        }>();
        if (!book || book.source_type !== "pdf") {
          throw new Error("Built-in or legacy knowledge sources cannot be deleted through the imported-book control.");
        }
        const allowedSearchPrefixes = [
          "brvin/books/" + importId + "/pages/",
          "fatman/books/" + importId + "/pages/",
        ];
        if (!allowedSearchPrefixes.includes(book.search_prefix)) {
          throw new Error("The indexed-page prefix does not match this book; refusing cross-book deletion.");
        }
        const allowedStoragePrefixes = [
          "brvin/source-pdfs/" + importId + "/",
          "brvin/imports/" + importId + "/",
          "fatman/imports/" + importId + "/",
        ];
        if (!allowedStoragePrefixes.includes(fatmanImportObjectPrefix(importJob))) {
          throw new Error("The private storage prefix does not match this book; refusing cross-book deletion.");
        }
        if (book.status !== "deleting" && book.status !== "delete_failed") {
          throw new Error("The BRVIN book is not in a deletable state.");
        }

        const instance = this.env.FATMAN_SEARCH!.get(this.env.FATMAN_INSTANCE_NAME!.trim());
        const indexedItems = await step.do("inventory only this book's AI Search items", async () => {
          const matches: Array<{ id: string; key: string }> = [];
          let page = 1;
          for (;;) {
            if (page > 10_000) throw new Error("AI Search item inventory exceeded the safety page limit.");
            const response = await instance.items.list({ page, per_page: 100, source: "builtin" });
            const rows = response.result ?? [];
            for (const item of rows) {
              if (item.key.startsWith(book.search_prefix)) matches.push({ id: item.id, key: item.key });
            }
            const totalPages = response.result_info?.total_pages;
            if (typeof totalPages === "number" && totalPages > 0 && page >= totalPages) break;
            if (rows.length < 100) break;
            page += 1;
          }
          return matches;
        });

        for (let offset = 0, batch = 1; offset < indexedItems.length; offset += 25, batch += 1) {
          const items = indexedItems.slice(offset, offset + 25);
          if (items.some(item => !item.key.startsWith(book.search_prefix))) {
            throw new Error("An AI Search deletion batch contained an item outside this book's prefix.");
          }
          await step.do("delete this book's AI Search page batch " + batch, async () => {
            for (const item of items) await instance.items.delete(item.id);
            return { deleted: items.length, keys: items.map(item => item.key) };
          });
        }

        const remainingSearchItems = await step.do("verify this book has no indexed AI Search items", async () => {
          const matches: string[] = [];
          let page = 1;
          for (;;) {
            if (page > 10_000) throw new Error("AI Search verification exceeded the safety page limit.");
            const response = await instance.items.list({ page, per_page: 100, source: "builtin" });
            const rows = response.result ?? [];
            for (const item of rows) if (item.key.startsWith(book.search_prefix)) matches.push(item.key);
            const totalPages = response.result_info?.total_pages;
            if (typeof totalPages === "number" && totalPages > 0 && page >= totalPages) break;
            if (rows.length < 100) break;
            page += 1;
          }
          return matches;
        });
        if (remainingSearchItems.length) {
          throw new Error("AI Search still lists " + remainingSearchItems.length + " page items for this book.");
        }

        const sourceStorageDeletion = await step.do("delete the book source-PDF object versions", async () =>
          deleteFatmanGcsObjectPrefix(this.env, importId, ""));
        const visionStorageDeletion = await step.do("delete the book temporary Vision OCR object versions", async () =>
          deleteFatmanGcsObjectPrefix(this.env, importId, "ocr/"));
        await step.do("record external BRVIN assets removed", async () => {
          await recordBrvinActivity(this.env, {
            importId, bookId: importId, agent: "Deletion supervisor",
            phase: "deletion", eventType: "book.external_assets_deleted", status: "completed",
            message: "The source PDF, temporary Vision OCR output and page-level AI Search items were removed. The BRVIN registry and access-grant cleanup is now running.",
            details: {
              title: book.title,
              searchItemsDeleted: indexedItems.length,
              searchPrefix: book.search_prefix,
              sourceStorage: sourceStorageDeletion,
              visionOcrStorage: visionStorageDeletion,
            },
          });
          return true;
        });

        await this.env.DB!.batch([
          this.env.DB!.prepare("DELETE FROM brvin_project_books WHERE book_id=?").bind(importId),
          this.env.DB!.prepare("DELETE FROM fatman_books WHERE id=?").bind(importId),
          this.env.DB!.prepare("DELETE FROM fatman_import_jobs WHERE id=? AND book_id=?").bind(importId, importId),
          this.env.DB!.prepare("DELETE FROM brvin_books WHERE id=? AND source_type='pdf'").bind(importId),
        ]);
        const remainingBook = await this.env.DB!.prepare(
          "SELECT id FROM brvin_books WHERE id=? LIMIT 1"
        ).bind(importId).first<{ id: string }>();
        const remainingJob = await this.env.DB!.prepare(
          "SELECT id FROM fatman_import_jobs WHERE id=? AND book_id=? LIMIT 1"
        ).bind(importId, importId).first<{ id: string }>();
        if (remainingBook || remainingJob) {
          throw new Error("External assets were deleted but one or more BRVIN/import registry rows remain; retry the deletion to finish database cleanup.");
        }
        await recordBrvinActivity(this.env, {
          importId, bookId: importId, agent: "Deletion supervisor",
          phase: "deletion", eventType: "book.deletion_completed", status: "completed",
          message: "The PDF, Vision OCR output, AI Search pages, project grants, BRVIN book row and import records are deleted. The audit trail and project/collection definitions remain.",
          details: { title: book.title, searchItemsDeleted: indexedItems.length, sourceStorage: sourceStorageDeletion, visionOcrStorage: visionStorageDeletion },
        });
        return;
      }

      if (params.task === "parmarbot_test") {
        if (!importJob.book_id) throw new Error("Parmarbot integration tests require a BRVIN-registered book.");
        const probes = [
          {
            expectedPage: 1,
            query: "rain garden choosing site slope drainage water collection location",
          },
          {
            expectedPage: 2,
            query: "four profile layers plant canopy mulch engineered soil native subsoil",
          },
          {
            expectedPage: 3,
            query: "highest priority post-storm checks clear inlet drawdown overflow route",
          },
        ];
        const verified: Array<{ query: string; expectedPage: number; returnedPage: number; score: number }> = [];
        for (const probe of probes) {
          const context = await step.do("Parmarbot retrieves BRVIN source page " + probe.expectedPage, async () =>
            retrieveFatmanContext(this.env, probe.query));
          const match = context.passages.find((passage) =>
            passage.bookId === importJob.book_id && passage.pdfPage === probe.expectedPage
          );
          if (!match) {
            await recordBrvinActivity(this.env, {
              importId, bookId: importJob.book_id, agent: "Parmarbot integration verifier",
              phase: "bot-test", eventType: "bot.retrieval_probe_failed", status: "failed",
              message: "Parmarbot's project-scoped retrieval did not return the expected Rain Gardens source page.",
              details: {
                expectedPage: probe.expectedPage,
                returnedPages: context.passages.filter(p => p.bookId === importJob.book_id).map(p => p.pdfPage),
                returnedPassages: context.passages.filter(p => p.bookId === importJob.book_id).length,
              },
            }).catch(() => undefined);
            throw new Error("Parmarbot BRVIN retrieval did not return test PDF page " + probe.expectedPage + ".");
          }
          verified.push({
            query: probe.query,
            expectedPage: probe.expectedPage,
            returnedPage: match.pdfPage,
            score: match.score,
          });
          await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Parmarbot integration verifier",
            phase: "bot-test", eventType: "bot.retrieval_probe_passed", status: "completed",
            message: "Parmarbot's live Fatman-mode retrieval helper returned the expected BRVIN page.",
            details: {
              expectedPage: probe.expectedPage,
              returnedPage: match.pdfPage,
              score: match.score,
              searchCount: context.searchCount ?? null,
            },
          }).catch(() => undefined);
        }
        await step.do("Parmarbot integration supervisor records full retrieval pass", async () => {
          await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Parmarbot integration supervisor",
            phase: "bot-test", eventType: "bot.retrieval_test_passed", status: "completed",
            message: "Parmarbot's production retrieval helper passed all three page-grounded BRVIN integration probes.",
            details: {
              projectSlug: "fatman",
              testedPages: verified.map(item => item.returnedPage),
              queryCount: verified.length,
              transportTested: false,
              answerGenerationTested: false,
            },
          });
          return { passed: true, testedPages: verified.map(item => item.returnedPage), queryCount: verified.length };
        });
        return;
      }

      if (params.task === "resume_index") {
        const runId = params.runId;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman index recovery parameters are invalid.");
        }
        const pages = await step.do("find incomplete Fatman index pages", async () =>
          listFatmanIndexPages(this.env, importId));
        const completedPages = new Set(pages
          .filter((item) => item.status === "completed")
          .map((item) => item.page));
        const startPage = Array.from({ length: expectedPages }, (_, index) => index + 1)
          .find((page) => !completedPages.has(page));

        if (startPage === undefined) {
          await step.do("start Fatman indexing monitor after recovery", async () =>
            this.startChild(importId + "-" + runId + "-monitor-1-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "monitor",
              importId,
              runId,
              monitorSequence: 1,
              repairPass: 0,
            }));
        } else {
          const endPage = Math.min(expectedPages, startPage + 7);
          await step.do("start recovered Fatman page chunk " + startPage, async () =>
            this.startChild(importId + "-" + runId + "-page-" + startPage + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "index_chunk",
              importId,
              startPage,
              endPage,
              runId,
            }));
        }
        return;
      }

      if (params.task === "retry_page") {
        const page = params.page;
        const retryAttempt = params.retryAttempt;
        const runId = params.runId;
        if (!Number.isSafeInteger(page) || page! < 1 || page! > expectedPages ||
            !Number.isSafeInteger(retryAttempt) || retryAttempt! < 1 || retryAttempt! > FATMAN_PAGE_RETRY_LIMIT ||
            typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman page-retry parameters are invalid.");
        }

        await step.sleep("cool down before retrying Fatman page " + page + " (attempt " + retryAttempt + ")", fatmanPageRetryDelay(retryAttempt!));
        try {
          await step.do("retry indexing Fatman PDF page " + page, async () =>
            indexOcrPage(this.env, importJob, page!));
        } catch (error) {
          if (!isTransientFatmanIndexError(error)) throw error;
          // After the initial backoff ladder, keep checking every 15 minutes
          // until AI Search recovers. Do not turn an outage into manual work.
          const nextAttempt = Math.min(FATMAN_PAGE_RETRY_LIMIT, retryAttempt! + 1);
          await step.do("schedule Fatman page retry " + nextAttempt, async () =>
            this.startChild(importId + "-" + runId + "-retry-page-" + page + "-" + nextAttempt + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "retry_page",
              importId,
              page,
              retryAttempt: nextAttempt,
              runId,
            }));
          return;
        }

        await step.do("resume Fatman supervisor after page " + page + " recovers", async () =>
          this.startChild(importId + "-" + runId + "-resume-after-" + page + "-" + retryAttempt + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
            task: "resume_index",
            importId,
            runId,
          }));
        return;
      }

      if (params.task === "index_chunk") {
        const startPage = params.startPage;
        const endPage = params.endPage;
        const runId = params.runId;
        if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) ||
            startPage! < 1 || endPage! > expectedPages || endPage! < startPage! || endPage! - startPage! >= 8 ||
            typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman page chunk parameters are invalid.");
        }
        if (importJob.book_id) {
          await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Index contract validator",
            phase: "indexing", eventType: "index.metadata_strategy", status: "completed",
            message: "Page and book provenance will be carried by the BRVIN page key and registry; no undeclared AI Search custom metadata is sent.",
            details: { strategy: "page_key_and_brvin_registry", metadataFields: 0 },
          }).catch(() => undefined);
          await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Page indexing specialist",
            phase: "indexing", eventType: "index.chunk_started", status: "running",
            message: "Indexing PDF pages " + startPage + "–" + endPage + ".",
            details: { startPage, endPage, expectedPages },
          }).catch(() => undefined);
        }
        for (let page = startPage!; page <= endPage!; page += 1) {
          const pageNumber = page;
          try {
            await step.do("index Fatman PDF page " + pageNumber, async () =>
              indexOcrPage(this.env, importJob, pageNumber));
            if (importJob.book_id) await recordBrvinActivity(this.env, {
              importId, bookId: importJob.book_id, agent: "Page indexing specialist",
              phase: "indexing", eventType: "index.page_completed", status: "completed",
              message: "Page " + pageNumber + " was added to the BRVIN search index.",
              details: { page: pageNumber, totalPages: expectedPages },
            }).catch(() => undefined);
          } catch (error) {
            if (!isTransientFatmanIndexError(error)) throw error;
            if (importJob.book_id) await recordBrvinActivity(this.env, {
              importId, bookId: importJob.book_id, agent: "Recovery specialist",
              phase: "recovery", eventType: "index.page_retry_scheduled", status: "warning",
              message: "Page " + pageNumber + " encountered a transient indexing issue; it has been handed to recovery.",
              details: { page: pageNumber, error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) },
            }).catch(() => undefined);
            await step.do("hand Fatman page " + pageNumber + " to the recovery specialist", async () =>
              this.startChild(importId + "-" + runId + "-retry-page-" + pageNumber + "-1-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
                task: "retry_page",
                importId,
                page: pageNumber,
                retryAttempt: 1,
                runId,
              }));
            return;
          }
        }

        if (endPage! < expectedPages) {
          const nextStart = endPage! + 1;
          const nextEnd = Math.min(expectedPages, nextStart + 7);
          await step.do("start next Fatman page chunk " + nextStart, async () =>
            this.startChild(importId + "-" + runId + "-page-" + nextStart + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "index_chunk",
              importId,
              startPage: nextStart,
              endPage: nextEnd,
              runId,
            }));
        } else {
          await step.do("start Fatman indexing monitor", async () =>
            this.startChild(importId + "-" + runId + "-monitor-1-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "monitor",
              importId,
              runId,
              monitorSequence: 1,
              repairPass: 0,
            }));
        }
        return;
      }

      if (params.task === "repair_chunk") {
        const pages = params.pages ?? [];
        const runId = params.runId;
        const monitorSequence = params.monitorSequence;
        const repairPass = params.repairPass ?? 0;
        if (pages.length < 1 || pages.length > 10 ||
            pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > expectedPages) ||
            typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId) ||
            !Number.isSafeInteger(monitorSequence) || monitorSequence! < 1 ||
            !Number.isSafeInteger(repairPass) || repairPass < 1 || repairPass > 12) {
          throw new Error("The Fatman repair task parameters are invalid.");
        }
        for (const page of [...new Set(pages)]) {
          try {
            await step.do("repair Fatman PDF page " + page, async () => indexOcrPage(this.env, importJob, page));
          } catch (error) {
            if (!isTransientFatmanIndexError(error)) throw error;
            await step.do("hand failed repair page " + page + " to the recovery specialist", async () =>
              this.startChild(importId + "-" + runId + "-retry-page-" + page + "-1-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
                task: "retry_page",
                importId,
                page,
                retryAttempt: 1,
                runId,
              }));
            return;
          }
        }
        await step.do("continue Fatman index monitoring", async () =>
          this.startChild(importId + "-" + runId + "-monitor-" + monitorSequence, {
            task: "monitor",
            importId,
            runId,
            monitorSequence,
            repairPass,
          }));
        return;
      }

      if (params.task === "quality_check") {
        const runId = params.runId;
        const retryAttempt = params.retryAttempt ?? 0;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId) ||
            !Number.isSafeInteger(retryAttempt) || retryAttempt < 0 || retryAttempt > FATMAN_PAGE_RETRY_LIMIT) {
          throw new Error("The Fatman retrieval quality-check parameters are invalid.");
        }

        if (importJob.book_id) await recordBrvinActivity(this.env, {
          importId, bookId: importJob.book_id, agent: "Retrieval QA specialist",
          phase: "verification", eventType: "qa.started", status: "running",
          message: "Page-grounded retrieval QA is checking whether indexed content can be retrieved from its original PDF pages.",
          details: { retryAttempt, expectedPages },
        }).catch(() => undefined);
        await step.sleep(
          "wait before Fatman retrieval quality check " + retryAttempt,
          retryAttempt === 0 ? "1 minute" : fatmanPageRetryDelay(retryAttempt),
        );
        let verification: { checkedPages: number[]; queryCount: number };
        try {
          verification = await step.do("verify page-grounded retrieval for this book", async () => {
            const instanceName = this.env.FATMAN_INSTANCE_NAME?.trim();
            if (!instanceName || !this.env.FATMAN_SEARCH) throw new Error("Fatman AI Search is not configured.");
            const instance = this.env.FATMAN_SEARCH.get(instanceName);
            const checkedPages: number[] = [];
            const pageResults: Array<{ page: number; successfulProbe: number }> = [];
            const verificationPages = importJob.book_id
              ? buildFatmanBookVerificationPages(expectedPages)
              : [...FATMAN_VERIFICATION_PAGES];
            const requiredMatches = importJob.book_id ? Math.min(3, expectedPages) : verificationPages.length;
            let queryCount = 0;
            for (const page of verificationPages) {
              const text = await readFatmanVisionOutput(this.env, importId, page);
              let probes: string[];
              try {
                probes = buildFatmanRetrievalProbes(text);
              } catch (error) {
                // Covers, blank pages and sparse front matter are not useful
                // retrieval evidence; continue to the next distributed sample.
                if (importJob.book_id && error instanceof Error && error.message.includes("fewer than six OCR words")) continue;
                throw error;
              }
              const expectedKey = fatmanIndexPageKey(importJob, page);
              let matchedProbe = 0;
              for (let index = 0; index < probes.length; index += 1) {
                queryCount += 1;
                const result = await instance.search({
                  messages: [{ role: "user", content: probes[index] }],
                  ai_search_options: { retrieval: { max_num_results: 50, retrieval_type: "hybrid" } },
                });
                const matched = (result.chunks ?? []).some((chunk) => chunk.item?.key === expectedKey);
                if (matched) {
                  matchedProbe = index + 1;
                  break;
                }
              }
              if (!matchedProbe) {
                throw new Error("Fatman retrieval QA could not match the expected source page " + page + " after " + probes.length + " page-grounded queries.");
              }
              checkedPages.push(page);
              pageResults.push({ page, successfulProbe: matchedProbe });
              if (importJob.book_id && checkedPages.length >= requiredMatches) break;
            }
            if (importJob.book_id && checkedPages.length < requiredMatches) {
              throw new Error("Fatman retrieval QA could not build enough OCR probes from readable pages.");
            }
            return { checkedPages, pageResults, queryCount };
          });
        } catch (error) {
          if (!isRetryableFatmanQualityFailure(error)) throw error;
          // Keep the final delay capped at 15 minutes and retry unattended.
          const nextAttempt = Math.min(FATMAN_PAGE_RETRY_LIMIT, retryAttempt + 1);
          await step.do("schedule book retrieval verification retry " + nextAttempt, async () =>
            this.startChild(importId + "-" + runId + "-quality-" + nextAttempt + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "quality_check",
              importId,
              runId,
              retryAttempt: nextAttempt,
            }));
          return;
        }

        if (importJob.book_id) await recordBrvinActivity(this.env, {
          importId, bookId: importJob.book_id, agent: "Retrieval QA specialist",
          phase: "verification", eventType: "qa.passed", status: "completed",
          message: "Page-grounded retrieval QA passed. BRVIN can now expose this book to explicitly assigned projects.",
          details: { checkedPages: verification.checkedPages, queryCount: verification.queryCount },
        }).catch(() => undefined);
        let shouldCleanup = true;
        if (importJob.book_id) {
          await step.do("mark additional book ready after retrieval verification", async () => {
            await markFatmanImportCompleted(this.env, importId);
            return { ready: true, checkedPages: verification.checkedPages };
          });
          await step.do("schedule automatic temporary Vision OCR cleanup after READY", async () =>
            startBrvinVisionOutputCleanup(this.env, importId, "retrieval_qa_passed"));
        } else {
          const releaseQa = await step.do("run six-category real-user Fatman release QA", async () =>
            runFatmanReleaseQaForEnv(this.env, importId + "-" + runId + "-release-qa-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8)));

          await step.do("release supervisor applies the six-category QA decision", async () => {
            await markFatmanImportCompleted(this.env, importId);
            await setFatmanBookState(this.env, {
              enabled: releaseQa.status === "passed",
              documentVersion: this.env.FATMAN_DOCUMENT_VERSION?.trim() ?? "",
              indexedPages: expectedPages,
            });
            return {
              enabled: releaseQa.status === "passed",
              qaStatus: releaseQa.status,
              passedCases: releaseQa.passedCases,
              totalCases: releaseQa.totalCases,
              failedCases: releaseQa.failedCases,
            };
          });
          shouldCleanup = releaseQa.status === "passed";
        }

        // BRVIN is a governed, reusable knowledge repository: retain its original
        // PDF and OCR output after QA so future consumers, audits and re-indexing
        // do not require another user upload or another Vision OCR charge.
        // Only the legacy one-off Fatman release keeps its historical temp cleanup.
        if (importJob.book_id) {
          await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Source retention supervisor",
            phase: "retention", eventType: "source.pdf_and_index_retained", status: "completed",
            message: "The original PDF and persistent AI Search page text/index remain stored. Temporary Vision OCR JSON is automatically removed after READY; the separate source-PDF prefix is never included in OCR expiry.",
            details: {
              sourcePrefix: fatmanImportObjectPrefix(importJob),
              visionOutputPrefix: "brvin/temporary-vision-ocr/" + importId + "/",
              deletion: "automatic_after_retrieval_qa",
              sourcePdfRetained: true,
              searchablePageTextRetained: true,
            },
          }).catch(() => undefined);
          return;
        }

        // Preserve legacy Fatman cleanup behavior after its release QA passes.
        if (!shouldCleanup) return;

        try {
          const objectNames = await step.do("list temporary Fatman OCR objects after activation", async () =>
            cleanupFatmanGcsObjects(this.env, importId));
          for (let offset = 0, batch = 1; offset < objectNames.length; offset += 25, batch += 1) {
            const names = objectNames.slice(offset, offset + 25);
            await step.do("start Fatman post-activation cleanup batch " + batch, async () =>
              this.startChild(importId + "-" + runId + "-cleanup-" + batch, {
                task: "cleanup_chunk",
                importId,
                objectNames: names,
              }));
          }
        } catch {
          // Book mode is ready. Temporary OCR output can be removed by the bucket lifecycle policy.
        }
        return;
      }

      if (params.task === "release_qa") {
        const runId = params.runId;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman release QA parameters are invalid.");
        }
        const report = await step.do("run scheduled six-category Fatman regression QA", async () =>
          runFatmanReleaseQaForEnv(this.env, importId + "-" + runId + "-release-qa"));
        await step.do("release supervisor reconciles live book-mode access", async () => {
          await setFatmanBookState(this.env, {
            enabled: report.status === "passed",
            documentVersion: this.env.FATMAN_DOCUMENT_VERSION?.trim() ?? "",
            indexedPages: expectedPages,
          });
          return {
            enabled: report.status === "passed",
            status: report.status,
            passedCases: report.passedCases,
            totalCases: report.totalCases,
            failedCases: report.failedCases,
          };
        });
        return;
      }

      if (params.task === "monitor") {
        const runId = params.runId;
        const monitorSequence = params.monitorSequence ?? 1;
        const repairPass = params.repairPass ?? 0;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId) ||
            !Number.isSafeInteger(monitorSequence) || monitorSequence < 1 ||
            !Number.isSafeInteger(repairPass) || repairPass < 0 || repairPass > 12) {
          throw new Error("The Fatman index monitor parameters are invalid.");
        }

        await step.sleep("wait before Fatman indexing check " + monitorSequence, "1 minute");
        const pages = await step.do("check Fatman index status " + monitorSequence, async () =>
          listFatmanIndexPages(this.env, importId));
        const byPage = new Map<number, { page: number; status: string; error?: string }>();
        for (const item of pages) byPage.set(item.page, item);
        const completedPages = pages.filter((item) => item.status === "completed").length;
        const failedPages = pages.filter((item) =>
          item.status === "error" || item.status === "skipped" || item.status === "outdated");
        await step.do("save Fatman indexing progress " + monitorSequence, async () => {
          await updateFatmanImportProgress(this.env, completedPages, importId);
          if (importJob.book_id) await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Index monitor specialist",
            phase: "indexing", eventType: "index.monitor_pass", status: failedPages.length ? "warning" : "running",
            message: "Index monitor checked " + completedPages + " of " + expectedPages + " pages; " + failedPages.length + " failed pages need attention.",
            details: { completedPages, expectedPages, failedPages: failedPages.length, monitorSequence, repairPass },
          });
          return { completedPages, failedPages: failedPages.length };
        });

        if (completedPages === expectedPages && failedPages.length === 0) {
          await step.do("launch autonomous Fatman retrieval quality verifier", async () =>
            this.startChild(importId + "-" + runId + "-quality-0-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8), {
              task: "quality_check",
              importId,
              runId,
              retryAttempt: 0,
            }));
          return;
        }

        const missingPages = Array.from({ length: expectedPages }, (_, index) => index + 1)
          .filter((page) => !byPage.has(page));
        const repairPages = [...new Set([...failedPages.map((item) => item.page), ...missingPages])].slice(0, 10);
        if (repairPages.length > 0) {
          const nextSequence = monitorSequence + 1;
          const nextRepairPass = Math.min(12, repairPass + 1);
          await step.do("repair missing Fatman page batch " + nextSequence, async () =>
            this.startChild(importId + "-" + runId + "-repair-" + monitorSequence, {
              task: "repair_chunk",
              importId,
              pages: repairPages,
              runId,
              monitorSequence: nextSequence,
              repairPass: nextRepairPass,
            }));
          return;
        }

        const nextSequence = monitorSequence + 1;
        await step.do("schedule next Fatman index check " + nextSequence, async () =>
          this.startChild(importId + "-" + runId + "-monitor-" + nextSequence, {
            task: "monitor",
            importId,
            runId,
            monitorSequence: nextSequence,
            repairPass,
          }));
        return;
      }

      if (params.task === "cleanup_chunk") {
        const objectNames = params.objectNames ?? [];
        const prefix = importedBook ? fatmanImportObjectPrefix(importedBook) : "fatman/imports/" + importId + "/";
        if (objectNames.length > 25 || objectNames.some((name) => !name.startsWith(prefix))) {
          throw new Error("The Fatman cleanup chunk is invalid.");
        }
        await step.do("delete temporary Fatman OCR object batch", async () => {
          await this.deleteObjects(objectNames);
          return { deleted: objectNames.length };
        });
        return;
      }

      const operationName = await step.do("submit Google Vision OCR", async () => submitFatmanVision(this.env, importId));
      let visionDone = false;
      for (let attempt = 1; attempt <= 120; attempt += 1) {
        await step.sleep("wait for Google Vision " + attempt, "30 seconds");
        const expectedOutputUri = "gs://" + gcsBucketName(this.env) + "/" + fatmanVisionOutputPrefix(importJob);
        const result = await step.do("check Google Vision " + attempt, async =>
          getFatmanVisionOperation(this.env, operationName, expectedOutputUri));
        if (result.error) throw new Error(result.error);
        if (result.done) {
          const outputInventory = await step.do("verify Google Vision GCS output files", async =>
            listFatmanVisionOutputObjects(this.env, importJob));
          const outputNames = new Set(outputInventory.objects.map(item => item.name));
          const expectedOutputNames = Array.from({ length: expectedPages }, (_, index) =>
            fatmanOutputObjectName(importId, index + 1, fatmanVisionOutputPrefix(importJob)));
          const missingOutputNames = expectedOutputNames.filter(name => !outputNames.has(name));
          if (missingOutputNames.length) {
            const observed = outputInventory.objects.map(item => item.name).slice(0, 10);
            throw new Error(
              "Google Vision marked OCR complete and reported the expected destination, but " +
              missingOutputNames.length + " of " + expectedPages +
              " page JSON output file(s) are missing from Cloud Storage. Missing: " +
              missingOutputNames.slice(0, 5).join(", ") +
              (observed.length ? ". Objects found: " + observed.join(", ") : ". No objects were found under " + outputInventory.prefix) +
              (outputInventory.truncated ? " (object listing truncated)." : ".")
            );
          }
          if (importJob.book_id) await recordBrvinActivity(this.env, {
            importId, bookId: importJob.book_id, agent: "Vision output verifier",
            phase: "ocr", eventType: "ocr.output_verified", status: "completed",
            message: "All expected per-page Google Vision JSON output files are present in the registered temporary GCS prefix.",
            details: {
              expectedPages,
              outputFiles: expectedOutputNames.map(name => name.split("/").pop()),
              destination: outputInventory.prefix,
            },
          }).catch(() => undefined);
          visionDone = true;
          break;
        }
      }
      if (!visionDone) throw new Error("Google Vision OCR did not finish within one hour.");

      if (importJob.book_id) await recordBrvinActivity(this.env, {
        importId, bookId: importJob.book_id, agent: "Vision OCR specialist",
        phase: "ocr", eventType: "ocr.completed", status: "completed",
        message: "Google Cloud Vision completed document text detection for the uploaded PDF.",
        details: { expectedPages },
      }).catch(() => undefined);
      await step.do("confirm all Vision pages are ready", async () => {
        await setFatmanImportStatus(this.env, importId, "processing");
        return { ready: true };
      });

      const indexingRunId = await step.do("create Fatman indexing run ID", async () =>
        crypto.randomUUID().replaceAll("-", "").slice(0, 8));
      await step.do("start first Fatman page chunk", async () =>
        this.startChild(importId + "-" + indexingRunId + "-page-1", {
          task: "index_chunk",
          importId,
          startPage: 1,
          endPage: Math.min(8, expectedPages),
          runId: indexingRunId,
        }));
      return;
    } catch (error) {
      if (params.task === "quality_check" || params.task === "release_qa") {
        if (importedBook?.book_id) {
          // Additional books remain separate from the original Fatman rollout gate.
          await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
        } else {
          await setFatmanBookState(this.env, {
            enabled: false,
            documentVersion: this.env.FATMAN_DOCUMENT_VERSION?.trim() ?? "",
            indexedPages: expectedPages,
          }).catch(() => undefined);
          if (params.task === "quality_check") {
            await markFatmanImportCompleted(this.env, importId).catch(() => undefined);
          }
        }
      } else if (params.task === "delete_book") {
        const message = error instanceof Error ? error.message : String(error);
        await this.env.DB?.batch([
          this.env.DB.prepare("UPDATE brvin_books SET status='delete_failed',error_message=?,updated_at=? WHERE id=?")
            .bind(message.slice(0, 400), Date.now(), importId),
          this.env.DB.prepare("UPDATE fatman_import_jobs SET status='delete_failed',error_message=?,updated_at=? WHERE id=?")
            .bind(message.slice(0, 400), Date.now(), importId),
        ]).catch(() => undefined);
        await recordBrvinActivity(this.env, {
          importId, bookId: importedBook?.book_id ?? importId, agent: "Deletion supervisor",
          phase: "deletion", eventType: "book.deletion_failed", status: "failed",
          message: "Book deletion stopped safely; the source remains inaccessible and the admin can retry after resolving the reported issue.",
          details: { error: message.slice(0, 400), retryable: true },
        }).catch(() => undefined);
      } else if (params.task === "delete_vision_output") {
        const message = error instanceof Error ? error.message : String(error);
        await this.env.DB?.prepare(
          "UPDATE brvin_books SET vision_output_deletion_started_at=NULL,updated_at=? " +
          "WHERE id=? AND vision_output_deleted_at IS NULL"
        ).bind(Date.now(), importId).run().catch(() => undefined);
        await recordBrvinActivity(this.env, {
          importId, bookId: importedBook?.book_id ?? importId, agent: "Storage retention supervisor",
          phase: "retention", eventType: "source.vision_ocr_delete_failed", status: "failed",
          message: "Vision OCR output could not be fully deleted; the original PDF and indexed book remain unchanged. Automatic retries are paused until storage permissions are corrected and an administrator retries cleanup.",
          details: { error: message.slice(0, 400), retryable: true, automaticRetryPaused: true, manualRetryAvailable: true },
        }).catch(() => undefined);
      } else if (params.task !== "cleanup_chunk" && params.task !== "parmarbot_test") {
        await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
      }
      if (importedBook?.book_id) await recordBrvinActivity(this.env, {
        importId, bookId: importedBook.book_id, agent: "Workflow supervisor",
        phase: "workflow", eventType: "workflow.exception", status: "failed",
        message: "A BRVIN processing stage stopped: " + (error instanceof Error ? error.message : String(error)).slice(0, 400),
        details: { task: params.task ?? "ingest" },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async startChild(id: string, params: FatmanImportParams): Promise<string> {
    let previousWorkflowId: string | null = null;
    let pointerReserved = false;

    // Reserve the D1 pointer BEFORE creating the child. A Workflow can start
    // immediately after create() returns; updating afterwards lets a parent
    // overwrite the newer child's pointer with its own already-completed ID.
    if (this.env.DB && params.task !== "cleanup_chunk") {
      try {
        const previous = await this.env.DB.prepare(
          "SELECT workflow_instance_id FROM fatman_import_jobs WHERE id = ? AND status = 'processing'"
        ).bind(params.importId).first<{ workflow_instance_id: string | null }>();
        if (previous) {
          previousWorkflowId = previous.workflow_instance_id;
          const update = await this.env.DB.prepare(
            "UPDATE fatman_import_jobs SET workflow_instance_id = ?, updated_at = ? WHERE id = ? AND status = 'processing'"
          ).bind(id, Date.now(), params.importId).run();
          pointerReserved = (update.meta?.changes ?? 0) > 0;
        }
      } catch {
        // Workflow execution remains authoritative if the monitoring pointer is unavailable.
      }
    }

    try {
      try {
        return (await this.env.FATMAN_IMPORT!.create({ id, params })).id;
      } catch (error) {
        try {
          return (await this.env.FATMAN_IMPORT!.get(id)).id;
        } catch {
          if (pointerReserved && this.env.DB) {
            await this.env.DB.prepare(
              "UPDATE fatman_import_jobs SET workflow_instance_id = ?, updated_at = ? WHERE id = ? AND workflow_instance_id = ? AND status = 'processing'"
            ).bind(previousWorkflowId, Date.now(), params.importId, id).run().catch(() => undefined);
          }
          throw error;
        }
      }
    } catch (error) {
      if (pointerReserved && this.env.DB) {
        await this.env.DB.prepare(
          "UPDATE fatman_import_jobs SET workflow_instance_id = ?, updated_at = ? WHERE id = ? AND workflow_instance_id = ? AND status = 'processing'"
        ).bind(previousWorkflowId, Date.now(), params.importId, id).run().catch(() => undefined);
      }
      throw error;
    }
  }

  private async deleteObjects(objectNames: string[]): Promise<void> {
    const bucket = this.env.FATMAN_GCS_BUCKET?.trim();
    if (!bucket) throw new Error("Fatman OCR bucket is not configured.");
    const token = await getGoogleAccessToken(this.env);
    for (const name of objectNames) {
      const response = await fetch("https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(bucket) + "/o/" + encodeURIComponent(name), {
        method: "DELETE",
        headers: { authorization: "Bearer " + token },
      });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete a temporary Google Cloud Storage OCR object (HTTP " + response.status + ").");
    }
  }
}
