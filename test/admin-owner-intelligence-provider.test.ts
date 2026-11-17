import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import {
  generateOwnerGeminiContent,
  listOwnerGeminiModels,
  OwnerGeminiProviderError,
  OWNER_GEMINI_MODEL_REGISTRY,
  type OwnerProviderDependencies,
} from "../src/admin/intelligence-provider";

const configuredEnv = {
  GCP_PROJECT_ID: "project-90db7be4-619f-4ed7-89b",
  GCP_CLIENT_EMAIL: "owner-test@example.iam.gserviceaccount.com",
  GCP_PRIVATE_KEY: "not-a-real-private-key-used-with-injected-auth",
  GEMINI_LOCATION: "global",
} as Env;

function dependencies(fetcher: typeof fetch, token = "test-token"): OwnerProviderDependencies {
  return { getAccessToken: vi.fn(async () => token), fetch: fetcher };
}

describe("Owner Vertex AI provider registry and adapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("probes only centrally allowlisted models with the project-scoped countTokens API", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ totalTokens: 8 }), { status: 200 });
    };
    const result = await listOwnerGeminiModels(configuredEnv, dependencies(fetcher));
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(OWNER_GEMINI_MODEL_REGISTRY.length);
    expect(result.models.every((model) => model.selectable && model.availability === "available")).toBe(true);
    expect(result.models.every((model) => model.contextWindowTokens === 1_048_576 && model.modelMaxOutputTokens > 0 && model.singleRequestOutputTokens > 0)).toBe(true);
    expect(result.models.find((model) => model.id === "gemini-4-hydrogen")?.singleRequestOutputTokens).toBe(65_536);
    expect(result.models.find((model) => model.id === "gemini-4-argon")?.singleRequestOutputTokens).toBe(32_768);
    expect(result.models.some((model) => model.id === "gemini-3.6-flash")).toBe(true);
    expect(calls).toHaveLength(OWNER_GEMINI_MODEL_REGISTRY.length);
    const first = String(calls[0]?.url);
    expect(first).toContain("/v1/projects/project-90db7be4-619f-4ed7-89b/locations/global/publishers/google/models/");
    expect(first).toContain(":countTokens");
    const init = calls[0]?.init;
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Owner model availability check." }] }],
    });
  });

  it("does not mark models selectable when project access or model availability is unverified", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const value = String(url);
      const status = value.includes("gemini-4-hydrogen") ? 403 : value.includes("gemini-4-carbon") ? 404 : 429;
      return new Response("redacted provider error", { status });
    });
    const result = await listOwnerGeminiModels(
      { ...configuredEnv, GEMINI_LOCATION: "us-central1" } as Env,
      dependencies(fetcher as unknown as typeof fetch),
    );
    expect(result.models.every((model) => !model.selectable)).toBe(true);
    expect(result.models.find((model) => model.id === "gemini-4-hydrogen")?.availabilityReason).toBe("provider_access_denied");
    expect(result.models.find((model) => model.id === "gemini-4-carbon")?.availabilityReason).toBe("model_or_location_not_available");
    expect(result.models.find((model) => model.id === "gemini-4-argon")?.availabilityReason).toBe("provider_temporarily_unavailable");
    expect(String(fetcher.mock.calls[0][0])).toContain("https://us-central1-aiplatform.googleapis.com/");
  });

  it("returns a safe unconfigured catalogue without calling Google auth", async () => {
    const fetcher = vi.fn();
    const auth = vi.fn();
    const result = await listOwnerGeminiModels(
      { GEMINI_LOCATION: "global" } as Env,
      { fetch: fetcher as unknown as typeof fetch, getAccessToken: auth },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("vertex_not_configured");
    expect(result.models.every((model) => !model.selectable && model.availability === "unverified")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
  });

  it("builds a plain general-purpose GenerateContent request without student contracts or implicit thinking settings", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "Hello from Gemini." }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await generateOwnerGeminiContent(configuredEnv, {
      modelId: "gemini-4-hydrogen",
      contents: [{ role: "user", text: "What is a black hole?" }],
      systemInstruction: "You are a general-purpose assistant.",
    }, dependencies(fetcher as unknown as typeof fetch));
    expect(result.text).toBe("Hello from Gemini.");
    expect(result.modelId).toBe("gemini-4-hydrogen");
    expect(result.usage.totalTokens).toBe(9);
    expect(String(calls[0]?.url)).toContain("/models/gemini-4-hydrogen:generateContent");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "What is a black hole?" }] }]);
    expect(body.systemInstruction.parts[0].text).toBe("You are a general-purpose assistant.");
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
    expect(body.generationConfig.maxOutputTokens).toBe(8_192);
    expect(JSON.stringify(body)).not.toContain("AnswerPacket");
    expect(JSON.stringify(body)).not.toContain("SSC");
  });

  it("rejects unlisted model IDs without a fetch or automatic fallback", async () => {
    const fetcher = vi.fn();
    await expect(generateOwnerGeminiContent(configuredEnv, {
      modelId: "projects/other/locations/global/publishers/google/models/something",
      contents: [{ role: "user", text: "Hi" }],
    }, dependencies(fetcher as unknown as typeof fetch))).rejects.toBeInstanceOf(OwnerGeminiProviderError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not generate when the model has not passed the project/location check", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response("redacted provider error", { status: 403 });
    };
    await expect(generateOwnerGeminiContent(
      { ...configuredEnv, GEMINI_LOCATION: "asia-south1" } as Env,
      { modelId: "gemini-3.8-flash", contents: [{ role: "user", text: "Hi" }] },
      dependencies(fetcher),
    )).rejects.toMatchObject({ retryable: true, message: "This model has not been confirmed for the configured Vertex AI project and location." });
    expect(calls.some((url) => url.endsWith(":generateContent"))).toBe(false);
  });

  it("sanitizes provider errors and marks only transient failures retryable", async () => {
    const fetcher: typeof fetch = async (url) => {
      if (String(url).endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 1 }), { status: 200 });
      return new Response("service account private key leaked in raw error", { status: 429 });
    };
    await expect(generateOwnerGeminiContent(
      { ...configuredEnv, GEMINI_LOCATION: "asia-southeast1" } as Env,
      { modelId: "gemini-3.8-flash", contents: [{ role: "user", text: "Hi" }] },
      dependencies(fetcher),
    )).rejects.toMatchObject({ status: 429, retryable: true, message: "Vertex AI is temporarily rate limiting requests for this project or model." });
  });
});
