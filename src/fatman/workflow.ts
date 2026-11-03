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
  task?: "index_chunk" | "cleanup_chunk";
  startPage?: number;
  endPage?: number;
  objectNames?: string[];
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
  if (task !== undefined && task !== "index_chunk" && task !== "cleanup_chunk") {
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

      if (params.task === "index_chunk") {
        const startPage = params.startPage;
        const endPage = params.endPage;
        if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) ||
            startPage! < 1 || endPage! > 538 || endPage! < startPage! || endPage! - startPage! >= 8) {
          throw new Error("The Fatman page chunk range is invalid.");
        }
        for (let page = startPage!; page <= endPage!; page += 1) {
          const pageNumber = page;
          await step.do("index Fatman PDF page " + pageNumber, async () =>
            indexOcrPage(this.env, importId, pageNumber));
        }
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
      const pagesPerChunk = 8;
      for (let startPage = 1; startPage <= 538; startPage += pagesPerChunk) {
        const endPage = Math.min(538, startPage + pagesPerChunk - 1);
        const childId = importId + "-" + indexingRunId + "-page-" + startPage;
        const startedId = await step.do("start Fatman page chunk " + startPage, async () => {
          try {
            return (await this.env.FATMAN_IMPORT!.create({
              id: childId,
              params: { task: "index_chunk", importId, startPage, endPage },
            })).id;
          } catch (error) {
            try {
              return (await this.env.FATMAN_IMPORT!.get(childId)).id;
            } catch {
              throw error;
            }
          }
        });

        let chunkComplete = false;
        for (let attempt = 1; attempt <= 30; attempt += 1) {
          const chunkStatus = await step.do("check Fatman page chunk " + startPage + " attempt " + attempt, async () => {
            const instance = await this.env.FATMAN_IMPORT!.get(startedId);
            const status = await instance.status();
            return { status: status.status, error: status.error?.message ?? null };
          });
          if (chunkStatus.status === "complete") {
            chunkComplete = true;
            break;
          }
          if (chunkStatus.status === "errored" || chunkStatus.status === "terminated" ||
              chunkStatus.status === "paused" || chunkStatus.status === "unknown") {
            throw new Error("Fatman page chunk " + startPage + "-" + endPage + " stopped: " +
              (chunkStatus.error || chunkStatus.status) + ".");
          }
          if (attempt < 30) {
            await step.sleep("wait for Fatman page chunk " + startPage + " attempt " + attempt, "10 seconds");
          }
        }
        if (!chunkComplete) {
          throw new Error("Fatman page chunk " + startPage + "-" + endPage + " did not finish within five minutes.");
        }
      }

      let complete = false;
      const repairCounts = new Map<number, number>();
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        const pages = await step.do("check Fatman index status " + attempt, async () => listFatmanIndexPages(this.env));
        const completedPages = pages.filter((item) => item.status === "completed").length;
        const failedPages = pages.filter((item) => item.status === "error" || item.status === "skipped" || item.status === "outdated");
        await step.do("save Fatman progress " + attempt, async () => {
          await updateFatmanImportProgress(this.env, completedPages);
          return { completedPages };
        });
        if (completedPages === 538 && failedPages.length === 0) {
          complete = true;
          break;
        }
        if (failedPages.length > 10) {
          throw new Error("AI Search reported " + failedPages.length + " failed pages. The import stopped to avoid overwhelming the index.");
        }
        if (failedPages.length > 0) {
          for (const failed of failedPages) {
            const retryCount = repairCounts.get(failed.page) ?? 0;
            if (retryCount >= 3) throw new Error("Fatman AI Search repeatedly failed PDF page " + failed.page + ".");
            repairCounts.set(failed.page, retryCount + 1);
            await step.do("retry failed Fatman page " + failed.page + " cycle " + (retryCount + 1), async () =>
              indexOcrPage(this.env, importId, failed.page));
          }
        }
        if (attempt < 30) await step.sleep("wait for Fatman index " + attempt, "1 minute");
      }
      if (!complete) throw new Error("Fatman AI Search did not complete all 538 pages within 30 minutes.");
      await step.do("mark Fatman import complete", async () => {
        await markFatmanImportCompleted(this.env, importId);
        return { completedPages: 538 };
      });
      try {
        const objectNames = await step.do("list temporary Fatman OCR objects", async () => cleanupFatmanGcsObjects(this.env, importId));
        for (let offset = 0, batch = 1; offset < objectNames.length; offset += 25, batch += 1) {
          const names = objectNames.slice(offset, offset + 25);
          const childId = importId + "-" + indexingRunId + "-cleanup-" + batch;
          await step.do("start Fatman cleanup batch " + batch, async () => {
            try {
              const instance = await this.env.FATMAN_IMPORT!.create({
                id: childId,
                params: { task: "cleanup_chunk", importId, objectNames: names },
              });
              return { instanceId: instance.id };
            } catch {
              const instance = await this.env.FATMAN_IMPORT!.get(childId);
              return { instanceId: instance.id };
            }
          });
        }
      } catch {
        // Indexed content is complete; temporary GCS cleanup can be retried by lifecycle policy.
      }
    } catch (error) {
      if (params.task !== "cleanup_chunk") {
        await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
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
