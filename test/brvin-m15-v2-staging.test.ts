import { describe, expect, it, vi } from "vitest";
import { persistM15V2AuthorizationReceipt } from "../src/brvin/m15-v2-staging";

describe("M15 v2 staging authorization receipt persistence", () => {
  it("stores the completed receipt JSON and final status in isolated D1", async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const DB = { prepare } as never;
    const result = {
      ok: true,
      benchmark: "brvin-m15-core-v2-qdrant-authorization",
      checks: { authorizedV2RetrievalSucceeded: true },
    };

    await persistM15V2AuthorizationReceipt(
      { DB },
      { runId: "m15-run-1", status: "passed", result, completedAt: 1_794_400_000_000 },
    );

    expect(prepare).toHaveBeenCalledWith(
      "UPDATE m15_v2_authorization_runs SET status=?,result_json=?,completed_at=? WHERE id=? AND status='running'",
    );
    expect(bind).toHaveBeenCalledWith(
      "passed",
      JSON.stringify(result),
      1_794_400_000_000,
      "m15-run-1",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed if the expected running receipt row was not updated", async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(persistM15V2AuthorizationReceipt(
      { DB: { prepare } as never },
      { runId: "missing-run", status: "failed", result: { ok: false }, completedAt: 1 },
    )).rejects.toThrow("could not be persisted");
  });
});
