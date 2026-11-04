const endpoint = process.env.SMOKE_TEST_URL;
const attempts = Number(process.env.SMOKE_TEST_ATTEMPTS ?? 12);
const delayMs = Number(process.env.SMOKE_TEST_DELAY_MS ?? 5000);

if (!endpoint) {
  console.error("SMOKE_TEST_URL is required.");
  process.exit(1);
}
if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 60) {
  console.error("SMOKE_TEST_ATTEMPTS must be an integer between 1 and 60.");
  process.exit(1);
}
if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
  console.error("SMOKE_TEST_DELAY_MS must be a non-negative integer.");
  process.exit(1);
}

const rootEndpoint = process.env.SMOKE_TEST_ROOT_URL ?? new URL("/", endpoint).toString();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${url} did not return JSON.`);
  }
  return response.json();
}

function assertRoot(body) {
  if (body?.ok !== true || body?.service !== "parmar-ai") {
    throw new Error("Root endpoint did not identify a healthy Parmar AI Worker.");
  }
}

function assertHealth(body) {
  if (body?.ok !== true || body?.status !== "healthy") {
    throw new Error("Parmar AI health endpoint is not healthy.");
  }
  if (body?.brvinRetrievalConnected !== true) {
    throw new Error("Private BRVIN service binding is not connected.");
  }
  if (body?.brvinReady !== true) {
    throw new Error("Fatman v1 book retrieval is not ready.");
  }
  if (!Number.isSafeInteger(body?.authorizedSources) || body.authorizedSources < 1) {
    throw new Error("Fatman has no authorized v1 book sources.");
  }
  if (body?.brvinV2Connected !== true || body?.brvinV2Ready !== true) {
    throw new Error("BRVIN v2 application identity or Fatman project authorisation is not ready.");
  }
  if (
    !Number.isSafeInteger(body?.brvinV2AuthorizedSources) ||
    body.brvinV2AuthorizedSources !== body.authorizedSources
  ) {
    throw new Error("BRVIN v1 and v2 Fatman source readiness checks do not match.");
  }
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const [root, health] = await Promise.all([
      readJson(rootEndpoint),
      readJson(endpoint),
    ]);
    assertRoot(root);
    assertHealth(health);
    console.log(`Production smoke checks passed on attempt ${attempt} (root + BRVIN-backed health).`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Production smoke check attempt ${attempt}/${attempts} failed: ${message}`);
    if (attempt < attempts) await wait(delayMs);
  }
}

console.error(`Production smoke checks failed after ${attempts} attempts.`);
process.exit(1);
