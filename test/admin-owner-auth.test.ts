import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import { getAdminSessionRole, handleAdminLogin, requireAdmin, requireOwner } from "../src/admin/auth";

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    OWNER_DASHBOARD_USER: "owner",
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_SESSION_SECRET: "test-session-signing-secret",
    ...overrides,
  } as Env;
}

async function login(username: string, password: string, env: Env): Promise<{ response: Response; cookie: string }> {
  const body = new FormData();
  body.set("username", username);
  body.set("password", password);
  const response = await handleAdminLogin(new Request("https://parmar-ai.test/admin/login", {
    method: "POST",
    body,
    headers: { "CF-Connecting-IP": "192.0.2.10" },
  }), env);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { response, cookie };
}

describe("admin and Owner web identity", () => {
  it("issues a separate Owner session through the existing sign-in endpoint", async () => {
    const env = testEnv();
    const result = await login("owner", "owner-test-password", env);

    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("location")).toBe("/admin/intelligence");
    expect(result.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(result.response.headers.get("set-cookie")).toContain("Secure");
    expect(result.response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(result.cookie).toBeTruthy();
  });

  it("allows Owner sessions through admin routes but only Owner sessions through the Intelligence guard", async () => {
    const env = testEnv();
    const owner = await login("owner", "owner-test-password", env);
    const request = new Request("https://parmar-ai.test/admin/intelligence", {
      headers: { Cookie: owner.cookie },
    });

    expect(await getAdminSessionRole(request, env)).toBe("owner");
    expect(await requireAdmin(request, env)).toBe(true);
    expect(await requireOwner(request, env)).toBe(true);
  });

  it("keeps ordinary administrator sessions out of the Owner workspace", async () => {
    const env = testEnv();
    const admin = await login("admin", "admin-test-password", env);
    const request = new Request("https://parmar-ai.test/admin/intelligence", {
      headers: { Cookie: admin.cookie },
    });

    expect(admin.response.headers.get("location")).toBe("/admin");
    expect(await getAdminSessionRole(request, env)).toBe("admin");
    expect(await requireAdmin(request, env)).toBe(true);
    expect(await requireOwner(request, env)).toBe(false);
  });

  it("does not issue Owner access when separate Owner credentials are not configured", async () => {
    const env = testEnv({ OWNER_DASHBOARD_USER: undefined, OWNER_DASHBOARD_PASSWORD: undefined });
    const result = await login("owner", "owner-test-password", env);
    expect(result.response.status).toBe(401);
    expect(result.cookie).toBe("");
  });

  it("revokes existing Owner sessions when the Owner password is rotated", async () => {
    const env = testEnv();
    const owner = await login("owner", "owner-test-password", env);
    const request = new Request("https://parmar-ai.test/admin/intelligence", {
      headers: { Cookie: owner.cookie },
    });

    expect(await requireOwner(request, env)).toBe(true);
    const rotated = testEnv({ OWNER_DASHBOARD_PASSWORD: "rotated-owner-password" });
    expect(await requireOwner(request, rotated)).toBe(false);
  });

  it("does not allow the Owner username to collide with the admin username", async () => {
    const env = testEnv({
      OWNER_DASHBOARD_USER: "ADMIN",
      OWNER_DASHBOARD_PASSWORD: "separate-owner-password",
    });
    const owner = await login("ADMIN", "separate-owner-password", env);
    expect(owner.response.status).toBe(401);
    expect(await requireOwner(new Request("https://parmar-ai.test/admin/intelligence", {
      headers: { Cookie: owner.cookie },
    }), env)).toBe(false);
  });

  it("does not allow a browser-edited role claim to become Owner", async () => {
    const env = testEnv();
    const admin = await login("admin", "admin-test-password", env);
    const token = admin.cookie.slice("parmar_admin_session=".length);
    const [payload, signature] = token.split(".");
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    const modifiedPayload = btoa(decoded.replace("|admin|", "|owner|"))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const tamperedCookie = `parmar_admin_session=${modifiedPayload}.${signature}`;
    const request = new Request("https://parmar-ai.test/admin/intelligence", {
      headers: { Cookie: tamperedCookie },
    });

    expect(await requireOwner(request, env)).toBe(false);
    expect(await getAdminSessionRole(request, env)).toBe(null);
  });
});
