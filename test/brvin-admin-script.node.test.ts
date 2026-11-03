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
    expect(workerSource).toContain("diagnoseFatmanGcsUpload(env)");
    expect(workerSource).not.toContain("x-brvin-diagnostic-token");
    expect(workerSource).not.toContain("BRVIN_DIAGNOSTIC_TOKEN");
    expect(workerSource.match(/adminApiPath === "\/admin\/api\/brvin\/diagnostics\/storage"/gu) ?? []).toHaveLength(1);
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
    const workflowSource = readFileSync(new URL("../src/fatman/workflow.ts", import.meta.url), "utf8");
    const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const wranglerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const envSource = readFileSync(new URL("../src/config/env.ts", import.meta.url), "utf8");
    const adminSource = readFileSync(new URL("../src/brvin/admin.ts", import.meta.url), "utf8");
    const analyticsSource = readFileSync(new URL("../src/analytics/db.ts", import.meta.url), "utf8");
    expect(workflowSource).toContain("const indexed = await instance.items.upload(key, content);");
    expect(workflowSource).not.toContain("metadata: { bookId: job.book_id, bookTitle: title, pdfPage: page }");
    expect(workflowSource).toContain("export async function runBrvinRecoverySupervisor");
    expect(workflowSource).toContain('task !== "parmarbot_test"');
    expect(envSource).toContain('| "parmarbot_test" | "delete_book" | "delete_vision_output";');
    expect(workflowSource).toContain('retrieveFatmanContext(this.env, probe.query)');
    expect(workflowSource).toContain('eventType: "bot.retrieval_test_passed"');
    expect(workflowSource).toContain('eventType: "source.pdf_and_index_retained"');
    expect(workflowSource).toContain("if (importJob.book_id) {");
    expect(workflowSource).toContain("deletion: \"automatic_after_retrieval_qa\"");
    expect(workflowSource).toContain("schedule automatic temporary Vision OCR cleanup after READY");
    expect(workflowSource).toContain("runBrvinVisionRetentionSupervisor");
    expect(workflowSource).toContain("workflow.auto_recovery_started");
    expect(workflowSource).toContain('source_type !== "pdf"');
    expect(workflowSource).toContain('book.status !== "deleting" && book.status !== "delete_failed"');
    expect(workflowSource).toContain('"brvin/books/" + importId + "/pages/"');
    expect(workflowSource).toContain('"brvin/imports/" + importId + "/"');
    expect(workflowSource).toContain('DELETE FROM brvin_project_books WHERE book_id=?');
    expect(workflowSource).toContain('DELETE FROM brvin_books WHERE id=? AND source_type=\'pdf\'');
    expect(workflowSource).toContain('DELETE FROM fatman_import_jobs WHERE id=? AND book_id=?');
    expect(workflowSource).toContain('UPDATE brvin_books SET vision_output_deleted_at=?');
    expect(adminSource).toContain('>Clear all imported books</button>');
    expect(adminSource).toContain('Type exactly DELETE ALL BRVIN BOOKS');
    expect(adminSource).toContain('The built-in 538-page Fatman reference');
    expect(adminSource).toContain('candidate.vision_output_deleted_at');
    expect(analyticsSource).toContain('ALTER TABLE brvin_books ADD COLUMN vision_output_deleted_at INTEGER');
    expect(analyticsSource).toContain('2026-11-04-brvin-vision-output-deleted-at-v1');
    expect(workflowSource).toContain('params.task === "delete_book"');
    expect(workflowSource).toContain('params.task === "delete_vision_output"');
    expect(workflowSource).toContain('deleteFatmanGcsObjectPrefix(this.env, importId, "ocr/")');
    expect(workflowSource).toContain("instance.items.delete(item.id)");
    expect(workflowSource).toContain('eventType: "book.deletion_completed"');
    expect(workflowSource).toContain('eventType: "book.deletion_failed"');
    expect(workflowSource).toContain('eventType: "source.vision_ocr_deleted"');
    expect(workflowSource).toContain("vision_output_deletion_started_at");
    expect(workflowSource).toContain("vision_output_deleted_at=?");
    expect(adminSource).toContain("visionOcrDeleting");
    expect(adminSource).toContain("candidate.vision_output_deletion_started_at");
    expect(analyticsSource).toContain("ALTER TABLE brvin_books ADD COLUMN vision_output_deletion_started_at INTEGER");
    expect(workerSource).toContain("/admin/api/brvin/books/delete");
    expect(workerSource).toContain("/admin/api/brvin/books/delete-vision-output");
    expect(workerSource).toContain("/admin/api/brvin/clear");
    expect(workerSource).not.toContain("BRVIN_DIAGNOSTIC_TOKEN");
    const importSource = readFileSync(new URL("../src/fatman/import.ts", import.meta.url), "utf8");
    expect(importSource).toContain("export async function deleteFatmanGcsObjectPrefix");
    expect(importSource).toContain("softDeleteRetentionSeconds");
    expect(importSource).toContain("retentionPolicySeconds");
    expect(importSource).toContain("retentionPolicyLocked");
    expect(importSource).toContain("softDeleted: \"true\"");
    expect(importSource).toContain("timeDeleted");
    expect(importSource).toContain("hardDeleteTime");
    expect(importSource).toContain("versions: \"true\"");
    expect(workerSource).toContain('controller.cron === "*/5 * * * *"');
    expect(wranglerConfig).toContain('"*/5 * * * *"');
    expect(script).toContain('const $=id=>document.getElementById(id),API="/admin/api/brvin/"');
    expect(script).toContain('function post(path,body){return api(API+path,');
    expect(script).toContain('post("upload/start"');
    expect(script).toContain('post("projects"');
    expect(script).toContain('post("collections"');
  });
});
