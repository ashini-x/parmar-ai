import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ROOT_URL = "https://parmar-ai.thenewtongs.workers.dev/";
const DEFAULT_HEALTH_URL = "https://parmar-ai.thenewtongs.workers.dev/health";
const API_BASE = "https://api.cloudflare.com/client/v4";

function requireValue(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required for production acceptance.");
  }
  return value.trim();
}

function deploymentTimestamp(deployment) {
  const timestamp = Date.parse(deployment?.created_on ?? "");
  return Number.isFinite(timestamp) ? timestamp : -1;
}

/**
 * Select only the newest deployment record. Falling back to an older 100%
 * deployment could incorrectly certify a currently split or partial rollout.
 */
export function resolveLatestWorkerDeployment(payload, workerName) {
  if (payload?.success !== true) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => (item.code ?? "?") + ": " + (item.message ?? "Unknown Cloudflare error")).join("; ")
      : "Cloudflare did not report success.";
    throw new Error("Cannot verify " + workerName + " deployment: " + errors);
  }

  const deployments = payload?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("No deployment history was returned for " + workerName + ".");
  }

  const latest = [...deployments].sort((left, right) => deploymentTimestamp(right) - deploymentTimestamp(left))[0];
  if (deploymentTimestamp(latest) < 0) {
    throw new Error("The latest " + workerName + " deployment has no valid creation timestamp.");
  }

  const versions = latest?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 || versions[0]?.percentage !== 100) {
    const traffic = Array.isArray(versions)
      ? versions.map((version) => String(version?.percentage ?? "?") + "%").join(" + ")
      : "unknown";
    throw new Error("The latest " + workerName + " deployment is not a single-version 100% rollout (traffic: " + traffic + ").");
  }

  const deploymentId = latest?.id;
  const versionId = versions[0]?.version_id;
  if (typeof deploymentId !== "string" || !deploymentId || typeof versionId !== "string" || !versionId) {
    throw new Error("The latest " + workerName + " deployment is missing its deployment or version ID.");
  }

  return {
    deploymentId,
    versionId,
    createdAt: latest.created_on,
    trafficPercent: 100,
  };
}

export function assertProductionHealth(root, health) {
  if (root?.ok !== true || root?.service !== "parmar-ai") {
    throw new Error("The public root endpoint did not identify a healthy परमार्थAI Worker.");
  }
  if (health?.ok !== true || health?.status !== "healthy") {
    throw new Error("The public health endpoint is not healthy.");
  }
  if (health?.brvinRetrievalConnected !== true) {
    throw new Error("The private BRVIN service binding is not connected.");
  }
  if (health?.brvinReady !== true) {
    throw new Error("Fatman retrieval is not ready.");
  }
  if (!Number.isSafeInteger(health?.authorizedSources) || health.authorizedSources < 1) {
    throw new Error("Fatman has no authorized retrieval sources.");
  }

  return {
    root: "passed",
    workerHealth: "passed",
    brvinServiceBinding: "passed",
    fatmanRetrieval: "passed",
    authorizedSources: health.authorizedSources,
  };
}

export function buildReleaseManifest({
  capturedAt,
  commitSha,
  workflowRunId,
  rootUrl,
  healthUrl,
  workers,
  checks,
}) {
  return {
    schemaVersion: 1,
    product: "परमार्थAI",
    result: "passed",
    capturedAt,
    sourceRevision: commitSha || null,
    workflowRunId: workflowRunId || null,
    endpoints: { root: rootUrl, health: healthUrl },
    workers,
    checks,
  };
}

async function readJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(url + " returned an unreadable JSON response (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const detail = Array.isArray(body?.errors)
      ? body.errors.map((item) => (item.code ?? "?") + ": " + (item.message ?? "Cloudflare API error")).join("; ")
      : "";
    throw new Error(url + " returned HTTP " + response.status + "." + (detail ? " " + detail : ""));
  }
  return body;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendSummary(env, manifest) {
  if (!env.GITHUB_STEP_SUMMARY) return;

  const rows = Object.entries(manifest.workers)
    .map(([name, worker]) => "| " + name + " | " + worker.deploymentId + " | " + worker.versionId + " | " + worker.trafficPercent + "% |")
    .join("\n");
  const markdown = [
    "## Production release acceptance",
    "",
    "Passed — " + manifest.product + " live release gate",
    "",
    "- Captured: " + manifest.capturedAt,
    "- Source revision: " + (manifest.sourceRevision ?? "not supplied"),
    "- Workflow run: " + (manifest.workflowRunId ?? "manual / unavailable"),
    "",
    "| Worker | Deployment ID | Version ID | Traffic |",
    "|---|---|---|---:|",
    rows,
    "",
    "### Live checks",
    "",
    "- Public root: " + manifest.checks.root,
    "- Worker health: " + manifest.checks.workerHealth,
    "- Private BRVIN binding: " + manifest.checks.brvinServiceBinding,
    "- Fatman retrieval readiness: " + manifest.checks.fatmanRetrieval,
    "- Authorized sources: " + manifest.checks.authorizedSources,
    "",
    "The check is read-only: it does not send Telegram messages, generate Gemini answers, consume student quota, or mutate production records.",
    "",
    "The attached JSON manifest is the deployment/version evidence for this acceptance run.",
    "",
  ].join("\n");

  await appendFile(env.GITHUB_STEP_SUMMARY, markdown, "utf8");
}

/**
 * Read-only live release gate. It checks current deployment state for both
 * Workers and probes the public root + BRVIN-backed health endpoint.
 */
export async function runProductionAcceptance({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
  sleep = wait,
} = {}) {
  const token = requireValue(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const accountId = requireValue(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const rootUrl = env.SMOKE_TEST_ROOT_URL?.trim() || DEFAULT_ROOT_URL;
  const healthUrl = env.SMOKE_TEST_URL?.trim() || DEFAULT_HEALTH_URL;
  const attempts = Number(env.SMOKE_TEST_ATTEMPTS ?? 12);
  const delayMs = Number(env.SMOKE_TEST_DELAY_MS ?? 5000);

  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error("SMOKE_TEST_ATTEMPTS must be an integer between 1 and 60.");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error("SMOKE_TEST_DELAY_MS must be an integer between 0 and 60000.");
  }

  const authHeaders = {
    authorization: "Bearer " + token,
    accept: "application/json",
  };
  const deploymentUrl = (name) => API_BASE + "/accounts/" + encodeURIComponent(accountId) +
    "/workers/scripts/" + encodeURIComponent(name) + "/deployments";

  const [brvinPayload, parmarPayload] = await Promise.all([
    readJson(fetchImpl, deploymentUrl("brvin-service"), { headers: authHeaders }),
    readJson(fetchImpl, deploymentUrl("parmar-ai"), { headers: authHeaders }),
  ]);

  const workers = {
    "brvin-service": resolveLatestWorkerDeployment(brvinPayload, "brvin-service"),
    "parmar-ai": resolveLatestWorkerDeployment(parmarPayload, "parmar-ai"),
  };

  let checks;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [root, health] = await Promise.all([
        readJson(fetchImpl, rootUrl),
        readJson(fetchImpl, healthUrl),
      ]);
      checks = assertProductionHealth(root, health);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }

  if (!checks) {
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? "Unknown health error");
    throw new Error("Live production acceptance failed after " + attempts + " attempt(s): " + message);
  }

  const capturedAt = now().toISOString();
  const manifest = buildReleaseManifest({
    capturedAt,
    commitSha: env.GITHUB_SHA,
    workflowRunId: env.GITHUB_RUN_ID,
    rootUrl,
    healthUrl,
    workers,
    checks,
  });

  const manifestPath = env.RELEASE_MANIFEST_PATH || "dist/production-release-manifest.json";
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await appendSummary(env, manifest);

  return { manifest, manifestPath };
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    const result = await runProductionAcceptance();
    console.log("Production release acceptance passed.");
    console.log("Manifest written to " + result.manifestPath + ".");
    console.log(JSON.stringify(result.manifest, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
