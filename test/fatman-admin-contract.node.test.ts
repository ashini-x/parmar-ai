import { readFileSync } from "node:fs";
import { fatmanAdminPage } from "../src/fatman/admin";
import { describe, expect, it } from "vitest";

describe("Fatman index rollout contract", () => {
  const source = readFileSync(new URL("../src/fatman/admin.ts", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const brvinAdminSource = readFileSync(new URL("../src/brvin/admin.ts", import.meta.url), "utf8");
  const retrievalSource = readFileSync(new URL("../src/brvin/retrieval.ts", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../src/core/job-store.ts", import.meta.url), "utf8");

  it("injects the approved PDF fingerprint into the browser module scope", async () => {
    const html = await fatmanAdminPage().text();

    expect(html).toContain(`const EXPECTED_PDF_SHA256="8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886";`);
  });

  it("checks the approved PDF fingerprint before preparing the index", () => {
    const hashCheck = source.indexOf("if(sourceHash!==EXPECTED_PDF_SHA256)");
    const prepareIndex = source.indexOf('api("prepare"');

    expect(source).toContain("const EXPECTED_PDF_SHA256 = \"8B183803FE8EE53087D731F7319519AF9AC5BB62B39B2D3110ACC3FE0AB59886\";");
    expect(hashCheck).toBeGreaterThanOrEqual(0);
    expect(prepareIndex).toBeGreaterThan(hashCheck);
  });

  it("isolates Fatman mode by private chat and snapshots each queued question", () => {
    expect(workerSource).toContain("const id = env.JOB_DEDUPE.idFromName(String(chatId));");
    expect(workerSource).toContain('callback.message?.chat?.type !== "private"');
    expect(storeSource).toContain('const FATMAN_MODE_PREFIX = "mode:fatman:"');
    expect(storeSource).toContain("this.ctx.storage.get<boolean>(FATMAN_MODE_PREFIX + encodeURIComponent(botConnectionId))");
    expect(storeSource).toContain("this.ctx.storage.put(FATMAN_MODE_PREFIX + encodeURIComponent(botConnectionId), active)");
    expect(storeSource).toContain("fatmanModeSnapshot: body.fatmanModeSnapshot === true");
  });

  it("requires a retrieval preview and explicit review before enabling book mode", () => {
    const finalizeStart = source.indexOf("export async function finalizeFatmanIndex");
    const finalizeEnd = source.indexOf("export async function disableFatmanIndex", finalizeStart);
    const finalizeHandler = source.slice(finalizeStart, finalizeEnd);
    const importStart = source.indexOf("async function importBook()");
    const importEnd = source.indexOf('document.getElementById("import")', importStart);
    const importHandler = source.slice(importStart, importEnd);

    expect(source).toContain('api("preview"');
    expect(finalizeHandler).toContain("if (reviewedQueries.length < 3)");
    expect(source).toContain("body:JSON.stringify({reviewedQueries:Array.from(reviewedQueries).slice(0,3)})");
    expect(importHandler).not.toContain('api("finalize"');
  });
});

describe("BRVIN imported-book archive controls", () => {
  const brvinAdminSource = readFileSync(new URL("../src/brvin/admin.ts", import.meta.url), "utf8");
  const retrievalSource = readFileSync(new URL("../src/brvin/retrieval.ts", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  it("archives and restores only complete imported PDF books without deleting their contents", () => {
    expect(brvinAdminSource).toContain("export async function archiveBrvinBook");
    expect(brvinAdminSource).toContain("candidate.import_status !== \"completed\"");
    expect(brvinAdminSource).toContain("candidate.indexed_pages");
    expect(brvinAdminSource).toContain("sourceRetained: true");
    expect(brvinAdminSource).toContain("data-book-archive");
    expect(brvinAdminSource).toContain("data-book-restore");
    expect(retrievalSource).toContain("WHERE b.status='ready'");
    expect(workerSource).toContain('adminApiPath === "/admin/api/brvin/books/archive"');
  });

  it("keeps archived PDFs eligible for the existing full-purge workflow", () => {
    expect(brvinAdminSource).toContain('"delete_failed", "archived"');
    expect(brvinAdminSource).toContain('b.status==="archived"');
  });
});
