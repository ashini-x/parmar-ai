import { describe, expect, it } from "vitest";
import {
  BRVIN_TEACHER_MANAGEMENT_METADATA_MIGRATION_KEY,
  ensureBrvinTeacherManagementMetadataSchema,
} from "../src/analytics/db";
import {
  hierarchicalReference,
  isValidBrvinTeachersTenantReference,
} from "../src/brvin/teachers-management";

class ManagementMetadataStatement {
  private values: unknown[] = [];
  constructor(private readonly db: ManagementMetadataDb, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>(): Promise<{ results: T[] }> {
    const match = this.sql.match(/^PRAGMA table_info\((brvin_projects|brvin_collections|brvin_books)\)$/u);
    if (!match) return { results: [] };
    return {
      results: [...(this.db.columns.get(match[1]) ?? new Set<string>())].map(name => ({ name })) as T[],
    };
  }
  async run(): Promise<{ success: boolean }> {
    const alter = this.sql.match(/^ALTER TABLE (brvin_projects|brvin_collections|brvin_books) ADD COLUMN ([a-z_]+)/u);
    if (alter) {
      const columns = this.db.columns.get(alter[1]) ?? new Set<string>();
      if (columns.has(alter[2])) throw new Error("duplicate column name: " + alter[2]);
      columns.add(alter[2]);
      this.db.columns.set(alter[1], columns);
      this.db.alters.push(alter[1] + "." + alter[2]);
    }
    if (this.sql.startsWith("INSERT OR IGNORE INTO brvin_migrations")) {
      this.db.migrations.add(String(this.values[0]));
    }
    return { success: true };
  }
}

class ManagementMetadataDb {
  columns = new Map<string, Set<string>>([
    ["brvin_projects", new Set(["id", "name", "slug", "description", "status"])],
    ["brvin_collections", new Set(["id", "name", "description", "status"])],
    ["brvin_books", new Set(["id", "title", "collection_id", "status"])],
  ]);
  migrations = new Set<string>();
  alters: string[] = [];
  statements: string[] = [];
  prepare(sql: string) { this.statements.push(sql); return new ManagementMetadataStatement(this, sql); }
  async batch(statements: ManagementMetadataStatement[]) {
    for (const statement of statements) await statement.run();
    return [];
  }
}

describe("BRVIN Teachers hierarchical knowledge references", () => {
  it("accepts the tenant reference format and rejects arbitrary input", () => {
    expect(isValidBrvinTeachersTenantReference("TCH-000001")).toBe(true);
    expect(isValidBrvinTeachersTenantReference("TCH-1000000")).toBe(true);
    expect(isValidBrvinTeachersTenantReference("TCH-1")).toBe(false);
    expect(isValidBrvinTeachersTenantReference("tch-000001")).toBe(false);
    expect(isValidBrvinTeachersTenantReference("TCH-000001-PRJ-001")).toBe(false);
  });

  it("formats each child reference beneath its parent and grows past 999", () => {
    expect(hierarchicalReference("TCH-000001", "PRJ", 1)).toBe("TCH-000001-PRJ-001");
    expect(hierarchicalReference("TCH-000001-PRJ-001", "COL", 12)).toBe("TCH-000001-PRJ-001-COL-012");
    expect(hierarchicalReference("TCH-000001-PRJ-001-COL-001", "SRC", 1000)).toBe("TCH-000001-PRJ-001-COL-001-SRC-1000");
    expect(() => hierarchicalReference("TCH-000001", "PRJ", 0)).toThrow();
  });
});

describe("BRVIN Teachers ownership/reference schema migration", () => {
  it("adds ownership, origin and human-reference metadata without replacing existing IDs", async () => {
    const db = new ManagementMetadataDb();
    await ensureBrvinTeacherManagementMetadataSchema(db as never);
    expect(db.columns.get("brvin_projects")).toEqual(expect.objectContaining(new Set([
      "owner_application_id", "owner_tenant_ref", "project_ref", "management_request_id", "subject", "management_request_hash",
    ])));
    expect(db.columns.get("brvin_collections")?.has("origin_project_id")).toBe(true);
    expect(db.columns.get("brvin_collections")?.has("collection_ref")).toBe(true);
    expect(db.columns.get("brvin_books")?.has("origin_collection_id")).toBe(true);
    expect(db.columns.get("brvin_books")?.has("source_ref")).toBe(true);
    expect(db.statements.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS brvin_reference_sequences"))).toBe(true);
    expect(db.migrations.has(BRVIN_TEACHER_MANAGEMENT_METADATA_MIGRATION_KEY)).toBe(true);
  });

  it("is idempotent for an already-upgraded database", async () => {
    const db = new ManagementMetadataDb();
    await ensureBrvinTeacherManagementMetadataSchema(db as never);
    db.alters.length = 0;
    await ensureBrvinTeacherManagementMetadataSchema(db as never);
    expect(db.alters).toHaveLength(0);
  });
});
