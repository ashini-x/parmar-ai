import type { Env } from "../config/env";
import { readBrvinCorpusGeneration } from "./corpus-reader";
import { indexBrvinCorpusGeneration } from "./m14-pilot-runner";
import {
  BRVIN_M14_PHYSICS_PILOT,
  BRVIN_M14_PHYSICS_QUERY_SUITE,
  summarizeBrvinM14PageCoverage,
  summarizeBrvinM14Ranking,
} from "./m14-physics-evaluation";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";
import { getGoogleAccessToken } from "../auth/google";
import type {
  FatmanImportJob,
  FatmanVisionOcrPage,
} from "../fatman/import";
import {
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
  getFatmanVisionOperation,
  listFatmanVisionOutputObjects,
} from "../fatman/import";
import {
  backfillBrvinM14CorpusFromStoredVision,
  type BrvinM14VisionBackfillDependencies,
  type BrvinM14VisionBackfillResult,
} from "./m14-vision-backfill";

const PILOT_SOURCE_ID = "01238b3a-9902-4a42-90b4-574048ee4f00";
const PILOT_SOURCE_SHA256 = "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c";
const PILOT_VISION_OPERATION = "projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2";
const PILOT_PAGE_COUNT = 3;
const PILOT_GENERATION_ID = "57129957231e548064e5594d8fb9f501";
const PILOT_RECOVERED_VISION_OPERATION = "projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff";
const MAX_VISION_PAGE_TEXT_CHARS = 1_000_000;

interface M14RegistryRecord {
  source_id: string;
  source_object: string;
  source_sha256: string;
  expected_size: number;
  uploaded_bytes: number;
  status: string;
  vision_operation: string;
  indexed_pages: number;
  book_id: string;
  book_title: string;
  page_count: number;
  created_at: number;
  updated_at: number;
}

export interface M14StagingWorkerEnv extends Env {
  BRVIN_M14_ADMIN_TOKEN?: string;
}

interface M14VisionRecoveryRecord {
  source_id: string;
  status: "submitting" | "running" | "completed" | "failed" | "submission_uncertain";
  vision_operation: string | null;
  output_bucket: string;
  output_prefix: string;
  source_pdf_generation: string;
  expected_page_count: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface M14CorpusReadbackSummary {
  sourceId: string;
  generationId: string;
  sourcePdfSha256: string;
  visionOperationId: string;
  pageCount: number;
  chunkCount: number;
  pages: Array<{ pdfPage: number; stableItemKey: string; chunkCount: number; rawOcrSha256: string; normalizedSearchTextSha256: string }>;
  verified: true;
}

export interface M14VisionRecoveryStatus {
  sourceId: string;
  status: M14VisionRecoveryRecord["status"] | "not_started" | "waiting_for_output_files";
  operationDone: boolean;
  operationHasError: boolean;
  destinationMatches: boolean;
  expectedPageCount: number;
  outputBucket?: string;
  outputPrefix?: string;
  expectedFileNames: string[];
  actualFileNames: string[];
  missingFileNames: string[];
  error?: string;
}

export interface M14VisionOutputDiagnostics {
  sourceId: string;
  pageCount: number;
  expectedPrefix: string;
  operationDone: boolean;
  operationHasError: boolean;
  operationDestinationMatches: boolean;
  truncated: boolean;
  expectedFileNames: string[];
  actualFileNames: string[];
  missingFileNames: string[];
  unexpectedFileNames: string[];
  objects: Array<{ fileName: string; size?: string }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

function m14AdminPage(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>BRVIN M14 Staging Operator</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #0b1220; color: #eef3fb; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    main { width: min(100%, 680px); background: #111c2e; border: 1px solid #293951; border-radius: 18px; padding: clamp(20px, 5vw, 34px); box-sizing: border-box; box-shadow: 0 24px 80px #0005; }
    .eyebrow { color: #9fb4d1; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { font-size: clamp(25px, 5vw, 34px); margin: 10px 0 8px; letter-spacing: -.03em; }
    p { color: #b8c7da; line-height: 1.6; }
    .notice { border: 1px solid #49617e; border-radius: 12px; padding: 13px 15px; background: #17263b; margin: 20px 0; }
    .notice strong { color: #eaf2ff; }
    label { display: block; margin: 18px 0 8px; font-weight: 650; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: 13px 14px; border-radius: 10px; border: 1px solid #526782; background: #080f1b; color: #fff; font: inherit; }
    .confirm { display: flex; align-items: flex-start; gap: 10px; font-weight: 400; line-height: 1.5; color: #d5e0ef; }
    .confirm input { margin-top: 5px; }
    button { width: 100%; border: 0; border-radius: 10px; padding: 14px 16px; margin-top: 20px; color: white; background: #245fca; font: inherit; font-weight: 750; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .status { border-radius: 10px; padding: 12px 14px; background: #0a1423; border: 1px solid #293951; margin-top: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .good { color: #9ae6b4; } .bad { color: #ffaaa6; } .muted { color: #9fb4d1; }
    details { margin-top: 18px; color: #b8c7da; }
    summary { cursor: pointer; font-weight: 650; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
    .small { font-size: 13px; }
    button.secondary { background: #293951; border: 1px solid #526782; margin-top: 10px; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Isolated staging environment</div>
    <h1>BRVIN M14 · Physics pilot</h1>
    <p>This operator handles one fixed three-page Physics source. It cannot select another PDF or access production retrieval data.</p>
    <div class="notice">
      <strong>Why OCR recovery is needed</strong>
      <p class="small">BRVIN already indexed this PDF and retained the original PDF, but its normal retention workflow removed the temporary OCR JSON after quality checks passed. This page can submit one new OCR request from the retained PDF and store the new output only in the separate M14 staging bucket.</p>
    </div>
    <div id="health" class="status muted" role="status" aria-live="polite">Checking staging configuration…</div>
    <label for="token">M14 staging operator token</label>
    <input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the BRVIN_M14_ADMIN_TOKEN secret" minlength="32">
    <label class="confirm"><input id="confirmOcr" type="checkbox"> <span>I understand this submits one new Google Vision OCR request for the retained Physics PDF. Google Cloud may charge for this request.</span></label>
    <button id="rebuildVision" type="button" disabled>Recreate OCR output from retained PDF (one time)</button>
    <button id="checkRecovery" class="secondary" type="button" disabled>Check OCR recovery status (read only)</button>
    <label class="confirm"><input id="confirm" type="checkbox"> <span>I understand this writes the fixed three-page Physics manifests into the isolated M14 staging bucket.</span></label>
    <button id="inspect" class="secondary" type="button" disabled>Inspect original OCR folder (read only)</button>
    <button id="run" type="button" disabled>Run Physics backfill</button>
    <button id="verifyCorpus" class="secondary" type="button" disabled>Verify stored M14 manifests (read only)</button>
    <div class="notice">
      <strong>Vertex AI + Qdrant pilot</strong>
      <p class="small">After configuring the isolated staging Vertex/Qdrant settings, index the seven verified chunks once. The positive evaluation runs ten source-grounded Physics queries. The separate non-gating diagnostics show top-five evidence for two reviewed no-match queries and repeat the friction query three times with point/chunk IDs and RRF scores. They do not test consumer answer abstention or set a pass/fail threshold.</p>
    </div>
    <button id="indexQdrant" type="button" disabled>Embed and index the 7 Physics chunks in Qdrant</button>
    <button id="evaluateQdrant" class="secondary" type="button" disabled>Run 10 source-grounded Physics retrieval checks</button>
    <button id="diagnoseQdrant" class="secondary" type="button" disabled>Run non-gating negative + rank-stability diagnostics</button>
    <div id="result" class="status muted" role="status" aria-live="polite">No recovery or backfill action has been started.</div>
    <details>
      <summary>Security and retry information</summary>
      <p class="small">The OCR action is fixed to the registered Physics source. Its source PDF is read from the existing private source bucket, while OCR results and derived manifests are written to the separate M14 staging bucket. A saved operation record prevents duplicate OCR submissions.</p>
      <p class="small">The token is used only for requests to this same staging website, is not saved in browser storage, and is cleared after each action. Never paste a Google private key here.</p>
    </details>
  </main>
<script>
(() => {
  const tokenInput = document.getElementById("token");
  const confirmInput = document.getElementById("confirm");
  const confirmOcrInput = document.getElementById("confirmOcr");
  const runButton = document.getElementById("run");
  const inspectButton = document.getElementById("inspect");
  const rebuildButton = document.getElementById("rebuildVision");
  const checkRecoveryButton = document.getElementById("checkRecovery");
  const verifyCorpusButton = document.getElementById("verifyCorpus");
  const indexQdrantButton = document.getElementById("indexQdrant");
  const evaluateQdrantButton = document.getElementById("evaluateQdrant");
  const diagnoseQdrantButton = document.getElementById("diagnoseQdrant");
  const healthBox = document.getElementById("health");
  const resultBox = document.getElementById("result");

  function refreshButton() {
    const canAuthenticate = tokenInput.value.trim().length >= 32;
    const ready = runButton.dataset.ready === "true";
    const ocrReady = runButton.dataset.ocrReady === "true";
    const ocrStatus = runButton.dataset.ocrStatus || "not_started";
    inspectButton.disabled = !canAuthenticate || !ready;
    checkRecoveryButton.disabled = !canAuthenticate || !ready;
    verifyCorpusButton.disabled = !canAuthenticate || !ready;
    const providerReady = runButton.dataset.providerReady === "true";
    indexQdrantButton.disabled = !canAuthenticate || !ready || !providerReady;
    evaluateQdrantButton.disabled = !canAuthenticate || !ready || !providerReady;
    diagnoseQdrantButton.disabled = !canAuthenticate || !ready || !providerReady;
    rebuildButton.disabled = !canAuthenticate || !confirmOcrInput.checked || !ready ||
      ["submitting", "running", "completed", "failed", "submission_uncertain"].includes(ocrStatus);
    runButton.disabled = !confirmInput.checked || !canAuthenticate || !ready || !ocrReady;
  }
  tokenInput.addEventListener("input", refreshButton);
  confirmInput.addEventListener("change", refreshButton);
  confirmOcrInput.addEventListener("change", refreshButton);

  async function checkHealth() {
    try {
      const response = await fetch("/health", {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const data = await response.json();
      const ready = response.ok && data.ok === true &&
        data.environment === "staging" && data.pilotEnabled === true &&
        data.sourceRegistryBound === true &&
        data.secretsConfigured?.gcpClientEmail === true &&
        data.secretsConfigured?.gcpPrivateKey === true &&
        data.secretsConfigured?.m14AdminToken === true;
      const providerChecks = [
        [data.m14ProviderConfigured?.vertexLocation === true, "BRVIN_M14_VERTEX_LOCATION"],
        [data.m14ProviderConfigured?.vertexModel === true, "BRVIN_M14_VERTEX_MODEL"],
        [data.m14ProviderConfigured?.embeddingDimensions === true, "BRVIN_M14_EMBEDDING_DIMENSIONS"],
        [data.m14ProviderConfigured?.qdrantUrl === true, "BRVIN_M14_QDRANT_URL"],
        [data.secretsConfigured?.qdrantApiKey === true, "BRVIN_M14_QDRANT_API_KEY (Secret)"],
        [data.m14ProviderConfigured?.qdrantCollection === true, "BRVIN_M14_QDRANT_COLLECTION"],
      ];
      const missingProviderSettings = providerChecks
        .filter(([configured]) => !configured)
        .map(([, name]) => name);
      const providerReady = ready && data.m14ProviderConfigured?.ready === true;
      healthBox.className = "status " + (!ready ? "bad" : providerReady ? "good" : "muted");
      healthBox.textContent = !ready
        ? "Staging is not ready. Check the Worker health response and complete any missing base configuration before continuing.\n" + JSON.stringify(data, null, 2)
        : providerReady
          ? "Staging and Vertex/Qdrant settings are present. The indexing and evaluation buttons are enabled when you enter the M14 operator token."
          : "Base staging checks passed, but Vertex/Qdrant settings are incomplete. The two Qdrant buttons are intentionally disabled. Add these missing settings under Cloudflare Workers & Pages → parmar-ai-m14-staging → Settings → Variables and Secrets:\n" +
            missingProviderSettings.map((name) => "• " + name).join("\n");
      runButton.dataset.ready = ready ? "true" : "false";
      runButton.dataset.providerReady = providerReady ? "true" : "false";
      refreshButton();
    } catch {
      healthBox.className = "status bad";
      healthBox.textContent = "Could not read the staging health endpoint. Refresh this page and try again.";
      runButton.dataset.ready = "false";
      refreshButton();
    }
  }

  async function authenticatedRequest(path, method, body, busyText) {
    let token = tokenInput.value.trim();
    tokenInput.value = "";
    refreshButton();
    resultBox.className = "status muted";
    resultBox.textContent = busyText;
    try {
      const response = await fetch(path, {
        method,
        headers: {
          "authorization": "Bearer " + token,
          ...(body !== undefined ? { "content-type": "application/json" } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const data = await response.json();
      resultBox.className = "status " + (response.ok && data.ok === true ? "good" : "bad");
      resultBox.textContent = JSON.stringify(data, null, 2);
      return { response, data };
    } catch {
      resultBox.className = "status bad";
      resultBox.textContent = "The request could not be completed. Check your connection and then use the read-only status button before retrying an operation.";
      return null;
    } finally {
      token = "";
      tokenInput.value = "";
      refreshButton();
    }
  }

  rebuildButton.addEventListener("click", async () => {
    refreshButton();
    if (rebuildButton.disabled || !confirmOcrInput.checked) return;
    rebuildButton.disabled = true;
    rebuildButton.textContent = "Submitting OCR request…";
    const result = await authenticatedRequest(
      "/admin/m14/vision/rebuild",
      "POST",
      { confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" },
      "Verifying the retained PDF and submitting one Vision OCR job into the M14 staging bucket. Do not refresh repeatedly."
    );
    if (result?.response.ok && result.data.ok === true) {
      runButton.dataset.ocrStatus = result.data.recovery?.status || "running";
      rebuildButton.textContent = "OCR request recorded";
      confirmOcrInput.disabled = true;
    } else {
      rebuildButton.textContent = "Recreate OCR output from retained PDF (one time)";
    }
    refreshButton();
  });

  checkRecoveryButton.addEventListener("click", async () => {
    refreshButton();
    if (checkRecoveryButton.disabled) return;
    checkRecoveryButton.disabled = true;
    checkRecoveryButton.textContent = "Checking…";
    const result = await authenticatedRequest(
      "/admin/m14/vision/status",
      "GET",
      undefined,
      "Checking the saved Vision operation and the three expected output files. This is read-only."
    );
    if (result?.response.ok && result.data.ok === true) {
      const recovery = result.data.recovery;
      runButton.dataset.ocrStatus = recovery.status;
      runButton.dataset.ocrReady = recovery.status === "completed" ? "true" : "false";
      checkRecoveryButton.textContent = recovery.status === "completed"
        ? "OCR output verified"
        : "Check OCR recovery status (read only)";
      if (recovery.status === "completed") {
        resultBox.className = "status good";
      }
    } else {
      checkRecoveryButton.textContent = "Check OCR recovery status (read only)";
    }
    refreshButton();
  });

  inspectButton.addEventListener("click", async () => {
    refreshButton();
    if (inspectButton.disabled) return;
    inspectButton.disabled = true;
    inspectButton.textContent = "Inspecting…";
    await authenticatedRequest(
      "/admin/m14/diagnostics",
      "GET",
      undefined,
      "Reading the original Vision operation and its original output folder. No files will be changed."
    );
    inspectButton.textContent = "Inspect original OCR folder (read only)";
    refreshButton();
  });

  verifyCorpusButton.addEventListener("click", async () => {
    refreshButton();
    if (verifyCorpusButton.disabled) return;
    verifyCorpusButton.disabled = true;
    verifyCorpusButton.textContent = "Verifying manifests…";
    await authenticatedRequest(
      "/admin/m14/corpus/verify",
      "GET",
      undefined,
      "Reading the persisted source/page manifests from GCS and recomputing every OCR, normalized-text and deterministic-chunk integrity check. This is read-only."
    );
    verifyCorpusButton.textContent = "Verify stored M14 manifests (read only)";
    refreshButton();
  });

  indexQdrantButton.addEventListener("click", async () => {
    refreshButton();
    if (indexQdrantButton.disabled) return;
    indexQdrantButton.disabled = true;
    indexQdrantButton.textContent = "Embedding and indexing…";
    const result = await authenticatedRequest(
      "/admin/m14/qdrant/index",
      "POST",
      { confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" },
      "Verifying the immutable corpus, checking the Vertex embedding configuration, creating/validating the isolated Qdrant collection, and indexing seven deterministic chunks. Keep this page open."
    );
    if (result?.response.ok && result.data.ok === true) {
      indexQdrantButton.textContent = "Qdrant indexing completed";
    } else {
      indexQdrantButton.textContent = "Embed and index the 7 Physics chunks in Qdrant";
    }
    refreshButton();
  });

  evaluateQdrantButton.addEventListener("click", async () => {
    refreshButton();
    if (evaluateQdrantButton.disabled) return;
    evaluateQdrantButton.disabled = true;
    evaluateQdrantButton.textContent = "Running retrieval checks…";
    const result = await authenticatedRequest(
      "/admin/m14/qdrant/evaluate",
      "POST",
      { confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" },
      "Running ten positive source-grounded Physics queries through Vertex embeddings and Qdrant hybrid dense+sparse RRF. This is staging-only."
    );
    if (result?.response.ok && result.data.ok === true) {
      evaluateQdrantButton.textContent = "Source-grounded retrieval checks completed";
    } else {
      evaluateQdrantButton.textContent = "Run 10 source-grounded Physics retrieval checks";
    }
    refreshButton();
  });

  diagnoseQdrantButton.addEventListener("click", async () => {
    refreshButton();
    if (diagnoseQdrantButton.disabled) return;
    diagnoseQdrantButton.disabled = true;
    diagnoseQdrantButton.textContent = "Running non-gating diagnostics…";
    const result = await authenticatedRequest(
      "/admin/m14/qdrant/diagnostics",
      "POST",
      { confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" },
      "Running two retrieval-only negative diagnostics and repeating the friction query three times. This does not test Gemini answer abstention and sets no pass/fail threshold."
    );
    if (result?.response.ok && result.data.ok === true) {
      diagnoseQdrantButton.textContent = "Non-gating diagnostics completed";
    } else {
      diagnoseQdrantButton.textContent = "Run non-gating negative + rank-stability diagnostics";
    }
    refreshButton();
  });

  runButton.addEventListener("click", async () => {
    refreshButton();
    if (runButton.disabled || runButton.dataset.ready !== "true" || runButton.dataset.ocrReady !== "true") {
      resultBox.className = "status bad";
      resultBox.textContent = "The new Vision OCR output has not yet been verified. Check OCR recovery status before running the backfill.";
      return;
    }
    runButton.disabled = true;
    runButton.textContent = "Running…";
    const result = await authenticatedRequest(
      "/admin/m14/backfill",
      "POST",
      { confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" },
      "The Worker is validating the recovered OCR output and writing the three immutable page manifests. Keep this page open."
    );
    if (result?.response.ok && result.data.ok === true) {
      runButton.textContent = "Backfill completed";
      confirmInput.disabled = true;
    } else {
      runButton.textContent = "Run Physics backfill";
    }
    refreshButton();
  });

  checkHealth();
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function equalSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown backfill failure.";
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 300);
}

async function getRegisteredPhysicsJob(env: Env, sourceId: string): Promise<FatmanImportJob | null> {
  if (!env.DB) throw new Error("The isolated M14 staging D1 registry is not bound.");
  const row = await env.DB.prepare(
    "SELECT source_id, source_object, source_sha256, expected_size, uploaded_bytes, status, " +
    "vision_operation, indexed_pages, book_id, book_title, page_count, created_at, updated_at " +
    "FROM m14_source_registry WHERE source_id = ? LIMIT 1",
  ).bind(sourceId).first<M14RegistryRecord>();
  if (!row) return null;
  return {
    id: row.source_id,
    source_object: row.source_object,
    source_sha256: row.source_sha256,
    expected_size: Number(row.expected_size),
    uploaded_bytes: Number(row.uploaded_bytes),
    upload_session_uri: null,
    status: row.status,
    vision_operation: row.vision_operation,
    workflow_instance_id: null,
    indexed_pages: Number(row.indexed_pages),
    error_message: null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    book_id: row.book_id,
    book_title: row.book_title,
    page_count: Number(row.page_count),
  };
}

async function readStoredVisionPage(
  env: Env,
  sourceId: string,
  page: number,
): Promise<FatmanVisionOcrPage> {
  const job = await getRegisteredPhysicsJob(env, sourceId);
  if (!job) throw new Error("The Physics source is not registered in the isolated staging D1 registry.");
  const objectName = fatmanOutputObjectName(
    sourceId,
    page,
    fatmanVisionOutputPrefix(job),
  );
  const bucket = env.FATMAN_GCS_BUCKET?.trim();
  if (!bucket) throw new Error("The original source/Vision GCS bucket is not configured on the M14 staging Worker.");
  const token = await getGoogleAccessToken(env);
  const url = "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?alt=media";
  const response = await fetch(url, {
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("Could not read the original stored Vision OCR for PDF page " + page +
      " (HTTP " + response.status + ").");
  }
  const payload = await response.json() as {
    responses?: Array<{
      fullTextAnnotation?: {
        text?: string;
        pages?: Array<{ confidence?: number }>;
      };
      error?: { message?: string };
    }>;
    context?: { pageNumber?: number };
  };
  if (payload.context?.pageNumber && Number(payload.context.pageNumber) !== page) {
    throw new Error("The saved Vision OCR object does not match requested physical PDF page " + page + ".");
  }
  const annotation = payload.responses?.[0];
  if (annotation?.error?.message) {
    throw new Error("Saved Vision OCR reports an error on physical PDF page " + page + ".");
  }
  if (!annotation) {
    throw new Error("Saved Vision OCR contains no response for physical PDF page " + page + ".");
  }
  const rawText = annotation.fullTextAnnotation?.text;
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Saved Vision OCR contains no readable text for physical PDF page " + page + ".");
  }
  if (rawText.length > MAX_VISION_PAGE_TEXT_CHARS) {
    throw new Error("Saved Vision OCR page " + page + " exceeds the one-million-character manifest limit.");
  }
  const confidence = annotation.fullTextAnnotation?.pages?.[0]?.confidence;
  return {
    rawText,
    ...(typeof confidence === "number" && Number.isFinite(confidence) &&
      confidence >= 0 && confidence <= 1 ? { pageConfidence: confidence } : {}),
  };
}

const M14_GCS_API = "https://storage.googleapis.com";
const M14_VISION_API = "https://vision.googleapis.com/v1";
const M14_RECOVERY_PREFIX = "brvin/m14-staging/vision-output/";

interface M14GcsObject {
  name: string;
  size?: string;
  generation?: string;
}

async function getM14VisionRecoveryRecord(env: Env): Promise<M14VisionRecoveryRecord | null> {
  if (!env.DB) throw new Error("The isolated M14 staging D1 registry is not bound.");
  return env.DB.prepare(
    "SELECT source_id, status, vision_operation, output_bucket, output_prefix, source_pdf_generation, " +
    "expected_page_count, error_message, created_at, updated_at " +
    "FROM m14_vision_recovery WHERE source_id = ? LIMIT 1",
  ).bind(PILOT_SOURCE_ID).first<M14VisionRecoveryRecord>();
}

async function listM14GcsObjects(
  env: Env,
  bucket: string,
  prefix: string,
  maxObjects = PILOT_PAGE_COUNT + 1,
): Promise<{ objects: M14GcsObject[]; truncated: boolean }> {
  const token = await getGoogleAccessToken(env);
  const limit = Math.max(1, Math.min(100, maxObjects));
  const objects: M14GcsObject[] = [];
  let pageToken = "";
  let truncated = false;
  do {
    const query = new URLSearchParams({
      prefix,
      maxResults: String(Math.min(1000, limit - objects.length)),
      fields: "items(name,size,generation),nextPageToken",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      M14_GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) + "/o?" + query.toString(),
      { headers: { authorization: "Bearer " + token } },
    );
    if (!response.ok) {
      throw new Error("Could not list the M14 staging Vision output objects (HTTP " + response.status + ").");
    }
    const data = await response.json() as {
      items?: Array<{ name?: string; size?: string | number; generation?: string | number }>;
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      if (typeof item.name !== "string" || !item.name.startsWith(prefix)) continue;
      objects.push({
        name: item.name,
        ...(item.size !== undefined ? { size: String(item.size) } : {}),
        ...(item.generation !== undefined ? { generation: String(item.generation) } : {}),
      });
      if (objects.length >= limit) break;
    }
    pageToken = data.nextPageToken ?? "";
    truncated = Boolean(pageToken) && objects.length >= limit;
  } while (pageToken && objects.length < limit);
  return { objects, truncated };
}

async function getM14GcsObjectMetadata(
  env: Env,
  bucket: string,
  objectName: string,
): Promise<{ generation: string; size: number }> {
  const token = await getGoogleAccessToken(env);
  const url = M14_GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket) +
    "/o/" + encodeURIComponent(objectName) + "?fields=name,generation,size";
  const response = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (!response.ok) {
    throw new Error("The retained original Physics PDF could not be verified in the source bucket (HTTP " + response.status + ").");
  }
  const metadata = await response.json() as { name?: string; generation?: string | number; size?: string | number };
  const size = Number(metadata.size);
  if (metadata.name !== objectName || metadata.generation === undefined ||
      !Number.isSafeInteger(size) || size < 1) {
    throw new Error("The retained Physics PDF metadata is incomplete or does not match the registered object.");
  }
  return { generation: String(metadata.generation), size };
}

async function startM14VisionRecovery(env: Env): Promise<{
  sourceId: string;
  status: M14VisionRecoveryRecord["status"];
  visionOperation?: string;
  outputBucket: string;
  outputPrefix: string;
  alreadySubmitted: boolean;
  message: string;
}> {
  if (!env.DB) throw new Error("The isolated M14 staging D1 registry is not bound.");
  const sourceBucket = env.FATMAN_GCS_BUCKET?.trim() ?? "";
  const outputBucket = env.BRVIN_M14_CORPUS_BUCKET?.trim() ?? "";
  const projectId = env.GCP_PROJECT_ID?.trim() ?? "";
  if (!sourceBucket || !outputBucket || !projectId ||
      !env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY) {
    throw new Error("Google Cloud source bucket, M14 destination bucket, project or service-account secrets are missing.");
  }
  if (sourceBucket === outputBucket) {
    throw new Error("M14 Vision recovery requires a destination bucket separate from the original source bucket.");
  }

  const job = await getRegisteredPhysicsJob(env, PILOT_SOURCE_ID);
  if (!job || job.id !== PILOT_SOURCE_ID || job.book_id !== PILOT_SOURCE_ID ||
      job.status !== "completed" || Number(job.page_count) !== PILOT_PAGE_COUNT ||
      Number(job.indexed_pages) !== PILOT_PAGE_COUNT ||
      job.source_sha256?.toLowerCase() !== PILOT_SOURCE_SHA256 ||
      job.source_object !== "brvin/source-pdfs/" + PILOT_SOURCE_ID + "/source.pdf" ||
      Number(job.expected_size) !== 77384 || Number(job.uploaded_bytes) !== 77384) {
    throw new Error("The registered Physics source does not match the fixed retained PDF expected by M14 recovery.");
  }

  const existing = await getM14VisionRecoveryRecord(env);
  if (existing) {
    return {
      sourceId: existing.source_id,
      status: existing.status,
      ...(existing.vision_operation ? { visionOperation: existing.vision_operation } : {}),
      outputBucket: existing.output_bucket,
      outputPrefix: existing.output_prefix,
      alreadySubmitted: true,
      message: existing.status === "submitting" || existing.status === "submission_uncertain"
        ? "A previous submission may already have reached Google Vision. It will not be submitted again automatically; inspect status before taking further action."
        : "A Vision recovery record already exists. No duplicate OCR request was submitted.",
    };
  }

  const sourceMetadata = await getM14GcsObjectMetadata(env, sourceBucket, job.source_object);
  if (sourceMetadata.size !== Number(job.expected_size)) {
    throw new Error("The retained Physics PDF size no longer matches the registered upload. No OCR request was submitted.");
  }
  const token = await getGoogleAccessToken(env);
  const sourceUrl = new URL(
    M14_GCS_API + "/storage/v1/b/" + encodeURIComponent(sourceBucket) +
      "/o/" + encodeURIComponent(job.source_object),
  );
  sourceUrl.searchParams.set("alt", "media");
  sourceUrl.searchParams.set("generation", sourceMetadata.generation);
  const sourceResponse = await fetch(sourceUrl, {
    headers: { authorization: "Bearer " + token },
  });
  if (!sourceResponse.ok) {
    throw new Error("The retained Physics PDF could not be read for SHA-256 verification (HTTP " + sourceResponse.status + ").");
  }
  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());
  const sourceDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", sourceBytes));
  const sourceSha256 = Array.from(sourceDigest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sourceBytes.byteLength !== Number(job.expected_size) ||
      sourceSha256 !== PILOT_SOURCE_SHA256) {
    throw new Error("The retained PDF bytes do not match the registered Physics source SHA-256. No OCR request was submitted.");
  }

  const outputPrefix = M14_RECOVERY_PREFIX + PILOT_SOURCE_ID + "/attempt-001/";
  const existingOutputs = await listM14GcsObjects(env, outputBucket, outputPrefix, PILOT_PAGE_COUNT + 1);
  if (existingOutputs.truncated || existingOutputs.objects.length > 0) {
    throw new Error("The M14 recovery output prefix is not empty. No OCR request was submitted.");
  }

  const now = Date.now();
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO m14_vision_recovery " +
    "(source_id, status, vision_operation, output_bucket, output_prefix, source_pdf_generation, expected_page_count, error_message, created_at, updated_at) " +
    "VALUES (?, 'submitting', NULL, ?, ?, ?, ?, NULL, ?, ?)",
  ).bind(
    PILOT_SOURCE_ID,
    outputBucket,
    outputPrefix,
    sourceMetadata.generation,
    PILOT_PAGE_COUNT,
    now,
    now,
  ).run();

  if ((inserted.meta?.changes ?? 0) !== 1) {
    const raced = await getM14VisionRecoveryRecord(env);
    if (!raced) throw new Error("The M14 OCR recovery submission lock could not be verified.");
    return {
      sourceId: raced.source_id,
      status: raced.status,
      ...(raced.vision_operation ? { visionOperation: raced.vision_operation } : {}),
      outputBucket: raced.output_bucket,
      outputPrefix: raced.output_prefix,
      alreadySubmitted: true,
      message: "Another operator request already claimed this one-time OCR recovery. No duplicate request was submitted.",
    };
  }

  const outputUri = "gs://" + outputBucket + "/" + outputPrefix;
  let response: Response;
  try {
    response = await fetch(M14_VISION_API + "/files:asyncBatchAnnotate", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [{
          inputConfig: {
            gcsSource: { uri: "gs://" + sourceBucket + "/" + job.source_object },
            mimeType: "application/pdf",
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          outputConfig: {
            gcsDestination: { uri: outputUri },
            batchSize: 1,
          },
        }],
      }),
    });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE m14_vision_recovery SET status='submission_uncertain', error_message=?, updated_at=? WHERE source_id=? AND status='submitting'",
    ).bind(safeError(error), Date.now(), PILOT_SOURCE_ID).run();
    throw new Error("The Vision request connection ended before an operation ID was received. To prevent duplicate billing, automatic resubmission is blocked; inspect the recovery record.");
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 240);
    const message = "Google Vision rejected the new OCR request (HTTP " + response.status + "). " + detail;
    await env.DB.prepare(
      "UPDATE m14_vision_recovery SET status='failed', error_message=?, updated_at=? WHERE source_id=? AND status='submitting'",
    ).bind(message.slice(0, 500), Date.now(), PILOT_SOURCE_ID).run();
    throw new Error(message);
  }

  const operation = await response.json() as { name?: string };
  if (!operation.name || !operation.name.startsWith("projects/" + projectId + "/operations/")) {
    await env.DB.prepare(
      "UPDATE m14_vision_recovery SET status='submission_uncertain', error_message=?, updated_at=? WHERE source_id=? AND status='submitting'",
    ).bind("Google Vision accepted the request but returned an invalid operation identifier.", Date.now(), PILOT_SOURCE_ID).run();
    throw new Error("Google Vision did not return a valid operation ID. Automatic resubmission is blocked to avoid duplicate OCR jobs.");
  }

  await env.DB.prepare(
    "UPDATE m14_vision_recovery SET status='running', vision_operation=?, error_message=NULL, updated_at=? WHERE source_id=? AND status='submitting'",
  ).bind(operation.name, Date.now(), PILOT_SOURCE_ID).run();

  return {
    sourceId: PILOT_SOURCE_ID,
    status: "running",
    visionOperation: operation.name,
    outputBucket,
    outputPrefix,
    alreadySubmitted: false,
    message: "One Google Vision OCR request was accepted. Use the read-only status button until all three output files are verified.",
  };
}

async function readM14RecoveryVisionPage(
  env: Env,
  recovery: Pick<M14VisionRecoveryRecord, "output_bucket" | "output_prefix" | "status" | "expected_page_count">,
  page: number,
): Promise<FatmanVisionOcrPage> {
  if (recovery.status !== "completed" || !Number.isSafeInteger(page) ||
      page < 1 || page > recovery.expected_page_count) {
    throw new Error("Recovered M14 Vision output is not complete for the requested physical PDF page.");
  }
  const objectName = recovery.output_prefix + "output-" + page + "-to-" + page + ".json";
  const token = await getGoogleAccessToken(env);
  const response = await fetch(
    M14_GCS_API + "/storage/v1/b/" + encodeURIComponent(recovery.output_bucket) +
    "/o/" + encodeURIComponent(objectName) + "?alt=media",
    { headers: { authorization: "Bearer " + token } },
  );
  if (!response.ok) {
    throw new Error("Could not read recovered Vision OCR for physical PDF page " + page + " (HTTP " + response.status + ").");
  }
  const payload = await response.json() as {
    responses?: Array<{
      fullTextAnnotation?: { text?: string; pages?: Array<{ confidence?: number }> };
      error?: { message?: string };
    }>;
    context?: { pageNumber?: number };
  };
  if (payload.context?.pageNumber && Number(payload.context.pageNumber) !== page) {
    throw new Error("Recovered Vision OCR object does not match requested physical PDF page " + page + ".");
  }
  const annotation = payload.responses?.[0];
  if (annotation?.error?.message) {
    throw new Error("Recovered Google Vision OCR reports an error on physical PDF page " + page + ".");
  }
  const rawText = annotation?.fullTextAnnotation?.text;
  if (!annotation || typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Recovered Google Vision OCR contains no readable text for physical PDF page " + page + ".");
  }
  if (rawText.length > MAX_VISION_PAGE_TEXT_CHARS) {
    throw new Error("Recovered Vision OCR page " + page + " exceeds the one-million-character manifest limit.");
  }
  const confidence = annotation.fullTextAnnotation?.pages?.[0]?.confidence;
  return {
    rawText,
    ...(typeof confidence === "number" && Number.isFinite(confidence) &&
      confidence >= 0 && confidence <= 1 ? { pageConfidence: confidence } : {}),
  };
}

async function getM14VisionRecoveryStatus(env: Env): Promise<M14VisionRecoveryStatus & {
  visionOperation?: string;
  outputBucket?: string;
  outputPrefix?: string;
}> {
  const record = await getM14VisionRecoveryRecord(env);
  const expectedFileNames = Array.from({ length: PILOT_PAGE_COUNT }, (_, index) =>
    "output-" + (index + 1) + "-to-" + (index + 1) + ".json"
  );
  if (!record) {
    return {
      sourceId: PILOT_SOURCE_ID,
      status: "not_started",
      operationDone: false,
      operationHasError: false,
      destinationMatches: false,
      expectedPageCount: PILOT_PAGE_COUNT,
      expectedFileNames,
      actualFileNames: [],
      missingFileNames: expectedFileNames,
    };
  }

  if (!record.vision_operation) {
    return {
      sourceId: record.source_id,
      status: record.status,
      operationDone: false,
      operationHasError: false,
      destinationMatches: false,
      expectedPageCount: record.expected_page_count,
      outputBucket: record.output_bucket,
      outputPrefix: record.output_prefix,
      expectedFileNames,
      actualFileNames: [],
      missingFileNames: expectedFileNames,
      ...(record.error_message ? { error: record.error_message } : {}),
    };
  }

  const expectedUri = "gs://" + record.output_bucket + "/" + record.output_prefix;
  const operation = await getFatmanVisionOperation(env, record.vision_operation, expectedUri);
  const listing = await listM14GcsObjects(
    env,
    record.output_bucket,
    record.output_prefix,
    record.expected_page_count + 1,
  );
  const expectedFullNames = expectedFileNames.map((name) => record.output_prefix + name);
  const actualNames = listing.objects.map((object) => object.name);
  const actualSet = new Set(actualNames);
  const missingFileNames = expectedFullNames
    .filter((name) => !actualSet.has(name))
    .map((name) => name.slice(record.output_prefix.length));
  const unexpectedFileNames = actualNames
    .filter((name) => !expectedFullNames.includes(name))
    .map((name) => name.startsWith(record.output_prefix) ? name.slice(record.output_prefix.length) : name);
  const destinationMatches = Boolean(operation.outputDestinations?.some(
    (uri) => uri.replace(/\/+$/u, "") === expectedUri.replace(/\/+$/u, "")
  ));
  const operationHasError = Boolean(operation.error);

  let status: M14VisionRecoveryStatus["status"] = operation.done ? record.status : "running";
  let error = record.error_message ?? undefined;
  if (operationHasError) {
    status = "failed";
    error = operation.error;
    await env.DB!.prepare(
      "UPDATE m14_vision_recovery SET status='failed', error_message=?, updated_at=? WHERE source_id=?",
    ).bind((error ?? "Google Vision reported an OCR operation error.").slice(0, 500), Date.now(), PILOT_SOURCE_ID).run();
  } else if (operation.done && destinationMatches && !listing.truncated &&
      missingFileNames.length === 0 && unexpectedFileNames.length === 0) {
    status = "completed";
    error = undefined;
    await env.DB!.prepare(
      "UPDATE m14_vision_recovery SET status='completed', error_message=NULL, updated_at=? WHERE source_id=?",
    ).bind(Date.now(), PILOT_SOURCE_ID).run();
  } else if (operation.done) {
    status = "waiting_for_output_files";
  }

  return {
    sourceId: record.source_id,
    status,
    operationDone: operation.done,
    operationHasError,
    destinationMatches,
    expectedPageCount: record.expected_page_count,
    outputBucket: record.output_bucket,
    outputPrefix: record.output_prefix,
    visionOperation: record.vision_operation,
    expectedFileNames,
    actualFileNames: actualNames.map((name) =>
      name.startsWith(record.output_prefix) ? name.slice(record.output_prefix.length) : name
    ),
    missingFileNames,
    ...(error ? { error } : {}),
  };
}

async function readVerifiedM14CorpusGeneration(env: Env) {
  const recovery = await getM14VisionRecoveryRecord(env);
  if (!recovery || recovery.status !== "completed" ||
      recovery.vision_operation !== PILOT_RECOVERED_VISION_OPERATION ||
      recovery.output_bucket !== env.BRVIN_M14_CORPUS_BUCKET?.trim() ||
      recovery.expected_page_count !== PILOT_PAGE_COUNT) {
    throw new Error("The one-time recovered Physics OCR operation is not verified as completed in the isolated staging registry.");
  }
  const corpus = await readBrvinCorpusGeneration(env, PILOT_SOURCE_ID, PILOT_GENERATION_ID);
  const source = corpus.sourceManifest;
  if (source.sourcePdfSha256.toLowerCase() !== PILOT_SOURCE_SHA256 ||
      source.ocrOperationId !== PILOT_RECOVERED_VISION_OPERATION ||
      source.pageCount !== PILOT_PAGE_COUNT ||
      corpus.pageManifests.length !== PILOT_PAGE_COUNT ||
      corpus.chunkCount !== 7) {
    throw new Error("The persisted M14 source manifest does not match the exact Physics source, recovered Vision operation and expected 3-page/7-chunk generation.");
  }
  const pages = corpus.pageManifests.map((page) => ({
    pdfPage: page.pdfPage,
    stableItemKey: page.stableItemKey,
    chunkCount: page.chunks.length,
    rawOcrSha256: page.rawOcrSha256,
    normalizedSearchTextSha256: page.normalizedSearchTextSha256,
  }));
  if (pages.map((page) => page.pdfPage).join(",") !== "1,2,3" ||
      pages.map((page) => page.chunkCount).join(",") !== "2,2,3") {
    throw new Error("The persisted M14 corpus has unexpected page coverage or chunk counts.");
  }
  return corpus;
}

function createM14QdrantPilot(env: Env): BrvinQdrantHybridPilot {
  const dimensions = Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 3072) {
    throw new Error("Set BRVIN_M14_EMBEDDING_DIMENSIONS to the same supported dimension configured for the isolated Qdrant collection.");
  }
  if (!env.BRVIN_M14_VERTEX_LOCATION?.trim() ||
      !env.BRVIN_M14_VERTEX_MODEL?.trim() ||
      !env.BRVIN_M14_QDRANT_URL?.trim() ||
      !env.BRVIN_M14_QDRANT_API_KEY?.trim() ||
      !env.BRVIN_M14_QDRANT_COLLECTION?.trim()) {
    throw new Error("M14 Vertex/Qdrant settings are incomplete. Configure the staging-only model, location, dimension, cluster URL, API key and collection name.");
  }
  const embeddings = new BrvinVertexEmbeddingProvider(env);
  return new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL,
    apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection: env.BRVIN_M14_QDRANT_COLLECTION,
    dimensions,
  }, embeddings);
}

export interface M14QdrantIndexReceipt {
  sourceId: string;
  generationId: string;
  projectId: string;
  collection: string;
  pageCount: number;
  chunkCount: number;
  pointCount: number;
  embeddingModelIds: string[];
  embeddingModelVersions: string[];
  dimensions: number;
  deterministicRetrySafe: true;
}

async function indexM14PhysicsCorpusInQdrant(env: Env): Promise<M14QdrantIndexReceipt> {
  const corpus = await readVerifiedM14CorpusGeneration(env);
  const pilot = createM14QdrantPilot(env);
  const result = await indexBrvinCorpusGeneration(
    pilot,
    BRVIN_M14_PHYSICS_PILOT.projectId,
    corpus,
  );
  if (result.sourceId !== PILOT_SOURCE_ID ||
      result.generationId !== PILOT_GENERATION_ID ||
      result.pageCount !== PILOT_PAGE_COUNT ||
      result.chunkCount !== 7 ||
      result.pointCount !== 7 ||
      result.pointIds.length !== 7 ||
      new Set(result.pointIds).size !== 7) {
    throw new Error("Qdrant did not confirm the complete seven-point Physics generation.");
  }
  return {
    sourceId: result.sourceId,
    generationId: result.generationId,
    projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
    collection: env.BRVIN_M14_QDRANT_COLLECTION!.trim(),
    pageCount: result.pageCount,
    chunkCount: result.chunkCount,
    pointCount: result.pointCount,
    embeddingModelIds: result.embeddingModelIds,
    embeddingModelVersions: result.embeddingModelVersions,
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
    deterministicRetrySafe: true,
  };
}

export interface M14QdrantEvaluationReceipt {
  projectId: string;
  sourceId: string;
  collection: string;
  embeddingModel: string;
  dimensions: number;
  queryCount: number;
  expectedPageCount: number;
  coveredExpectedPageCount: number;
  expectedPageCoverageRate: number;
  allExpectedPagesCovered: boolean;
  returnedResultCount: number;
  expectedPageResultCount: number;
  expectedPagePrecisionAt5: number;
  meanReciprocalExpectedPageRank: number;
  negativeCasesDeferred: string[];
  checks: Array<{
    id: string;
    category: string;
    expectedPages: number[];
    retrievedPages: number[];
    expectedPageCoverage: number[];
    expectedPageRanks: Array<number | null>;
    pageCoveragePassed: boolean;
    expectedPageResultCount: number;
    expectedPagePrecisionAt5: number;
    firstExpectedPageRank: number | null;
    resultCount: number;
    topScore: number | null;
    verification: "prior-source-evidence" | "ocr-ground-truth-verified";
  }>;
  note: string;
}

async function evaluateM14KnownPhysicsQueries(env: Env): Promise<M14QdrantEvaluationReceipt> {
  const pilot = createM14QdrantPilot(env);
  const cases = BRVIN_M14_PHYSICS_QUERY_SUITE.filter(
    (item) => !item.expectedNoMatch && item.expectedPdfPages.length > 0 &&
      (item.verification === "prior-source-evidence" || item.verification === "ocr-ground-truth-verified"),
  );
  const negativeCasesDeferred = BRVIN_M14_PHYSICS_QUERY_SUITE
    .filter((item) => item.expectedNoMatch === true)
    .map((item) => item.id);
  const checks: M14QdrantEvaluationReceipt["checks"] = [];
  for (const item of cases) {
    const results = await pilot.query({
      projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
      authorizedSourceIds: [PILOT_SOURCE_ID],
      query: item.query,
      limit: 5,
      prefetchLimit: 15,
    });
    const retrievedPages = results.map((result) => result.pdfPage);
    const expectedPageCoverage = item.expectedPdfPages.filter((page) => retrievedPages.includes(page));
    const expectedPageRanks = item.expectedPdfPages.map((page) => {
      const index = retrievedPages.indexOf(page);
      return index >= 0 ? index + 1 : null;
    });
    const expectedPageResultCount = results.filter(
      (result) => item.expectedPdfPages.includes(result.pdfPage),
    ).length;
    const firstExpectedPageRank = expectedPageRanks
      .filter((rank): rank is number => rank !== null)
      .reduce<number | null>((best, rank) => best === null ? rank : Math.min(best, rank), null);
    checks.push({
      id: item.id,
      category: item.category,
      expectedPages: [...item.expectedPdfPages],
      retrievedPages,
      expectedPageCoverage,
      expectedPageRanks,
      pageCoveragePassed: expectedPageCoverage.length === item.expectedPdfPages.length,
      expectedPageResultCount,
      expectedPagePrecisionAt5: results.length > 0 ? expectedPageResultCount / results.length : 0,
      firstExpectedPageRank,
      resultCount: results.length,
      topScore: results[0]?.score ?? null,
      verification: item.verification as "prior-source-evidence" | "ocr-ground-truth-verified",
    });
  }
  const pageCoverage = summarizeBrvinM14PageCoverage(checks);
  const ranking = summarizeBrvinM14Ranking(checks);
  return {
    projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
    sourceId: PILOT_SOURCE_ID,
    collection: env.BRVIN_M14_QDRANT_COLLECTION!.trim(),
    embeddingModel: env.BRVIN_M14_VERTEX_MODEL!.trim(),
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
    queryCount: checks.length,
    ...pageCoverage,
    ...ranking,
    negativeCasesDeferred,
    checks,
    note: "Ten positive source-grounded Physics queries run through Vertex embeddings and Qdrant dense+sparse RRF. expectedPageCoverageRate measures expected-page recall in the top five. expectedPagePrecisionAt5 is a strict physical-page-label precision proxy over returned chunks: a result on a non-expected page is not automatically irrelevant, and chunk-level human relevance judgments are required before this becomes a formal precision gate. meanReciprocalExpectedPageRank measures the rank of the first expected page per query; none of these metrics alone proves formula fidelity or answer correctness. Two OCR-reviewed negative/no-answer cases remain deferred until case-sensitive rejection and abstention thresholds are defined.",
  };
}

export interface M14QdrantRetrievalDiagnosticsReceipt {
  projectId: string;
  sourceId: string;
  collection: string;
  embeddingModel: string;
  dimensions: number;
  candidateEvidence: Array<{
    pointId: string;
    chunkId?: string;
    pdfPage: number;
    contentTypes: string[];
    fullText: string;
    retrievedBy: Array<{
      queryId: string;
      queryType: "negative" | "friction_repeat";
      repeat?: number;
      rank: number;
      rrfScore: number;
    }>;
  }>;
  negativeCaseDiagnostics: Array<{
    id: string;
    category: string;
    query: string;
    expectedNoMatch: true;
    resultCount: number;
    topRrfScore: number | null;
    results: Array<{
      rank: number;
      pointId: string;
      chunkId?: string;
      pdfPage: number;
      rrfScore: number;
      contentTypes: string[];
      textPreview: string;
    }>;
    interpretation: string;
  }>;
  frictionRepeatability: {
    queryId: string;
    query: string;
    expectedPages: number[];
    repeatCount: number;
    samples: Array<{
      repeat: number;
      firstExpectedPageRank: number | null;
      expectedPageResultCount: number;
      orderedResults: Array<{
        rank: number;
        pointId: string;
        chunkId?: string;
        pdfPage: number;
        rrfScore: number;
      }>;
    }>;
    distinctOrderedSequences: number;
    distinctTopFiveSets: number;
    observedFirstExpectedPageRanks: Array<number | null>;
    rankStableAcrossRepeats: boolean;
    note: string;
  };
  note: string;
}

/**
 * Retrieval-only, non-gating diagnostics. The two expected-no-match queries
 * expose returned evidence for human inspection; they do not declare an
 * abstention pass/fail. Three repeated friction queries expose result order,
 * point/chunk identity and RRF scores so tie/order variation can be diagnosed.
 */
async function runM14QdrantRetrievalDiagnostics(
  env: Env,
): Promise<M14QdrantRetrievalDiagnosticsReceipt> {
  const pilot = createM14QdrantPilot(env);
  const negativeCases = BRVIN_M14_PHYSICS_QUERY_SUITE.filter(
    (item) => item.expectedNoMatch === true,
  );
  const negativeCaseDiagnostics: M14QdrantRetrievalDiagnosticsReceipt["negativeCaseDiagnostics"] = [];
  const uniqueCandidateEvidence = new Map<
    string,
    M14QdrantRetrievalDiagnosticsReceipt["candidateEvidence"][number]
  >();
  const recordCandidateEvidence = (
    results: Awaited<ReturnType<typeof pilot.query>>,
    queryId: string,
    queryType: "negative" | "friction_repeat",
    repeat?: number,
  ): void => {
    results.forEach((result, index) => {
      const chunkId = typeof result.metadata?.chunkId === "string"
        ? result.metadata.chunkId
        : undefined;
      const retrievedBy = {
        queryId,
        queryType,
        ...(repeat !== undefined ? { repeat } : {}),
        rank: index + 1,
        rrfScore: result.score ?? 0,
      };
      const existing = uniqueCandidateEvidence.get(result.id);
      if (existing) {
        if (existing.fullText !== result.text || existing.pdfPage !== result.pdfPage) {
          throw new Error("Qdrant returned conflicting full-text evidence for one deterministic M14 point.");
        }
        existing.retrievedBy.push(retrievedBy);
        return;
      }
      if (uniqueCandidateEvidence.size >= 7) {
        throw new Error("The M14 diagnostic returned more unique points than the verified seven-chunk corpus.");
      }
      uniqueCandidateEvidence.set(result.id, {
        pointId: result.id,
        ...(chunkId ? { chunkId } : {}),
        pdfPage: result.pdfPage,
        contentTypes: [...result.contentTypes],
        fullText: result.text,
        retrievedBy: [retrievedBy],
      });
    });
  };

  for (const item of negativeCases) {
    const results = await pilot.query({
      projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
      authorizedSourceIds: [PILOT_SOURCE_ID],
      query: item.query,
      limit: 5,
      prefetchLimit: 15,
    });
    recordCandidateEvidence(results, item.id, "negative");
    negativeCaseDiagnostics.push({
      id: item.id,
      category: item.category,
      query: item.query,
      expectedNoMatch: true,
      resultCount: results.length,
      topRrfScore: results[0]?.score ?? null,
      results: results.map((result, index) => {
        const chunkId = typeof result.metadata?.chunkId === "string"
          ? result.metadata.chunkId
          : undefined;
        return {
          rank: index + 1,
          pointId: result.id,
          ...(chunkId ? { chunkId } : {}),
          pdfPage: result.pdfPage,
          rrfScore: result.score ?? 0,
          contentTypes: [...result.contentTypes],
          textPreview: result.text.replace(/\s+/gu, " ").slice(0, 260),
        };
      }),
      interpretation: "Retrieval-only evidence for human review. This result list is not an abstention pass/fail; RRF scores are rank-fusion scores, not calibrated confidence probabilities.",
    });
  }

  const frictionCase = BRVIN_M14_PHYSICS_QUERY_SUITE.find(
    (item) => item.id === "friction-and-net-force",
  );
  if (!frictionCase || frictionCase.expectedPdfPages.length === 0) {
    throw new Error("The reviewed M14 friction stability query is missing its expected-page ground truth.");
  }
  const repeatCount = 3;
  const samples: M14QdrantRetrievalDiagnosticsReceipt["frictionRepeatability"]["samples"] = [];

  for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
    const results = await pilot.query({
      projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
      authorizedSourceIds: [PILOT_SOURCE_ID],
      query: frictionCase.query,
      limit: 5,
      prefetchLimit: 15,
    });
    recordCandidateEvidence(results, frictionCase.id, "friction_repeat", repeat);
    const retrievedPages = results.map((result) => result.pdfPage);
    const expectedPageRanks = frictionCase.expectedPdfPages.map((page) => {
      const index = retrievedPages.indexOf(page);
      return index >= 0 ? index + 1 : null;
    });
    const firstExpectedPageRank = expectedPageRanks
      .filter((rank): rank is number => rank !== null)
      .reduce<number | null>((best, rank) => best === null ? rank : Math.min(best, rank), null);

    samples.push({
      repeat,
      firstExpectedPageRank,
      expectedPageResultCount: results.filter(
        (result) => frictionCase.expectedPdfPages.includes(result.pdfPage),
      ).length,
      orderedResults: results.map((result, index) => {
        const chunkId = typeof result.metadata?.chunkId === "string"
          ? result.metadata.chunkId
          : undefined;
        return {
          rank: index + 1,
          pointId: result.id,
          ...(chunkId ? { chunkId } : {}),
          pdfPage: result.pdfPage,
          rrfScore: result.score ?? 0,
        };
      }),
    });
  }

  const orderedFingerprints = samples.map((sample) =>
    sample.orderedResults.map((result) => result.pointId).join("|"),
  );
  const setFingerprints = samples.map((sample) =>
    sample.orderedResults.map((result) => result.pointId).sort().join("|"),
  );
  const observedFirstExpectedPageRanks = samples.map((sample) => sample.firstExpectedPageRank);

  return {
    projectId: BRVIN_M14_PHYSICS_PILOT.projectId,
    sourceId: PILOT_SOURCE_ID,
    collection: env.BRVIN_M14_QDRANT_COLLECTION!.trim(),
    embeddingModel: env.BRVIN_M14_VERTEX_MODEL!.trim(),
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
    candidateEvidence: [...uniqueCandidateEvidence.values()],
    negativeCaseDiagnostics,
    frictionRepeatability: {
      queryId: frictionCase.id,
      query: frictionCase.query,
      expectedPages: [...frictionCase.expectedPdfPages],
      repeatCount,
      samples,
      distinctOrderedSequences: new Set(orderedFingerprints).size,
      distinctTopFiveSets: new Set(setFingerprints).size,
      observedFirstExpectedPageRanks,
      rankStableAcrossRepeats: new Set(observedFirstExpectedPageRanks).size <= 1,
      note: "Three identical query calls against the same staging project/source. Compare point IDs, chunk IDs, RRF scores and page ranks. This is a diagnostic sample, not a ranking acceptance threshold.",
    },
    note: "Non-gating retrieval diagnostics only. Complete chunk text for each unique returned point is included once in candidateEvidence for authenticated staging-operator human review; it is sourced from the fixed M14 corpus payload and is not a generated answer. No retrieval abstention or answer correctness is asserted. Qdrant RRF scores are not calibrated confidence probabilities. The friction query is repeated three times to expose within-run ordering and candidate variation. The separate BRVIN Teachers consumer-owned Gemini answer/abstention path is not invoked by this action.",
  };
}

async function verifyM14CorpusReadback(env: Env): Promise<M14CorpusReadbackSummary> {
  const corpus = await readVerifiedM14CorpusGeneration(env);
  const source = corpus.sourceManifest;
  const pages = corpus.pageManifests.map((page) => ({
    pdfPage: page.pdfPage,
    stableItemKey: page.stableItemKey,
    chunkCount: page.chunks.length,
    rawOcrSha256: page.rawOcrSha256,
    normalizedSearchTextSha256: page.normalizedSearchTextSha256,
  }));
  return {
    sourceId: PILOT_SOURCE_ID,
    generationId: PILOT_GENERATION_ID,
    sourcePdfSha256: source.sourcePdfSha256,
    visionOperationId: source.ocrOperationId,
    pageCount: source.pageCount,
    chunkCount: corpus.chunkCount,
    pages,
    verified: true,
  };
}

async function inspectM14VisionOutputs(env: Env): Promise<M14VisionOutputDiagnostics> {
  const sourceBucket = env.FATMAN_GCS_BUCKET?.trim() ?? "";
  if (!env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.GCP_PROJECT_ID || !sourceBucket || !env.BRVIN_M14_CORPUS_BUCKET) {
    throw new Error("Staging Google Cloud configuration is incomplete.");
  }
  const job = await getRegisteredPhysicsJob(env, PILOT_SOURCE_ID);
  if (!job || job.id !== PILOT_SOURCE_ID || job.book_id !== PILOT_SOURCE_ID ||
      job.status !== "completed" || Number(job.page_count) !== PILOT_PAGE_COUNT ||
      Number(job.indexed_pages) !== PILOT_PAGE_COUNT ||
      job.source_sha256?.toLowerCase() !== PILOT_SOURCE_SHA256 ||
      job.vision_operation !== PILOT_VISION_OPERATION) {
    throw new Error("The registered Physics source is not the exact completed import expected by the M14 diagnostic.");
  }

  const prefix = fatmanVisionOutputPrefix(job);
  const expectedOutputUri = "gs://" + sourceBucket + "/" + prefix;
  const operation = await getFatmanVisionOperation(env, PILOT_VISION_OPERATION, expectedOutputUri);
  const listing = await listFatmanVisionOutputObjects(env, job, PILOT_PAGE_COUNT + 1);
  const expectedFullNames = Array.from({ length: PILOT_PAGE_COUNT }, (_, index) =>
    fatmanOutputObjectName(job.id, index + 1, prefix)
  );
  const actualFullNames = listing.objects.map((object) => object.name);
  const expectedFileNames = expectedFullNames.map((name) => name.slice(prefix.length)).sort();
  const actualFileNames = actualFullNames.map((name) =>
    name.startsWith(prefix) ? name.slice(prefix.length) : name
  ).sort();
  const actualSet = new Set(actualFullNames);
  const expectedSet = new Set(expectedFullNames);
  const missingFileNames = expectedFullNames
    .filter((name) => !actualSet.has(name))
    .map((name) => name.slice(prefix.length))
    .sort();
  const unexpectedFileNames = actualFullNames
    .filter((name) => !expectedSet.has(name))
    .map((name) => name.startsWith(prefix) ? name.slice(prefix.length) : name)
    .sort();

  return {
    sourceId: PILOT_SOURCE_ID,
    pageCount: PILOT_PAGE_COUNT,
    expectedPrefix: prefix,
    operationDone: operation.done,
    operationHasError: Boolean(operation.error),
    operationDestinationMatches: Boolean(operation.outputDestinations?.some(
      (uri) => uri.replace(/\/+$/u, "") === expectedOutputUri.replace(/\/+$/u, "")
    )),
    truncated: listing.truncated,
    expectedFileNames,
    actualFileNames,
    missingFileNames,
    unexpectedFileNames,
    objects: listing.objects.map((object) => ({
      fileName: object.name.startsWith(prefix) ? object.name.slice(prefix.length) : object.name,
      ...(object.size !== undefined ? { size: object.size } : {}),
    })),
  };
}

export async function handleM14StagingRequest(
  request: Request,
  env: M14StagingWorkerEnv,
  runBackfill: typeof backfillBrvinM14CorpusFromStoredVision = backfillBrvinM14CorpusFromStoredVision,
  inspectOutputs: typeof inspectM14VisionOutputs = inspectM14VisionOutputs,
  startRecovery: typeof startM14VisionRecovery = startM14VisionRecovery,
  readRecoveryStatus: typeof getM14VisionRecoveryStatus = getM14VisionRecoveryStatus,
  verifyCorpus: typeof verifyM14CorpusReadback = verifyM14CorpusReadback,
  indexQdrant: typeof indexM14PhysicsCorpusInQdrant = indexM14PhysicsCorpusInQdrant,
  evaluateQdrant: typeof evaluateM14KnownPhysicsQueries = evaluateM14KnownPhysicsQueries,
  diagnoseQdrant: typeof runM14QdrantRetrievalDiagnostics = runM14QdrantRetrievalDiagnostics,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return json({
      ok: true,
      app: "parmar-ai-m14-staging",
      environment: env.ENVIRONMENT ?? "unset",
      pilotEnabled: env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() === "true",
      sourceRegistryBound: Boolean(env.DB),
      secretsConfigured: {
        gcpClientEmail: Boolean(env.GCP_CLIENT_EMAIL),
        gcpPrivateKey: Boolean(env.GCP_PRIVATE_KEY),
        m14AdminToken: Boolean(env.BRVIN_M14_ADMIN_TOKEN),
        qdrantApiKey: Boolean(env.BRVIN_M14_QDRANT_API_KEY),
      },
      m14ProviderConfigured: {
        vertexLocation: Boolean(env.BRVIN_M14_VERTEX_LOCATION),
        vertexModel: Boolean(env.BRVIN_M14_VERTEX_MODEL),
        embeddingDimensions: Boolean(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
        qdrantUrl: Boolean(env.BRVIN_M14_QDRANT_URL),
        qdrantCollection: Boolean(env.BRVIN_M14_QDRANT_COLLECTION),
        ready: Boolean(env.BRVIN_M14_VERTEX_LOCATION && env.BRVIN_M14_VERTEX_MODEL &&
          env.BRVIN_M14_EMBEDDING_DIMENSIONS && env.BRVIN_M14_QDRANT_URL &&
          env.BRVIN_M14_QDRANT_API_KEY && env.BRVIN_M14_QDRANT_COLLECTION),
      },
      // Do not expose credential values, bucket names or source-document content.
    });
  }

  if (url.pathname === "/admin/m14") {
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (env.ENVIRONMENT !== "staging" ||
        env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
      return json({ ok: false, error: "m14_staging_pilot_disabled" }, 404);
    }
    return m14AdminPage();
  }

  const isDiagnostics = url.pathname === "/admin/m14/diagnostics";
  const isVisionRebuild = url.pathname === "/admin/m14/vision/rebuild";
  const isVisionStatus = url.pathname === "/admin/m14/vision/status";
  const isCorpusVerify = url.pathname === "/admin/m14/corpus/verify";
  const isQdrantIndex = url.pathname === "/admin/m14/qdrant/index";
  const isQdrantEvaluate = url.pathname === "/admin/m14/qdrant/evaluate";
  const isQdrantDiagnostics = url.pathname === "/admin/m14/qdrant/diagnostics";
  const isBackfill = url.pathname === "/admin/m14/backfill";
  if (!isDiagnostics && !isVisionRebuild && !isVisionStatus && !isCorpusVerify &&
      !isQdrantIndex && !isQdrantEvaluate && !isQdrantDiagnostics && !isBackfill) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  if ((isDiagnostics && request.method !== "GET") ||
      (isVisionRebuild && request.method !== "POST") ||
      (isVisionStatus && request.method !== "GET") ||
      (isCorpusVerify && request.method !== "GET") ||
      (isQdrantIndex && request.method !== "POST") ||
      (isQdrantEvaluate && request.method !== "POST") ||
      (isQdrantDiagnostics && request.method !== "POST") ||
      (isBackfill && request.method !== "POST")) {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    return json({ ok: false, error: "m14_staging_pilot_disabled" }, 404);
  }
  const configuredToken = env.BRVIN_M14_ADMIN_TOKEN?.trim() ?? "";
  if (configuredToken.length < 32) {
    return json({ ok: false, error: "m14_operator_secret_not_configured" }, 503);
  }
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!equalSecret(suppliedToken, configuredToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (isDiagnostics) {
    try {
      const diagnostics = await inspectOutputs(env);
      return json({ ok: true, diagnostics });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  if (isVisionStatus) {
    try {
      const recovery = await readRecoveryStatus(env);
      return json({ ok: true, recovery });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  if (isCorpusVerify) {
    try {
      const verification = await verifyCorpus(env);
      return json({ ok: true, verification });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  if (!env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.GCP_PROJECT_ID || !env.FATMAN_GCS_BUCKET ||
      !env.BRVIN_M14_CORPUS_BUCKET || !env.DB) {
    return json({ ok: false, error: "staging_google_cloud_configuration_incomplete" }, 503);
  }

  if (isQdrantIndex || isQdrantEvaluate || isQdrantDiagnostics) {
    let providerPayload: unknown;
    try {
      providerPayload = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (!providerPayload || typeof providerPayload !== "object" ||
        (providerPayload as { confirmSourceId?: unknown }).confirmSourceId !== PILOT_SOURCE_ID) {
      return json({ ok: false, error: "source_confirmation_mismatch" }, 400);
    }
    if (!env.BRVIN_M14_VERTEX_LOCATION || !env.BRVIN_M14_VERTEX_MODEL ||
        !env.BRVIN_M14_EMBEDDING_DIMENSIONS || !env.BRVIN_M14_QDRANT_URL ||
        !env.BRVIN_M14_QDRANT_API_KEY || !env.BRVIN_M14_QDRANT_COLLECTION) {
      return json({ ok: false, error: "m14_vertex_qdrant_configuration_incomplete" }, 503);
    }
    try {
      if (isQdrantIndex) {
        const receipt = await indexQdrant(env);
        return json({ ok: true, index: receipt });
      }
      if (isQdrantEvaluate) {
        const receipt = await evaluateQdrant(env);
        return json({ ok: true, evaluation: receipt });
      }
      const diagnostics = await diagnoseQdrant(env);
      return json({ ok: true, diagnostics });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  if (isVisionRebuild) {
    let recoveryPayload: unknown;
    try {
      recoveryPayload = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (!recoveryPayload || typeof recoveryPayload !== "object" ||
        (recoveryPayload as { confirmSourceId?: unknown }).confirmSourceId !== PILOT_SOURCE_ID) {
      return json({ ok: false, error: "source_confirmation_mismatch" }, 400);
    }
    try {
      const recovery = await startRecovery(env);
      return json({ ok: true, recovery });
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 502);
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!payload || typeof payload !== "object" ||
      (payload as { confirmSourceId?: unknown }).confirmSourceId !== PILOT_SOURCE_ID) {
    return json({ ok: false, error: "source_confirmation_mismatch" }, 400);
  }

  try {
    const recovery = await readRecoveryStatus(env);
    if (recovery.status !== "completed" || !recovery.visionOperation ||
        !recovery.outputBucket || !recovery.outputPrefix) {
      return json({
        ok: false,
        error: "m14_vision_recovery_not_ready",
        recovery,
        message: "The new OCR operation must complete and all three page files must be verified before the backfill can run.",
      }, 409);
    }
    const registeredJob = await getRegisteredPhysicsJob(env, PILOT_SOURCE_ID);
    if (!registeredJob) throw new Error("The registered Physics source is missing from the isolated M14 staging registry.");
    const recoveredJob: FatmanImportJob = {
      ...registeredJob,
      vision_operation: recovery.visionOperation,
    };
    const recoveryRecord: Pick<M14VisionRecoveryRecord, "output_bucket" | "output_prefix" | "status" | "expected_page_count"> = {
      output_bucket: recovery.outputBucket,
      output_prefix: recovery.outputPrefix,
      status: "completed",
      expected_page_count: recovery.expectedPageCount,
    };
    const dependencies: Partial<BrvinM14VisionBackfillDependencies> = {
      getJob: async () => recoveredJob,
      getVisionOperation: getFatmanVisionOperation,
      listVisionObjects: async (_env, _job, maxObjects) => {
        const listing = await listM14GcsObjects(
          env,
          recovery.outputBucket!,
          recovery.outputPrefix!,
          maxObjects,
        );
        return {
          prefix: "gs://" + recovery.outputBucket + "/" + recovery.outputPrefix,
          objects: listing.objects.map((object) => ({
            name: object.name,
            ...(object.size !== undefined ? { size: object.size } : {}),
          })),
          truncated: listing.truncated,
        };
      },
      readVisionPage: async (_env, _sourceId, page) =>
        readM14RecoveryVisionPage(env, recoveryRecord, page),
    };
    const result = await runBackfill(env, {
      sourceId: PILOT_SOURCE_ID,
      sourcePdfSha256: PILOT_SOURCE_SHA256,
      visionOperationId: recovery.visionOperation,
      pageCount: PILOT_PAGE_COUNT,
      visionOutputBucket: recovery.outputBucket,
      visionOutputPrefix: recovery.outputPrefix,
    }, dependencies);
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export default {
  async fetch(request: Request, env: M14StagingWorkerEnv): Promise<Response> {
    return handleM14StagingRequest(request, env);
  },
};
