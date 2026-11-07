import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import { getGoogleAccessToken, invalidateGoogleAccessToken } from "../src/auth/google";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function createPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return [
    "-----BEGIN PRIVATE KEY-----",
    bytesToBase64(new Uint8Array(der)),
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

describe("Google service-account OAuth cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a valid token and refreshes only when that exact token is rejected", async () => {
    const privateKey = await createPrivateKeyPem();
    let issued = 0;
    const fetchMock = vi.fn(async () => {
      issued += 1;
      return new Response(JSON.stringify({
        access_token: `access-token-${issued}`,
        expires_in: 3_600,
        token_type: "Bearer",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      GCP_CLIENT_EMAIL: "parmar-worker@example.iam.gserviceaccount.com",
      GCP_PRIVATE_KEY: privateKey,
      GCP_PRIVATE_KEY_ID: "test-key",
    } as unknown as Env;

    const first = await getGoogleAccessToken(env);
    const second = await getGoogleAccessToken(env);
    expect(first).toBe("access-token-1");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A stale request must not invalidate a newer credential.
    invalidateGoogleAccessToken("some-older-token");
    expect(await getGoogleAccessToken(env)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateGoogleAccessToken(first);
    const refreshed = await getGoogleAccessToken(env);
    expect(refreshed).toBe("access-token-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The refreshed credential is now cached as usual.
    expect(await getGoogleAccessToken(env)).toBe(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    invalidateGoogleAccessToken(refreshed);
  });
});
