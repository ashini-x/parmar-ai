import { ensureAnalyticsSchema } from "../analytics/db";
import type { Env } from "../config/env";

export const LEGACY_TELEGRAM_BOT_CONNECTION_ID = "legacy-env";

export interface TelegramBotConnection {
  connectionId: string;
  botId: number;
  username: string | null;
  firstName: string | null;
  token: string;
  webhookSecret: string;
  status: "active" | "disconnected";
  connectedAt: number;
  lastVerifiedAt: number | null;
  disconnectedAt: number | null;
}

interface TelegramBotRow {
  bot_connection_id: string;
  bot_id: number;
  username: string | null;
  first_name: string | null;
  token_ciphertext: string;
  webhook_secret_ciphertext: string;
  status: "active" | "disconnected";
  connected_at: number;
  last_verified_at: number | null;
  disconnected_at: number | null;
}

export async function getActiveTelegramBot(env: Env): Promise<TelegramBotConnection | null> {
  if (!env.DB) return null;
  await ensureTelegramBotSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM telegram_bots WHERE status='active' ORDER BY connected_at DESC LIMIT 1`,
  ).first<TelegramBotRow>();
  return row ? decryptRow(env, row) : null;
}

export async function getTelegramBotByConnectionId(
  env: Env,
  connectionId: string,
): Promise<TelegramBotConnection | null> {
  if (connectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) {
    const active = await getActiveTelegramBot(env);
    if (active?.connectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) return active;
    return null;
  }

  if (!env.DB) return null;
  await ensureTelegramBotSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM telegram_bots WHERE bot_connection_id=? LIMIT 1`,
  ).bind(connectionId).first<TelegramBotRow>();
  return row ? decryptRow(env, row) : null;
}

export async function getTelegramBotByBotId(
  env: Env,
  botId: number,
): Promise<TelegramBotConnection | null> {
  if (!env.DB) return null;
  await ensureTelegramBotSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM telegram_bots WHERE bot_id=? LIMIT 1`,
  ).bind(botId).first<TelegramBotRow>();
  return row ? decryptRow(env, row) : null;
}

export async function findTelegramBotByWebhookSecret(
  env: Env,
  secret: string,
): Promise<TelegramBotConnection | null> {
  if (!env.DB || !secret.trim()) return null;
  await ensureTelegramBotSchema(env);
  const secretHash = await sha256Hex(secret.trim());
  const row = await env.DB.prepare(
    `SELECT * FROM telegram_bots WHERE webhook_secret_hash=? LIMIT 1`,
  ).bind(secretHash).first<TelegramBotRow & { webhook_secret_hash: string }>();
  return row ? decryptRow(env, row) : null;
}

export async function saveTelegramBot(
  env: Env,
  input: {
    connectionId: string;
    botId: number;
    username?: string | null;
    firstName?: string | null;
    token: string;
    webhookSecret: string;
    status: "active" | "disconnected";
    connectedAt?: number;
    lastVerifiedAt?: number | null;
    disconnectedAt?: number | null;
  },
): Promise<TelegramBotConnection> {
  if (!env.DB) throw new Error("D1 is required for Telegram bot connections.");
  await ensureTelegramBotSchema(env);

  const now = Date.now();
  const connectedAt = input.connectedAt ?? now;
  const encryptedToken = await encryptString(env, input.token.trim());
  const encryptedSecret = await encryptString(env, input.webhookSecret.trim());
  const secretHash = await sha256Hex(input.webhookSecret.trim());

  await env.DB.prepare(
    `INSERT INTO telegram_bots
      (bot_connection_id, bot_id, username, first_name, token_ciphertext, webhook_secret_ciphertext,
       webhook_secret_hash, status, connected_at, last_verified_at, disconnected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(bot_connection_id) DO UPDATE SET
       bot_id=excluded.bot_id,
       username=excluded.username,
       first_name=excluded.first_name,
       token_ciphertext=excluded.token_ciphertext,
       webhook_secret_ciphertext=excluded.webhook_secret_ciphertext,
       webhook_secret_hash=excluded.webhook_secret_hash,
       status=excluded.status,
       connected_at=excluded.connected_at,
       last_verified_at=excluded.last_verified_at,
       disconnected_at=excluded.disconnected_at`,
  ).bind(
    input.connectionId,
    input.botId,
    input.username ?? null,
    input.firstName ?? null,
    encryptedToken,
    encryptedSecret,
    secretHash,
    input.status,
    connectedAt,
    input.lastVerifiedAt ?? now,
    input.disconnectedAt ?? (input.status === "disconnected" ? now : null),
  ).run();

  const saved = await getTelegramBotByConnectionId(env, input.connectionId);
  if (!saved) throw new Error("Telegram bot connection could not be verified after saving.");
  if (saved.botId !== input.botId || saved.status !== input.status || saved.token !== input.token.trim()) {
    throw new Error("Telegram bot connection verification failed.");
  }
  return saved;
}

export async function markTelegramBotDisconnected(
  env: Env,
  connectionId: string,
  reason: string,
): Promise<void> {
  if (!env.DB || !connectionId) return;
  await ensureTelegramBotSchema(env);
  const result = await env.DB.prepare(
    `UPDATE telegram_bots
     SET status='disconnected', disconnected_at=?, last_verified_at=COALESCE(last_verified_at,?)
     WHERE bot_connection_id=?`,
  ).bind(Date.now(), Date.now(), connectionId).run();
  if (!result.success) throw new Error("Telegram bot disconnect could not be recorded.");
  await env.DB.prepare(
    `INSERT INTO events (telegram_user_id, chat_id, event_type, event_at, metadata_json)
     VALUES (NULL, NULL, 'telegram_bot_disconnected', ?, ?)`,
  ).bind(Date.now(), JSON.stringify({ connectionId, reason: reason.slice(0, 300) })).run();
}

export async function markTelegramBotVerified(env: Env, connectionId: string): Promise<void> {
  if (!env.DB) return;
  await ensureTelegramBotSchema(env);
  const result = await env.DB.prepare(
    `UPDATE telegram_bots SET last_verified_at=?, disconnected_at=NULL WHERE bot_connection_id=?`,
  ).bind(Date.now(), connectionId).run();
  if (!result.success) throw new Error("Telegram bot verification timestamp could not be saved.");
}

export async function listTelegramBots(env: Env): Promise<TelegramBotConnection[]> {
  if (!env.DB) return [];
  await ensureTelegramBotSchema(env);
  const result = await env.DB.prepare(
    `SELECT * FROM telegram_bots ORDER BY connected_at DESC LIMIT 25`,
  ).all<TelegramBotRow>();
  return (result.results ?? []).map((row) => decryptRow(env, row));
}

export async function isTelegramBotConnectionActive(
  env: Env,
  connectionId: string,
): Promise<boolean> {
  if (connectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID) {
    const active = await getActiveTelegramBot(env);
    return Boolean(active?.connectionId === LEGACY_TELEGRAM_BOT_CONNECTION_ID);
  }
  if (!env.DB) return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);
  await ensureTelegramBotSchema(env);
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM telegram_bots WHERE bot_connection_id=? AND status='active' LIMIT 1`,
  ).bind(connectionId).first();
  return Boolean(row);
}

export async function getTelegramEncryptionStatus(env: Env): Promise<{
  configured: boolean;
  source: "TELEGRAM_BOT_ENCRYPTION_KEY" | "ADMIN_SESSION_SECRET" | "missing";
}> {
  if (env.TELEGRAM_BOT_ENCRYPTION_KEY?.trim()) {
    return { configured: true, source: "TELEGRAM_BOT_ENCRYPTION_KEY" };
  }
  if (env.ADMIN_SESSION_SECRET?.trim()) {
    return { configured: true, source: "ADMIN_SESSION_SECRET" };
  }
  return { configured: false, source: "missing" };
}

export async function ensureTelegramBotSchema(env: Env): Promise<void> {
  await ensureAnalyticsSchema(env);
}

function encryptionSecret(env: Env): string {
  const secret = env.TELEGRAM_BOT_ENCRYPTION_KEY?.trim() || env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("Telegram bot encryption is not configured. Set TELEGRAM_BOT_ENCRYPTION_KEY (recommended) or ADMIN_SESSION_SECRET.");
  }
  return secret;
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret(env)));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptString(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(env),
    new TextEncoder().encode(plaintext),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptString(env: Env, value: string): Promise<string> {
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported Telegram secret format.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parts[1]) },
    await aesKey(env),
    base64ToBytes(parts[2]),
  );
  return new TextDecoder().decode(plaintext);
}

function decryptRow(env: Env, row: TelegramBotRow): TelegramBotConnection {
  throw new Error("decryptRow must be awaited through decryptRowAsync.");
}

async function decryptRowAsync(env: Env, row: TelegramBotRow): Promise<TelegramBotConnection> {
  return {
    connectionId: row.bot_connection_id,
    botId: Number(row.bot_id),
    username: row.username,
    firstName: row.first_name,
    token: await decryptString(env, row.token_ciphertext),
    webhookSecret: await decryptString(env, row.webhook_secret_ciphertext),
    status: row.status,
    connectedAt: Number(row.connected_at),
    lastVerifiedAt: row.last_verified_at === null ? null : Number(row.last_verified_at),
    disconnectedAt: row.disconnected_at === null ? null : Number(row.disconnected_at),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
