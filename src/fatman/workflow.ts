import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
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
  task?: "resume_index" | "index_chunk" | "repair_chunk" | "cleanup_chunk" | "monitor";
  startPage?: number;
  endPage?: number;
  objectNames?: string[];
  pages?: number[];
  runId?: string;
  monitorSequence?: number;
  repairPass?: number;
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
      task !== "cleanup_chunk" && task !== "monitor") {
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
  };
}


async function indexOcrPage(env: Env, importId: string, page: number): Promise<{ page: number; status: string }> {
  const instanceName = env.FATMAN_INSTANCE_NAME?.trim();
  if (!instanceName || !env.FATMAN_SEARCH) throw new Error("Fatman AI Search is not configured.");
  const instance = env.FATMAN_SEARCH.get(instanceName);
  const key = "fatman/pages/page-" + String(page).padStart(6, "0") + ".txt";
  const found = await instance.items.list({ search: key, per_page: 50, source: "builtin" });
  const exact = (found.result ?? []).filter((item) => item.key === key);
  const keep = exact.find((item) => item.status === "completed") ??
    exact.find((item) => item.status === "queued" || item.status === "running");
  for (const item of exact) {
    if (item.id === keep?.id) continue;
    await instance.items.delete(item.id);
  }
  if (keep) return { page, status: keep.status };
  const text = await readFatmanVisionOutput(env, importId, page);
  const indexed = await instance.items.upload(key, "Fatman 2nd Edition 2026 | PDF page " + page + "\n\n" + text);
  return { page, status: indexed.status };
}

export class FatmanImportWorkflow extends WorkflowEntrypoint<Env, FatmanImportParams> {
  async run(event: WorkflowEvent<FatmanImportParams>, step: WorkflowStep): Promise<void> {
    const params = fatmanParamsFromPayload(event.payload);
    const importId = params.importId;
    try {
      const job = await getFatmanImportJob(this.env, importId);
      if (!job || Number(job.uploaded_bytes) !== Number(job.expected_size)) {
        throw new Error("The complete private PDF upload could not be verified.");
      }

      if (params.task === "resume_index") {
        const runId = params.runId;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman index recovery parameters are invalid.");
        }
        const pages = await step.do("find incomplete Fatman index pages", async () =>
          listFatmanIndexPages(this.env));
        const completedPages = new Set(pages
          .filter((item) => item.status === "completed")
          .map((item) => item.page));
        const startPage = Array.from({ length: 538 }, (_, index) => index + 1)
          .find((page) => !completedPages.has(page));

        if (startPage === undefined) {
          await step.do("start Fatman indexing monitor after recovery", async () =>
            this.startChild(importId + "-" + runId + "-monitor-1", {
              task: "monitor",
              importId,
              runId,
              monitorSequence: 1,
              repairPass: 0,
            }));
        } else {
          const endPage = Math.min(538, startPage + 7);
          await step.do("start recovered Fatman page chunk " + startPage, async () =>
            this.startChild(importId + "-" + runId + "-page-" + startPage, {
              task: "index_chunk",
              importId,
              startPage,
              endPage,
              runId,
            }));
        }
        return;
      }

      if (params.task === "index_chunk") {
        const startPage = params.startPage;
        const endPage = params.endPage;
        const runId = params.runId;
        if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) ||
            startPage! < 1 || endPage! > 538 || endPage! < startPage! || endPage! - startPage! >= 8 ||
            typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId)) {
          throw new Error("The Fatman page chunk parameters are invalid.");
        }
        for (let page = startPage!; page <= endPage!; page += 1) {
          const pageNumber = page;
          await step.do("index Fatman PDF page " + pageNumber, async () =>
            indexOcrPage(this.env, importId, pageNumber));
        }

        if (endPage! < 538) {
          const nextStart = endPage! + 1;
          const nextEnd = Math.min(538, nextStart + 7);
          await step.do("start next Fatman page chunk " + nextStart, async () =>
            this.startChild(importId + "-" + runId + "-page-" + nextStart, {
              task: "index_chunk",
              importId,
              startPage: nextStart,
              endPage: nextEnd,
              runId,
            }));
        } else {
          await step.do("start Fatman indexing monitor", async () =>
            this.startChild(importId + "-" + runId + "-monitor-1", {
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
            pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > 538) ||
            typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId) ||
            !Number.isSafeInteger(monitorSequence) || monitorSequence! < 1 ||
            !Number.isSafeInteger(repairPass) || repairPass < 1 || repairPass > 3) {
          throw new Error("The Fatman repair task parameters are invalid.");
        }
        for (const page of [...new Set(pages)]) {
          await step.do("repair Fatman PDF page " + page, async () => indexOcrPage(this.env, importId, page));
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

      if (params.task === "monitor") {
        const runId = params.runId;
        const monitorSequence = params.monitorSequence ?? 1;
        const repairPass = params.repairPass ?? 0;
        if (typeof runId !== "string" || !/^[a-f0-9]{8}$/u.test(runId) ||
            !Number.isSafeInteger(monitorSequence) || monitorSequence < 1 ||
            !Number.isSafeInteger(repairPass) || repairPass < 0 || repairPass > 3) {
          throw new Error("The Fatman index monitor parameters are invalid.");
        }

        await step.sleep("wait before Fatman indexing check " + monitorSequence, "1 minute");
        const pages = await step.do("check Fatman index status " + monitorSequence, async () =>
          listFatmanIndexPages(this.env));
        const byPage = new Map<number, { page: number; status: string; error?: string }>();
        for (const item of pages) byPage.set(item.page, item);
        const completedPages = pages.filter((item) => item.status === "completed").length;
        const failedPages = pages.filter((item) =>
          item.status === "error" || item.status === "skipped" || item.status === "outdated");
        await step.do("save Fatman indexing progress " + monitorSequence, async () => {
          await updateFatmanImportProgress(this.env, completedPages);
          return { completedPages };
        });

        if (completedPages === 538 && failedPages.length === 0) {
          await step.do("mark Fatman import complete", async () => {
            await markFatmanImportCompleted(this.env, importId);
            return { completedPages: 538 };
          });
          try {
            const objectNames = await step.do("list temporary Fatman OCR objects", async () =>
              cleanupFatmanGcsObjects(this.env, importId));
            for (let offset = 0, batch = 1; offset < objectNames.length; offset += 25, batch += 1) {
              const names = objectNames.slice(offset, offset + 25);
              await step.do("start Fatman cleanup batch " + batch, async () =>
                this.startChild(importId + "-" + runId + "-cleanup-" + batch, {
                  task: "cleanup_chunk",
                  importId,
                  objectNames: names,
                }));
            }
          } catch {
            // Indexing is complete. Temporary objects can be removed by the bucket lifecycle policy.
          }
          return;
        }

        if (failedPages.length > 10) {
          throw new Error("AI Search reported " + failedPages.length + " failed pages. The import stopped to avoid overwhelming the index.");
        }
        const missingPages = Array.from({ length: 538 }, (_, index) => index + 1)
          .filter((page) => !byPage.has(page));
        const repairPages = [...new Set([...failedPages.map((item) => item.page), ...missingPages])].slice(0, 10);
        if (repairPages.length > 0) {
          if (repairPass >= 3) {
            throw new Error("Fatman AI Search still has missing or failed pages after three repair passes.");
          }
          const nextSequence = monitorSequence + 1;
          const nextRepairPass = repairPass + 1;
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
          endPage: 8,
          runId: indexingRunId,
        }));
      return;
    } catch (error) {
      if (params.task !== "cleanup_chunk") {
        await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
      }
      throw error;
    }
  }

  private async startChild(id: string, params: FatmanImportParams): Promise<string> {
    try {
      return (await this.env.FATMAN_IMPORT!.create({ id, params })).id;
    } catch (error) {
      try {
        return (await this.env.FATMAN_IMPORT!.get(id)).id;
      } catch {
        throw error;
      }
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
