import { describe, expect, it } from "vitest";
import { BRVIN_OWNER_METADATA_MIGRATION_KEY, ensureBrvinOwnerMetadataSchema } from "../src/analytics/db";

class OwnerMetadataStatement {
  private values: unknown[] = [];
  constructor(private readonly db: OwnerMetadataDb, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>(): Promise<{ results: T[] }> {
    const match = this.sql.match(/^PRAGMA table_info\((brvin_projects|brvin_applications)\)$/u);
    if (match) return {
      results: [...(this.db.columns.get(match[1]) ?? new Set<string>())].map(name => ({ name })) as T[],
    };
    return { results: [] };
  }
  async run(): Promise<{ success: boolean }> {
    const alter = this.sql.match(/^ALTER TABLE (brvin_projects|brvin_applications) ADD COLUMN owner_label/u);
    if (alter) {
      const columns = this.db.columns.get(alter[1]) ?? new Set<string>();
      if (columns.has("owner_label")) throw new Error("duplicate column name: owner_label");
      columns.add("owner_label");
      this.db.columns.set(alter[1], columns);
      this.db.alters.push(alter[1]);
    }
    if (this.sql.startsWith("INSERT OR IGNORE INTO brvin_migrations")) {
      this.db.migrations.add(String(this.values[0]));
    }
    return { success: true };
  }
}

class OwnerMetadataDb {
  columns = new Map<string, Set<string>>([
    ["brvin_projects", new Set(["id", "name", "slug", "description", "status"])],
    ["brvin_applications", new Set(["id", "name", "slug", "description", "status"])],
  ]);
  migrations = new Set<string>();
  alters: string[] = [];
  prepare(sql: string) { return new OwnerMetadataStatement(this, sql); }
}

describe("BRVIN teacher/owner metadata migration", () => {
  it("adds owner labels to existing projects and applications and records the migration", async () => {
    const db = new OwnerMetadataDb();
    await ensureBrvinOwnerMetadataSchema(db as never);
    expect(db.columns.get("brvin_projects")?.has("owner_label")).toBe(true);
    expect(db.columns.get("brvin_applications")?.has("owner_label")).toBe(true);
    expect(db.alters).toEqual(["brvin_projects", "brvin_applications"]);
    expect(db.migrations.has(BRVIN_OWNER_METADATA_MIGRATION_KEY)).toBe(true);
  });

  it("is idempotent when owner label columns already exist", async () => {
    const db = new OwnerMetadataDb();
    db.columns.get("brvin_projects")?.add("owner_label");
    db.columns.get("brvin_applications")?.add("owner_label");
    await ensureBrvinOwnerMetadataSchema(db as never);
    await ensureBrvinOwnerMetadataSchema(db as never);
    expect(db.alters).toHaveLength(0);
    expect(db.migrations.has(BRVIN_OWNER_METADATA_MIGRATION_KEY)).toBe(true);
  });
});
