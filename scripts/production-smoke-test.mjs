const endpoint = process.env.SMOKE_TEST_URL;
const attempts = Number(process.env.SMOKE_TEST_ATTEMPTS ?? 12);
const delayMs = Number(process.env.SMOKE_TEST_DELAY_MS ?? 5000);

if (!endpoint) {
  console.error("SMOKE_TEST_URL is required.");
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("Health endpoint did not return JSON.");
    }

    const body = await response.json();
    if (body?.ok === true && body?.status === "healthy") {
      console.log(`Production health check passed on attempt ${attempt} (${endpoint}).`);
      process.exit(0);
    }
    throw new Error("Health endpoint returned an unexpected status body.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Health check attempt ${attempt}/${attempts} failed: ${message}`);
    if (attempt < attempts) {
      await wait(delayMs);
    }
  }
}

console.error(`Production health check failed after ${attempts} attempts (${endpoint}).`);
process.exit(1);
