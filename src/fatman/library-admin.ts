import type { Env } from "../config/env";
import { json } from "../http/response";
import {
  startFatmanLibraryUpload as startLibraryUpload,
  getFatmanImportJob,
} from "./import";

export function fatmanLibraryAdminPage(): Response {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function fatmanLibraryBooks(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The book database is not configured." }, 503);
  try {
    const rows = await env.DB.prepare(
      "SELECT id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, error_message, created_at, updated_at " +
      "FROM fatman_books ORDER BY created_at DESC LIMIT 100"
    ).all<{
      id: string;
      title: string;
      source_filename: string;
      source_sha256: string;
      expected_size: number;
      page_count: number;
      status: string;
      indexed_pages: number;
      error_message: string | null;
      created_at: number;
      updated_at: number;
    }>();
    return json({
      ok: true,
      books: (rows.results ?? []).map((book) => ({
        id: book.id,
        title: book.title,
        filename: book.source_filename,
        fingerprint: book.source_sha256,
        sizeBytes: Number(book.expected_size),
        pageCount: Number(book.page_count),
        indexedPages: Number(book.indexed_pages),
        status: book.status,
        error: book.error_message ?? undefined,
        createdAt: Number(book.created_at),
        updatedAt: Number(book.updated_at),
      })),
    });
  } catch (error) {
    return json({ ok: false, error: friendlyError(error) }, 502);
  }
}

export async function startFatmanLibraryUpload(env: Env, request: Request): Promise<Response> {
  return startLibraryUpload(env, request);
}

export async function fatmanLibraryImportStatus(env: Env, importId: string | null): Promise<Response> {
  if (!importId || !/^[a-f0-9-]{36}$/iu.test(importId)) {
    return json({ ok: false, error: "Choose a valid book import to check." }, 400);
  }
  try {
    const job = await getFatmanImportJob(env, importId);
    if (!job || !job.book_id) return json({ ok: false, error: "This book import could not be found." }, 404);
    const status = await import("./import").then(({ fatmanUploadStatus }) => fatmanUploadStatus(env, importId, true));
    return status;
  } catch (error) {
    return json({ ok: false, error: friendlyError(error) }, 502);
  }
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 240);
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatman · Book library</title>
<style>
:root{color-scheme:light;--bg:#f4f6f8;--card:#fff;--ink:#17202b;--muted:#687585;--line:#e4e9ef;--blue:#245fd6;--green:#168354;--amber:#a86b09;--red:#b93333;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);padding:28px 16px 54px}.shell{max-width:900px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:19px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:750}.title{font-size:clamp(25px,4vw,34px);letter-spacing:-.04em;margin:5px 0}.sub{color:var(--muted);line-height:1.5;margin:0}.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);padding:10px 13px;font:inherit;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer}.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.btn:disabled{opacity:.45;cursor:wait}.card{background:var(--card);border:1px solid var(--line);border-radius:17px;padding:20px;box-shadow:0 5px 24px #17202b08;margin-top:14px}.card h2{font-size:16px;margin:0 0 7px}.field{display:block;margin:17px 0 8px;font-size:13px;font-weight:700}.input{display:block;width:100%;border:1px solid #d8dee7;border-radius:11px;padding:12px 13px;background:#fff;font:inherit;color:var(--ink)}.drop{display:flex;align-items:center;justify-content:center;text-align:center;min-height:140px;border:1.5px dashed #c8d1dd;border-radius:14px;padding:20px;background:#fafbfd;cursor:pointer}.drop strong{display:block;margin-bottom:5px}.drop small{color:var(--muted)}.drop input{position:absolute;width:1px;height:1px;opacity:0}.fileinfo{font-size:12px;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}.check{display:flex;gap:10px;align-items:flex-start;margin:15px 0;color:#566273;font-size:13px;line-height:1.45}.check input{margin-top:3px}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}.status{white-space:pre-wrap;min-height:44px;font-size:13px;color:#4b5868;line-height:1.5;margin:14px 0 7px}.progress{height:10px;width:100%;border:0;border-radius:99px;overflow:hidden;background:#e9edf2}.progress::-webkit-progress-bar{background:#e9edf2}.progress::-webkit-progress-value{background:var(--blue);border-radius:99px}.progress::-moz-progress-bar{background:var(--blue);border-radius:99px}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:17px}.step{padding:10px;border:1px solid var(--line);border-radius:11px;background:#fafbfd;min-width:0}.step b{display:block;font-size:12px}.step span{display:block;color:var(--muted);font-size:11px;margin-top:4px}.step.active{border-color:#b9cffb;background:#f4f7ff}.step.done{border-color:#bfe6d1;background:#f3fbf6}.step.failed{border-color:#f2caca;background:#fff7f7}.table-wrap{overflow:auto}.books{width:100%;border-collapse:collapse;font-size:13px}.books th,.books td{text-align:left;border-bottom:1px solid #edf0f4;padding:11px 9px;vertical-align:top}.books th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.pill{display:inline-block;border-radius:99px;background:#eef2f7;padding:4px 8px;font-size:11px;font-weight:750;text-transform:capitalize}.pill.ready{background:#e8f7ef;color:#14774c}.pill.processing,.pill.uploading,.pill.uploaded{background:#eef4ff;color:#2457a7}.pill.failed,.pill.needs_review{background:#fff0f0;color:#a22d2d}.muted{color:var(--muted)}.empty{padding:24px;text-align:center;color:var(--muted);font-size:13px}.alert{border:1px solid #f0d3a9;background:#fff9ee;border-radius:11px;padding:11px 13px;color:#795015;font-size:12px;line-height:1.45;margin-top:12px}.error{color:var(--red)}.footer{font-size:11px;color:var(--muted);margin:16px 2px}@media(max-width:620px){body{padding:18px 11px 36px}.card{padding:16px}.steps{grid-template-columns:repeat(2,1fr)}.books th:nth-child(2),.books td:nth-child(2){display:none}}
</style>
</head>
<body><main class="shell">
<header class="top"><div><div class="eyebrow">Parmar AI / Fatman</div><h1 class="title">Book library</h1><p class="sub">Add a PDF. Fatman will read it, index it and make it available for answers automatically.</p></div><div class="actions"><a class="btn" href="/admin">Admin home</a><a class="btn" href="/admin/fatman/monitor">Legacy book monitor</a></div></header>
<section class="card">
<h2>Add a book</h2><p class="sub">Choose a PDF and give it a name. The system checks the file, uploads it securely and runs the reading and indexing steps in the background.</p>
<label class="field" for="book-title">Book name</label><input class="input" id="book-title" maxlength="160" placeholder="For example, Indian Polity – Reference Book">
<label class="field">PDF file</label><label class="drop" for="book-pdf"><span><strong>Choose a PDF from this device</strong><small>PDF format · up to 1 GB</small><input id="book-pdf" type="file" accept="application/pdf"></span></label><div class="fileinfo" id="file-info">No PDF selected.</div>
<label class="check"><input type="checkbox" id="cost-confirmed"><span>I understand that reading this PDF uses Google Cloud OCR and may incur usage charges on the connected Google Cloud project.</span></label>
<div class="row"><button class="btn primary" id="upload" disabled>Add book to Fatman</button><button class="btn" id="refresh">Refresh status</button></div>
<progress class="progress" id="progress" value="0" max="100"></progress><p class="status" id="status" aria-live="polite">Choose a PDF to begin. You can leave and return later; the server continues OCR and indexing after upload.</p>
<div class="steps"><div class="step" id="step-upload"><b>1 · Secure upload</b><span>PDF transferred</span></div><div class="step" id="step-ocr"><b>2 · Read PDF</b><span>Google Vision OCR</span></div><div class="step" id="step-index"><b>3 · Build search</b><span>Page indexing</span></div><div class="step" id="step-ready"><b>4 · Verify</b><span>Ready for questions</span></div></div>
<div class="alert">Keep this page open while the PDF is uploading. Once the upload reaches 100%, OCR and indexing continue on the server even when you close this page. A failed transfer can be resumed by selecting the same PDF again.</div>
</section>
<section class="card"><div class="row" style="justify-content:space-between;margin:0 0 10px"><div><h2>Books already added</h2><p class="sub">Each book is tracked separately. Completed books become searchable in Fatman.</p></div><button class="btn" id="refresh-books">Refresh list</button></div><div class="table-wrap"><table class="books"><thead><tr><th>Book</th><th>Pages indexed</th><th>Status</th><th>Last updated</th></tr></thead><tbody id="books"><tr><td colspan="4" class="empty">Loading your book library…</td></tr></tbody></table></div></section>
<p class="footer">Administrator-only page · Existing Fatman 2nd Edition import remains unchanged.</p>
</main>
<script type="module">
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const ROOT="/admin/api/fatman/", LIB=ROOT+"library/";
const el=id=>document.getElementById(id);
const fileInput=el("book-pdf"),titleInput=el("book-title"),uploadButton=el("upload"),statusEl=el("status"),progress=el("progress");
let activeImportId=null,selectedFile=null,refreshTimer=null,uploading=false,lastStatus=null;
function say(message,isError=false){statusEl.textContent=message;statusEl.classList.toggle("error",isError);}
async function api(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin"});let data={};try{data=await response.json();}catch{}if(!response.ok||data.ok!==true)throw new Error(data.error||"The request could not be completed (HTTP "+response.status+").");return data;}
function humanStatus(status){return ({ready:"Ready",processing:"Processing",uploading:"Uploading",uploaded:"Upload complete",failed:"Needs attention",needs_review:"Needs review"})[status]||String(status||"Waiting").replaceAll("_"," ");}
function stage(id,state){const node=el("step-"+id);node.className="step"+(state==="done"?" done":state==="active"?" active":state==="failed"?" failed":"");}
function renderStages(job,pipeline){
 const status=job?.status||"";
 const vision=pipeline?.vision?.status||"not_started";
 const indexed=Number(job?.indexedPages||0),total=Number(job?.expectedPages||0);
 const uploaded=Number(job?.uploadedBytes||0),size=Number(job?.expectedSize||0);
 const uploadDone=size>0&&uploaded>=size;
 const visionDone=vision==="completed"||indexed>0;
 const indexDone=status==="completed";
 const failed=status==="failed";
 stage("upload",failed?"done":uploadDone?"done":status==="uploading"?"active":"");
 stage("ocr",failed?"failed":visionDone?"done":uploadDone?"active":"");
 stage("index",failed?"failed":indexDone?"done":visionDone?"active":"");
 stage("ready",indexDone?"done":failed?"failed":"");
 if(status==="uploading"&&size){progress.max=size;progress.value=uploaded;}
 else if(total){progress.max=total;progress.value=indexed;}
 else{progress.max=100;progress.value=uploadDone?100:0;}
}
function formatBytes(value){const n=Number(value||0);if(n<1024)return n+" B";const units=["KB","MB","GB"];let x=n/1024,i=0;while(x>=1024&&i<units.length-1){x/=1024;i++;}return x.toFixed(1)+" "+units[i];}
async function refreshCurrent(){
 if(!activeImportId)return;
 const data=await api(ROOT+"upload/status?id="+encodeURIComponent(activeImportId));
 const job=data.import;if(!job)return;
 lastStatus=data;renderStages(job,data.pipeline);
 const pct=job.expectedSize?Math.floor(job.uploadedBytes/job.expectedSize*100):0;
 if(job.status==="uploading")say("Uploading securely: "+pct+"% · "+formatBytes(job.uploadedBytes)+" of "+formatBytes(job.expectedSize)+". Keep this page open until the transfer is complete.");
 else if(job.status==="uploaded"){say("PDF uploaded. Starting the automatic reading and indexing process…");await api(ROOT+"upload/"+encodeURIComponent(activeImportId)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).catch(()=>{});}
 else if(job.status==="processing"){
  const vision=data.pipeline?.vision?.status||"starting";
  say((vision==="running"?"Reading PDF with Google Vision OCR. ":"OCR complete or finishing. ")+ "Search index: "+job.indexedPages+" of "+job.expectedPages+" pages. You can close this page; the server will continue.");
 }
 else if(job.status==="completed")say("This book has been processed and verified. It is now ready for questions in Fatman.");
 else if(job.status==="failed")say("This book needs attention: "+(job.error||"The processing step stopped.")+(job.canResume?" You can resume indexing without uploading the PDF again.":" Select the same PDF again to retry the upload."),true);
 if(job.status==="uploading"||job.status==="uploaded"||job.status==="processing"){
  if(!refreshTimer)refreshTimer=setInterval(()=>refreshCurrent().then(refreshBooks).catch(e=>say("Could not refresh: "+e.message,true)),10000);
 }else if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
 await refreshBooks();
}
async function refreshBooks(){
 try{
  const data=await api(LIB+"books");const tbody=el("books");tbody.replaceChildren();
  if(!data.books.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=4;cell.className="empty";cell.textContent="No books have been added yet.";row.append(cell);tbody.append(row);return;}
  for(const book of data.books){
   const row=document.createElement("tr"),name=document.createElement("td"),pages=document.createElement("td"),state=document.createElement("td"),updated=document.createElement("td");
   const strong=document.createElement("strong");strong.textContent=book.title;name.append(strong);
   const small=document.createElement("div");small.className="muted";small.textContent=book.filename||"";name.append(small);
   pages.textContent=book.indexedPages+" / "+book.pageCount;
   const pill=document.createElement("span");pill.className="pill "+book.status;pill.textContent=humanStatus(book.status);state.append(pill);
   if(book.error){const err=document.createElement("div");err.className="muted";err.textContent=book.error;state.append(err);}
   updated.textContent=new Date(book.updatedAt).toLocaleString();
   row.append(name,pages,state,updated);tbody.append(row);
  }
 }catch(error){el("books").textContent="Could not load book list: "+error.message;}
}
fileInput.addEventListener("change",()=>{
 selectedFile=fileInput.files?.[0]||null;
 if(selectedFile&&!titleInput.value.trim())titleInput.value=selectedFile.name.replace(/\.pdf$/iu,"").replace(/[_-]+/gu," ").trim();
 el("file-info").textContent=selectedFile?selectedFile.name+" · "+formatBytes(selectedFile.size):"No PDF selected.";
 uploadButton.disabled=!selectedFile||uploading;
});
async function inspectPdf(file){
 if(file.size<8||file.size>1024*1024*1024)throw new Error("Choose a PDF between 8 bytes and 1 GB.");
 const bytes=await file.arrayBuffer();
 const header=new TextDecoder().decode(bytes.slice(0,5));
 if(header!=="%PDF-")throw new Error("The selected file does not look like a valid PDF.");
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 const sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("").toUpperCase();
 const pdf=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
 const pageCount=pdf.numPages;await pdf.destroy();
 if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>2000)throw new Error("This PDF has "+pageCount+" pages. The supported range is 1–2,000 pages per book.");
 return {bytes,sha256,pageCount};
}
async function uploadBook(){
 const file=selectedFile;if(!file)return;
 if(!titleInput.value.trim()){say("Enter a name for this book.",true);return;}
 if(!el("cost-confirmed").checked){say("Please confirm that you understand OCR processing may incur Google Cloud usage charges.",true);return;}
 uploading=true;uploadButton.disabled=true;
 try{
  say("Checking the PDF and calculating its file fingerprint…");
  const info=await inspectPdf(file);
  say("PDF checked: "+info.pageCount+" pages. Checking the secure upload service…");
  const started=await api(LIB+"upload/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
   title:titleInput.value.trim(),filename:file.name,sha256:info.sha256,size:file.size,pageCount:info.pageCount,costConfirmed:true
  })});
  activeImportId=started.importId;
  if(started.status==="ready"||started.status==="completed"){await refreshCurrent();return;}
  if(started.status==="processing"||started.status==="uploaded"){
   if(started.status==="uploaded")await api(ROOT+"upload/"+encodeURIComponent(activeImportId)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   await refreshCurrent();return;
  }
  let offset=Number(started.uploadedBytes||0),total=file.size;const chunkSize=8*1024*1024;
  progress.max=total;progress.value=offset;
  while(offset<total){
   say("Uploading securely: "+Math.floor(offset/total*100)+"%. You can keep this page open until the transfer finishes.");
   const response=await fetch(ROOT+"upload/"+encodeURIComponent(activeImportId)+"/chunk",{
    method:"POST",credentials:"same-origin",headers:{"content-type":"application/octet-stream","x-fatman-chunk-start":String(offset),"x-fatman-total-size":String(total)},
    body:file.slice(offset,Math.min(total,offset+chunkSize))
   });
   let data={};try{data=await response.json();}catch{}
   if(response.status===409&&Number.isSafeInteger(Number(data.uploadedBytes))){offset=Number(data.uploadedBytes);progress.value=offset;continue;}
   if(!response.ok||data.ok!==true)throw new Error(data.error||"The PDF transfer was interrupted.");
   offset=Number(data.uploadedBytes);progress.value=offset;
  }
  say("Upload complete. Starting automatic OCR and search indexing…");
  await api(ROOT+"upload/"+encodeURIComponent(activeImportId)+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  await refreshCurrent();
 }catch(error){say("The process paused: "+error.message+" You can select this same PDF again to resume safely.",true);}
 finally{uploading=false;uploadButton.disabled=!selectedFile;}
}
uploadButton.addEventListener("click",uploadBook);
el("refresh").addEventListener("click",()=>refreshCurrent().catch(e=>say(e.message,true)));
el("refresh-books").addEventListener("click",refreshBooks);
refreshBooks();
</script></body></html>`;
