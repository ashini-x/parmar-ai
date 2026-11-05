import { describe, expect, it } from "vitest";
import { proveBrvinConnectionV2 } from "../src/brvin/service-core";

const ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000202";
const CHALLENGE_ID = "00000000-0000-4000-8000-000000000999";
const NONCE = "a".repeat(64);

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), item => item.toString(16).padStart(2, "0")).join("");
}

class ProbeDb {
  challenge: Record<string, unknown>;
  proofHash: string | null = null;
  status = "pending";
  constructor(environmentId = ENVIRONMENT_ID) {
    this.challenge = {
      id: CHALLENGE_ID,
      environment_id: environmentId,
      nonce_hash: "",
      status: "pending",
      expires_at: Date.now() + 60_000,
    };
  }
  prepare(sql: string) {
    const db = this;
    return {
      bind(...values: unknown[]) {
        return {
          first: async () => {
            if (sql.includes("FROM brvin_application_environments e")) {
              return {
                environment_id: ENVIRONMENT_ID,
                application_id: "00000000-0000-4000-8000-000000000101",
                environment_key: "production",
                environment_status: "active",
                resolved_application_id: "00000000-0000-4000-8000-000000000101",
                application_slug: "ssc-math",
                application_status: "active",
              };
            }
            if (sql.includes("FROM brvin_connection_checks")) return db.challenge;
            return null;
          },
          all: async () => {
            if (sql.includes("FROM brvin_application_project_grants") && sql.includes("ORDER BY p.name")) {
              return { results: [] };
            }
            return { results: [] };
          },
          run: async () => {
            if (sql.includes("UPDATE brvin_connection_checks SET proof_hash")) {
              db.proofHash = String(values[0]);
              db.status = "proof_issued";
              db.challenge.status = "proof_issued";
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe("private v2 connection proof RPC", () => {
  it("issues a one-time content-free proof for the trusted environment with no ready sources", async () => {
    const db = new ProbeDb();
    db.challenge.nonce_hash = await digest(NONCE);
    const result = await proveBrvinConnectionV2(
      { DB: db } as any,
      ENVIRONMENT_ID,
      { challengeId: CHALLENGE_ID, nonce: NONCE },
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        challengeId: CHALLENGE_ID,
        ready: false,
        authorizedSourceCount: 0,
      },
    });
    if (!result.ok) throw new Error("Expected valid proof result");
    expect(result.data.proof).toMatch(/^[a-f0-9]{64}$/u);
    expect(db.proofHash).toBe(await digest(result.data.proof));
    expect(db.proofHash).not.toBe(result.data.proof);
    expect(db.status).toBe("proof_issued");
  });

  it("rejects a challenge issued for a different environment", async () => {
    const db = new ProbeDb(OTHER_ENVIRONMENT_ID);
    db.challenge.nonce_hash = await digest(NONCE);
    const result = await proveBrvinConnectionV2(
      { DB: db } as any,
      ENVIRONMENT_ID,
      { challengeId: CHALLENGE_ID, nonce: NONCE },
    );

    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(db.proofHash).toBeNull();
  });

  it("rejects challenge replay after the first proof was issued", async () => {
    const db = new ProbeDb();
    db.challenge.nonce_hash = await digest(NONCE);
    const first = await proveBrvinConnectionV2({ DB: db } as any, ENVIRONMENT_ID, {
      challengeId: CHALLENGE_ID, nonce: NONCE,
    });
    const second = await proveBrvinConnectionV2({ DB: db } as any, ENVIRONMENT_ID, {
      challengeId: CHALLENGE_ID, nonce: NONCE,
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("rejects additional identity or permission fields in the challenge input", async () => {
    const db = new ProbeDb();
    db.challenge.nonce_hash = await digest(NONCE);
    const result = await proveBrvinConnectionV2({ DB: db } as any, ENVIRONMENT_ID, {
      challengeId: CHALLENGE_ID,
      nonce: NONCE,
      applicationEnvironmentId: OTHER_ENVIRONMENT_ID,
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(db.proofHash).toBeNull();
  });
});
