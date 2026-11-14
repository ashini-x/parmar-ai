import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), "wrangler.m14-staging.jsonc");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const vars = config.vars ?? {};
const expected = {
  ENVIRONMENT: "staging",
  BRVIN_M14_PILOT_ENABLED: "true",
  BRVIN_M14_VERTEX_LOCATION: "asia-south1",
  BRVIN_M14_VERTEX_MODEL: "gemini-embedding-001",
  BRVIN_M14_EMBEDDING_DIMENSIONS: "768",
  BRVIN_M14_QDRANT_COLLECTION: "brvin_m14_physics_pilot_v1",
  BRVIN_M15_BENCHMARK_QDRANT_COLLECTION: "brvin_m15_physics_benchmark_v1",
  BRVIN_M15_FATMAN_QDRANT_COLLECTION: "brvin_m15_fatman_538_v1",
  BRVIN_M15_FATMAN_JUDGE_A_MODEL: "gemini-4-argon",
  BRVIN_M15_FATMAN_JUDGE_B_MODEL: "gemini-3.8-flash",
};

for (const [name, value] of Object.entries(expected)) {
  if (vars[name] !== value) {
    throw new Error(`Missing or incorrect ${name} in ${configPath}`);
  }
}

const endpoint = vars.BRVIN_M14_QDRANT_URL;
if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
  throw new Error("BRVIN_M14_QDRANT_URL must be a non-secret HTTPS endpoint in the tracked staging config.");
}
const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash ||
    (parsedEndpoint.pathname && parsedEndpoint.pathname !== "/")) {
  throw new Error("BRVIN_M14_QDRANT_URL must be an HTTPS endpoint origin, not a credential-bearing URL.");
}
if (Object.prototype.hasOwnProperty.call(vars, "BRVIN_M14_QDRANT_API_KEY")) {
  throw new Error("BRVIN_M14_QDRANT_API_KEY must remain a Worker secret, not a plain-text var.");
}
const aiSearchBindings = config.ai_search ?? [];
const expectedBindings = {
  BRVIN_M15_AI_SEARCH: "fatman-2026-8b183803",
  BRVIN_M15_BENCHMARK_AI_SEARCH: "brvin-m15-physics-staging-v1",
  BRVIN_M15_FATMAN_SOURCE_EXPORT: "fatman-2026-8b183803",
  BRVIN_M15_FATMAN_AI_SEARCH: "brvin-m15-fatman-legacy-v1",
};
for (const [binding, instanceName] of Object.entries(expectedBindings)) {
  if (!aiSearchBindings.some((entry) => entry.binding === binding && entry.instance_name === instanceName)) {
    throw new Error("Missing or incorrect isolated M15 AI Search binding: " + binding);
  }
}
console.log("M14/M15 staging config is complete; the Fatman legacy index is bound for text export only, the Fatman comparison index and Qdrant collection are separate, and Qdrant key is not embedded in plain-text vars.");
