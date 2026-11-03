import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { brvinAdminScript } from "../src/brvin/admin";

describe("BRVIN browser script contract", () => {
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
