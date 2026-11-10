import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type M14StagingConfig = {
  vars: Record<string, string>;
};

describe("M14 staging Worker deployment configuration", () => {
  const config = JSON.parse(
    readFileSync(new URL("../wrangler.m14-staging.jsonc", import.meta.url), "utf8"),
  ) as M14StagingConfig;

  it("keeps all Vertex and Qdrant non-secret settings in versioned config", () => {
    expect(config.vars).toMatchObject({
      ENVIRONMENT: "staging",
      BRVIN_M14_PILOT_ENABLED: "true",
      BRVIN_M14_VERTEX_LOCATION: "asia-south1",
      BRVIN_M14_VERTEX_MODEL: "gemini-embedding-001",
      BRVIN_M14_EMBEDDING_DIMENSIONS: "768",
      BRVIN_M14_QDRANT_COLLECTION: "brvin_m14_physics_pilot_v1",
    });
    expect(config.vars.BRVIN_M14_QDRANT_URL).toMatch(/^https:\/\//u);
  });

  it("does not place the Qdrant API key in plain-text Worker vars", () => {
    expect(config.vars).not.toHaveProperty("BRVIN_M14_QDRANT_API_KEY");
  });
});
