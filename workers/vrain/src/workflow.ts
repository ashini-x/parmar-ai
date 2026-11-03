import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env, VrainDocument } from "./types";
import {
  getObjectMetadata,
  getVisionOperation,
  googleRetryMessage,
  isRetryableGoogleError,
  listObjects,
  readJsonObject,
  readTextObject,
  streamObjectSha256,
  submitVisionPdf,
  uploadTextObject,
} from "./google";

const MAX_ATTEMPTS_PER_WORKFLOW = 8;
const RETRY_DELAYS = ["30 seconds", "1 minute", "2 minutes", "4 minutes", "8 minutes", "15 minutes"] as const;

interface VisionOutput {
  context?: { pageNumber?: number };
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
    error?: { message?: string };
  }>;
}

interface DocumentJob {
  documentId: string;
}

class RetryHandoffError extends Error {
  constructor(readonly stage: string, message: string) {
    super(message);
    this.name = "RetryHandoffError";
  }
}

function safeError(error: unknown): string {
  return googleRetryMessage(error).slice(0, 300);
}

function retryDelay(attempt: number): typeof RETRY_DELAYS[number] {
  return RETRY_DELAYS[Math.min(RETRY_DELAYS.length - 1, Math.max(0, attempt - 1))];
}

function isRetryable(error: unknown): boolean {
  if (isRetryableGoogleError(error)) return true;
  const message = safeError(error).toLowerCase();
  return /fetch failed|network|timeout|timed out|temporarily unavailable|http 408|http 409|http 429|http 5\d\d|search index.*not ready|index is not yet returning|indexing is still/iu.test(message);
}

async function getDocument(env: Env, documentId: string): Promise<VrainDocument> {
  const document = await env.DB.prepare("SELECT * FROM vrain_documents WHERE id = ?")
    .bind(documentId).first<VrainDocument>();
  if (!document) throw new NonRetryableError("VRAIN document does not exist.");
  return document;
}

async function recordEvent(
  env: Env,
  documentId: string,
  specialist: string,
  stage: string,
  eventType: string,
  status: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now();
  const document = await env.DB.prepare("SELECT collection_id FROM vrain_documents WHERE id=?")
    .bind(documentId).first<{ collection_id: string }>();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO vrain_activity_events (job_id,document_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(documentId, documentId, specialist, stage, eventType, status, message, JSON.stringify(details), now),
    env.DB.prepare("UPDATE vrain_documents SET updated_at=? WHERE id=?").bind(now, documentId),
    env.DB.prepare(
      "UPDATE vrain_jobs SET stage=?,last_heartbeat_at=?,attempt=MAX(attempt,?) WHERE document_id=?",
    ).bind(stage, now, Number(details.attempt ?? 0), documentId),
  ]);
  void document;
}

async function updateDocument(
  env: Env,
  documentId: string,
  values: Partial<Pick<VrainDocument, "status" | "vision_operation" | "workflow_instance_id" | "indexed_pages" | "error_code" | "error_message" | "published_at">> & Record<string, unknown>,
): Promise<void> {
  const allowed = [
    "status", "vision_operation", "workflow_instance_id", "indexed_pages",
    "error_code", "error_message", "published_at", "vision_output_prefix",
    "ocr_repair_attempts",
  ] as const;
  const entries = Object.entries(values).filter(([key]) => (allowed as readonly string[]).includes(key));
  if (!entries.length) return;
  const assignments = entries.map(([key]) => key + "=?").join(",");
  await env.DB.prepare("UPDATE vrain_documents SET " + assignments + ",updated_at=? WHERE id=?")
    .bind(...entries.map(([, value]) => value), Date.now(), documentId).run();
}

async function runWithRecovery<T>(
  env: Env,
  step: WorkflowStep,
  documentId: string,
  stage: string,
  specialist: string,
  action: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_WORKFLOW; attempt += 1) {
    try {
      await recordEvent(env, documentId, specialist, stage, stage + ".attempt_started", "running",
        specialist + " is executing " + stage + ".", { attempt });
      const value = await step.do(
        stage + " attempt " + attempt,
        { retries: { limit: 0, delay: "1 second" }, timeout: "30 minutes" },
        async () => (await action(attempt)) as never,
      );
      return value as T;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw new NonRetryableError(safeError(error));
      const message = safeError(error);
      await step.do("record " + stage + " retry " + attempt, async () => {
        await recordEvent(env, documentId, "Recovery specialist", stage, "recovery.retry_scheduled", "warning",
          "A recoverable error was detected. VRAIN will repair or retry this stage automatically.",
          { attempt, error: message, nextDelay: retryDelay(attempt) });
      });
      if (attempt < MAX_ATTEMPTS_PER_WORKFLOW) {
        await step.sleep("cooldown " + stage + " retry " + attempt, retryDelay(attempt));
      }
    }
  }
  throw new RetryHandoffError(stage, safeError(lastError));
}

function pageRangeFromObjectName(name: string): { start: number; end: number } | undefined {
  const match = /output-(\d+)-to-(\d+)\.json$/iu.exec(name);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return undefined;
  return { start, end };
}

function normalizeOcrText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/gu, "").replace(/\r\n?/gu, "\n").trim().slice(0, 120_000);
}

async function readVisionPageText(env: Env, objectName: string, page: number): Promise<string> {
  const output = await readJsonObject<VisionOutput>(env, objectName);
  const contextPage = Number(output.context?.pageNumber ?? page);
  if (contextPage !== page) throw new Error("Google Vision returned an unexpected PDF page number.");
  const response = output.responses?.[0];
  if (response?.error?.message) {
    throw new Error("Google Vision reported a page extraction error on PDF page " + page + ": " + response.error.message);
  }
  return normalizeOcrText(response?.fullTextAnnotation?.text);
}

function buildProbe(text: string): string | undefined {
  const words = text
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((word) => word.length >= 3);
  if (words.length < 6) return undefined;
  const start = Math.max(0, Math.floor(words.length / 2) - 6);
  return words.slice(start, start + 12).join(" ").slice(0, 240);
}

function verificationPages(pageCount: number): number[] {
  const ratios = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1];
  return [...new Set(ratios.map((ratio) =>
    Math.max(1, Math.min(pageCount, Math.ceil(pageCount * ratio))),
  ))];
}

async function markWaitingRetry(env: Env, documentId: string, stage: string, error: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE vrain_documents SET status='waiting_retry',error_code='RECOVERABLE',error_message=?,updated_at=? WHERE id=?")
      .bind(error, now, documentId),
    env.DB.prepare("UPDATE vrain_jobs SET state='waiting_retry',stage=?,next_retry_at=?,last_heartbeat_at=?,error_code='RECOVERABLE',error_message=? WHERE document_id=?")
      .bind(stage, now + 5 * 60_000, now, error, documentId),
    env.DB.prepare(
      "INSERT INTO vrain_activity_events (job_id,document_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(documentId, documentId, "Recovery supervisor", stage, "recovery.handoff", "warning",
      "This workflow reached its safe retry budget. The job remains queued for automatic recovery; no owner action is required.",
      JSON.stringify({ error, nextCheck: now + 5 * 60_000 }), now),
  ]);
}

async function markFailed(env: Env, documentId: string, error: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE vrain_documents SET status='failed',error_code='NON_RETRYABLE',error_message=?,updated_at=? WHERE id=?")
      .bind(error, now, documentId),
    env.DB.prepare("UPDATE vrain_jobs SET state='failed',error_code='NON_RETRYABLE',error_message=?,last_heartbeat_at=?,completed_at=? WHERE document_id=?")
      .bind(error, now, now, documentId),
    env.DB.prepare(
      "INSERT INTO vrain_activity_events (job_id,document_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(documentId, documentId, "Final supervisor", "processing", "workflow.blocked", "failed",
      "The source or configuration has a non-retryable blocker. The source was not published.",
      JSON.stringify({ error }), now),
  ]);
}

export class VrainIngestWorkflow extends WorkflowEntrypoint<Env, DocumentJob> {
  async run(event: WorkflowEvent<DocumentJob>, step: WorkflowStep): Promise<void> {
    const documentId = event.payload.documentId;
    if (typeof documentId !== "string" || !/^[a-f0-9-]{36}$/iu.test(documentId)) {
      throw new NonRetryableError("The VRAIN ingestion workflow received an invalid document ID.");
    }

    try {
      let document = await step.do("load VRAIN document", async () => getDocument(this.env, documentId));
      if (!["processing", "waiting_retry"].includes(document.status)) return;
      await updateDocument(this.env, documentId, { status: "processing", error_code: null, error_message: null });
      await this.env.DB.prepare("UPDATE vrain_jobs SET state='processing',last_heartbeat_at=? WHERE document_id=?")
        .bind(Date.now(), documentId).run().catch(() => undefined);

      await runWithRecovery(this.env, step, documentId, "verify_source", "Source integrity specialist", async () => {
        const metadata = await this.env.DB.prepare("SELECT expected_size,source_sha256,gcs_object FROM vrain_documents WHERE id=?")
          .bind(documentId).first<{ expected_size: number; source_sha256: string; gcs_object: string }>();
        if (!metadata) throw new NonRetryableError("The source registry record is missing.");
        const object = await getObjectMetadata(this.env, metadata.gcs_object);
        if (object.size !== Number(metadata.expected_size)) throw new Error("Uploaded PDF size does not match the declared source size.");
        const actualHash = await streamObjectSha256(this.env, metadata.gcs_object);
        if (actualHash !== metadata.source_sha256.toUpperCase()) {
          throw new NonRetryableError("The uploaded PDF SHA-256 does not match the verified intake fingerprint.");
        }
        await recordEvent(this.env, documentId, "Source integrity specialist", "verification",
          "source.sha256_verified", "completed", "The private GCS object size and server-computed SHA-256 match the intake record.",
          { size: object.size, sha256: actualHash });
      });

      document = await getDocument(this.env, documentId);
      let visionOperation = document.vision_operation;
      let outputPrefix = String((document as VrainDocument & { vision_output_prefix?: string }).vision_output_prefix ?? "");

      if (!visionOperation) {
        outputPrefix = "vrain/imports/" + documentId + "/ocr/" + crypto.randomUUID().replaceAll("-", "") + "/";
        visionOperation = await runWithRecovery(this.env, step, documentId, "vision_submit", "Google Cloud Vision OCR specialist", async () => {
          const operation = await submitVisionPdf(this.env, document.gcs_object, outputPrefix);
          await this.env.DB.prepare(
            "UPDATE vrain_documents SET vision_operation=?,vision_output_prefix=?,updated_at=? WHERE id=?",
          ).bind(operation, outputPrefix, Date.now(), documentId).run();
          return operation;
        });
        await recordEvent(this.env, documentId, "Google Cloud Vision OCR specialist", "ocr",
          "ocr.submitted", "running", "Google Cloud Vision accepted asynchronous PDF Document Text Detection.",
          { operation: visionOperation, pageCount: document.page_count });
      }

      let operationDone = false;
      let pollCount = 0;
      while (!operationDone) {
        pollCount += 1;
        operationDone = await runWithRecovery(this.env, step, documentId, "vision_poll_" + pollCount,
          "Google Cloud Vision OCR specialist", async () => {
            const result = await getVisionOperation(this.env, visionOperation!);
            return result.done;
          });
        if (!operationDone) {
          await recordEvent(this.env, documentId, "Google Cloud Vision OCR specialist", "ocr",
            "ocr.poll", "running", "Google Cloud Vision is still processing the PDF.",
            { pollCount });
          await step.sleep("wait for Google Vision poll " + pollCount, "1 minute");
        }
      }
      await recordEvent(this.env, documentId, "Google Cloud Vision OCR specialist", "ocr",
        "ocr.completed", "completed", "Google Cloud Vision completed the asynchronous OCR operation.",
        { operation: visionOperation });

      const outputObjects = await runWithRecovery(this.env, step, documentId, "list_ocr_output",
        "Document extraction specialist", async () =>
          (await listObjects(this.env, outputPrefix)).filter((name) => name.toLowerCase().endsWith(".json")));
      const pageToObject = new Map<number, string>();
      for (const objectName of outputObjects) {
        const range = pageRangeFromObjectName(objectName);
        if (!range) continue;
        for (let page = range.start; page <= range.end; page += 1) pageToObject.set(page, objectName);
      }
      const extraPages = [...pageToObject.keys()].filter((page) => page > document.page_count);
      if (extraPages.length) {
        throw new NonRetryableError("The declared PDF page count is lower than the page count Google Cloud Vision actually processed. Extra pages: " + extraPages.slice(0, 20).join(", "));
      }
      const missingPages = Array.from({ length: document.page_count }, (_, index) => index + 1)
        .filter((page) => !pageToObject.has(page));
      if (missingPages.length) {
        const repairCount = Number((document as VrainDocument & { ocr_repair_attempts?: number }).ocr_repair_attempts ?? 0);
        if (repairCount >= 2) {
          throw new NonRetryableError("Google Cloud Vision repeatedly returned incomplete page coverage. Missing PDF pages: " + missingPages.slice(0, 20).join(", "));
        }
        await this.env.DB.prepare(
          "UPDATE vrain_documents SET vision_operation=NULL,vision_output_prefix=NULL,ocr_repair_attempts=ocr_repair_attempts+1,updated_at=? WHERE id=?",
        ).bind(Date.now(), documentId).run();
        await recordEvent(this.env, documentId, "Recovery specialist", "ocr_repair",
          "ocr.coverage_repair", "warning", "OCR output did not cover every expected PDF page. VRAIN is resubmitting Vision OCR.",
          { missingPages: missingPages.slice(0, 50), repairAttempt: repairCount + 1 });
        throw new RetryHandoffError("vision_coverage", "Vision OCR output is missing " + missingPages.length + " page(s); a fresh OCR operation was queued.");
      }

      const OCR_BATCH_SIZE = 10;
      for (let startPage = 1; startPage <= document.page_count; startPage += OCR_BATCH_SIZE) {
        const endPage = Math.min(document.page_count, startPage + OCR_BATCH_SIZE - 1);
        await runWithRecovery(this.env, step, documentId, "persist_ocr_pages_" + startPage + "_" + endPage,
          "Document extraction specialist", async () => {
            await Promise.all(Array.from({ length: endPage - startPage + 1 }, async (_, offset) => {
              const pageNumber = startPage + offset;
              const sourceOutput = pageToObject.get(pageNumber);
              if (!sourceOutput) throw new NonRetryableError("Google Vision OCR output disappeared for PDF page " + pageNumber + ".");
              const pageText = await readVisionPageText(this.env, sourceOutput, pageNumber);
              const normalizedKey = "vrain/books/" + documentId + "/ocr/page-" + String(pageNumber).padStart(6, "0") + ".txt";
              await uploadTextObject(this.env, normalizedKey, pageText);
            }));
            await recordEvent(this.env, documentId, "Document extraction specialist", "normalization",
              "ocr.pages_normalized", "completed", "VRAIN persisted normalized OCR text for PDF pages " + startPage + "–" + endPage + ".",
              { startPage, endPage, pageCount: document.page_count });
          });
      }

      const searchName = this.env.VRAIN_SEARCH_INSTANCE?.trim() || "vrain-knowledge-v1";
      const search = this.env.VRAIN_SEARCH.get(searchName);
      const INDEX_BATCH_SIZE = 5;
      const indexCheckpoint = await this.env.DB.prepare("SELECT indexed_pages FROM vrain_documents WHERE id=?")
        .bind(documentId).first<{ indexed_pages: number }>();
      const indexedThrough = Math.max(0, Number(indexCheckpoint?.indexed_pages ?? 0));
      const firstUncommittedBatch = Math.floor(indexedThrough / INDEX_BATCH_SIZE) * INDEX_BATCH_SIZE + 1;
      if (firstUncommittedBatch > 1) {
        await recordEvent(this.env, documentId, "Recovery specialist", "indexing",
          "index.checkpoint_resumed", "completed",
          "VRAIN is resuming indexing from the first uncommitted page batch.",
          { indexedThrough, resumeAtPage: firstUncommittedBatch });
      }
      for (let startPage = firstUncommittedBatch; startPage <= document.page_count; startPage += INDEX_BATCH_SIZE) {
        const endPage = Math.min(document.page_count, startPage + INDEX_BATCH_SIZE - 1);
        await runWithRecovery(this.env, step, documentId, "index_pages_" + startPage + "_" + endPage,
          "Page indexing specialist", async () => {
            const startedAt = Date.now();
            await Promise.all(Array.from({ length: endPage - startPage + 1 }, async (_, offset) => {
              const pageNumber = startPage + offset;
              const normalizedKey = "vrain/books/" + documentId + "/ocr/page-" + String(pageNumber).padStart(6, "0") + ".txt";
              const text = await readTextObject(this.env, normalizedKey);
              const key = "vrain/books/" + documentId + "/pages/page-" + String(pageNumber).padStart(6, "0") + ".txt";
              const indexed = await search.items.uploadAndPoll(
                key,
                document.title + " | PDF page " + pageNumber + " | language " + document.language + "\n\n" +
                  (text || "[No machine-readable text was detected on this PDF page.]"),
                {
                  metadata: { documentId, documentTitle: document.title, pdfPage: pageNumber, language: document.language },
                  pollIntervalMs: 2_000,
                  timeoutMs: 120_000,
                },
              );
              if (indexed.status !== "completed") throw new Error(indexed.error ?? "AI Search did not complete indexing for PDF page " + pageNumber + ".");
            }));
            const elapsedMs = Date.now() - startedAt;
            const averagePageMs = Math.max(1, Math.round(elapsedMs / (endPage - startPage + 1)));
            for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
              await this.env.DB.prepare("UPDATE vrain_documents SET indexed_pages=MAX(indexed_pages,?),updated_at=? WHERE id=?")
                .bind(pageNumber, Date.now(), documentId).run();
              await recordEvent(this.env, documentId, "Page indexing specialist", "indexing",
                "index.page_completed", "completed", "PDF page " + pageNumber + " was indexed and acknowledged by AI Search.",
                { page: pageNumber, pageCount: document.page_count, elapsedMs: averagePageMs });
            }
            await this.env.DB.prepare("UPDATE vrain_jobs SET stage='indexing',last_heartbeat_at=? WHERE document_id=?")
              .bind(Date.now(), documentId).run();
            await recordEvent(this.env, documentId, "Page indexing specialist", "indexing",
              "index.progress", "running", "Indexed " + endPage + " of " + document.page_count + " PDF pages.",
              { indexedPages: endPage, pageCount: document.page_count, percent: Math.floor(endPage / document.page_count * 100) });
          });
      }

      await runWithRecovery(this.env, step, documentId, "retrieval_qa",
        "Retrieval QA specialist", async () => {
          const selected = verificationPages(document.page_count);
          const checks: number[] = [];
          const minimumChecks = Math.min(3, document.page_count);
          const checkOrder = [...selected, ...Array.from({ length: document.page_count }, (_, index) => index + 1)
            .filter((page) => !selected.includes(page))];
          const pageTexts = new Map<number, string>();
          for (const page of checkOrder) {
            const normalizedKey = "vrain/books/" + documentId + "/ocr/page-" + String(page).padStart(6, "0") + ".txt";
            const text = await readTextObject(this.env, normalizedKey);
            pageTexts.set(page, text);
            if (buildProbe(text)) checks.push(page);
            if (checks.length >= Math.max(5, minimumChecks)) break;
          }
          const qaPages = checks.slice(0, Math.max(5, minimumChecks));
          if (qaPages.length < minimumChecks) {
            throw new NonRetryableError("The PDF does not contain enough readable OCR text for page-grounded retrieval QA.");
          }
          for (const page of qaPages) {
            const probe = buildProbe(pageTexts.get(page) ?? "");
            if (!probe) continue;
            const result = await search.search({
              messages: [{ role: "user", content: probe }],
              ai_search_options: { retrieval: { max_num_results: 50, retrieval_type: "hybrid" } },
            });
            const expectedKey = "vrain/books/" + documentId + "/pages/page-" + String(page).padStart(6, "0") + ".txt";
            const match = (result.chunks ?? []).some((chunk) => chunk.item?.key === expectedKey);
            if (!match) throw new Error("The AI Search index is not yet returning expected PDF source page " + page + ".");
          }
          const allIndexed = await this.env.DB.prepare(
            "SELECT indexed_pages,page_count,status FROM vrain_documents WHERE id=?",
          ).bind(documentId).first<{ indexed_pages: number; page_count: number; status: string }>();
          if (!allIndexed || Number(allIndexed.indexed_pages) !== Number(allIndexed.page_count)) {
            throw new Error("The document index does not cover every expected PDF page.");
          }
          await recordEvent(this.env, documentId, "Retrieval QA specialist", "verification",
            "qa.passed", "completed", "Distributed page-grounded retrieval probes recovered their exact source PDF pages.",
            { checkedPages: qaPages, indexedPages: allIndexed.indexed_pages, pageCount: allIndexed.page_count });
        });

      await step.do("publish verified VRAIN document", async () => {
        const now = Date.now();
        const published = await this.env.DB.prepare(
          "UPDATE vrain_documents SET status='ready',error_code=NULL,error_message=NULL,published_at=?,updated_at=? " +
          "WHERE id=? AND indexed_pages=page_count AND status='processing'",
        ).bind(now, now, documentId).run();
        if (Number(published.meta.changes ?? 0) !== 1) {
          throw new NonRetryableError("The final publication gate refused the source because it is no longer processing or its full page index is incomplete.");
        }
        await this.env.DB.batch([
          this.env.DB.prepare(
            "UPDATE vrain_jobs SET state='ready',stage='published',last_heartbeat_at=?,completed_at=?,next_retry_at=NULL " +
            "WHERE document_id=?",
          ).bind(now, now, documentId),
          this.env.DB.prepare(
            "INSERT INTO vrain_activity_events (job_id,document_id,specialist,stage,event_type,status,message,detail_json,created_at) " +
            "VALUES (?,?,?,?,?,?,?,?,?)",
          ).bind(documentId, documentId, "Final supervisor", "publication", "document.ready", "completed",
            "The document passed integrity, OCR coverage, full-page indexing and page-grounded retrieval QA. It is now eligible for project grants.",
            JSON.stringify({ pageCount: document.page_count }), now),
        ]);
      });
    } catch (error) {
      if (error instanceof RetryHandoffError) {
        await markWaitingRetry(this.env, documentId, error.stage, error.message);
        return;
      }
      const message = safeError(error);
      if (error instanceof NonRetryableError || !isRetryable(error)) {
        await markFailed(this.env, documentId, message);
        return;
      }
      await markWaitingRetry(this.env, documentId, "workflow", message);
    }
  }
}
