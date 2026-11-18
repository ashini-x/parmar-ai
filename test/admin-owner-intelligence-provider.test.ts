import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import {
  countOwnerGeminiInputTokens,
  generateOwnerGeminiContent,
  openOwnerGeminiStream,
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
  it("counts the exact multi-turn prompt for a per-chat token budget", async () => {
    const calls: Array<{ url: RequestInfo | URL; body: Record<string, unknown> }> = [];
    const env = { ...configuredEnv, GCP_PROJECT_ID: "session-token-preflight-project" } as Env;
    const fetcher: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      return new Response(JSON.stringify({
        totalTokens: JSON.stringify(body.contents).includes("Owner model availability check.") ? 1 : 12_345,
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const contents = [
      { role: "user" as const, text: "Earlier question" },
      { role: "model" as const, text: "Earlier answer" },
      { role: "user" as const, text: "Continue from the saved history." },
    ];
    const tokens = await countOwnerGeminiInputTokens(
      env,
      { modelId: "gemini-4-carbon", contents },
      dependencies(fetcher),
    );
    expect(tokens).toBe(12_345);
    expect(calls).toHaveLength(2); // selected-model eligibility probe + exact conversation preflight
    expect(String(calls[1].url)).toContain(":countTokens");
    expect(calls[1].body.contents).toEqual(contents.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })));
  });


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

  it("returns a bounded unavailable catalogue when a Count Tokens probe never settles", async () => {
    vi.useFakeTimers();
    try {
      const env = { ...configuredEnv, GCP_PROJECT_ID: "project-probe-timeout-123" } as Env;
      const fetcher: typeof fetch = async () => new Promise<Response>(() => undefined);
      const pending = listOwnerGeminiModels(env, dependencies(fetcher));
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(result.models).toHaveLength(OWNER_GEMINI_MODEL_REGISTRY.length);
      expect(result.models.every((model) => !model.selectable && model.availabilityReason === "provider_temporarily_unavailable")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an authentication-unavailable state when access-token acquisition never settles", async () => {
    vi.useFakeTimers();
    try {
      const env = { ...configuredEnv, GCP_PROJECT_ID: "project-auth-timeout-123" } as Env;
      const fetcher = vi.fn();
      const getAccessToken = vi.fn(() => new Promise<string>(() => undefined));
      const pending = listOwnerGeminiModels(env, { fetch: fetcher, getAccessToken });
      await vi.advanceTimersByTimeAsync(12_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toBe("google_auth_unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds a plain general-purpose GenerateContent request with the selected model-specific thinking level", async () => {
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
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(body.generationConfig.maxOutputTokens).toBe(8_192);
    expect(JSON.stringify(body)).not.toContain("AnswerPacket");
    expect(JSON.stringify(body)).not.toContain("SSC");
  });

  it("identifies a GenerateContent 403 and exposes only safe Google permission diagnostics", async () => {
    const calls: string[] = [];
    const env = { ...configuredEnv, GCP_PROJECT_ID: "generate-permission-test-project" } as Env;
    const fetcher: typeof fetch = async (url) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 1 }), { status: 200 });
      return new Response(JSON.stringify({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Permission denied on resource projects/secret-project-id.",
          details: [{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "IAM_PERMISSION_DENIED",
            metadata: {
              permission: "aiplatform.endpoints.predict",
              resource: "projects/secret-project-id",
            },
          }],
        },
      }), { status: 403, headers: { "content-type": "application/json" } });
    };
    let failure: unknown;
    try {
      await openOwnerGeminiStream(
        env,
        { modelId: "gemini-4-carbon", thinkingLevel: "HIGH", contents: [{ role: "user", text: "Continue our conversation." }] },
        new AbortController().signal,
        dependencies(fetcher),
      );
    } catch (error) {
      failure = error;
    }
    expect(calls.some((url) => url.endsWith(":countTokens"))).toBe(true);
    expect(calls.some((url) => url.includes(":streamGenerateContent"))).toBe(true);
    expect(failure).toMatchObject({
      status: 403,
      stage: "stream_generate_content",
    });
    expect((failure as Error).message).toContain("StreamGenerateContent request");
    expect((failure as Error).message).toContain("permission aiplatform.endpoints.predict");
    expect((failure as Error).message).not.toContain("secret-project-id");
  });

  it("extracts only the IAM permission and reason from a formatted Google 403 message", async () => {
    const calls: string[] = [];
    const env = { ...configuredEnv, GCP_PROJECT_ID: "formatted-error-test-project" } as Env;
    const fetcher: typeof fetch = async (url) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 1 }), { status: 200 });
      return new Response(JSON.stringify({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Permission 'aiplatform.endpoints.predict' denied on resource '//aiplatform.googleapis.com/projects/secret-project-id/locations/global/publishers/google/models/gemini-4-carbon'. [reason: \"IAM_PERMISSION_DENIED\" domain: \"aiplatform.googleapis.com\"]",
        },
      }), { status: 403, headers: { "content-type": "application/json" } });
    };
    let failure: unknown;
    try {
      await openOwnerGeminiStream(
        env,
        { modelId: "gemini-4-carbon", thinkingLevel: "HIGH", contents: [{ role: "user", text: "Check the model." }] },
        new AbortController().signal,
        dependencies(fetcher),
      );
    } catch (error) {
      failure = error;
    }
    expect(calls.some((url) => url.includes(":streamGenerateContent"))).toBe(true);
    expect(failure).toMatchObject({
      status: 403,
      stage: "stream_generate_content",
    });
    expect((failure as Error).message).toContain("permission aiplatform.endpoints.predict");
    expect((failure as Error).message).toContain("reason IAM_PERMISSION_DENIED");
    expect((failure as Error).message).not.toContain("secret-project-id");
    expect((failure as Error).message).not.toContain("aiplatform.googleapis.com/projects");
  });

  it("identifies a Count Tokens 403 and does not attempt GenerateContent", async () => {
    const calls: string[] = [];
    const env = { ...configuredEnv, GCP_PROJECT_ID: "count-token-permission-test-project" } as Env;
    const fetcher: typeof fetch = async (url) => {
      const value = String(url);
      calls.push(value);
      return new Response(JSON.stringify({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          details: [{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "IAM_PERMISSION_DENIED",
            metadata: { permission: "aiplatform.endpoints.predict" },
          }],
        },
      }), { status: 403, headers: { "content-type": "application/json" } });
    };
    let failure: unknown;
    try {
      await openOwnerGeminiStream(
        env,
        { modelId: "gemini-4-carbon", thinkingLevel: "HIGH", contents: [{ role: "user", text: "Try Carbon." }] },
        new AbortController().signal,
        dependencies(fetcher),
      );
    } catch (error) {
      failure = error;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(":countTokens");
    expect(failure).toMatchObject({
      status: 403,
      stage: "count_tokens_probe",
    });
    expect((failure as Error).message).toContain("Count Tokens availability probe");
    expect((failure as Error).message).not.toContain("denied the GenerateContent request");
  });

  it("rejects unpaired, repeated-role or oversized conversation turns before provider access", async () => {
    const fetcher = vi.fn();
    await expect(openOwnerGeminiStream(configuredEnv, {
      modelId: "gemini-4-hydrogen",
      thinkingLevel: "HIGH",
      contents: [
        { role: "user", text: "Question one" },
        { role: "user", text: "Question two" },
      ],
    }, new AbortController().signal, dependencies(fetcher as unknown as typeof fetch))).rejects.toMatchObject({
      message: expect.stringContaining("conversation context is invalid or too large"),
    });
    expect(fetcher).not.toHaveBeenCalled();
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
    )).rejects.toMatchObject({ status: 429, retryable: true, message: "Vertex AI rate-limited the GenerateContent request." });
  });
});


  it("rejects a thinking level that the selected model does not support", async () => {
    const fetcher = vi.fn();
    await expect(generateOwnerGeminiContent(configuredEnv, {
      modelId: "gemini-4-argon",
      thinkingLevel: "XHIGH",
      contents: [{ role: "user", text: "Hi" }],
    }, dependencies(fetcher as unknown as typeof fetch))).rejects.toMatchObject({
      message: "The selected thinking level is not supported by this model.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams text deltas, excludes thought parts and returns usage with the selected thinking level", async () => {
    const sse = [
      { candidates: [{ content: { role: "model", parts: [
        { text: "private thought", thought: true },
        { text: "Hello " },
      ] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "world." }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 5, totalTokenCount: 13 } },
    ].map((chunk) => "data: " + JSON.stringify(chunk) + "\r\n\r\n").join("");
    const calls: Array<{ url: string; body?: string }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const value = String(url);
      calls.push({ url: value, body: String(init?.body ?? "") });
      if (value.endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 2 }), { status: 200 });
      const encoded = new TextEncoder().encode(sse);
      const splitAt = sse.indexOf("\r\n\r\n") + 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.slice(0, splitAt));
          controller.enqueue(encoded.slice(splitAt));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const stream = await openOwnerGeminiStream(
      { ...configuredEnv, GEMINI_LOCATION: "australia-southeast2" } as Env,
      {
        modelId: "gemini-4-argon",
        thinkingLevel: "HIGH",
        contents: [{ role: "user", text: "Say hello." }],
      },
      new AbortController().signal,
      dependencies(fetcher),
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "")).toEqual(["Hello ", "world."]);
    expect(events[events.length - 1]).toMatchObject({
      type: "done",
      usage: { promptTokens: 8, outputTokens: 5, totalTokens: 13 },
    });
    const streamRequest = calls.find((value) => value.url.includes(":streamGenerateContent"));
    expect(streamRequest?.url).toContain("?alt=sse");
    expect(JSON.parse(streamRequest?.body ?? "{}").generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    const availabilityProbes = calls.filter((call) => call.url.endsWith(":countTokens"));
    expect(availabilityProbes).toHaveLength(1);
    expect(availabilityProbes[0].url).toContain("/models/gemini-4-argon:countTokens");
  });

