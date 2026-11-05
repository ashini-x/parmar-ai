import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  ensureAnalyticsSchema: vi.fn(async () => undefined),
  getFatmanBookState: vi.fn(),
  recordBrvinActivity: vi.fn(),
  setFatmanBookState: vi.fn(),
}));
const google = vi.hoisted(() => ({ getGoogleAccessToken: vi.fn() }));

vi.mock("../src/analytics/db", () => analytics);
vi.mock("../src/auth/google", () => google);

import { diagnoseFatmanGcsUpload } from "../src/fatman/import";

describe("BRVIN GCS read-only permission diagnostic", () => {
  const env = {
    FATMAN_GCS_BUCKET: "brvin-test-bucket",
    GCP_CLIENT_EMAIL: "worker@example.iam.gserviceaccount.com",
    GCP_PRIVATE_KEY: "test-key",
    GCP_PROJECT_ID: "test-project",
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    google.getGoogleAccessToken.mockResolvedValue("access-token");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps core PDF object access ready when only bucket lifecycle permissions are missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "storage.buckets.get denied" },
      }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        permissions: [
          "storage.objects.create",
          "storage.objects.get",
          "storage.objects.list",
          "storage.objects.delete",
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await diagnoseFatmanGcsUpload(env);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      uploadStartReady: true,
      retentionLifecycleReady: false,
      retentionLifecycleMissingPermissions: ["storage.buckets.get", "storage.buckets.update"],
    });
    expect(result.checks.permissions).toMatchObject({
      ok: true,
      missingObjectPermissions: [],
      lifecycleRuleGetGranted: false,
      lifecycleRuleUpdateGranted: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit | undefined)?.method !== "PATCH")).toBe(true);
  });

  it("blocks core upload readiness when an object-level permission is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "brvin-test-bucket", location: "US", storageClass: "STANDARD", projectNumber: "123",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        permissions: [
          "storage.objects.create",
          "storage.objects.get",
          "storage.objects.delete",
          "storage.buckets.get",
          "storage.buckets.update",
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await diagnoseFatmanGcsUpload(env);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.ok).toBe(false);
    expect(result.uploadStartReady).toBe(false);
    expect(result.checks.permissions.missingObjectPermissions).toEqual(["storage.objects.list"]);
    expect(result.retentionLifecycleMissingPermissions).toEqual([]);
  });
});
