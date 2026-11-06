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

import {
  diagnoseFatmanGcsUpload,
  fatmanOutputObjectName,
  fatmanVisionOutputPrefix,
  listFatmanVisionOutputObjects,
  parseFatmanVisionOperationResult,
} from "../src/fatman/import";

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
    expect(result.retentionLifecycleRule.status).toBe("missing");
    expect(result.retentionLifecycleReady).toBe(false);
  });

  it("reports the exact 30-day OCR-prefix rule as installed only when the bucket rule exists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "brvin-test-bucket",
        lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 30, matchesPrefix: ["brvin/temporary-vision-ocr/"] } }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        permissions: [
          "storage.objects.create",
          "storage.objects.get",
          "storage.objects.list",
          "storage.objects.delete",
          "storage.buckets.get",
          "storage.buckets.update",
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await diagnoseFatmanGcsUpload(env);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      uploadStartReady: true,
      retentionLifecycleReady: true,
      retentionLifecyclePermissionsReady: true,
      retentionLifecycleRule: {
        status: "installed",
        prefix: "brvin/temporary-vision-ocr/",
        requiredMaxAgeDays: 30,
        configuredAgeDays: 30,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit | undefined)?.method !== "PATCH")).toBe(true);
  });

  it("blocks lifecycle readiness when an existing Delete rule can overlap source PDFs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "brvin-test-bucket",
        lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 30 } }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        permissions: [
          "storage.objects.create",
          "storage.objects.get",
          "storage.objects.list",
          "storage.objects.delete",
          "storage.buckets.get",
          "storage.buckets.update",
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await diagnoseFatmanGcsUpload(env);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.uploadStartReady).toBe(true);
    expect(result.retentionLifecyclePermissionsReady).toBe(true);
    expect(result.retentionLifecycleReady).toBe(false);
    expect(result.retentionLifecycleRule.status).toBe("blocked_unsafe_delete_rule");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit | undefined)?.method !== "PATCH")).toBe(true);
  });
});


describe("Vision output object naming", () => {
  it("uses the returned temporary destination directly for new BRVIN imports", () => {
    const id = "import-123";
    const job = { id, source_object: "brvin/source-pdfs/" + id + "/source.pdf" };
    const prefix = fatmanVisionOutputPrefix(job as any);
    expect(prefix).toBe("brvin/temporary-vision-ocr/" + id + "/");
    expect(fatmanOutputObjectName(id, 1, prefix)).toBe(prefix + "output-1-to-1.json");
    expect(fatmanOutputObjectName(id, 3, prefix)).toBe(prefix + "output-3-to-3.json");
  });

  it("keeps the legacy OCR subdirectory inside its destination prefix without adding it twice", () => {
    const id = "legacy-123";
    const job = { id, source_object: "fatman/source-pdfs/" + id + "/source.pdf" };
    const prefix = fatmanVisionOutputPrefix(job as any);
    expect(prefix).toBe("fatman/source-pdfs/" + id + "/ocr/");
    expect(fatmanOutputObjectName(id, 1, prefix)).toBe(prefix + "output-1-to-1.json");
  });

  it("preserves the legacy default prefix for existing direct callers", () => {
    expect(fatmanOutputObjectName("legacy-456", 2)).toBe("fatman/imports/legacy-456/ocr/output-2-to-2.json");
  });
});

describe("Google Vision asynchronous output verification", () => {
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
  const expectedUri = "gs://brvin-test-bucket/brvin/temporary-vision-ocr/import-123/";

  it("accepts a completed operation only when its response confirms the expected GCS destination", () => {
    const result = parseFatmanVisionOperationResult({
      done: true,
      response: {
        responses: [{
          outputConfig: {
            gcsDestination: { uri: expectedUri }
          }
        }]
      }
    }, expectedUri);

    expect(result).toEqual({ done: true, outputDestinations: [expectedUri] });
  });

  it("normalizes only trailing slashes when comparing the returned GCS destination", () => {
    const result = parseFatmanVisionOperationResult({
      done: true,
      response: {
        responses: [{
          outputConfig: {
            gcsDestination: { uri: expectedUri.slice(0, -1) }
          }
        }]
      }
    }, expectedUri);

    expect(result.done).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("does not treat done=true without a response payload as successful OCR", () => {
    const result = parseFatmanVisionOperationResult({ done: true }, expectedUri);
    expect(result.done).toBe(true);
    expect(result.error).toContain("returned no file response metadata");
  });

  it("surfaces an operation-level Vision error even when done=true", () => {
    const result = parseFatmanVisionOperationResult({
      done: true,
      error: { message: "permission denied writing output" }
    }, expectedUri);
    expect(result.error).toContain("permission denied writing output");
  });

  it("fails closed when Vision reports a different output destination", () => {
    const result = parseFatmanVisionOperationResult({
      done: true,
      response: {
        responses: [{
          outputConfig: {
            gcsDestination: { uri: "gs://brvin-test-bucket/somewhere-else/" }
          }
        }]
      }
    }, expectedUri);
    expect(result.error).toContain("does not match the import's registered temporary OCR prefix");
    expect(result.outputDestinations).toEqual(["gs://brvin-test-bucket/somewhere-else/"]);
  });

  it("rejects successful operation metadata without a GCS output URI", () => {
    const result = parseFatmanVisionOperationResult({
      done: true,
      response: { responses: [{}] }
    }, expectedUri);
    expect(result.error).toContain("without a valid Cloud Storage output destination");
  });

  it("lists only bounded metadata under this import's expected temporary prefix", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          { name: "brvin/temporary-vision-ocr/import-123/ocr/output-1-to-1.json", size: "512", timeCreated: "2026-11-06T08:00:00Z" },
          { name: "brvin/temporary-vision-ocr/another-import/ocr/output-1-to-1.json", size: "999" }
        ],
        nextPageToken: "more"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ name: "brvin/temporary-vision-ocr/import-123/ocr/output-2-to-2.json", size: "640" }]
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listFatmanVisionOutputObjects(env, {
      id: "import-123",
      source_object: "brvin/source-pdfs/import-123/source.pdf"
    } as any);

    expect(result.prefix).toBe(expectedUri);
    expect(result.objects).toHaveLength(2);
    expect(result.objects.map(item => item.name)).toEqual([
      "brvin/temporary-vision-ocr/import-123/ocr/output-1-to-1.json",
      "brvin/temporary-vision-ocr/import-123/ocr/output-2-to-2.json"
    ]);
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.searchParams.get("prefix")).toBe("brvin/temporary-vision-ocr/import-123/");
    expect(firstUrl.searchParams.get("maxResults")).toBe("25");
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondUrl.searchParams.get("pageToken")).toBe("more");
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });
});
