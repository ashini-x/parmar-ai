import { describe, expect, it } from "vitest";
import { buildBrvinHandoff } from "../src/brvin/handoff";

const baseInput = {
  brvinAccountId: "b34a6c0b7221454c5db977fe61ddf759",
  now: Date.parse("2026-11-05T18:30:00.000Z"),
  application: {
    id: "11111111-2222-4333-8444-555555555555",
    slug: "ssc-math-bot",
    name: "SSC Mathematics Bot",
    description: "Teacher-focused mathematics assistant",
    ownerLabel: "Teacher A · Mathematics",
    repositoryUrl: "https://github.com/ashini-x/ssc-math-bot",
    repositoryDefaultBranch: "develop",
    runtimeProvider: "cloudflare-workers",
    status: "active",
    updatedAt: 1793900000000,
  },
  environment: {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    environmentKey: "production",
    displayName: "Production",
    workerName: "ssc-math-bot",
    workerUrl: "https://ssc-math-bot.example.workers.dev",
    status: "active",
    updatedAt: 1793900000001,
  },
};

describe("BRVIN M8 ChatGPT handoff", () => {
  it("generates a repository- and environment-specific prompt plus structured manifest", () => {
    const result = buildBrvinHandoff(baseInput);
    expect(result.manifest.revision).toBe("brvin-chatgpt-handoff/v2");
    expect(result.manifest.generatedAt).toBe("2026-11-05T18:30:00.000Z");
    expect(result.manifest.target.repository).toMatchObject({
      url: "https://github.com/ashini-x/ssc-math-bot",
      owner: "ashini-x",
      name: "ssc-math-bot",
      defaultBranch: "develop",
    });
    expect(result.manifest.target.application.id).toBe(baseInput.application.id);
    expect(result.manifest.target.environment.id).toBe(baseInput.environment.id);
    expect(result.manifest.target.runtime.brvinCloudflareAccountId).toBe(baseInput.brvinAccountId);
    expect(result.manifest.service).toMatchObject({
      workerName: "brvin-service",
      entrypoint: "BrvinRetrievalApi",
      bindingName: "BRVIN_SERVICE",
      trustedIdentityProperty: "applicationEnvironmentId",
    });
    expect(result.manifest.service.rpcMethods).toEqual([
      "listAuthorizedProjectsV2()",
      "getProjectStatusV2({ projectId })",
      "retrieveProjectContextV2(input)",
      "proveConnectionV2({ challengeId, nonce }) — connection probe only",
    ]);
    expect(result.prompt).toContain("https://github.com/ashini-x/ssc-math-bot");
    expect(result.prompt).toContain('"applicationEnvironmentId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"');
    expect(result.prompt).toContain("listAuthorizedProjectsV2()");
    expect(result.prompt).toContain("retrieveProjectContextV2(input)");
    expect(result.prompt).toContain("physical PDF page");
    expect(result.prompt).toContain("POST /brvin/connection-probe");
    expect(result.prompt).toContain("proveConnectionV2({ challengeId, nonce })");
    expect(result.prompt).toContain("one-time proof");
    expect(result.prompt).toContain("same Cloudflare account");
  });

  it("does not include provider tokens, secrets, D1 credentials or AI Search bindings", () => {
    const result = buildBrvinHandoff(baseInput);
    const serialized = JSON.stringify({ manifest: result.manifest, prompt: result.prompt }).toLowerCase();
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("private_key");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("brvin_search");
    expect(serialized).not.toContain("parmar-ai-admin-prod");
    expect(serialized).not.toContain("cloudflare_api_token");
  });

  it("marks a non-Cloudflare runtime as unsupported and instructs ChatGPT to stop", () => {
    const result = buildBrvinHandoff({
      ...baseInput,
      application: { ...baseInput.application, runtimeProvider: "other" },
    });
    expect(result.manifest.target.runtime.supportedByCurrentPrivateBinding).toBe(false);
    expect(result.prompt).toContain("BLOCKED");
    expect(result.prompt).toContain("do not invent a public gateway");
  });

  it("rejects a missing or non-GitHub repository reference", () => {
    expect(() => buildBrvinHandoff({
      ...baseInput,
      application: { ...baseInput.application, repositoryUrl: "" },
    })).toThrow("Add a valid HTTPS GitHub repository URL");
    expect(() => buildBrvinHandoff({
      ...baseInput,
      application: { ...baseInput.application, repositoryUrl: "https://github.com/owner/repo?token=x" },
    })).toThrow("Add a valid HTTPS GitHub repository URL");
  });
});
