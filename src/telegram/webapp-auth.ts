export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: TelegramWebAppUser;
  authDate: number;
}

function stringToArrayBuffer(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function hmacSha256(
  keyBytes: ArrayBuffer,
  message: string
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  return crypto.subtle.sign(
    "HMAC",
    key,
    stringToArrayBuffer(message)
  );
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600
): Promise<ValidatedInitData> {
  if (!initData.trim()) {
    throw new Error("telegram_init_data_missing");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("telegram_init_data_hash_missing");
  }

  params.delete("hash");

  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    entries.push([key, value]);
  });

  const dataCheckString = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmacSha256(
    stringToArrayBuffer("WebAppData"),
    botToken
  );

  const calculatedHash = bytesToHex(
    await hmacSha256(secretKey, dataCheckString)
  );

  if (!safeEqualHex(calculatedHash, receivedHash)) {
    throw new Error("telegram_init_data_invalid");
  }

  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error("telegram_auth_date_invalid");
  }

  const age = Math.floor(Date.now() / 1000) - authDate;

  if (age < -60 || age > maxAgeSeconds) {
    throw new Error("telegram_init_data_expired");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("telegram_user_missing");
  }

  let user: TelegramWebAppUser;

  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new Error("telegram_user_invalid");
  }

  if (!user || typeof user.id !== "number") {
    throw new Error("telegram_user_invalid");
  }

  return {
    user,
    authDate
  };
}
