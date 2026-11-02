import type { AiSearchInstance, AiSearchItem, Env } from "../config/env";
import { getFatmanBookState, reserveFatmanSearchQuery, setFatmanBookState } from "../analytics/db";
import { json } from "../http/response";

const EXPECTED_PAGES = 538;
const EXPECTED_PDF_SHA256 = "8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_PREFIX = "fatman/pages/page-";

export function fatmanAdminPage(): Response {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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

    const instance = env.FATMAN_SEARCH!.get(env.FATMAN_INSTANCE_NAME!.trim());
    const key = pageKey(pageNumber);
    const existing = await instance.items.list({ search: key, per_page: 50, source: "builtin" });
    const exactMatches = (existing.result ?? []).filter((item) => item.key === key);
    if (exactMatches.some((item) => item.status === "completed")) {
      return json({ ok: true, page: pageNumber, status: "completed", skipped: true });
    }
    if (exactMatches.some((item) => item.status === "queued" || item.status === "running")) {
      return json({ ok: true, page: pageNumber, status: "running", skipped: true }, 202);
    }
    for (const item of exactMatches) await instance.items.delete(item.id);

    const blob = new Blob([bytes], { type: "image/jpeg" });
    const item = await instance.items.upload(key, blob);
    return json({ ok: true, page: pageNumber, status: item.status }, 202);
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
    const pages = items.map((item) => ({
      page: pageNumberFromKey(item.key),
      status: item.status,
    })).filter((item): item is { page: number; status: string } => item.page !== undefined);
    const completedPages = pages.filter((item) => item.status === "completed").length;
    return json({
      ok: true,
      exists: true,
      enabled: state.enabled && state.documentVersion === env.FATMAN_DOCUMENT_VERSION?.trim(),
      expectedPages: EXPECTED_PAGES,
      completedPages,
      queuedPages: pages.filter((item) => item.status === "queued" || item.status === "running").length,
      failedPages: pages.filter((item) => item.status === "error" || item.status === "skipped").length,
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
        failedPages: Array.from(pageByNumber.values()).filter((item) => item.status === "error" || item.status === "skipped").length,
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

async function listFatmanPages(instance: AiSearchInstance): Promise<AiSearchItem[]> {
  const items: AiSearchItem[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const response = await instance.items.list({ page, per_page: 50, source: "builtin" });
    items.push(...(response.result ?? []).filter((item) => item.key.startsWith(PAGE_PREFIX)));
    totalPages = Number(response.result_info?.total_pages ?? page);
    page += 1;
  }
  return items;
}

function hasFatmanBindings(env: Env): boolean {
  return Boolean(env.FATMAN_SEARCH) &&
    Boolean(env.FATMAN_INSTANCE_NAME?.trim()) &&
    Boolean(env.FATMAN_DOCUMENT_VERSION?.trim()) &&
    Boolean(env.DB);
}

function pageKey(pageNumber: number): string {
  return PAGE_PREFIX + String(pageNumber).padStart(6, "0") + ".jpg";
}

function pageNumberFromKey(key: string): number | undefined {
  if (!key.startsWith(PAGE_PREFIX) || !key.endsWith(".jpg")) return undefined;
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
</style></head><body><main class="card"><h1>Fatman 2nd Edition index</h1><p class="sub">Choose the reviewed 538-page Fatman PDF. The importer checks its SHA-256 before creating or uploading anything, then converts pages to images for OCR. Keep this page open while the import runs.</p>
<div class="row"><input id="pdf" type="file" accept="application/pdf"><button id="import" class="button">Import or resume</button><button id="refresh" class="button alt">Refresh status</button><button id="disable" class="button alt">Disable book mode</button></div>
<progress id="progress" value="0" max="538"></progress><p id="status">Checking index status…</p>
<h2>Review retrieval</h2><p class="sub">After all pages finish, run three different searches using facts you can verify in the book. Review the returned text and PDF page for each before enabling.</p><div class="row"><textarea id="preview-query" placeholder="Enter a fact or phrase you can verify in the book"></textarea><button id="preview" class="button alt">Preview search</button></div><div id="preview-results"></div><label class="review"><input id="reviewed" type="checkbox"><span>I checked the currently displayed text and PDF page against the book.</span></label><button id="enable" class="button" disabled>Review 0/3 searches</button>
<div class="note">Only an administrator can open this page. Importing disables book mode. Enablement requires all 538 pages and three distinct reviewed search results.</div></main>
<script type="module">
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const statusEl=document.getElementById("status");
const progressEl=document.getElementById("progress");
const importButton=document.getElementById("import");
const API="/admin/api/fatman/";
function setStatus(text){statusEl.textContent=text;}
async function api(path,options){
  const response=await fetch(API+path,options);
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||("Request failed: "+response.status));
  return data;
}
async function refresh(){
  try{
    const data=await api("status");
    progressEl.value=data.completedPages||0;
    setStatus((data.enabled?"Book mode is enabled. ":"Book mode is disabled. ")+
      (data.exists?(data.completedPages+" of "+data.expectedPages+" pages indexed; "+data.queuedPages+" processing; "+data.failedPages+" failed."):"Index has not been created."));
  }catch(error){setStatus("Could not read index status: "+error.message);}
}
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
async function renderPage(pdf,pageNumber){
  const page=await pdf.getPage(pageNumber);
  const initial=page.getViewport({scale:1});
  const scale=Math.min(1.8,1300/initial.width);
  const viewport=page.getViewport({scale});
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
  const context=canvas.getContext("2d",{alpha:false});
  if(!context)throw new Error("Could not render PDF page "+pageNumber);
  await page.render({canvasContext:context,viewport}).promise;
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.88));
  canvas.width=0;canvas.height=0;
  if(!blob)throw new Error("Could not encode PDF page "+pageNumber);
  if(blob.size>2*1024*1024)throw new Error("Rendered page "+pageNumber+" exceeds the 2 MB page limit.");
  return blob;
}
async function importBook(){
  const file=document.getElementById("pdf").files[0];
  if(!file){setStatus("Choose the PDF first.");return;}
  importButton.disabled=true;
  progressEl.value=0;
  try{
    setStatus("Reading the PDF in this browser…");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const sourceHash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("").toUpperCase();
    if(sourceHash!==EXPECTED_PDF_SHA256)throw new Error("This is not the reviewed Fatman PDF. No index changes were made.");
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    if(pdf.numPages!==538)throw new Error("This import requires 538 PDF pages. The selected file has "+pdf.numPages+".");
    setStatus("Preparing OCR index…");
    await api("prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pages:pdf.numPages})});
    const current=await api("status");
    const complete=new Set((current.pages||[]).filter(item=>item.status==="completed").map(item=>item.page));
    let next=1,done=complete.size,failure=null;
    progressEl.value=done;
    setStatus("Uploading page images… "+done+" already indexed.");
    async function worker(){
      while(next<=pdf.numPages&&!failure){
        const pageNumber=next++;
        if(complete.has(pageNumber))continue;
        try{
          const blob=await renderPage(pdf,pageNumber);
          let response;
          for(let attempt=0;attempt<3;attempt++){
            response=await fetch(API+"page/"+pageNumber,{method:"POST",headers:{"content-type":"image/jpeg"},body:blob});
            if(response.ok)break;
            if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
          }
          const data=await response.json();
          if(!response.ok||!data.ok)throw new Error(data.error||("Page "+pageNumber+" upload failed."));
          done++;progressEl.value=done;
          setStatus("Uploading page images… "+done+" of "+pdf.numPages+".");
        }catch(error){failure=error;}
      }
    }
    await Promise.all([worker(),worker(),worker()]);
    if(failure)throw failure;
    setStatus("All page images are uploaded. Waiting for OCR and indexing…");
    for(let attempt=0;attempt<180;attempt++){
      const data=await api("status");
      progressEl.value=data.completedPages||0;
      setStatus("OCR index: "+data.completedPages+" of "+data.expectedPages+" pages complete; "+data.queuedPages+" processing; "+data.failedPages+" failed.");
      if(data.completedPages===538&&data.failedPages===0){
        setStatus("All 538 pages are indexed. Review a search result above before enabling book mode.");
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
    throw new Error("Indexing is still processing. Refresh this page later to check progress.");
  }catch(error){setStatus("Import stopped: "+error.message);}
  finally{importButton.disabled=false;}
}
document.getElementById("import").addEventListener("click",importBook);
document.getElementById("refresh").addEventListener("click",refresh);
document.getElementById("disable").addEventListener("click",disable);
refresh();
</script></body></html>`;
