import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";

const ensure = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/analytics/db", () => ({ ensureAnalyticsSchema: ensure }));

import {
  completeBrvinConnectionVerification,
  handleBrvinConnectionProbe,
  startBrvinConnectionVerification,
} from "../src/brvin/connection-verification";

const ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000102";
const CHALLENGE_ID = "00000000-0000-4000-8000-000000000999";

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), item => item.toString(16).padStart(2, "0")).join("");
}

class Statement {
  private values: unknown[] = [];
  constructor(private db: MemoryD1, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  first<T>() { return this.db.first(this.sql, this.values) as Promise<T | null>; }
  run() { return this.db.run(this.sql, this.values); }
}

class MemoryD1 {
  environment = {
    id: ENVIRONMENT_ID,
    environment_status: "active",
    worker_url: "https://ssc-math.example.workers.dev",
    application_status: "active",
  };
  check: Record<string, unknown> | null = null;

  prepare(sql: string) { return new Statement(this, sql); }

  async first(sql: string, values: unknown[]): Promise<Record<string, unknown> | null> {
    if (sql.includes("FROM brvin_application_environments e JOIN brvin_applications a")) {
      return values[0] === ENVIRONMENT_ID ? this.environment : null;
    }
    if (sql.includes("FROM brvin_connection_checks c")) return this.check;
    return null;
  }

  async run(sql: string, values: unknown[]) {
    if (sql.includes("INSERT INTO brvin_connection_checks")) {
      this.check = {
        id: values[0],
        environment_id: values[1],
        nonce_hash: values[2],
        status: "pending",
        created_at: values[3],
        expires_at: values[4],
        proof_hash: null,
        ready: null,
        authorized_source_count: null,
        environment_status: "active",
        environment_updated_at: 0,
        application_status: "active",
      };
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET status='connected'")) {
      if (this.check?.id === values[1] && this.check.status === "proof_issued" && this.check.proof_hash === values[2]) {
        this.check.status = "connected";
        this.check.completed_at = values[0];
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (sql.includes("SET status='failed'")) {
      if (this.check?.id === values[2]) {
        this.check.status = "failed";
        this.check.failure_code = values[0];
        this.check.completed_at = values[1];
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET status='expired'")) {
      if (this.check?.id === values[1]) this.check.status = "expired";
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}

function adminRequest(body: unknown) {
  return new Request("https://brvin.example/admin/api/brvin/connections/test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://brvin.example" },
    body: JSON.stringify(body),
  });
}

function env(db: MemoryD1) {
  return { DB: db } as unknown as Env;
}

describe("BRVIN live connection challenge and proof", () => {
  beforeEach(() => ensure.mockClear());

  it("creates a short-lived nonce challenge only for an active environment with a saved HTTPS Worker URL", async () => {
    const db = new MemoryD1();
    const response = await startBrvinConnectionVerification(env(db), adminRequest({ environmentId: ENVIRONMENT_ID }));
    const body = await response.json() as { ok: boolean; challengeId: string; nonce: string; probeUrl: string; expiresAt: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.challengeId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(body.nonce).toMatch(/^[a-f0-9]{64}$/u);
    expect(body.probeUrl).toBe("https://ssc-math.example.workers.dev/brvin/connection-probe");
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(db.check?.status).toBe("pending");
    expect(db.check?.nonce_hash).toBe(await digest(body.nonce));
    expect(db.check?.nonce_hash).not.toBe(body.nonce);
  });

  it("accepts only a private service-issued one-time proof and returns the stored readiness snapshot", async () => {
    const db = new MemoryD1();
    const proof = "a".repeat(64);
    db.check = {
      id: CHALLENGE_ID,
      environment_id: ENVIRONMENT_ID,
      nonce_hash: "b".repeat(64),
      proof_hash: await digest(proof),
      status: "proof_issued",
      ready: 1,
      authorized_source_count: 2,
      expires_at: Date.now() + 60_000,
      created_at: Date.now() - 100,
      environment_status: "active",
      environment_updated_at: Date.now() - 200,
      application_updated_at: Date.now() - 200,
      application_status: "active",
    };

    const response = await completeBrvinConnectionVerification(env(db), adminRequest({ challengeId: CHALLENGE_ID, proof }));
    const body = await response.json() as { ok: boolean; status: string; ready: boolean; authorizedSourceCount: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "connected", ready: true, authorizedSourceCount: 2 });
    expect(db.check.status).toBe("connected");

    const replay = await completeBrvinConnectionVerification(env(db), adminRequest({ challengeId: CHALLENGE_ID, proof }));
    expect(replay.status).toBe(409);
  });

  it("does not accept a forged browser-supplied proof or browser-supplied readiness values", async () => {
    const db = new MemoryD1();
    db.check = {
      id: CHALLENGE_ID,
      environment_id: ENVIRONMENT_ID,
      nonce_hash: "b".repeat(64),
      proof_hash: await digest("c".repeat(64)),
      status: "proof_issued",
      ready: 0,
      authorized_source_count: 0,
      expires_at: Date.now() + 60_000,
      created_at: Date.now() - 100,
      environment_status: "active",
      environment_updated_at: Date.now() - 200,
      application_updated_at: Date.now() - 200,
      application_status: "active",
    };

    const response = await completeBrvinConnectionVerification(env(db), adminRequest({
      challengeId: CHALLENGE_ID,
      proof: "d".repeat(64),
      ready: true,
      authorizedSourceCount: 999,
    }));
    expect(response.status).toBe(403);
    expect(db.check.status).toBe("proof_issued");
    expect(db.check.authorized_source_count).toBe(0);
  });

  it("returns proof only when the private service confirms the trusted deployment identity", async () => {
    const proveConnectionV2 = vi.fn().mockResolvedValue({
      ok: true,
      data: { challengeId: CHALLENGE_ID, proof: "e".repeat(64), ready: false, authorizedSourceCount: 0 },
    });
    const response = await handleBrvinConnectionProbe(
      new Request("https://consumer.example/brvin/connection-probe", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://brvin.example" },
        body: JSON.stringify({ challengeId: CHALLENGE_ID, nonce: "f".repeat(64) }),
      }),
      { BRVIN_SERVICE: { proveConnectionV2 } } as unknown as Env,
    );
    const body = await response.json() as { ok: boolean; proof: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, proof: "e".repeat(64) });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(proveConnectionV2).toHaveBeenCalledWith({ challengeId: CHALLENGE_ID, nonce: "f".repeat(64) });
  });

  it("allows the CORS preflight but does not allow a public GET probe", async () => {
    const preflight = await handleBrvinConnectionProbe(
      new Request("https://consumer.example/brvin/connection-probe", { method: "OPTIONS" }),
      {} as Env,
    );
    expect(preflight.status).toBe(204);

    const get = await handleBrvinConnectionProbe(
      new Request("https://consumer.example/brvin/connection-probe", { method: "GET" }),
      {} as Env,
    );
    expect(get.status).toBe(405);
  });
});
