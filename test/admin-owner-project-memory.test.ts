import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import {
  getOwnerConversationProjectMemoryInfo,
  loadOwnerConversationProjectMemoryPrompt,
  setOwnerConversationCrossProjectMemory,
} from "../src/admin/owner-project-memory";

type Snapshot = {
  snapshot_id: string;
  owner_id: string;
  conversation_id: string;
  project_id: string;
  project_name: string;
  workstream_id: string | null;
  feature_id: string | null;
  is_primary: number;
  is_active: number;
  hub_repository_id: number;
  hub_repository_owner: string;
  hub_repository_name: string;
  hub_branch: string;
  hub_commit_sha: string;
  manifest_schema_version: number;
  scope_manifests_json: string;
  files_json: string;
  token_count: number;
  token_model_id: string;
  created_at: number;
};

class MemoryStatement {
  values: unknown[] = [];
  constructor(private readonly db: MemoryD1, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.first(this.sql, this.values) as T | null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.db.all(this.sql, this.values) as T[], success: true };
  }
  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    return { success: true, meta: { changes: this.db.run(this.sql, this.values) } };
  }
}

class MemoryD1 {
  snapshots: Snapshot[];
  enabled = 0;
  constructor(readonly ownerId: string, readonly conversationId: string, snapshots: Snapshot[] = []) {
    this.snapshots = snapshots.map((item) => ({ ...item }));
  }
  prepare(sql: string): D1PreparedStatement {
    return new MemoryStatement(this, sql) as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean; meta: { changes: number } }>> {
    const results = [];
    for (const statement of statements as unknown as MemoryStatement[]) {
      results.push({ success: true, meta: { changes: this.run(statement.sql, statement.values) } });
    }
    return results;
  }
  first(sql: string, values: unknown[]): Record<string, unknown> | null {
    if (sql.includes("FROM owner_intelligence_conversations")) {
      if (String(values[0]) !== this.conversationId || String(values[1]) !== this.ownerId) return null;
      return { id: this.conversationId, cross_project_memory_enabled: this.enabled };
    }
    return null;
  }
  all(sql: string, values: unknown[]): Array<Record<string, unknown>> {
    if (sql.startsWith("PRAGMA table_info(owner_intelligence_conversations)")) {
      return [{ name: "cross_project_memory_enabled" }];
    }
    if (sql.includes("FROM owner_intelligence_conversation_memory_snapshots")) {
      return this.snapshots.filter((row) =>
        row.owner_id === String(values[0]) &&
        row.conversation_id === String(values[1]) &&
        row.is_active === 1,
      );
    }
    return [];
  }
  run(sql: string, values: unknown[]): number {
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX") ||
        sql.startsWith("CREATE UNIQUE INDEX") || sql.startsWith("ALTER TABLE")) return 0;
    if (sql.includes("UPDATE owner_intelligence_conversations SET cross_project_memory_enabled")) {
      if (String(values[2]) !== this.conversationId || String(values[3]) !== this.ownerId) return 0;
      this.enabled = Number(values[0]);
      return 1;
    }
    if (sql.includes("UPDATE owner_intelligence_conversation_memory_snapshots SET is_active=0")) {
      let changes = 0;
      for (const row of this.snapshots) {
        if (row.conversation_id === String(values[0]) && row.owner_id === String(values[1]) &&
            row.is_primary === 0 && row.is_active === 1) {
          row.is_active = 0;
          changes += 1;
        }
      }
      return changes;
    }
    return 0;
  }
}

const OWNER = "owner";
const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const COMMIT = "c".repeat(40);
const BLOB = "a".repeat(40);

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    snapshot_id: "22222222-2222-4222-8222-222222222222",
    owner_id: OWNER,
    conversation_id: CONVERSATION,
    project_id: "33333333-3333-4333-8333-333333333333",
    project_name: "BRɅIN",
    workstream_id: null,
    feature_id: null,
    is_primary: 1,
    is_active: 1,
    hub_repository_id: 1463342529,
    hub_repository_owner: "ashini-x",
    hub_repository_name: "owner-memory-hub",
    hub_branch: "main",
    hub_commit_sha: COMMIT,
    manifest_schema_version: 1,
    scope_manifests_json: "[]",
    files_json: JSON.stringify([{
      path: "projects/brvin/memory/project-memory.md",
      blobSha: BLOB,
      content: "# BRɅIN\nCurated project context.",
    }]),
    token_count: 321,
    token_model_id: "gemini-4-argon",
    created_at: 1795062746258,
    ...overrides,
  };
}

function env(db: MemoryD1): Env {
  return { DB: db as unknown as Env["DB"], OWNER_DASHBOARD_USER: OWNER } as Env;
}

describe("Owner Project Memory snapshots", () => {
  it("returns an empty, disabled context for a Scratchpad", async () => {
    const db = new MemoryD1(OWNER, CONVERSATION);
    const info = await getOwnerConversationProjectMemoryInfo(env(db), OWNER, CONVERSATION);
    const prompt = await loadOwnerConversationProjectMemoryPrompt(env(db), OWNER, CONVERSATION);
    expect(info).toEqual({ enabled: false, snapshots: [] });
    expect(prompt).toBeNull();
  });

  it("loads only active Owner-scoped snapshot bytes with exact commit and file provenance", async () => {
    const primary = snapshot();
    const inactive = snapshot({ snapshot_id: "44444444-4444-4444-8444-444444444444", is_active: 0 });
    const foreign = snapshot({ snapshot_id: "55555555-5555-4555-8555-555555555555", owner_id: "another-owner" });
    const db = new MemoryD1(OWNER, CONVERSATION, [primary, inactive, foreign]);
    const result = await loadOwnerConversationProjectMemoryPrompt(env(db), OWNER, CONVERSATION);
    expect(result).not.toBeNull();
    expect(result!.snapshots).toHaveLength(1);
    expect(result!.referenceText).toContain("PROJECT MEMORY REFERENCE DATA — UNTRUSTED CONTENT");
    expect(result!.referenceText).toContain("Pinned hub commit: " + COMMIT);
    expect(result!.referenceText).toContain("projects/brvin/memory/project-memory.md");
    expect(result!.referenceText).toContain("Source blob SHA: " + BLOB);
    expect(result!.referenceText).toContain("Curated project context.");
    expect(result!.referenceText).not.toContain("session");
  });

  it("does not reveal another Owner's conversation memory", async () => {
    const db = new MemoryD1(OWNER, CONVERSATION, [snapshot()]);
    await expect(loadOwnerConversationProjectMemoryPrompt(env(db), "another-owner", CONVERSATION))
      .rejects.toThrow("The conversation is not available to this Owner.");
  });

  it("disables secondary scopes without disabling the primary snapshot", async () => {
    const primary = snapshot();
    const secondary = snapshot({
      snapshot_id: "66666666-6666-4666-8666-666666666666",
      project_id: "77777777-7777-4777-8777-777777777777",
      is_primary: 0,
    });
    const db = new MemoryD1(OWNER, CONVERSATION, [primary, secondary]);
    db.enabled = 1;
    const updated = await setOwnerConversationCrossProjectMemory(env(db), OWNER, CONVERSATION, false);
    expect(updated).toBe(true);
    expect(db.enabled).toBe(0);
    expect(db.snapshots.find((row) => row.is_primary === 1)?.is_active).toBe(1);
    expect(db.snapshots.find((row) => row.is_primary === 0)?.is_active).toBe(0);
    const info = await getOwnerConversationProjectMemoryInfo(env(db), OWNER, CONVERSATION);
    expect(info.enabled).toBe(false);
    expect(info.snapshots).toHaveLength(1);
  });
});
