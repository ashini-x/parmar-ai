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
    const importId = event.payload.importId;
    try {
      const job = await getFatmanImportJob(this.env, importId);
      if (!job || Number(job.uploaded_bytes) !== Number(job.expected_size)) {
        throw new Error("The complete private PDF upload could not be verified.");
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

      for (let page = 1; page <= 538; page += 1) {
        const pageNumber = page;
        await step.do("index Fatman PDF page " + pageNumber, async () => indexOcrPage(this.env, importId, pageNumber));
      }

      let complete = false;
      const repairCounts = new Map<number, number>();
      for (let attempt = 1; attempt <= 60; attempt += 1) {
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
        if (attempt < 60) await step.sleep("wait for Fatman index " + attempt, "30 seconds");
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
          await step.do("delete temporary Fatman OCR objects " + batch, async () => {
            await this.deleteObjects(names);
            return { deleted: names.length };
          });
        }
      } catch {
        // Indexed content is complete; temporary GCS cleanup can be retried by lifecycle policy.
      }
    } catch (error) {
      await markFatmanImportFailed(this.env, importId, error).catch(() => undefined);
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
