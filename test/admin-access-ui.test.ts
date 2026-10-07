import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("admin access UI", () => {
  const source = readFileSync(resolve(process.cwd(), "src/admin/dashboard.ts"), "utf8");

  it("passes explicit action strings from student controls", () => {
    expect(source).toContain('JSON.stringify(Number(u.unlimited)?\'revoke_unlimited\':\'grant_unlimited\')');
    expect(source).toContain('JSON.stringify(Number(u.suspended)?\'unsuspend\':\'suspend\')');
  });

  it("recognizes owner, admin and static-unlimited identities in the directory", () => {
    expect(source).toContain("const staticUnlimitedIds = parseIdSet(env.UNLIMITED_AI_TELEGRAM_USER_IDS);");
    expect(source).toContain("isOwner || isAdmin || staticUnlimited || Number(user.unlimited) === 1");
  });

  it("subscribes Telegram webhooks to poll answers for native quizzes", () => {
    expect(source).toContain('allowed_updates: ["message", "poll_answer"]');
  });

  it("protects owner/admin rows from suspend or access mutation in the UI", () => {
    expect(source).toContain("const isProtected=Number(u.is_owner)||Number(u.is_admin);");
    expect(source).toContain("Protected admin account");
  });
});
