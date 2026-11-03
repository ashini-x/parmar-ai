import type { AiSearchInstance, AiSearchItem, Env } from "../config/env";
import { getGoogleAccessToken } from "../auth/google";
import { getFatmanBookState, reserveFatmanSearchQuery, setFatmanBookState } from "../analytics/db";
import { json } from "../http/response";
import { nextAiSearchPage } from "./pagination";

const EXPECTED_PAGES = 538;
const EXPECTED_PDF_SHA256 = "8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_OCR_TEXT_CHARS = 120_000;
const GOOGLE_VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
const PAGE_PREFIX = "fatman/pages/page-";

export function fatmanAdminPage(): Response {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function testFatmanVision(env: Env): Promise<Response> {
  if (!hasGoogleVisionBindings(env)) {
    return json({ ok: false, error: "Google Cloud project and service-account credentials are not configured on the Worker." }, 503);
  }

  try {
    const token = await getGoogleAccessToken(env);
    const response = await callGoogleVision(env, token, {
      requests: [{ features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }],
    });
    const data = await googleResponseJson(response);
    const requestError = googleVisionRequestError(data);
    if (requestError && isMissingImageValidation(requestError)) {
      return json({ ok: true, provider: "google_vision", billableImages: 0 });
    }
    return googleVisionFailureResponse(response.status, data);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function prepareFatmanIndex(env: Env): Promise<Response> {
  if (!hasFatmanBindings(env)) return json({ ok: false, error: "fatman_not_configured" }, 503);
  try {
    const namespace = env.FATMAN_SEARCH!;
    const instanceName = env.FATMAN_INSTANCE_NAME!.trim();
    const state = await getFatmanBookState(env);
    await setFatmanBookState(env, {
      enabled: false,
      documentVersion: env.FATMAN_DOCUMENT_VERSION!.trim(),
      indexedPages: state.indexedPages,
    });
    const existing = await namespace.list();
    let instance: AiSearchInstance;
    if ((existing.result ?? []).some((item) => item.id === instanceName)) {
      instance = namespace.get(instanceName);
      await instance.update({
        indexing_options: { use_ocr: true },
        index_method: { vector: true, keyword: true },
      });
    } else {
      instance = await namespace.create({
        id: instanceName,
        indexing_options: { use_ocr: true },
        index_method: { vector: true, keyword: true },
      });
    }

    const pages = await listFatmanPages(instance);
    return json({
      ok: true,
      expectedPages: EXPECTED_PAGES,
      existingPages: pages.filter((item) => item.status === "completed").length,
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function uploadFatmanPage(env: Env, request: Request, pageNumber: number): Promise<Response> {
  if (!hasFatmanBindings(env)) return json({ ok: false, error: "fatman_not_configured" }, 503);
  if (request.headers.get("x-fatman-free-quota-confirmed") !== "true") {
    return json({ ok: false, error: "Confirm that at least 538 free Vision OCR units remain before importing." }, 400);
  }
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > EXPECTED_PAGES) {
    return json({ ok: false, error: "invalid_page_number" }, 400);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("image/jpeg")) {
    return json({ ok: false, error: "jpeg_required" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
    return json({ ok: false, error: "page_size_out_of_range" }, 413);
  }

  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 4 || bytes.byteLength > MAX_PAGE_BYTES) {
      return json({ ok: false, error: "page_size_out_of_range" }, 413);
    }
    const view = new Uint8Array(bytes);
    if (view[0] !== 0xff || view[1] !== 0xd8 || view[view.length - 2] !== 0xff || view[view.length - 1] !== 0xd9) {
      return json({ ok: false, error: "invalid_jpeg" }, 415);
    }

    if (!hasGoogleVisionBindings(env)) {
      return json({ ok: false, page: pageNumber, error: "Google Cloud Vision is not configured on the Worker." }, 503);
    }

    const instance = env.FATMAN_SEARCH!.get(env.FATMAN_INSTANCE_NAME!.trim());
    const key = pageKey(pageNumber);
    const existing = await instance.items.list({ search: key, per_page: 50, source: "builtin" });
    const exactMatches = (existing.result ?? []).filter((item) => item.key === key);
    if (exactMatches.some((item) => item.status === "completed")) {
      return json({ ok: true, page: pageNumber, status: "completed", skipped: true });
    }
    const pending = exactMatches.find((item) => item.status === "queued" || item.status === "running");
    if (pending) {
      return fatmanPageUploadResponse(pageNumber, pending);
    }

    const recoverable = exactMatches.find((item) =>
      item.status === "error" || item.status === "skipped" || item.status === "outdated");
    let text: string;
    if (recoverable) {
      text = await recoverFatmanPageText(instance, recoverable);
      await instance.items.delete(recoverable.id);
    } else {
      text = await recognizeFatmanPage(env, new Uint8Array(bytes), pageNumber);
    }

    const item = await instance.items.upload(key, text);
    return fatmanPageUploadResponse(pageNumber, item);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function fatmanIndexStatus(env: Env): Promise<Response> {
  if (!hasFatmanBindings(env)) return json({ ok: false, error: "fatman_not_configured" }, 503);
  try {
    const listed = await env.FATMAN_SEARCH!.list();
    const instanceName = env.FATMAN_INSTANCE_NAME!.trim();
    const exists = (listed.result ?? []).some((item) => item.id === instanceName);
    const state = await getFatmanBookState(env);
    if (!exists) {
      return json({
        ok: true,
        exists: false,
        enabled: false,
        expectedPages: EXPECTED_PAGES,
        completedPages: 0,
        queuedPages: 0,
        failedPages: 0,
        pages: [],
      });
    }

    const items = await listFatmanPages(env.FATMAN_SEARCH!.get(instanceName));
    const pageByNumber = new Map<number, { page: number; status: string; error?: string }>();
    const priority = (status: string) => status === "completed" ? 5 :
      status === "queued" || status === "running" ? 4 :
      status === "error" || status === "skipped" || status === "outdated" ? 3 : 0;
    for (const item of items) {
      const page = pageNumberFromKey(item.key);
      if (page === undefined) continue;
      const candidate = { page, status: item.status, error: item.error ? safeError(item.error) : undefined };
      const existing = pageByNumber.get(page);
      if (!existing || priority(candidate.status) > priority(existing.status)) pageByNumber.set(page, candidate);
    }
    const pages = Array.from(pageByNumber.values()).sort((a, b) => a.page - b.page);
    const completedPages = pages.filter((item) => item.status === "completed").length;
    return json({
      ok: true,
      exists: true,
      enabled: state.enabled && state.documentVersion === env.FATMAN_DOCUMENT_VERSION?.trim(),
      expectedPages: EXPECTED_PAGES,
      completedPages,
      queuedPages: pages.filter((item) => item.status === "queued" || item.status === "running").length,
      failedPages: pages.filter((item) => item.status === "error" || item.status === "skipped" || item.status === "outdated").length,
      pages,
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function previewFatmanIndex(env: Env, request: Request): Promise<Response> {
  if (!hasFatmanBindings(env)) return json({ ok: false, error: "fatman_not_configured" }, 503);
  let body: { query?: unknown };
  try {
    body = await request.json() as { query?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const query = typeof body.query === "string" ? body.query.replace(/\s+/gu, " ").trim().slice(0, 1_000) : "";
  if (!query) return json({ ok: false, error: "query_required" }, 400);

  try {
    const instanceName = env.FATMAN_INSTANCE_NAME!.trim();
    const listed = await env.FATMAN_SEARCH!.list();
    if (!(listed.result ?? []).some((item) => item.id === instanceName)) {
      return json({ ok: false, error: "index_instance_missing" }, 409);
    }
    const instance = env.FATMAN_SEARCH!.get(instanceName);
    const pages = await listFatmanPages(instance);
    const readyPages = new Set(pages.filter((item) => item.status === "completed").map((item) => pageNumberFromKey(item.key)));
    if (Array.from({ length: EXPECTED_PAGES }, (_, index) => readyPages.has(index + 1)).some((ready) => !ready)) {
      return json({ ok: false, error: "index_not_complete" }, 409);
    }

    const configuredLimit = Number(env.FATMAN_MONTHLY_QUERY_LIMIT);
    const monthlyLimit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(800, Math.floor(configuredLimit))) : 800;
    const usage = await reserveFatmanSearchQuery(env, monthlyLimit);
    if (!usage.allowed) return json({ ok: false, error: "monthly_search_limit_reached" }, 429);

    const result = await instance.search({
      messages: [{ role: "user", content: query }],
      ai_search_options: { retrieval: { max_num_results: 5, retrieval_type: "hybrid" } },
    });
    const results = (result.chunks ?? []).flatMap((chunk) => {
      const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
      const page = pageNumberFromKey(key);
      const text = typeof chunk.text === "string"
        ? chunk.text.replace(/\bjoin\s*[-:]*\s*@?freebookspdf\d*\b/giu, " ").replace(/\s+/gu, " ").trim().slice(0, 1_400)
        : "";
      const score = typeof chunk.score === "number" && Number.isFinite(chunk.score) ? chunk.score : null;
      return page && text ? [{ page, text, score }] : [];
    }).slice(0, 5);
    return json({ ok: true, query, results, monthlyQueryCount: usage.queryCount });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function finalizeFatmanIndex(env: Env, request: Request): Promise<Response> {
  if (!hasFatmanBindings(env)) return json({ ok: false, error: "fatman_not_configured" }, 503);
  let body: { reviewedQueries?: unknown };
  try {
    body = await request.json() as { reviewedQueries?: unknown };
  } catch {
    return json({ ok: false, error: "three_distinct_review_queries_required" }, 400);
  }
  const reviewedQueries = Array.isArray(body.reviewedQueries)
    ? [...new Set(body.reviewedQueries
      .filter((query): query is string => typeof query === "string")
      .map((query) => query.replace(/\s+/gu, " ").trim().slice(0, 1_000))
      .filter(Boolean))].slice(0, 3)
    : [];
  if (reviewedQueries.length < 3) {
    return json({ ok: false, error: "three_distinct_review_queries_required" }, 400);
  }
  try {
    const listed = await env.FATMAN_SEARCH!.list();
    const instanceName = env.FATMAN_INSTANCE_NAME!.trim();
    if (!(listed.result ?? []).some((item) => item.id === instanceName)) {
      return json({ ok: false, error: "index_instance_missing" }, 409);
    }
    const items = await listFatmanPages(env.FATMAN_SEARCH!.get(instanceName));
    const pageByNumber = new Map<number, AiSearchItem>();
    for (const item of items) {
      const page = pageNumberFromKey(item.key);
      if (page !== undefined) pageByNumber.set(page, item);
    }
    const allPagesReady = pageByNumber.size === EXPECTED_PAGES &&
      Array.from({ length: EXPECTED_PAGES }, (_, index) => pageByNumber.get(index + 1)?.status === "completed").every(Boolean);
    if (!allPagesReady) {
      return json({
        ok: false,
        error: "index_not_complete",
        completedPages: Array.from(pageByNumber.values()).filter((item) => item.status === "completed").length,
        failedPages: Array.from(pageByNumber.values()).filter((item) => item.status === "error" || item.status === "skipped" || item.status === "outdated").length,
      }, 409);
    }
    await setFatmanBookState(env, {
      enabled: true,
      documentVersion: env.FATMAN_DOCUMENT_VERSION!.trim(),
      indexedPages: EXPECTED_PAGES,
    });
    return json({ ok: true, enabled: true, indexedPages: EXPECTED_PAGES });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function disableFatmanIndex(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "database_not_configured" }, 503);
  try {
    const state = await getFatmanBookState(env);
    await setFatmanBookState(env, {
      enabled: false,
      documentVersion: state.documentVersion,
      indexedPages: state.indexedPages,
    });
    return json({ ok: true, enabled: false });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

async function recognizeFatmanPage(env: Env, bytes: Uint8Array, pageNumber: number): Promise<string> {
  const token = await getGoogleAccessToken(env);
  const response = await callGoogleVision(env, token, {
    requests: [{
      image: { content: bytesToBase64(bytes) },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
    }],
  });
  const data = await googleResponseJson(response);
  if (!response.ok) throw new Error(googleVisionErrorMessage(response.status, data));

  const result = firstGoogleVisionResult(data);
  if (!result) throw new Error("Google Vision returned no result for PDF page " + pageNumber + ".");
  const requestError = asRecord(result.error);
  if (requestError) throw new Error(googleVisionErrorMessage(response.status, { responses: [result] }));

  const text = asRecord(result.fullTextAnnotation)?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Google Vision found no readable text on PDF page " + pageNumber + ".");
  }

  const normalized = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (normalized.length > MAX_OCR_TEXT_CHARS) {
    throw new Error("Google Vision text for PDF page " + pageNumber + " exceeds the page text limit.");
  }
  return "Fatman 2nd Edition\nPDF page: " + pageNumber + "\n\n" + normalized + "\n";
}

async function callGoogleVision(env: Env, token: string, body: Record<string, unknown>): Promise<Response> {
  const projectId = env.GCP_PROJECT_ID?.trim();
  if (!projectId) throw new Error("GCP_PROJECT_ID is not configured on the Worker.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(GOOGLE_VISION_URL, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "x-goog-user-project": projectId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Google Vision timed out after 30 seconds. Refresh status before retrying this page.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function googleResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function firstGoogleVisionResult(data: unknown): Record<string, unknown> | undefined {
  const responses = asRecord(data)?.responses;
  if (!Array.isArray(responses)) return undefined;
  const first = asRecord(responses[0]);
  return first ?? undefined;
}

function googleVisionRequestError(data: unknown): Record<string, unknown> | undefined {
  const outerError = asRecord(asRecord(data)?.error);
  if (outerError) return outerError;
  return asRecord(firstGoogleVisionResult(data)?.error) ?? undefined;
}

function isMissingImageValidation(error: Record<string, unknown>): boolean {
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  return (code === 3 || code === 400) &&
    /image/iu.test(message) &&
    /(required|missing|specified|provided|supplied|must|invalid)/iu.test(message);
}

function googleVisionFailureResponse(status: number, data: unknown): Response {
  return json({ ok: false, error: googleVisionErrorMessage(status, data) }, status === 403 ? 503 : 502);
}

function googleVisionErrorMessage(status: number, data: unknown): string {
  const error = googleVisionRequestError(data);
  const code = typeof error?.status === "string" ? error.status : String(error?.code ?? "");
  const message = typeof error?.message === "string" ? error.message : "";
  const details = code + " " + message;

  if (/SERVICE_DISABLED|has not been used|API is disabled|not enabled/iu.test(details)) {
    return "Cloud Vision API is not enabled for the configured Google Cloud project. Enable Cloud Vision API, then test again.";
  }
  if (/USER_PROJECT_DENIED|serviceusage\.services\.use|quota project|user project/iu.test(details)) {
    return "The Worker service account needs Service Usage Consumer access on the configured Google Cloud project.";
  }
  if (/BILLING_DISABLED|billing.*(disabled|not enabled|must be enabled)/iu.test(details)) {
    return "Billing is not enabled for the configured Google Cloud project. Check the project billing setup before using Vision.";
  }
  return "Google Vision OCR failed (HTTP " + status + "): " + safeError(message || code || "Unknown Google Vision error.");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function recoverFatmanPageText(instance: AiSearchInstance, item: AiSearchItem): Promise<string> {
  const source = await instance.items.get(item.id).download();
  if (!source.contentType.toLowerCase().startsWith("text/")) {
    throw new Error("Cloudflare could not return the previous OCR text, so this page was not sent to Vision again.");
  }
  const text = await new Response(source.body).text();
  if (!text.trim() || text.length > MAX_OCR_TEXT_CHARS) {
    throw new Error("The previous OCR text could not be recovered safely, so this page was not sent to Vision again.");
  }
  return text;
}

function fatmanPageUploadResponse(pageNumber: number, item: AiSearchItem): Response {
  if (item.status === "error" || item.status === "skipped" || item.status === "outdated") {
    return json({
      ok: false,
      page: pageNumber,
      status: item.status,
      error: safeError(item.error ?? "Cloudflare could not index this page."),
    }, 422);
  }
  if (item.status === "queued" || item.status === "running") {
    return json({ ok: true, page: pageNumber, status: item.status, processing: true }, 202);
  }
  if (item.status !== "completed") {
    return json({
      ok: false,
      page: pageNumber,
      status: item.status,
      error: "Cloudflare could not accept this page. Refresh status before resuming.",
    }, 409);
  }
  return json({ ok: true, page: pageNumber, status: item.status });
}

async function listFatmanPages(instance: AiSearchInstance): Promise<AiSearchItem[]> {
  const items: AiSearchItem[] = [];
  let page = 1;
  while (page <= 20) {
    const response = await instance.items.list({ page, per_page: 50, source: "builtin" });
    items.push(...(response.result ?? []).filter((item) => item.key.startsWith(PAGE_PREFIX) && item.key.endsWith(".txt")));
    const nextPage = nextAiSearchPage(response, page, 50);
    if (nextPage === null) break;
    page = nextPage;
  }
  return items;
}

function hasGoogleVisionBindings(env: Env): boolean {
  return Boolean(env.GCP_PROJECT_ID?.trim()) &&
    Boolean(env.GCP_CLIENT_EMAIL?.trim()) &&
    Boolean(env.GCP_PRIVATE_KEY?.trim());
}

function hasFatmanBindings(env: Env): boolean {
  return Boolean(env.FATMAN_SEARCH) &&
    Boolean(env.FATMAN_INSTANCE_NAME?.trim()) &&
    Boolean(env.FATMAN_DOCUMENT_VERSION?.trim()) &&
    Boolean(env.DB);
}

function pageKey(pageNumber: number): string {
  return PAGE_PREFIX + String(pageNumber).padStart(6, "0") + ".txt";
}

function pageNumberFromKey(key: string): number | undefined {
  if (!key.startsWith(PAGE_PREFIX) || !key.endsWith(".txt")) return undefined;
  const value = key.slice(PAGE_PREFIX.length, -4);
  if (!/^[0-9]{1,6}$/.test(value)) return undefined;
  const page = Number(value);
  return page >= 1 && page <= EXPECTED_PAGES ? page : undefined;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll("\r", " ").replaceAll("\n", " ").slice(0, 240);
}

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fatman book index</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18202a;background:#f4f6f8}body{margin:0;padding:32px 16px}.card{max-width:720px;margin:0 auto;background:white;border:1px solid #e2e6ea;border-radius:16px;padding:24px;box-shadow:0 8px 28px #10203012}h1{font-size:24px;margin:0 0 8px}.sub{color:#657180;line-height:1.5}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}.button{border:0;border-radius:10px;background:#1264d6;color:white;padding:11px 16px;font-size:15px;font-weight:600;cursor:pointer}.button.alt{background:#e9edf2;color:#18202a}.button:disabled{opacity:.5;cursor:wait}input{max-width:100%}textarea{width:100%;min-height:72px;padding:10px 12px;border:1px solid #d9dfe6;border-radius:10px;font:inherit;resize:vertical}.review{display:flex;gap:9px;align-items:flex-start;color:#4d5968;font-size:14px;line-height:1.45;margin:14px 0}.result{padding:12px 14px;border:1px solid #e3e8ed;border-radius:12px;margin:10px 0;background:#fafbfc}.result-title{font-weight:700;margin-bottom:5px}.result-text{white-space:pre-wrap;color:#4d5968;font-size:13px;line-height:1.5}progress{width:100%;height:10px}#status{white-space:pre-wrap;color:#374354;font-size:14px;min-height:42px}.note{font-size:13px;color:#6a7480;border-top:1px solid #eef0f3;margin-top:20px;padding-top:14px}
</style></head><body><main class="card"><div class="row" style="justify-content:space-between;align-items:center"><h1>Fatman 2nd Edition index</h1><a href="/admin/fatman/monitor" style="color:#1264d6;font-weight:650;text-decoration:none">Live monitor ↗</a></div><p class="sub">Choose the reviewed 538-page Fatman PDF. After checking its SHA-256 and page count, this page uploads the PDF privately to Google Cloud Storage. Keep it open until the upload finishes and background OCR starts. Google Vision OCR and indexing then continue on the server, even if you close this page. If the browser closes during transfer, choose the same PDF and select Import or resume to continue from the saved position.</p>
<div class="row"><button id="test-vision" class="button alt">Test Google Vision</button><span id="vision-status" class="sub">Connection not tested. This check sends no page images.</span></div>
<label class="review"><input id="quota-confirmed" type="checkbox"><span>I verified that at least 538 free Google Vision Document Text Detection units remain this month. I will not start the import if I cannot confirm this.</span></label>
<div class="row"><input id="pdf" type="file" accept="application/pdf"><button id="import" class="button">Import or resume</button><button id="resume-index" class="button alt" hidden>Resume indexing</button><button id="refresh" class="button alt">Refresh status</button><button id="disable" class="button alt">Disable book mode</button></div>
<div id="storage-access" class="note"></div><progress id="progress" value="0" max="538"></progress><p id="status">Checking index status…</p>
<h2>Review retrieval</h2><p class="sub">After all 538 pages finish, the server automatically verifies three page-grounded retrieval probes across the beginning, middle and end of the book. Book mode activates only when each search returns its expected PDF page. You can still run manual spot checks below.</p><div class="row"><textarea id="preview-query" placeholder="Enter a fact or phrase you can verify in the book"></textarea><button id="preview" class="button alt">Preview search</button></div><div id="preview-results"></div><label class="review"><input id="reviewed" type="checkbox"><span>I checked the currently displayed text and PDF page against the book.</span></label><button id="enable" class="button" disabled>Review 0/3 searches</button>
<div class="note">Only an administrator can open this page. Importing disables book mode. Enablement requires all 538 pages and three distinct reviewed search results.</div></main>
<script type="module">
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const EXPECTED_PDF_SHA256=${JSON.stringify(EXPECTED_PDF_SHA256)};
const statusEl=document.getElementById("status");
const progressEl=document.getElementById("progress");
const importButton=document.getElementById("import");
const resumeButton=document.getElementById("resume-index");
const API="/admin/api/fatman/";
function setStatus(text){statusEl.textContent=text;}
async function api(path,options){
  const response=await fetch(API+path,options);
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||("Request failed: "+response.status));
  return data;
}
let refreshTimer=null;
async function refresh(){
  try{
    const data=await api("status");
    let upload=await api("upload/status");
    if(upload.import?.status==="uploaded"&&upload.import.id){
      if(!refreshTimer)refreshTimer=setInterval(()=>refresh(),15000);
      await api("upload/"+encodeURIComponent(upload.import.id)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).catch(()=>undefined);
      upload=await api("upload/status?id="+encodeURIComponent(upload.import.id));
    }
    const job=upload.import;
    resumeButton.hidden=job?.canResume!==true;
    importButton.disabled=job?.canResume===true;
    const indexed=Math.max(Number(data.completedPages||0),Number(job?.indexedPages||0));
    progressEl.max=job?.status==="uploading"&&job.expectedSize?job.expectedSize:538;
    progressEl.value=progressEl.max===538?indexed:Number(job?.uploadedBytes||0);
    const firstError=(data.pages||[]).find(item=>item.error)?.error;
    const accessEl=document.getElementById("storage-access");
    accessEl.textContent=upload.serviceAccountEmail
      ? "Before upload, grant roles/storage.objectAdmin on bucket parmar-fatman-ocr-90db7be4 to "+upload.serviceAccountEmail+". This permission lets the Worker upload the PDF and lets Vision read it and write OCR output."
      : "Google service-account email is not configured on the Worker.";
    let jobLine="";
    if(job?.status==="uploading"){
      const pct=job.expectedSize?Math.floor((job.uploadedBytes/job.expectedSize)*100):0;
      jobLine="PDF upload: "+pct+" percent. Keep this page open until it reaches 100 percent.";
    }else if(job?.status==="uploaded"){
      jobLine="PDF upload complete. Starting background OCR and indexing.";
    }else if(job?.status==="processing"){
      jobLine="Background OCR and indexing: "+indexed+" of 538 pages indexed. You can close this page and return later.";
    }else if(job?.status==="completed"){
      jobLine="Import complete. All 538 pages are indexed. Review search results before enabling book mode.";
    }else if(job?.status==="failed"){
      jobLine="Import stopped: "+(job.error||"An error occurred.")+
        (job.canResume?" Saved OCR is preserved. Select Resume indexing; no PDF upload is needed.":" Choose the same PDF and select Import or resume.");
    }
    setStatus((data.enabled?"Book mode is enabled. ":"Book mode is disabled. ")+
      (data.exists?(data.completedPages+" of "+data.expectedPages+" pages indexed; "+data.queuedPages+" processing; "+data.failedPages+" failed."):"Index has not been created.")+
      (jobLine?"\\n"+jobLine:"")+
      (firstError?"\\nFirst indexing error: "+firstError:""));
    if((job?.status==="uploading"||job?.status==="uploaded"||job?.status==="processing")&&!refreshTimer){
      refreshTimer=setInterval(()=>refresh(),15000);
    }else if((!job||job.status==="completed"||job.status==="failed")&&refreshTimer){
      clearInterval(refreshTimer);refreshTimer=null;
    }
  }catch(error){setStatus("Could not read import status: "+error.message);}
}
const quotaConfirmed=document.getElementById("quota-confirmed");
const visionStatus=document.getElementById("vision-status");
const visionButton=document.getElementById("test-vision");
async function testVision(){
  visionButton.disabled=true;
  visionStatus.textContent="Checking Google Vision without sending an image…";
  try{
    await api("vision/test",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    visionStatus.textContent="Google Vision is reachable. This check sent no images and used 0 OCR units.";
  }catch(error){
    visionStatus.textContent="Google Vision check failed: "+error.message;
  }finally{visionButton.disabled=false;}
}
visionButton.addEventListener("click",testVision);
async function resumeIndex(){
  resumeButton.disabled=true;
  try{
    const upload=await api("upload/status");
    const job=upload.import;
    if(!job?.id||job.canResume!==true)throw new Error("No saved OCR result is ready to resume.");
    await api("upload/"+encodeURIComponent(job.id)+"/resume",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    await refresh();
  }catch(error){setStatus("Could not resume indexing: "+error.message);}
  finally{resumeButton.disabled=false;}
}
resumeButton.addEventListener("click",resumeIndex);
async function disable(){
  try{await api("disable",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});await refresh();}
  catch(error){setStatus("Could not disable book mode: "+error.message);}
}
let previewHasResults=false;
let activePreviewQuery="";
const reviewedQueries=new Set();
const enableButton=document.getElementById("enable");
const reviewedCheckbox=document.getElementById("reviewed");
function updateEnableGate(){
  const reviewedCount=Math.min(reviewedQueries.size,3);
  const canEnable=reviewedQueries.size>=3;
  enableButton.disabled=!canEnable;
  enableButton.textContent=canEnable?"Enable book mode":"Review "+reviewedCount+"/3 searches";
}
async function previewSearch(){
  enableButton.disabled=true;reviewedCheckbox.checked=false;previewHasResults=false;
  const query=document.getElementById("preview-query").value.replace(/\\s+/g," ").trim();
  activePreviewQuery=query;
  const resultsEl=document.getElementById("preview-results");resultsEl.replaceChildren();
  try{
    const data=await api("preview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query})});
    for(const item of data.results){
      const card=document.createElement("article");card.className="result";
      const title=document.createElement("div");title.className="result-title";
      title.textContent="PDF page "+item.page+(item.score===null?"":" · score "+item.score.toFixed(3));
      const passage=document.createElement("div");passage.className="result-text";passage.textContent=item.text;
      card.append(title,passage);resultsEl.append(card);
    }
    previewHasResults=data.results.length>0;
    setStatus(previewHasResults?"Review the retrieved passages above against the book. Complete three distinct searches.":"No page passages were returned. Try a more specific phrase.");
    updateEnableGate();
  }catch(error){setStatus("Search preview failed: "+error.message);}
}
async function enableBook(){
  enableButton.disabled=true;
  try{await api("finalize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reviewedQueries:Array.from(reviewedQueries).slice(0,3)})});await refresh();setStatus("Book mode is enabled.");}
  catch(error){setStatus("Could not enable book mode: "+error.message);updateEnableGate();}
}
reviewedCheckbox.addEventListener("change",()=>{
  if(reviewedCheckbox.checked&&previewHasResults&&activePreviewQuery)reviewedQueries.add(activePreviewQuery);
  else if(!reviewedCheckbox.checked&&activePreviewQuery)reviewedQueries.delete(activePreviewQuery);
  updateEnableGate();
});
document.getElementById("preview").addEventListener("click",previewSearch);
enableButton.addEventListener("click",enableBook);
async function importBook(){
  const file=document.getElementById("pdf").files[0];
  if(!file){setStatus("Choose the reviewed Fatman PDF to start or resume its upload.");return;}
  if(!quotaConfirmed.checked){setStatus("Before importing, verify at least 538 free Google Vision OCR units remain this month and check the box above.");return;}
  importButton.disabled=true;
  try{
    setStatus("Checking PDF and page count…");
    const bytes=await file.arrayBuffer();
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const sourceHash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("").toUpperCase();
    if(sourceHash!==EXPECTED_PDF_SHA256)throw new Error("This is not the reviewed Fatman PDF. No index changes were made.");
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
    const pageCount=pdf.numPages;
    await pdf.destroy();
    if(pageCount!==538)throw new Error("This import requires 538 PDF pages. The selected file has "+pageCount+".");
    setStatus("Testing Google Vision without sending a page image…");
    await api("vision/test",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    setStatus("Preparing the Fatman text index…");
    await api("prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pages:pageCount})});
    const started=await api("upload/start",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({sha256:sourceHash,size:file.size,quotaConfirmed:quotaConfirmed.checked})
    });
    const importId=started.importId;
    let offset=Number(started.uploadedBytes||0);
    if(started.status==="completed"){
      await refresh();
      return;
    }
    if(started.status==="processing"){
      await api("upload/"+encodeURIComponent(importId)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
      if(!refreshTimer)refreshTimer=setInterval(()=>refresh(),15000);
      await refresh();
      return;
    }
    const chunkSize=8*1024*1024;
    progressEl.max=file.size;
    progressEl.value=offset;
    while(offset<file.size){
      setStatus("Uploading the private PDF: "+Math.floor(offset/file.size*100)+" percent. Keep this page open until the upload completes.");
      const chunk=file.slice(offset,Math.min(file.size,offset+chunkSize));
      const response=await fetch(API+"upload/"+encodeURIComponent(importId)+"/chunk",{
        method:"POST",
        headers:{
          "content-type":"application/octet-stream",
          "x-fatman-chunk-start":String(offset),
          "x-fatman-total-size":String(file.size)
        },
        body:chunk
      });
      const data=await response.json();
      if(response.status===409&&Number.isSafeInteger(Number(data.uploadedBytes))){
        offset=Number(data.uploadedBytes);
        progressEl.value=offset;
        continue;
      }
      if(!response.ok||!data.ok)throw new Error(data.error||("PDF upload failed: "+response.status));
      offset=Number(data.uploadedBytes);
      progressEl.value=offset;
    }
    progressEl.max=538;
    progressEl.value=0;
    setStatus("PDF safely uploaded. Starting background Google Vision OCR and indexing…");
    await api("upload/"+encodeURIComponent(importId)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    if(!refreshTimer)refreshTimer=setInterval(()=>refresh(),15000);
    await refresh();
  }catch(error){
    setStatus("Import paused: "+error.message+" Choose the same PDF and select Import or resume to continue from the saved upload position.");
  }finally{importButton.disabled=false;}
}
document.getElementById("import").addEventListener("click",importBook);
document.getElementById("refresh").addEventListener("click",refresh);
document.getElementById("disable").addEventListener("click",disable);
refresh();
</script></body></html>`;
