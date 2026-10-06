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

export async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const password = env.ADMIN_DASHBOARD_PASSWORD?.trim();
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim();
  if (!password || !sessionSecret) return false;

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return false;

  const token = cookie.slice(COOKIE_NAME.length + 1);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(payload));
    const [username, expires] = decoded.split("|");
    if (!username || !expires || Number(expires) < Math.floor(Date.now() / 1000)) return false;
    const expected = await hmac(sessionSecret, payload);
    const actual = base64UrlDecode(signature);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ actual[i];
    return diff === 0 && username === (env.ADMIN_DASHBOARD_USER?.trim() || "admin");
  } catch {
    return false;
  }
}

export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await request.formData();
  const username = String(body.get("username") ?? "").trim();
  const password = String(body.get("password") ?? "");
  const expectedUser = env.ADMIN_DASHBOARD_USER?.trim() || "admin";
  const expectedPassword = env.ADMIN_DASHBOARD_PASSWORD?.trim();
  const sessionSecret = env.ADMIN_SESSION_SECRET?.trim();

  if (!expectedPassword || !sessionSecret || username !== expectedUser || password !== expectedPassword) {
    return new Response(loginHtml("Invalid admin credentials."), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = base64UrlEncode(new TextEncoder().encode(`${expectedUser}|${expires}`));
  const signature = base64UrlEncode(await hmac(sessionSecret, payload));
  const token = `${payload}.${signature}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: "/admin",
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parmar Admin Login</title><style>${baseCss()}</style></head><body><main class="login"><section class="card"><h1>Parmar AI Admin</h1><p class="muted">Private operations dashboard</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}<form method="post" action="/admin/login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></section></main></body></html>`;
}

function baseCss(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;background:#f3f6fb}*{box-sizing:border-box}body{margin:0}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 8px 30px rgba(15,23,42,.06)}.login{min-height:100vh;display:grid;place-items:center;padding:24px}.login .card{width:min(420px,100%);padding:30px}h1{margin:0 0 6px}label{display:block;font-weight:600;margin-top:18px}input{display:block;width:100%;padding:12px 13px;margin-top:7px;border:1px solid #d1d5db;border-radius:10px;font:inherit}button{border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer;background:#111827;color:#fff;margin-top:22px;width:100%}.muted{color:#6b7280}.error{background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px 12px;margin-top:16px}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" } as Record<string, string>)[char] ?? char);
}
