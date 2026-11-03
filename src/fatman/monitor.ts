import type { Env } from "../config/env";
import { fatmanIndexStatus } from "./admin";
import { fatmanUploadStatus } from "./import";
import { json } from "../http/response";

const EXPECTED_PAGES = 538;

interface PageRecord {
  page: number;
  status: string;
  error?: string;
}

export function fatmanMonitorPage(): Response {
  return new Response(MONITOR_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function fatmanMonitorStatus(env: Env): Promise<Response> {
  try {
    const [indexResponse, uploadResponse] = await Promise.all([
      fatmanIndexStatus(env),
      fatmanUploadStatus(env, null, true),
    ]);
    const [indexData, uploadData] = await Promise.all([
      indexResponse.json() as Promise<Record<string, unknown>>,
      uploadResponse.json() as Promise<Record<string, unknown>>,
    ]);

    if (!indexResponse.ok || indexData.ok !== true) {
      return json({
        ok: false,
        error: typeof indexData.error === "string" ? indexData.error : "Could not read Fatman AI Search status.",
      }, indexResponse.status || 502);
    }
    if (!uploadResponse.ok || uploadData.ok !== true) {
      return json({
        ok: false,
        error: typeof uploadData.error === "string" ? uploadData.error : "Could not read Fatman import status.",
      }, uploadResponse.status || 502);
    }

    const rawPages = Array.isArray(indexData.pages) ? indexData.pages as PageRecord[] : [];
    const byPage = new Map<number, PageRecord>();
    for (const item of rawPages) {
      if (!Number.isSafeInteger(item.page) || item.page < 1 || item.page > EXPECTED_PAGES) continue;
      const current = byPage.get(item.page);
      if (!current || pageStatusPriority(item.status) > pageStatusPriority(current.status)) {
        byPage.set(item.page, item);
      }
    }

    const pages = Array.from({ length: EXPECTED_PAGES }, (_, index) => {
      const page = index + 1;
      const record = byPage.get(page);
      return {
        page,
        status: record?.status ?? "missing",
        ...(record?.error ? { error: record.error } : {}),
      };
    });

    const counts = {
      completed: pages.filter((item) => item.status === "completed").length,
      running: pages.filter((item) => item.status === "running").length,
      queued: pages.filter((item) => item.status === "queued").length,
      failed: pages.filter((item) => isFailedPageStatus(item.status)).length,
      missing: pages.filter((item) => item.status === "missing").length,
    };
    const submitted = EXPECTED_PAGES - counts.missing;
    let highestContiguousCompletedPage = 0;
    for (const item of pages) {
      if (item.status !== "completed") break;
      highestContiguousCompletedPage = item.page;
    }

    return json({
      ok: true,
      checkedAt: new Date().toISOString(),
      expectedPages: EXPECTED_PAGES,
      enabled: indexData.enabled === true,
      indexExists: indexData.exists === true,
      documentVersion: env.FATMAN_DOCUMENT_VERSION?.trim() ?? "",
      progress: {
        completedPages: counts.completed,
        remainingPages: EXPECTED_PAGES - counts.completed,
        submittedPages: submitted,
        notSubmittedPages: counts.missing,
        processingPages: counts.running + counts.queued,
        highestContiguousCompletedPage,
        completionPercent: roundPercent(counts.completed, EXPECTED_PAGES),
        submissionPercent: roundPercent(submitted, EXPECTED_PAGES),
        counts,
      },
      pages,
      missingRanges: compressPageRanges(pages.filter((item) => item.status === "missing").map((item) => item.page)),
      failedPages: pages.filter((item) => isFailedPageStatus(item.status)),
      import: uploadData.import ?? null,
      pipeline: uploadData.pipeline ?? {
        vision: { status: "unknown" },
        workflow: { status: "unknown" },
      },
      storage: {
        bucketConfigured: uploadData.bucketConfigured === true,
        serviceAccountEmail: uploadData.serviceAccountEmail ?? null,
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}

function pageStatusPriority(status: string): number {
  if (status === "completed") return 5;
  if (status === "running" || status === "queued") return 4;
  if (isFailedPageStatus(status)) return 3;
  return 0;
}

function isFailedPageStatus(status: string): boolean {
  return status === "error" || status === "skipped" || status === "outdated";
}

function roundPercent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

function compressPageRanges(pageNumbers: number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const page of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.end + 1 === page) last.end = page;
    else ranges.push({ start: page, end: page });
  }
  return ranges;
}

const MONITOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatman live monitor</title>
<style>
:root{color-scheme:light;--bg:#f4f6f8;--card:#fff;--ink:#17202b;--muted:#657180;--line:#e5e9ee;--blue:#2563eb;--green:#169b62;--amber:#c58a16;--red:#d04444;--soft:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);padding:28px 16px 56px}.shell{max-width:1180px;margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}.eyebrow{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);font-weight:700}.title{font-size:clamp(25px,4vw,36px);letter-spacing:-.04em;margin:5px 0}.sub{color:var(--muted);line-height:1.5;margin:0}.actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.btn{border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);padding:10px 14px;font:inherit;font-size:13px;font-weight:650;text-decoration:none;cursor:pointer}.btn.primary{background:#17202b;color:#fff;border-color:#17202b}.btn:disabled{opacity:.5;cursor:wait}.live{display:inline-flex;align-items:center;gap:7px;border:1px solid #cfe9dc;border-radius:999px;padding:7px 11px;color:#147d4e;background:#f1fbf5;font-size:12px;font-weight:700}.dot{width:7px;height:7px;background:#18a365;border-radius:50%;box-shadow:0 0 0 4px #18a3651c}.card{background:var(--card);border:1px solid var(--line);border-radius:17px;padding:19px;box-shadow:0 4px 20px #17202b06}.hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(230px,.7fr);gap:16px;margin-bottom:16px}.big-number{font-size:clamp(42px,7vw,64px);letter-spacing:-.06em;font-weight:750;line-height:1;margin:10px 0 8px}.big-number small{font-size:18px;color:var(--muted);font-weight:600;letter-spacing:-.02em}.progress-track{height:12px;background:#e9edf2;border-radius:99px;overflow:hidden;margin:14px 0 10px}.progress-fill{height:100%;width:0;background:var(--green);border-radius:99px;transition:width .35s ease}.progress-meta{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:16px}.stat{border:1px solid var(--line);border-radius:13px;padding:13px 14px;background:#fff}.stat strong{display:block;font-size:27px;letter-spacing:-.04em}.stat span{font-size:12px;color:var(--muted)}.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}.blue{color:var(--blue)}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 13px}.section-head h2{font-size:16px;margin:0;letter-spacing:-.02em}.muted{color:var(--muted)}.pipeline{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.stage{border:1px solid var(--line);border-radius:13px;padding:14px;background:#fff;min-width:0}.stage .name{font-size:12px;color:var(--muted);margin-bottom:8px}.stage .value{font-size:15px;font-weight:700;overflow-wrap:anywhere}.stage .detail{font-size:11px;color:var(--muted);line-height:1.45;margin-top:5px}.stage-state{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;margin-top:9px}.stage-state .dot{width:6px;height:6px;box-shadow:none}.bar-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.small-track{height:7px;background:#edf0f3;border-radius:99px;overflow:hidden;margin:8px 0 5px}.small-fill{height:100%;background:var(--blue);border-radius:99px}.pages-card{margin-top:16px}.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.select,.search{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:9px 11px;font:inherit;font-size:12px}.search{width:130px}.legend{display:flex;gap:11px;flex-wrap:wrap;margin:14px 0;font-size:11px;color:var(--muted)}.key{display:inline-flex;align-items:center;gap:5px}.swatch{width:9px;height:9px;border-radius:3px;background:#dfe4ea}.swatch.completed{background:#19a46a}.swatch.running{background:#3983ed}.swatch.queued{background:#e5ad42}.swatch.failed{background:#dc5555}.page-grid{display:grid;grid-template-columns:repeat(19,minmax(0,1fr));gap:5px}.page{border:0;border-radius:5px;aspect-ratio:1.45;background:#e9edf2;color:#647080;font-size:9px;font-weight:700;cursor:default;min-width:0;padding:0}.page.completed{background:#d9f3e5;color:#147647}.page.running{background:#dceaff;color:#1f5bb5}.page.queued{background:#fff0ce;color:#8a5d09}.page.error,.page.skipped,.page.outdated{background:#ffe0e0;color:#a52f2f}.page.hide{display:none}.page:hover{outline:2px solid #17202b;outline-offset:1px}.range-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}.range{background:var(--soft);border:1px solid var(--line);padding:7px 9px;border-radius:8px;font-size:11px;color:#465363}.range.error{border-color:#f1caca;background:#fff7f7;color:#9d3030}.alert{margin-top:12px;border:1px solid #f1caca;background:#fff7f7;color:#9d3030;border-radius:11px;padding:12px;font-size:12px;white-space:pre-wrap}.foot{margin-top:14px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.detail{font-size:11px;line-height:1.4}.hide{display:none!important}
@media(max-width:760px){body{padding:19px 11px 40px}.hero{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.pipeline{grid-template-columns:repeat(2,minmax(0,1fr))}.page-grid{grid-template-columns:repeat(12,minmax(0,1fr))}.bar-pair{grid-template-columns:1fr}}
</style>
</head>
<body>
<main class="shell">
  <header class="top">
    <div><div class="eyebrow">Parmar AI / Fatman operations</div><h1 class="title">Live indexing monitor</h1><p class="sub">538-page OCR and AI Search pipeline · read-only operational view</p></div>
    <div class="actions"><span class="live" id="live-indicator"><i class="dot"></i> Live · 10s refresh</span><button class="btn" id="refresh">Refresh now</button><button class="btn" id="auto">Pause auto-refresh</button><a class="btn primary" href="/admin/fatman">Importer</a></div>
  </header>
  <section class="hero">
    <article class="card"><div class="eyebrow">Pages successfully indexed</div><div class="big-number" id="main-progress">— <small>/ 538</small></div><div class="progress-track"><div class="progress-fill" id="completion-bar"></div></div><div class="progress-meta"><span id="completion-label">Loading exact page states…</span><strong id="completion-percent">—</strong></div></article>
    <article class="card"><div class="eyebrow">Still to complete</div><div class="big-number" id="remaining">—</div><p class="sub">Pages not yet completed, including pages running, queued, failed or not submitted.</p><div class="range-list" id="next-work"></div></article>
  </section>
  <section class="stats" aria-label="Page status totals">
    <div class="stat"><strong class="ok" id="count-completed">—</strong><span>Completed</span></div><div class="stat"><strong class="blue" id="count-running">—</strong><span>Running now</span></div><div class="stat"><strong class="warn" id="count-queued">—</strong><span>Queued</span></div><div class="stat"><strong class="bad" id="count-failed">—</strong><span>Failed / needs repair</span></div><div class="stat"><strong id="count-missing">—</strong><span>Not submitted yet</span></div>
  </section>
  <section class="pipeline">
    <article class="stage"><div class="name">01 · PDF upload</div><div class="value" id="upload-state">Loading…</div><div class="small-track"><div class="small-fill" id="upload-bar"></div></div><div class="detail" id="upload-detail">Saved upload offset / total size</div><div class="stage-state" id="upload-status"></div></article>
    <article class="stage"><div class="name">02 · Google Vision OCR</div><div class="value" id="vision-state">Loading…</div><div class="detail" id="vision-detail">Operation status will appear here.</div><div class="stage-state" id="vision-status"></div></article>
    <article class="stage"><div class="name">03 · Cloudflare Workflow</div><div class="value" id="workflow-state">Loading…</div><div class="detail" id="workflow-detail">Workflow execution and recovery state.</div><div class="stage-state" id="workflow-status"></div></article>
    <article class="stage"><div class="name">04 · Book mode</div><div class="value" id="book-state">Loading…</div><div class="detail" id="book-detail">Activation remains gated until full indexing and retrieval review.</div><div class="stage-state" id="book-status"></div></article>
  </section>
  <section class="card"><div class="section-head"><h2>Pipeline progress</h2><span class="muted" id="import-state">Reading import job…</span></div><div class="bar-pair"><div><div class="progress-meta"><span>Pages submitted to AI Search</span><strong id="submitted-percent">—</strong></div><div class="small-track"><div class="small-fill" id="submitted-bar"></div></div><div class="detail muted" id="submitted-detail">—</div></div><div><div class="progress-meta"><span>Pages completed</span><strong id="indexed-percent">—</strong></div><div class="small-track"><div class="small-fill" id="indexed-bar"></div></div><div class="detail muted" id="indexed-detail">—</div></div></div><div id="import-error" class="alert hide"></div></section>
  <section class="card pages-card"><div class="section-head"><h2>Page-by-page map</h2><div class="toolbar"><select class="select" id="filter"><option value="all">All page states</option><option value="completed">Completed</option><option value="running">Running</option><option value="queued">Queued</option><option value="failed">Failed</option><option value="missing">Not submitted</option></select><input class="search" id="page-search" type="number" min="1" max="538" placeholder="Go to page"></div></div><p class="sub">Each square is one PDF page. Hover or focus a square to see its exact status and any error.</p><div class="legend"><span class="key"><i class="swatch completed"></i>Completed</span><span class="key"><i class="swatch running"></i>Running</span><span class="key"><i class="swatch queued"></i>Queued</span><span class="key"><i class="swatch failed"></i>Failed</span><span class="key"><i class="swatch"></i>Not submitted</span></div><div class="page-grid" id="page-grid" aria-label="538 PDF page statuses"></div><div class="foot"><span id="page-summary">—</span><span id="updated">Waiting for first status response…</span></div><div id="ranges" class="range-list"></div></section>
  <div class="foot"><span id="service-info">Protected administrator view · no import or index changes are made here.</span><span>Dashboard refreshes status only; it never restarts OCR or indexing.</span></div>
</main>
<script>
const API="/admin/api/fatman/monitor",EXPECTED=538;
let snapshot=null,timer=null,autoEnabled=true,inFlight=false,selectedFilter="all",pageButtons=[];
const el=id=>document.getElementById(id);
const setText=(id,value)=>{el(id).textContent=value;};
const pct=(value,total)=>total?Math.round(value/total*1000)/10:0;
function formatBytes(value){const n=Number(value||0);if(!Number.isFinite(n)||n<0)return "—";if(n<1024)return n+" B";const u=["KB","MB","GB","TB"];let v=n/1024,i=0;while(v>=1024&&i<u.length-1){v/=1024;i++;}return v.toFixed(v>=100?0:1)+" "+u[i];}
function niceStatus(value){const labels={completed:"Completed",running:"Running",queued:"Queued",error:"Failed",skipped:"Skipped",outdated:"Outdated",missing:"Not submitted",processing:"Processing",uploading:"Uploading",uploaded:"Uploaded",failed:"Failed",complete:"Complete",errored:"Errored",unknown:"Unknown",not_started:"Not started"};return labels[value]||String(value||"Unknown").replaceAll("_"," ");}
function statusClass(status){return ["error","skipped","outdated"].includes(status)?"failed":status;}
function setDotState(id,label,color){const node=el(id);node.replaceChildren();const dot=document.createElement("i");dot.className="dot";dot.style.background=color;node.append(dot,document.createTextNode(label));}
function createPageGrid(){const fragment=document.createDocumentFragment();for(let n=1;n<=EXPECTED;n++){const b=document.createElement("button");b.type="button";b.className="page";b.dataset.page=String(n);b.textContent=String(n);b.title="Page "+n+": waiting for status";b.setAttribute("aria-label",b.title);fragment.append(b);pageButtons.push(b);}el("page-grid").replaceChildren(fragment);}
function renderPages(pages){for(let i=0;i<pageButtons.length;i++){const item=pages[i]||{page:i+1,status:"missing"};const b=pageButtons[i],failed=statusClass(item.status)==="failed";const pass=selectedFilter==="all"||(selectedFilter==="failed"?failed:selectedFilter===item.status);b.className="page "+statusClass(item.status)+(pass?"":" hide");const tip="Page "+item.page+": "+niceStatus(item.status)+(item.error?" · "+item.error:"");b.title=tip;b.setAttribute("aria-label",tip);b.disabled=!pass;}const firstMissing=pages.find(x=>x.status==="missing"),firstFailed=pages.find(x=>statusClass(x.status)==="failed");setText("page-summary",pages.length+" pages mapped"+(firstMissing?" · first not submitted: "+firstMissing.page:"")+(firstFailed?" · first failed: "+firstFailed.page:""));}
function drawRanges(ranges,failedPages){const host=el("ranges");host.replaceChildren();const entries=[];for(const r of (ranges||[]).slice(0,8))entries.push({label:"Not submitted · "+(r.start===r.end?r.start:r.start+"–"+r.end),kind:""});for(const p of (failedPages||[]).slice(0,12))entries.push({label:"Page "+p.page+" · "+niceStatus(p.status)+(p.error?" · "+p.error:""),kind:"error"});for(const item of entries){const s=document.createElement("span");s.className="range "+item.kind;s.textContent=item.label;host.append(s);}if(!entries.length){const s=document.createElement("span");s.className="range";s.textContent="No missing or failed pages";host.append(s);}}
function render(data){snapshot=data;const p=data.progress||{},c=p.counts||{},job=data.import||{},pipe=data.pipeline||{},vision=pipe.vision||{},workflow=pipe.workflow||{};const completed=Number(p.completedPages||0),remaining=Number(p.remainingPages??EXPECTED-completed),completion=Number(p.completionPercent||0),submitted=Number(p.submittedPages||0),submission=pct(submitted,EXPECTED);
setText("main-progress",completed+" / 538");setText("remaining",remaining.toLocaleString());el("completion-bar").style.width=completion+"%";setText("completion-percent",completion.toFixed(1)+"%");setText("completion-label",completed+" pages fully indexed · "+remaining+" not yet complete");
setText("count-completed",c.completed||0);setText("count-running",c.running||0);setText("count-queued",c.queued||0);setText("count-failed",c.failed||0);setText("count-missing",c.missing||0);
el("submitted-bar").style.width=submission+"%";setText("submitted-percent",submission.toFixed(1)+"%");setText("submitted-detail",submitted+" of "+EXPECTED+" pages have a text item in AI Search");el("indexed-bar").style.width=completion+"%";setText("indexed-percent",completion.toFixed(1)+"%");setText("indexed-detail",completed+" completed; "+(c.running||0)+" running; "+(c.queued||0)+" queued; "+(c.failed||0)+" failed");
const uploadPct=job.expectedSize?pct(job.uploadedBytes,job.expectedSize):0;el("upload-bar").style.width=uploadPct+"%";setText("upload-state",job.status?niceStatus(job.status):"No import job");setText("upload-detail",job.expectedSize?formatBytes(job.uploadedBytes)+" / "+formatBytes(job.expectedSize)+" · "+uploadPct.toFixed(1)+"%":"No saved PDF upload record");setDotState("upload-status",job.status==="failed"?"Upload/import failed":job.status==="uploading"?"Transfer active":job.status==="processing"?"PDF saved":job.status==="completed"?"Import record complete":"Waiting",job.status==="failed"?"#d04444":job.status==="uploading"?"#3983ed":"#169b62");
setText("vision-state",niceStatus(vision.status||(job.hasVisionOperation?"unknown":"not_started")));setText("vision-detail",vision.operation||vision.error||"Google Vision long-running operation");setDotState("vision-status",vision.error?"Vision status unavailable":vision.status==="completed"?"OCR operation complete":vision.status==="running"?"OCR operation running":"Vision operation state",vision.error?"#c58a16":vision.status==="completed"?"#169b62":vision.status==="running"?"#3983ed":"#9aa4b2");
setText("workflow-state",niceStatus(workflow.status||"unknown"));setText("workflow-detail",workflow.id?"Workflow "+workflow.id:(workflow.error||"No Workflow instance recorded"));setDotState("workflow-status",workflow.error?"Workflow lookup failed":workflow.status==="running"?"Execution active":workflow.status==="complete"?"Workflow complete":workflow.status==="errored"?"Workflow errored":"Workflow state",workflow.status==="running"?"#3983ed":workflow.status==="complete"?"#169b62":workflow.status==="errored"?"#d04444":"#9aa4b2");
setText("book-state",data.enabled?"Enabled":"Disabled");setText("book-detail",data.enabled?"Fatman answers are available to eligible private chats.":"Activation waits for all 538 pages and retrieval review.");setDotState("book-status",data.enabled?"Ready for retrieval":"Not active",data.enabled?"#169b62":"#9aa4b2");
setText("import-state",job.id?"Import "+job.id:"No import job found");const err=job.error||workflow.error||vision.error||"";el("import-error").classList.toggle("hide",!err);setText("import-error",err);
renderPages(data.pages||[]);drawRanges(data.missingRanges,data.failedPages);const host=el("next-work");host.replaceChildren();const contiguous=Number(p.highestContiguousCompletedPage||0);const run=document.createElement("span");run.className="range";run.textContent=contiguous?"Continuous completed run: pages 1–"+contiguous:"No initial contiguous completed run yet";host.append(run);const first=(data.pages||[]).find(x=>x.status==="missing");if(first){const n=document.createElement("span");n.className="range";n.textContent="Next missing page: "+first.page;host.append(n);}
setText("updated","Last server check: "+new Date(data.checkedAt||Date.now()).toLocaleTimeString()+" · auto-refresh "+(autoEnabled?"on":"paused"));setText("service-info",(data.storage?.serviceAccountEmail?"Google service account: "+data.storage.serviceAccountEmail+" · ":"")+"Protected administrator view · read-only monitor");}
function applyPageFilter(){const query=Number(el("page-search").value||0);for(const b of pageButtons){const item=snapshot?.pages?.[Number(b.dataset.page)-1],s=item?.status||"missing",failed=statusClass(s)==="failed",statusMatch=selectedFilter==="all"||(selectedFilter==="failed"?failed:selectedFilter===s),pageMatch=!query||Number(b.dataset.page)===query;b.classList.toggle("hide",!(statusMatch&&pageMatch));b.disabled=!(statusMatch&&pageMatch);}}
async function refresh(){if(inFlight)return;inFlight=true;el("refresh").disabled=true;try{const response=await fetch(API,{cache:"no-store",headers:{accept:"application/json"}});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"Monitor request failed: "+response.status);render(data);el("live-indicator").innerHTML='<i class="dot"></i> Live · 10s refresh';}catch(error){el("live-indicator").textContent="Connection issue";setText("updated","Refresh failed: "+error.message+" · showing last successful snapshot");}finally{inFlight=false;el("refresh").disabled=false;}}
function startTimer(){if(timer)clearInterval(timer);timer=null;if(autoEnabled)timer=setInterval(refresh,10000);}
el("refresh").addEventListener("click",refresh);el("auto").addEventListener("click",()=>{autoEnabled=!autoEnabled;setText("auto",autoEnabled?"Pause auto-refresh":"Resume auto-refresh");startTimer();setText("updated",autoEnabled?"Auto-refresh resumed":"Auto-refresh paused");});el("filter").addEventListener("change",()=>{selectedFilter=el("filter").value;applyPageFilter();});el("page-search").addEventListener("input",applyPageFilter);document.addEventListener("visibilitychange",()=>{if(document.hidden){if(timer)clearInterval(timer);timer=null;}else{refresh();startTimer();}});
createPageGrid();refresh();startTimer();
</script>
</body></html>`;
