import type { Env } from "./types";
import { Sha256 } from "./sha256";

const GCS_API = "https://storage.googleapis.com";
const VISION_API = "https://vision.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const encoder = new TextEncoder();

export class GoogleServiceError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "GoogleServiceError";
    this.status = status;
    this.retryable = retryable;
  }
}

let tokenCache: { value: string; expiresAt: number } | undefined;
let tokenPromise: Promise<string> | undefined;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

function decodePem(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/gu, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/gu, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getAccessToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const email = env.GCP_CLIENT_EMAIL?.trim();
    const privateKey = env.GCP_PRIVATE_KEY?.trim();
    if (!email || !privateKey) throw new GoogleServiceError("Google Cloud service-account credentials are not configured.", 401);
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", ...(env.GCP_PRIVATE_KEY_ID ? { kid: env.GCP_PRIVATE_KEY_ID } : {}) })));
    const claims = base64Url(encoder.encode(JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })));
    const unsigned = header + "." + claims;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      decodePem(privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
    const assertion = unsigned + "." + base64Url(signature);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) {
      throw new GoogleServiceError(
        payload.error_description ?? payload.error ?? "Google OAuth token exchange failed.",
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    tokenCache = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000 };
    return payload.access_token;
  })().finally(() => { tokenPromise = undefined; });
  return tokenPromise;
}

function bucket(env: Env): string {
  const name = env.VRAIN_GCS_BUCKET?.trim();
  if (!name || name.startsWith("REPLACE_")) throw new GoogleServiceError("VRAIN private Google Cloud Storage bucket is not configured.", 500);
  return name;
}

async function responseError(response: Response, operation: string): Promise<GoogleServiceError> {
  const raw = (await response.text().catch(() => "")).slice(0, 800);
  let detail = raw.replace(/\s+/gu, " ").trim();
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    detail = parsed.error?.message ?? detail;
  } catch { /* Keep bounded response text. */ }
  return new GoogleServiceError(
    detail ? operation + ": " + detail : operation + " (HTTP " + response.status + ").",
    response.status,
    response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
  );
}

export async function createResumableUpload(
  env: Env,
  objectName: string,
  size: number,
  metadata: Record<string, string>,
): Promise<string> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucket(env)) +
      "/o?uploadType=resumable&name=" + encodeURIComponent(objectName),
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": "application/pdf",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name: objectName, metadata }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw await responseError(response, "Could not start the resumable private PDF upload");
  const uri = response.headers.get("location");
  if (!uri || !uri.startsWith("https://")) throw new GoogleServiceError("Google Cloud Storage did not return a secure resumable upload URI.", 502, true);
  return uri;
}

export async function probeUploadSession(uri: string, size: number, token: string): Promise<number> {
  const response = await fetch(uri, {
    method: "PUT",
    headers: { authorization: "Bearer " + token, "content-range": "bytes */" + size },
    body: new Uint8Array(),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 200 || response.status === 201) return size;
  if (response.status !== 308) throw await responseError(response, "Could not inspect the resumable upload offset");
  const match = response.headers.get("range")?.match(/bytes=0-(\d+)/u);
  return match ? Math.min(size, Number(match[1]) + 1) : 0;
}

export async function uploadChunk(
  env: Env,
  uri: string,
  bytes: ArrayBuffer,
  start: number,
  total: number,
): Promise<{ uploadedBytes: number; complete: boolean }> {
  const token = await getAccessToken(env);
  const end = start + bytes.byteLength - 1;
  const response = await fetch(uri, {
    method: "PUT",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/pdf",
      "content-range": "bytes " + start + "-" + end + "/" + total,
    },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 200 || response.status === 201) return { uploadedBytes: total, complete: true };
  if (response.status === 308) {
    const match = response.headers.get("range")?.match(/bytes=0-(\d+)/u);
    return { uploadedBytes: match ? Math.min(total, Number(match[1]) + 1) : 0, complete: false };
  }
  throw await responseError(response, "Google Cloud Storage rejected an upload chunk");
}

export async function getObjectMetadata(env: Env, objectName: string): Promise<{ size: number; contentType?: string }> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName),
    { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw await responseError(response, "Could not inspect the uploaded PDF object");
  const payload = await response.json() as { size?: string; contentType?: string };
  return { size: Number(payload.size ?? 0), contentType: payload.contentType };
}

export async function streamObjectSha256(env: Env, objectName: string): Promise<string> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName) + "?alt=media",
    { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok || !response.body) throw await responseError(response, "Could not stream the source PDF for SHA-256 verification");
  const hash = new Sha256();
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      hash.update(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.hex().toUpperCase();
}

export async function submitVisionPdf(env: Env, sourceObject: string, outputPrefix: string): Promise<string> {
  const token = await getAccessToken(env);
  const response = await fetch(VISION_API + "/files:asyncBatchAnnotate", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      requests: [{
        inputConfig: {
          gcsSource: { uri: "gs://" + bucket(env) + "/" + sourceObject },
          mimeType: "application/pdf",
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        outputConfig: {
          gcsDestination: { uri: "gs://" + bucket(env) + "/" + outputPrefix },
          batchSize: 1,
        },
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await responseError(response, "Google Cloud Vision could not accept the PDF OCR job");
  const payload = await response.json() as { name?: string };
  if (!payload.name) throw new GoogleServiceError("Google Cloud Vision did not return an operation name.", 502, true);
  return payload.name;
}

export async function getVisionOperation(env: Env, operationName: string): Promise<{ done: boolean; error?: string }> {
  const token = await getAccessToken(env);
  const response = await fetch(VISION_API + "/" + operationName, {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await responseError(response, "Could not poll the Google Cloud Vision operation");
  const payload = await response.json() as { done?: boolean; error?: { message?: string } };
  if (payload.error?.message) throw new GoogleServiceError("Google Cloud Vision OCR failed: " + payload.error.message, 422);
  return { done: payload.done === true };
}

export async function listObjects(env: Env, prefix: string): Promise<string[]> {
  const token = await getAccessToken(env);
  const names: string[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ prefix, maxResults: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o?" + query.toString(),
      { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw await responseError(response, "Could not list VRAIN OCR output objects");
    const payload = await response.json() as { items?: Array<{ name: string }>; nextPageToken?: string };
    names.push(...(payload.items ?? []).map((item) => item.name));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return names;
}

export async function readJsonObject<T>(env: Env, objectName: string): Promise<T> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName) + "?alt=media",
    { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw await responseError(response, "Could not read OCR output object");
  return await response.json() as T;
}

export async function uploadTextObject(env: Env, objectName: string, text: string): Promise<void> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/upload/storage/v1/b/" + encodeURIComponent(bucket(env)) +
      "/o?uploadType=media&name=" + encodeURIComponent(objectName),
    {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "text/plain; charset=utf-8" },
      body: text,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw await responseError(response, "Could not persist normalized OCR page text");
}

export async function readTextObject(env: Env, objectName: string): Promise<string> {
  const token = await getAccessToken(env);
  const response = await fetch(
    GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName) + "?alt=media",
    { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw await responseError(response, "Could not read normalized OCR page text");
  return await response.text();
}

export async function deleteObjects(env: Env, objectNames: string[]): Promise<void> {
  const token = await getAccessToken(env);
  for (const objectName of objectNames) {
    const response = await fetch(
      GCS_API + "/storage/v1/b/" + encodeURIComponent(bucket(env)) + "/o/" + encodeURIComponent(objectName),
      { method: "DELETE", headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok && response.status !== 404) throw await responseError(response, "Could not clean up temporary OCR object");
  }
}

export function isRetryableGoogleError(error: unknown): boolean {
  if (error instanceof GoogleServiceError) return error.retryable;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|timeout|timed out|socket|temporarily unavailable|http 429|http 5\d\d/iu.test(message);
}

export function googleRetryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 300);
}
