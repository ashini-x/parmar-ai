import type { Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import { json } from "../http/response";

const CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const HEX_256_PATTERN = /^[a-f0-9]{64}$/u;

type VerificationRow = {
  id: string;
  environment_id: string;
  nonce_hash: string;
  proof_hash: string | null;
  status: string;
  ready: number | null;
  authorized_source_count: number | null;
  expires_at: number;
  created_at: number;
  environment_status: string;
  environment_updated_at: number;
  application_updated_at: number;
  application_status: string;
};

function randomHex(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, item => item.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function normalizedProbeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Creates a short-lived, administrator-authorized challenge. The browser sends
 * it to the registered consumer Worker; no BRVIN service credential leaves D1.
 */
export async function startBrvinConnectionVerification(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { environmentId?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ ok: false, error: "Invalid verification request." }, 400); }

  const environmentId = typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  if (!UUID_PATTERN.test(environmentId)) return json({ ok: false, error: "Choose a valid application environment." }, 400);

  try {
    await ensureAnalyticsSchema(env);
    const environment = await env.DB.prepare(
      "SELECT e.id,e.status AS environment_status,e.worker_url,a.status AS application_status " +
      "FROM brvin_application_environments e JOIN brvin_applications a ON a.id=e.application_id WHERE e.id=? LIMIT 1",
    ).bind(environmentId).first<{
      id: string; environment_status: string; worker_url: string; application_status: string;
    }>();
    if (!environment) return json({ ok: false, error: "The application environment was not found." }, 404);
    if (environment.application_status !== "active" || environment.environment_status !== "active") {
      return json({ ok: false, error: "Only an active application and environment can be verified." }, 409);
    }

    const origin = normalizedProbeOrigin(environment.worker_url);
    if (!origin) {
      return json({ ok: false, error: "Save the deployed consumer Worker's HTTPS origin before verifying its connection." }, 409);
    }

    const challengeId = crypto.randomUUID().toLowerCase();
    const nonce = randomHex();
    const now = Date.now();
    const expiresAt = now + CHALLENGE_TTL_MS;
    await env.DB.prepare(
      "INSERT INTO brvin_connection_checks " +
      "(id,environment_id,nonce_hash,status,created_at,expires_at) VALUES (?,?,?,'pending',?,?)",
    ).bind(challengeId, environmentId, await sha256Hex(nonce), now, expiresAt).run();

    return json({
      ok: true,
      challengeId,
      nonce,
      expiresAt,
      probeUrl: origin + "/brvin/connection-probe",
    });
  } catch {
    return json({ ok: false, error: "A connection-verification challenge could not be created." }, 503);
  }
}

/**
 * Finalizes a challenge only when the private BRVIN Service Binding has issued
 * the matching one-time proof. The browser cannot set readiness or source count.
 */
export async function completeBrvinConnectionVerification(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "The BRVIN database is not configured." }, 503);
  let body: { challengeId?: unknown; proof?: unknown; failureCode?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ ok: false, error: "Invalid verification result." }, 400); }

  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  if (!UUID_PATTERN.test(challengeId)) return json({ ok: false, error: "Invalid verification challenge." }, 400);

  const failureCode = body.failureCode === "PROBE_UNREACHABLE" ? "PROBE_UNREACHABLE"
    : body.failureCode === "PROBE_REJECTED" ? "PROBE_REJECTED"
    : null;

  try {
    await ensureAnalyticsSchema(env);
    const row = await env.DB.prepare(
      "SELECT c.id,c.environment_id,c.nonce_hash,c.proof_hash,c.status,c.ready,c.authorized_source_count," +
      "c.expires_at,c.created_at,e.status AS environment_status,e.updated_at AS environment_updated_at," +
      "a.updated_at AS application_updated_at,a.status AS application_status " +
      "FROM brvin_connection_checks c " +
      "JOIN brvin_application_environments e ON e.id=c.environment_id " +
      "JOIN brvin_applications a ON a.id=e.application_id WHERE c.id=? LIMIT 1",
    ).bind(challengeId).first<VerificationRow>();

    if (!row) return json({ ok: false, error: "The verification challenge was not found." }, 404);
    if (row.status === "connected" || row.status === "failed" || row.status === "expired") {
      return json({ ok: false, error: "The verification challenge has already been consumed." }, 409);
    }

    const now = Date.now();
    if (row.expires_at <= now) {
      await env.DB.prepare(
        "UPDATE brvin_connection_checks SET status='expired',failure_code='CHALLENGE_EXPIRED',completed_at=? WHERE id=? AND status IN ('pending','proof_issued')",
      ).bind(now, challengeId).run();
      return json({ ok: false, error: "The verification challenge expired. Start a new check." }, 410);
    }

    if (row.environment_status !== "active" || row.application_status !== "active" ||
        row.created_at < Math.max(row.environment_updated_at, row.application_updated_at)) {
      await env.DB.prepare(
        "UPDATE brvin_connection_checks SET status='failed',failure_code='ENVIRONMENT_CHANGED',completed_at=? WHERE id=? AND status IN ('pending','proof_issued')",
      ).bind(now, challengeId).run();
      return json({ ok: false, error: "The application or environment changed during verification. Start a new check." }, 409);
    }

    if (failureCode) {
      await env.DB.prepare(
        "UPDATE brvin_connection_checks SET status='failed',failure_code=?,completed_at=? WHERE id=? AND status IN ('pending','proof_issued')",
      ).bind(failureCode, now, challengeId).run();
      return json({ ok: true, status: "failed", failureCode });
    }

    const proof = typeof body.proof === "string" ? body.proof : "";
    if (!HEX_256_PATTERN.test(proof) || !row.proof_hash ||
        !constantTimeEqual(await sha256Hex(proof), row.proof_hash) || row.status !== "proof_issued") {
      return json({ ok: false, error: "The consumer did not return a valid private BRVIN proof." }, 403);
    }

    const update = await env.DB.prepare(
      "UPDATE brvin_connection_checks SET status='connected',completed_at=? " +
      "WHERE id=? AND status='proof_issued' AND proof_hash=? AND expires_at>?",
    ).bind(now, challengeId, row.proof_hash, now).run();
    if (Number(update.meta?.changes ?? 0) !== 1) {
      return json({ ok: false, error: "The verification challenge was already used or expired." }, 409);
    }

    const ready = Number(row.ready ?? 0) === 1 && Number(row.authorized_source_count ?? 0) > 0;
    return json({
      ok: true,
      status: ready ? "connected" : "connected_no_ready_knowledge",
      ready,
      authorizedSourceCount: Number(row.authorized_source_count ?? 0),
      checkedAt: now,
    });
  } catch {
    return json({ ok: false, error: "The verification result could not be confirmed." }, 503);
  }
}

/**
 * Public, content-free consumer endpoint. Possession of an unexpired challenge
 * is not enough: the private service must issue a proof using ctx.props identity.
 */
export async function handleBrvinConnectionProbe(request: Request, env: Env): Promise<Response> {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "300",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, { ...headers, allow: "POST, OPTIONS" });
  if (!env.BRVIN_SERVICE) return json({ ok: false, error: "BRVIN_UNAVAILABLE" }, 503, headers);

  let body: { challengeId?: unknown; nonce?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ ok: false, error: "INVALID_REQUEST" }, 400, headers); }

  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!UUID_PATTERN.test(challengeId) || !HEX_256_PATTERN.test(nonce)) {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400, headers);
  }

  try {
    const result = await env.BRVIN_SERVICE.proveConnectionV2({ challengeId, nonce });
    if (!result.ok) return json({ ok: false, error: result.code }, 403, headers);
    return json({ ok: true, proof: result.data.proof }, 200, headers);
  } catch {
    return json({ ok: false, error: "BRVIN_UNAVAILABLE" }, 503, headers);
  }
}
