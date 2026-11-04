import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProductionHealth,
  buildReleaseManifest,
  resolveLatestWorkerDeployment,
  runProductionAcceptance,
} from "../scripts/production-release-acceptance.mjs";

const deployment = (id, versionId, createdOn, percentage = 100) => ({
  id,
  created_on: createdOn,
  versions: [{ version_id: versionId, percentage }],
});

describe("production release acceptance", () => {
  it("records the newest 100% deployment, not an older release", () => {
    const result = resolveLatestWorkerDeployment({
      success: true,
      result: {
        deployments: [
          deployment("new-deploy", "new-version", "2026-11-04T11:00:00.000Z"),
          deployment("old-deploy", "old-version", "2026-11-04T10:00:00.000Z"),
        ],
      },
    }, "parmar-ai");

    expect(result).toEqual({
      deploymentId: "new-deploy",
      versionId: "new-version",
      createdAt: "2026-11-04T11:00:00.000Z",
      trafficPercent: 100,
    });
  });

  it("rejects a newest split rollout instead of falling back to an older 100% deployment", () => {
    expect(() => resolveLatestWorkerDeployment({
      success: true,
      result: {
        deployments: [
          {
            id: "split-deploy",
            created_on: "2026-11-04T11:00:00.000Z",
            versions: [
              { version_id: "canary", percentage: 10 },
              { version_id: "stable", percentage: 90 },
            ],
          },
          deployment("old-deploy", "old-version", "2026-11-04T10:00:00.000Z"),
        ],
      },
    }, "brvin-service")).toThrow(/not a single-version 100% rollout/u);
  });

  it("rejects a deployment with more than one version even when percentages sum to 100", () => {
    expect(() => resolveLatestWorkerDeployment({
      success: true,
      result: {
        deployments: [{
          id: "two-versions",
          created_on: "2026-11-04T11:00:00.000Z",
          versions: [
            { version_id: "v1", percentage: 50 },
            { version_id: "v2", percentage: 50 },
          ],
        }],
      },
    }, "parmar-ai")).toThrow(/not a single-version 100% rollout/u);
  });

  it("requires the Worker, private BRVIN binding and authorised Fatman source to be ready", () => {
    expect(assertProductionHealth(
      { ok: true, service: "parmar-ai" },
      {
        ok: true,
        status: "healthy",
        brvinRetrievalConnected: true,
        brvinReady: true,
        authorizedSources: 1,
      },
    )).toMatchObject({
      root: "passed",
      workerHealth: "passed",
      brvinServiceBinding: "passed",
      fatmanRetrieval: "passed",
      authorizedSources: 1,
    });

    expect(() => assertProductionHealth(
      { ok: true, service: "parmar-ai" },
      {
        ok: true,
        status: "healthy",
        brvinRetrievalConnected: true,
        brvinReady: false,
        authorizedSources: 0,
      },
    )).toThrow(/Fatman retrieval is not ready/u);
  });

  it("creates a versioned release manifest without secret material", () => {
    const manifest = buildReleaseManifest({
      capturedAt: "2026-11-04T11:30:00.000Z",
      commitSha: "abc123",
      workflowRunId: "12345",
      rootUrl: "https://example.test/",
      healthUrl: "https://example.test/health",
      workers: {
        "parmar-ai": { deploymentId: "p-deploy", versionId: "p-version", createdAt: "2026-11-04T11:00:00.000Z", trafficPercent: 100 },
        "brvin-service": { deploymentId: "b-deploy", versionId: "b-version", createdAt: "2026-11-04T11:00:00.000Z", trafficPercent: 100 },
      },
      checks: { root: "passed", workerHealth: "passed", brvinServiceBinding: "passed", fatmanRetrieval: "passed", authorizedSources: 1 },
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      product: "परमार्थAI",
      result: "passed",
      sourceRevision: "abc123",
      workflowRunId: "12345",
      workers: {
        "parmar-ai": { versionId: "p-version", trafficPercent: 100 },
        "brvin-service": { versionId: "b-version", trafficPercent: 100 },
      },
    });
    expect(JSON.stringify(manifest)).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(JSON.stringify(manifest)).not.toContain("Bearer ");
  });

  it("runs read-only live checks and writes the exact active deployment manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "parmar-release-acceptance-"));
    const manifestPath = join(directory, "production-release-manifest.json");
    const summaryPath = join(directory, "summary.md");
    const calls = [];
    const deployments = {
      "parmar-ai": {
        success: true,
        result: { deployments: [deployment("p-deploy", "p-version", "2026-11-04T11:00:00.000Z")] },
      },
      "brvin-service": {
        success: true,
        result: { deployments: [deployment("b-deploy", "b-version", "2026-11-04T11:00:00.000Z")] },
      },
    };
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      let body;
      if (String(url).includes("/workers/scripts/parmar-ai/")) body = deployments["parmar-ai"];
      else if (String(url).includes("/workers/scripts/brvin-service/")) body = deployments["brvin-service"];
      else if (String(url).endsWith("/health")) {
        body = {
          ok: true,
          status: "healthy",
          brvinRetrievalConnected: true,
          brvinReady: true,
          authorizedSources: 1,
        };
      } else {
        body = { ok: true, service: "parmar-ai" };
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await runProductionAcceptance({
        env: {
          CLOUDFLARE_API_TOKEN: "test-token-must-not-be-written",
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          GITHUB_SHA: "abc123",
          GITHUB_RUN_ID: "12345",
          SMOKE_TEST_ROOT_URL: "https://example.test/",
          SMOKE_TEST_URL: "https://example.test/health",
          SMOKE_TEST_ATTEMPTS: "1",
          SMOKE_TEST_DELAY_MS: "0",
          RELEASE_MANIFEST_PATH: manifestPath,
          GITHUB_STEP_SUMMARY: summaryPath,
        },
        fetchImpl,
        now: () => new Date("2026-11-04T11:30:00.000Z"),
      });

      const saved = JSON.parse(await readFile(manifestPath, "utf8"));
      const summary = await readFile(summaryPath, "utf8");
      expect(result.manifestPath).toBe(manifestPath);
      expect(saved.sourceRevision).toBe("abc123");
      expect(saved.workers["parmar-ai"].versionId).toBe("p-version");
      expect(saved.workers["brvin-service"].versionId).toBe("b-version");
      expect(saved.checks.fatmanRetrieval).toBe("passed");
      expect(summary).toContain("Production release acceptance");
      expect(summary).toContain("p-version");
      expect(summary).toContain("b-version");
      expect(summary).toContain("does not send Telegram messages");
      expect(calls).toHaveLength(4);
      expect(calls.filter((call) => call.url.includes("/workers/scripts/")).every((call) =>
        call.options.headers.authorization === "Bearer test-token-must-not-be-written"
      )).toBe(true);
      expect(JSON.stringify(saved)).not.toContain("test-token-must-not-be-written");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when Cloudflare cannot confirm the latest 100% deployment", async () => {
    await expect(runProductionAcceptance({
      env: {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
        SMOKE_TEST_ATTEMPTS: "1",
      },
      fetchImpl: async (url) => new Response(JSON.stringify({
        success: true,
        result: {
          deployments: [deployment("partial", "partial-version", "2026-11-04T11:00:00.000Z", 50)],
        },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      sleep: async () => {},
    })).rejects.toThrow(/not a single-version 100% rollout/u);
  });
});
