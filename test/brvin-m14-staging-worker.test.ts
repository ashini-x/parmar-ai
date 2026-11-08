import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import {
  handleM14StagingRequest,
  type M14StagingWorkerEnv,
} from "../src/brvin/m14-staging-worker";
import type { BrvinM14VisionBackfillResult } from "../src/brvin/m14-vision-backfill";

const SOURCE_ID = "01238b3a-9902-4a42-90b4-574048ee4f00";
const SOURCE_SHA = "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c";
const OPERATION = "projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2";
const TOKEN = "m14-test-operator-token-0123456789abcdef0123456789abcdef";

function makeEnv(overrides: Partial<Env> = {}): M14StagingWorkerEnv {
  return {
    ENVIRONMENT: "staging",
    BRVIN_M14_PILOT_ENABLED: "true",
    BRVIN_M14_ADMIN_TOKEN: TOKEN,
    GCP_PROJECT_ID: "project-90db7be4-619f-4ed7-89b",
    GCP_CLIENT_EMAIL: "m14-test@project-90db7be4-619f4ed789b.iam.gserviceaccount.com",
    GCP_PRIVATE_KEY: "test-only-private-key",
    FATMAN_GCS_BUCKET: "parmar-fatman-ocr-90db7be4",
    BRVIN_M14_CORPUS_BUCKET: "brvin-m14-physics-90db7be4-a8ca999e",
    ...overrides,
  } as M14StagingWorkerEnv;
}

const result: BrvinM14VisionBackfillResult = {
  sourceId: SOURCE_ID,
  generationId: "a".repeat(32),
  pageCount: 3,
  chunkCount: 7,
  sourceBucket: "source-bucket",
  corpusBucket: "m14-corpus-bucket",
  visionOperationId: OPERATION,
  pages: [
    { pdfPage: 1, stableItemKey: "page-1", chunkCount: 2, sourceManifestCreated: true, pageManifestCreated: true },
    { pdfPage: 2, stableItemKey: "page-2", chunkCount: 3, sourceManifestCreated: false, pageManifestCreated: true },
    { pdfPage: 3, stableItemKey: "page-3", chunkCount: 2, sourceManifestCreated: false, pageManifestCreated: true },
  ],
};

function makeRequest(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}): Request {
  return new Request("https://m14-staging.example.workers.dev" + path, {
    method: options.method ?? "POST",
    headers: {
      ...(options.token ? { authorization: "Bearer " + options.token } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe("BRVIN M14 isolated staging operator", () => {
  it("exposes a minimal health response without credential values or source contents", async () => {
    const response = await handleM14StagingRequest(
      new Request("https://m14-staging.example.workers.dev/health"),
      makeEnv(),
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      app: "parmar-ai-m14-staging",
      environment: "staging",
      pilotEnabled: true,
      secretsConfigured: {
        gcpClientEmail: true,
        gcpPrivateKey: true,
        m14AdminToken: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-only-private-key");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("serves a same-origin browser operator page without exposing secrets", async () => {
    const response = await handleM14StagingRequest(
      new Request("https://m14-staging.example.workers.dev/admin/m14"),
      makeEnv(),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(html).toContain("BRVIN M14");
    expect(html).toContain('/admin/m14/backfill');
    expect(html).toContain("credentials: \"omit\"");
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("test-only-private-key");
    expect(html).not.toContain("https://");
  });

  it("does not expose the browser operator when staging is disabled or production is selected", async () => {
    const request = new Request("https://m14-staging.example.workers.dev/admin/m14");
    const production = await handleM14StagingRequest(
      request,
      makeEnv({ ENVIRONMENT: "production" }),
    );
    expect(production.status).toBe(404);

    const disabled = await handleM14StagingRequest(
      request,
      makeEnv({ BRVIN_M14_PILOT_ENABLED: "false" }),
    );
    expect(disabled.status).toBe(404);
  });

  it("keeps unknown routes unavailable", async () => {
    const response = await handleM14StagingRequest(
      new Request("https://m14-staging.example.workers.dev/other"),
      makeEnv(),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "not_found" });
  });

  it("requires staging, explicit pilot enablement, POST and a configured operator secret", async () => {
    const run = vi.fn(async () => result);
    const request = makeRequest("/admin/m14/backfill", {
      token: TOKEN,
      body: { confirmSourceId: SOURCE_ID },
    });
    const production = await handleM14StagingRequest(
      request,
      makeEnv({ ENVIRONMENT: "production" }),
      run as never,
    );
    expect(production.status).toBe(404);

    const disabled = await handleM14StagingRequest(
      request,
      makeEnv({ BRVIN_M14_PILOT_ENABLED: "false" }),
      run as never,
    );
    expect(disabled.status).toBe(404);

    const get = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", { method: "GET", token: TOKEN }),
      makeEnv(),
      run as never,
    );
    expect(get.status).toBe(405);

    const unconfigured = await handleM14StagingRequest(
      request,
      makeEnv({ BRVIN_M14_ADMIN_TOKEN: undefined }),
      run as never,
    );
    expect(unconfigured.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("requires bearer authentication and an explicit confirmation for the one registered source", async () => {
    const run = vi.fn(async () => result);
    const unauthenticated = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", { body: { confirmSourceId: SOURCE_ID } }),
      makeEnv(),
      run as never,
    );
    expect(unauthenticated.status).toBe(401);

    const wrongToken = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", {
        token: "wrong-token",
        body: { confirmSourceId: SOURCE_ID },
      }),
      makeEnv(),
      run as never,
    );
    expect(wrongToken.status).toBe(401);

    const wrongSource = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", {
        token: TOKEN,
        body: { confirmSourceId: "00000000-0000-4000-8000-000000000000" },
      }),
      makeEnv(),
      run as never,
    );
    expect(wrongSource.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs only the pinned Physics backfill and returns a private, non-cacheable receipt", async () => {
    const run = vi.fn(async () => result);
    const response = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", {
        token: TOKEN,
        body: { confirmSourceId: SOURCE_ID },
      }),
      makeEnv(),
      run as never,
    );
    const body = await response.json() as { ok: boolean; result: BrvinM14VisionBackfillResult };
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, result });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ ENVIRONMENT: "staging" }),
      {
        sourceId: SOURCE_ID,
        sourcePdfSha256: SOURCE_SHA,
        visionOperationId: OPERATION,
        pageCount: 3,
      },
      expect.any(Object),
    );
  });

  it("does not run the backfill if the GCP source or destination configuration is missing", async () => {
    const run = vi.fn(async () => result);
    const response = await handleM14StagingRequest(
      makeRequest("/admin/m14/backfill", {
        token: TOKEN,
        body: { confirmSourceId: SOURCE_ID },
      }),
      makeEnv({ BRVIN_M14_CORPUS_BUCKET: undefined }),
      run as never,
    );
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
});
