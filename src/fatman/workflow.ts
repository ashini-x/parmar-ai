import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../config/env";
import { runFatmanReleaseQaForEnv } from "./release-qa-runner";
import { setFatmanBookState } from "../analytics/db";
import { FATMAN_PAGE_RETRY_LIMIT, fatmanPageRetryDelay, isTransientFatmanIndexError } from "./recovery-policy";
import { buildFatmanBookVerificationPages, buildFatmanRetrievalProbes, FATMAN_VERIFICATION_PAGES, isRetryableFatmanQualityFailure } from "./quality";
import { getGoogleAccessToken } from "../auth/google";
import { fatmanExpectedPageCount, fatmanIndexPageKey } from "./library";
import type { FatmanImportJob } from "./import";
import {
  cleanupFatmanGcsObjects,
  getFatmanImportJob,
  getFatmanVisionOperation,
  listFatmanIndexPages,
  markFatmanImportCompleted,
  markFatmanImportFailed,
  readFatmanVisionOutput,
  setFatmanImportStatus,
  submitFatmanVision,
  updateFatmanImportProgress,
} from "./import";

interface FatmanImportParams {
  importId: string;
  task?: "resume_index" | "index_chunk" | "repair_chunk" | "cleanup_chunk" | "monitor" | "retry_page" | "quality_check" | "release_qa";
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
      task !== "cleanup_chunk" && task !== "monitor" && task !== "retry_page" && task !== "quality_check" && task !== "release_qa") {
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
  const indexed = job.book_id
    ? await instance.items.upload(key, content, { metadata: { bookId: job.book_id, bookTitle: title, pdfPage: page } })
    : await instance.items.upload(key, content);
  if (indexed.status === "error" || indexed.status === "skipped" || indexed.status === "outdated") {
    throw new Error(indexed.error ? String(indexed.error) : "AI Search rejected PDF page " + page + " with status " + indexed.status + ".");
  }
  return { page, status: indexed.status };
}

export class FatmanImportWorkflow extends WorkflowEntrypoint<Env, FatmanImportParams> {
  async run(event: WorkflowEvent<FatmanImportParams>, step: WorkflowStep): Promise<void> {
    const params = fatmanParamsFromPayload(event.payload);
    const importId = params.importId;
    let job: FatmanImportJob | null = null;
    let expectedPages = 538;
    try {
      const loadedJob = await getFatmanImportJob(this.env, importId);
      if (!loadedJob || Number(loadedJob.uploaded_bytes) !== Number(loadedJob.expected_size)) {
        throw new Error("The complete private PDF upload could not be verified.");
      }
      job = loadedJob;
      const importJob = loadedJob;
      expectedPages = fatmanExpectedPageCount(importJob);

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
        for (let page = startPage!; page <= endPage!; page += 1) {
          const pageNumber = page;
          try {
            await step.do("index Fatman PDF page " + pageNumber, async () =>
              indexOcrPage(this.env, importJob, pageNumber));
          } catch (error) {
            if (!isTransientFatmanIndexError(error)) throw error;
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

        let shouldCleanup = true;
        if (job?.book_id) {
          await step.do("mark additional book ready after retrieval verification", async () => {
            await markFatmanImportCompleted(this.env, importId);
            return { ready: true, checkedPages: verification.checkedPages };
          });
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

        // Preserve the private GCS source and OCR output until retrieval checks pass.
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
          return { completedPages };
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
        const prefix = "fatman/imports/" + importId + "/";
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
        const result = await step.do("check Google Vision " + attempt, async () => getFatmanVisionOperation(this.env, operationName));
        if (result.error) throw new Error(result.error);
        if (result.done) {
          visionDone = true;
          break;
        }
      }
      if (!visionDone) throw new Error("Google Vision OCR did not finish within one hour.");

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
        if (job?.book_id) {
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
      } else if (params.task !== "cleanup_chunk") {
        await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
      }
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
