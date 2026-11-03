import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { brvinAdminScript } from "../src/brvin/admin";
import { readFileSync } from "node:fs";

describe("BRVIN browser script contract", () => {
  it("exposes an authenticated read-only storage diagnostic without mutating GCS objects", () => {
    const importSource = readFileSync(new URL("../src/fatman/import.ts", import.meta.url), "utf8");
    const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(importSource).toContain("export async function diagnoseFatmanGcsUpload");
    expect(importSource).toContain("storage.objects.create");
    expect(importSource).toContain("storage.objects.delete");
    expect(importSource).toContain("Does not create, overwrite, or delete any GCS objects.");
    expect(workerSource).toContain("/admin/api/brvin/diagnostics/storage");
    expect(workerSource).toContain("x-brvin-diagnostic-token");
    expect(workerSource).toContain("if (!tokenAuthorized && !(await requireAdmin(request, env)))");
    expect(workerSource).toContain("diagnoseFatmanGcsUpload(env)");
  });

  it("serves JavaScript that parses before delivery to browsers", async () => {
    const script = await brvinAdminScript().text();
    const parsed = ts.createSourceFile(
      "brvin-app.js",
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };

    if (parsed.parseDiagnostics.length) {
      const diagnostic = parsed.parseDiagnostics[0];
      const position = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const lines = script.split("\n");
      const excerpt = lines
        .slice(Math.max(0, position.line - 2), position.line + 3)
        .map((line, index) => (Math.max(0, position.line - 2) + index + 1) + ": " + line)
        .join("\n");
      throw new Error(
        "Generated BRVIN script syntax error at " + (position.line + 1) + ":" +
        (position.character + 1) + ": " +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") + "\n" + excerpt,
      );
    }

    expect(parsed.parseDiagnostics).toHaveLength(0);
  });
});
