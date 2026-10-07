import type { Env } from "../config/env";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_TIMEOUT_MS = 8_000;
const ASSERTION_LIFETIME_SECONDS = 3_600;
const TOKEN_SAFETY_WINDOW_MS = 90_000;
const TOKEN_MAX_ATTEMPTS = 3;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let tokenRefreshPromise: Promise<string> | null = null;

export class GoogleAuthError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "GoogleAuthError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function getGoogleAccessToken(env: Env): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = issueAccessToken(env).finally(() => {
    tokenRefreshPromise = null;
  });

  return tokenRefreshPromise;
}

async function issueAccessToken(env: Env): Promise<string> {
  const clientEmail = env.GCP_CLIENT_EMAIL?.trim();
  const privateKey = env.GCP_PRIVATE_KEY?.trim();
  const privateKeyId = env.GCP_PRIVATE_KEY_ID?.trim();

  if (!clientEmail || !privateKey) {
    throw new GoogleAuthError(
      "Google Cloud service account credentials are not configured.",
    );
  }

  let lastError: GoogleAuthError | null = null;

  for (let attempt = 1; attempt <= TOKEN_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await issueAccessTokenOnce(clientEmail, privateKey, privateKeyId);
    } catch (error) {
      const authError = toGoogleAuthError(error);
      lastError = authError;

      if (!authError.retryable || attempt >= TOKEN_MAX_ATTEMPTS) {
        throw authError;
      }

      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new GoogleAuthError("Google OAuth token request failed.", undefined, true);
}

async function issueAccessTokenOnce(
  clientEmail: string,
  privateKey: string,
  privateKeyId?: string,
): Promise<string> {
  const assertion = await createServiceAccountAssertion({
    clientEmail,
    privateKey,
    privateKeyId,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: GoogleTokenResponse;

    try {
      data = JSON.parse(raw) as GoogleTokenResponse;
    } catch {
      throw new GoogleAuthError(
        `Google OAuth returned invalid JSON (HTTP ${response.status}).`,
        response.status,
        isRetryableStatus(response.status),
      );
    }

    if (!response.ok || !data.access_token) {
      throw new GoogleAuthError(
        data.error_description ??
          data.error ??
          `Google OAuth token request failed (HTTP ${response.status}).`,
        response.status,
        isRetryableStatus(response.status),
      );
    }

    const expiresInSeconds =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : 3_600;

    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(1_000, expiresInSeconds * 1_000 - TOKEN_SAFETY_WINDOW_MS),
    };

    return data.access_token;
  } catch (error) {
    throw toGoogleAuthError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function createServiceAccountAssertion(input: {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
}): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + ASSERTION_LIFETIME_SECONDS;

  const header: Record<string, string> = {
    alg: "RS256",
    typ: "JWT",
  };

  if (input.privateKeyId) {
    header.kid = input.privateKeyId;
  }

  const payload = {
    iss: input.clientEmail,
    scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(input.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  const normalized = privateKey.replace(/\\n/g, "\n").trim();
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/,
  );

  if (!match) {
    throw new GoogleAuthError(
      "GCP_PRIVATE_KEY is not a valid PKCS#8 PEM private key.",
    );
  }

  const der = base64ToBytes(match[1].replace(/\s+/g, ""));

  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der.slice().buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new GoogleAuthError(
      "GCP_PRIVATE_KEY could not be imported by Web Crypto.",
    );
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toGoogleAuthError(error: unknown): GoogleAuthError {
  if (error instanceof GoogleAuthError) return error;

  if (error instanceof Error && error.name === "AbortError") {
    return new GoogleAuthError(
      `Google OAuth timed out after ${TOKEN_TIMEOUT_MS}ms.`,
      undefined,
      true,
    );
  }

  return new GoogleAuthError(
    error instanceof Error ? error.message : String(error),
    undefined,
    true,
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
