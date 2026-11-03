import type { Env } from "../config/env";
import { ensureAnalyticsSchema, getFatmanBookState, getLatestFatmanReleaseQaRun } from "../analytics/db";
import { json } from "../http/response";

export async function fatmanReleaseQaStatus(env: Env): Promise<Response> {
  try {
    const latest = await getLatestFatmanReleaseQaRun(env);
    return json({ ok: true, latest });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
}

export async function triggerFatmanReleaseQa(env: Env): Promise<Response> {
  if (!env.DB || !env.FATMAN_IMPORT) {
    return json({ ok: false, error: "Fatman release QA requires D1 and the Workflow binding." }, 503);
  }

  try {
    await ensureAnalyticsSchema(env);
    const job = await env.DB.prepare(
      "SELECT id, status, expected_size, uploaded_bytes, indexed_pages FROM fatman_import_jobs ORDER BY updated_at DESC LIMIT 1"
    ).first<{
      id: string;
      status: string;
      expected_size: number;
      uploaded_bytes: number;
      indexed_pages: number;
    }>();

    const state = await getFatmanBookState(env);
    const latest = await getLatestFatmanReleaseQaRun(env);
    if (latest?.status === "running" && Date.now() - latest.startedAt < 30 * 60 * 1_000) {
      return json({ ok: false, error: "A Fatman release QA run is already in progress.", latest }, 409);
    }
    if (
      !job ||
      job.status !== "completed" ||
      Number(job.uploaded_bytes) !== Number(job.expected_size) ||
      Number(job.indexed_pages) !== 538 ||
      state.indexedPages !== 538 ||
      state.documentVersion !== env.FATMAN_DOCUMENT_VERSION?.trim()
    ) {
      return json({
        ok: false,
        error: "Release QA requires the current 538-page import to be complete and version-matched.",
      }, 409);
    }

    const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    const workflowId = "fatman-qa-manual-" + runId;
    const instance = await env.FATMAN_IMPORT.create({
      id: workflowId,
      params: { task: "release_qa", importId: job.id, runId },
    });
    return json({
      ok: true,
      queued: true,
      workflowId: instance.id,
      importId: job.id,
      message: "Six-category Fatman release QA has been queued.",
    }, 202);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
