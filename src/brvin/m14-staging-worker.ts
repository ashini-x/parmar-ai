import type { Env } from "../config/env";
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
    <p>This operator runs one controlled backfill for the already-registered three-page Physics source. It cannot select another PDF, change a source ID, or access production data.</p>
    <div class="notice">
      <strong>Before you continue</strong>
      <p class="small">Complete the Google Cloud bucket, service-account permissions, and Cloudflare secret setup first. The action writes derived manifests to the separate M14 staging bucket. It does not upload the PDF again or start another OCR job.</p>
    </div>
    <div id="health" class="status muted" role="status" aria-live="polite">Checking staging configuration…</div>
    <label for="token">M14 staging operator token</label>
    <input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the BRVIN_M14_ADMIN_TOKEN secret" minlength="32">
    <label class="confirm"><input id="confirm" type="checkbox"> <span>I understand this will run the fixed three-page Physics backfill in the isolated staging environment.</span></label>
    <button id="inspect" class="secondary" type="button" disabled>Inspect saved OCR files (read only)</button>
    <button id="run" type="button" disabled>Run Physics backfill</button>
    <div id="result" class="status muted" role="status" aria-live="polite">No backfill has been started.</div>
    <details>
      <summary>Security and retry information</summary>
      <p class="small">The token is used only for this request, is cleared from the input after submission, and is not saved in browser storage. The browser sends it only to this same staging website. Re-running an identical backfill is designed to verify existing immutable manifests rather than overwrite changed data.</p>
      <p class="small">Never paste a Google private key here. This page needs only the separate M14 operator token.</p>
    </details>
  </main>
<script>
(() => {
  const tokenInput = document.getElementById("token");
  const confirmInput = document.getElementById("confirm");
  const runButton = document.getElementById("run");
  const inspectButton = document.getElementById("inspect");
  const healthBox = document.getElementById("health");
  const resultBox = document.getElementById("result");

  function refreshButton() {
    const canAuthenticate = tokenInput.value.trim().length >= 32;
    inspectButton.disabled = !canAuthenticate || runButton.dataset.ready !== "true";
    runButton.disabled = !confirmInput.checked || !canAuthenticate || runButton.dataset.ready !== "true";
  }
  tokenInput.addEventListener("input", refreshButton);
  confirmInput.addEventListener("change", refreshButton);

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
      healthBox.className = "status " + (ready ? "good" : "bad");
      healthBox.textContent = ready
        ? "Staging checks passed: staging mode, pilot enabled, isolated registry and required secrets are present."
        : "Staging is not ready. Check the Worker health response and complete any missing configuration before running the backfill.\\n" + JSON.stringify(data, null, 2);
      runButton.dataset.ready = ready ? "true" : "false";
      refreshButton();
    } catch {
      healthBox.className = "status bad";
      healthBox.textContent = "Could not read the staging health endpoint. Refresh this page and try again.";
      runButton.dataset.ready = "false";
      refreshButton();
    }
  }

  inspectButton.addEventListener("click", async () => {
    refreshButton();
    if (inspectButton.disabled) return;
    let token = tokenInput.value.trim();
    tokenInput.value = "";
    refreshButton();
    inspectButton.disabled = true;
    inspectButton.textContent = "Inspecting…";
    resultBox.className = "status muted";
    resultBox.textContent = "Reading only the saved Vision operation status and OCR object filenames. No files will be changed.";
    try {
      const response = await fetch("/admin/m14/diagnostics", {
        method: "GET",
        headers: { "authorization": "Bearer " + token },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const data = await response.json();
      resultBox.className = "status " + (response.ok && data.ok === true ? "good" : "bad");
      resultBox.textContent = JSON.stringify(data, null, 2);
    } catch {
      resultBox.className = "status bad";
      resultBox.textContent = "Could not inspect the saved OCR files. Check your connection and try again.";
    } finally {
      token = "";
      tokenInput.value = "";
      inspectButton.textContent = "Inspect saved OCR files (read only)";
      refreshButton();
    }
  });

  runButton.addEventListener("click", async () => {
    refreshButton();
    if (runButton.disabled || runButton.dataset.ready !== "true") {
      resultBox.className = "status bad";
      resultBox.textContent = "The required staging checks have not passed. Do not run the backfill yet.";
      return;
    }

    let token = tokenInput.value.trim();
    tokenInput.value = "";
    refreshButton();
    confirmInput.disabled = true;
    runButton.disabled = true;
    runButton.textContent = "Running…";
    resultBox.className = "status muted";
    resultBox.textContent = "The Worker is validating the saved OCR source and writing the three page manifests. Keep this page open until a result appears.";

    try {
      const response = await fetch("/admin/m14/backfill", {
        method: "POST",
        headers: {
          "authorization": "Bearer " + token,
          "content-type": "application/json"
        },
        body: JSON.stringify({ confirmSourceId: "01238b3a-9902-4a42-90b4-574048ee4f00" }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const data = await response.json();
      resultBox.className = "status " + (response.ok && data.ok === true ? "good" : "bad");
      resultBox.textContent = JSON.stringify(data, null, 2);
      if (response.ok && data.ok === true) {
        runButton.textContent = "Backfill completed";
      } else {
        runButton.textContent = "Retry Physics backfill";
        confirmInput.disabled = false;
      }
    } catch {
      resultBox.className = "status bad";
      resultBox.textContent = "The request could not be completed or the connection was interrupted. Check the health page before retrying. Identical successful writes are replay-safe.";
      runButton.textContent = "Retry Physics backfill";
      confirmInput.disabled = false;
    } finally {
      token = "";
      tokenInput.value = "";
      refreshButton();
    }
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
      (uri) => uri.replace(/\\/+$/u, "") === expectedOutputUri.replace(/\\/+$/u, "")
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
  const isBackfill = url.pathname === "/admin/m14/backfill";
  if (!isDiagnostics && !isBackfill) return json({ ok: false, error: "not_found" }, 404);
  if ((isDiagnostics && request.method !== "GET") || (isBackfill && request.method !== "POST")) {
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

  if (!env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.GCP_PROJECT_ID || !env.FATMAN_GCS_BUCKET ||
      !env.BRVIN_M14_CORPUS_BUCKET) {
    return json({ ok: false, error: "staging_google_cloud_configuration_incomplete" }, 503);
  }

  try {
    const dependencies: Partial<BrvinM14VisionBackfillDependencies> = {
      getJob: getRegisteredPhysicsJob,
      getVisionOperation: getFatmanVisionOperation,
      listVisionObjects: listFatmanVisionOutputObjects,
      readVisionPage: readStoredVisionPage,
    };
    const result = await runBackfill(env, {
      sourceId: PILOT_SOURCE_ID,
      sourcePdfSha256: PILOT_SOURCE_SHA256,
      visionOperationId: PILOT_VISION_OPERATION,
      pageCount: PILOT_PAGE_COUNT,
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
