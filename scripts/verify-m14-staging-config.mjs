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
console.log("M14 staging config is complete; Qdrant API key is not embedded in plain-text vars.");
