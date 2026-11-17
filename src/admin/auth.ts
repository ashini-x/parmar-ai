import { ensureAnalyticsSchema } from "../analytics/db";
import type { Env } from "../config/env";

const COOKIE_NAME = "parmar_admin_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

type AdminRole = "admin" | "owner";

function configuredAdminUsername(env: Env): string {
  return env.ADMIN_DASHBOARD_USER?.trim() || "admin";
}

function ownerUsesAdminCredentials(env: Env): boolean {
  const ownerUser = env.OWNER_DASHBOARD_USER?.trim();
  return Boolean(ownerUser && ownerUser.toLowerCase() === configuredAdminUsername(env).toLowerCase());
}

function ownerCredentialsAreUsable(env: Env): boolean {
  const ownerUser = env.OWNER_DASHBOARD_USER?.trim();
  if (!ownerUser) return false;
  if (ownerUsesAdminCredentials(env)) return Boolean(env.ADMIN_DASHBOARD_PASSWORD?.trim());
  return Boolean(env.OWNER_DASHBOARD_PASSWORD?.trim());
}

function safeSignatureEqual(expected: Uint8Array, actual: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

function sessionSignatureSecret(env: Env, role: AdminRole): string | undefined {
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim();
  if (!sessionSecret) return undefined;
  if (role === "admin") return sessionSecret;
  const ownerPassword = ownerUsesAdminCredentials(env)
    ? env.ADMIN_DASHBOARD_PASSWORD?.trim()
    : env.OWNER_DASHBOARD_PASSWORD?.trim();
  if (!ownerCredentialsAreUsable(env) || !ownerPassword) return undefined;
  // Rotating the credential assigned to the Owner principal revokes existing
  // Owner sessions without invalidating unrelated administrator sessions.
  return `${sessionSecret}:owner:${ownerPassword}`;
}

export async function getAdminSessionRole(request: Request, env: Env): Promise<AdminRole | null> {
  if (!env.ADMIN_SESSION_SECRET?.trim()) return null;

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;

  const token = cookie.slice(COOKIE_NAME.length + 1);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(payload));
    const parts = decoded.split("|");
    let username = "";
    let role: AdminRole = "admin";
    let expiresText = "";

    if (parts.length === 2) {
      // Existing sessions created before role claims remain admin-only.
      [username, expiresText] = parts;
    } else if (parts.length === 3 && (parts[1] === "admin" || parts[1] === "owner")) {
      username = parts[0];
      role = parts[1];
      expiresText = parts[2];
    } else {
      return null;
    }

    const expires = Number(expiresText);
    if (!username || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return null;

    if (role === "admin") {
      if (username !== configuredAdminUsername(env) || !env.ADMIN_DASHBOARD_PASSWORD?.trim()) return null;
    } else if (!ownerCredentialsAreUsable(env) || username !== env.OWNER_DASHBOARD_USER?.trim()) {
      return null;
    }

    const signingSecret = sessionSignatureSecret(env, role);
    if (!signingSecret) return null;
    const expected = await hmac(signingSecret, payload);
    const actual = base64UrlDecode(signature);
    return safeSignatureEqual(expected, actual) ? role : null;
  } catch {
    return null;
  }
}

export async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  return (await getAdminSessionRole(request, env)) !== null;
}

export async function requireOwner(request: Request, env: Env): Promise<boolean> {
  return (await getAdminSessionRole(request, env)) === "owner";
}

async function loginRateLimitState(env: Env, clientKey: string, now: number): Promise<{ locked: boolean }> {
  if (!env.DB) return { locked: false };
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    `SELECT window_started_at, failures, locked_until FROM admin_login_attempts WHERE client_key = ?`
  ).bind(clientKey).first<{ window_started_at: number; failures: number; locked_until: number | null }>();
  if (!row) return { locked: false };
  if (row.locked_until && Number(row.locked_until) > now) return { locked: true };
  if (now - Number(row.window_started_at) > 5 * 60_000) {
    await env.DB.prepare(`DELETE FROM admin_login_attempts WHERE client_key = ?`).bind(clientKey).run();
  }
  return { locked: false };
}

async function recordLoginFailure(env: Env, clientKey: string, now: number): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    `SELECT window_started_at, failures FROM admin_login_attempts WHERE client_key = ?`
  ).bind(clientKey).first<{ window_started_at: number; failures: number }>();

  if (!row || now - Number(row.window_started_at) > 5 * 60_000) {
    await env.DB.prepare(
      `INSERT INTO admin_login_attempts (client_key, window_started_at, failures, locked_until) VALUES (?, ?, 1, NULL)
       ON CONFLICT(client_key) DO UPDATE SET window_started_at=excluded.window_started_at, failures=1, locked_until=NULL`
    ).bind(clientKey, now).run();
    return;
  }

  const failures = Number(row.failures) + 1;
  const lockedUntil = failures >= 5 ? now + 10 * 60_000 : null;
  await env.DB.prepare(
    `UPDATE admin_login_attempts SET failures = ?, locked_until = ? WHERE client_key = ?`
  ).bind(failures, lockedUntil, clientKey).run();
}

async function clearLoginFailures(env: Env, clientKey: string): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(`DELETE FROM admin_login_attempts WHERE client_key = ?`).bind(clientKey).run();
}

export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const clientKey = (request.headers.get("CF-Connecting-IP") ?? "unknown").slice(0, 100);
  const now = Date.now();
  if ((await loginRateLimitState(env, clientKey, now)).locked) {
    return new Response(loginHtml("Too many failed attempts. Try again later."), {
      status: 429,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "600" },
    });
  }

  const body = await request.formData();
  const username = String(body.get("username") ?? "").trim();
  const password = String(body.get("password") ?? "");
  const expectedAdminUser = configuredAdminUsername(env);
  const expectedAdminPassword = env.ADMIN_DASHBOARD_PASSWORD?.trim();
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim();
  const ownerUser = env.OWNER_DASHBOARD_USER?.trim();
  const ownerUsesAdmin = ownerUsesAdminCredentials(env);
  const ownerPassword = ownerUsesAdmin ? expectedAdminPassword : env.OWNER_DASHBOARD_PASSWORD?.trim();
  const ownerConfigured = ownerCredentialsAreUsable(env);

  const isOwnerLogin = Boolean(
    ownerConfigured &&
    ownerUser &&
    ownerPassword &&
    username === (ownerUsesAdmin ? expectedAdminUser : ownerUser) &&
    password === ownerPassword
  );
  const isAdminLogin = Boolean(expectedAdminPassword && username === expectedAdminUser && password === expectedAdminPassword);
  const role: AdminRole | null = isOwnerLogin ? "owner" : isAdminLogin ? "admin" : null;

  if (!role || !sessionSecret) {
    await recordLoginFailure(env, clientKey, now);
    return new Response(loginHtml("Invalid admin credentials."), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  await clearLoginFailures(env, clientKey);
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = base64UrlEncode(new TextEncoder().encode(`${username}|${role}|${expires}`));
  const signingSecret = role === "owner" ? `${sessionSecret}:owner:${ownerPassword}` : sessionSecret;
  const signature = base64UrlEncode(await hmac(signingSecret, payload));
  const token = `${payload}.${signature}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: role === "owner" ? "/admin/intelligence" : "/admin",
      "set-cookie": `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      "cache-control": "no-store",
    },
  });
}

export function clearAdminSession(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/admin/login",
      "set-cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      "cache-control": "no-store",
    },
  });
}

export function loginHtml(error = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>परमार्थAI Admin Login</title><style>${baseCss()}</style></head><body><main class="login"><section class="card"><h1>परमार्थAI Admin</h1><p class="muted">Private operations dashboard</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}<form method="post" action="/admin/login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></section></main></body></html>`;
}

function baseCss(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;background:#f3f6fb}*{box-sizing:border-box}body{margin:0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 8px 30px rgba(15,23,42,.06)}.login{min-height:100vh;display:grid;place-items:center;padding:24px}.login .card{width:min(420px,100%);padding:30px}h1{margin:0 0 6px}label{display:block;font-weight:600;margin-top:18px}input{display:block;width:100%;padding:12px 13px;margin-top:7px;border:1px solid #d1d5db;border-radius:10px;font:inherit}button{border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer;background:#111827;color:#fff;margin-top:22px;width:100%}.muted{color:#6b7280}.error{background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px 12px;margin-top:16px}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" } as Record<string, string>)[char] ?? char);
}
