import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("native quiz production contract", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  it("does not send a second bot message after a native quiz vote", () => {
    const start = source.indexOf("async function handleTelegramPollAnswer");
    const end = source.indexOf("function startTypingHeartbeat", start);
    const handler = source.slice(start, end);

    expect(handler).toContain("record_quiz_result");
    expect(handler).not.toContain("sendTelegramMessage(");
  });

  it("cleans up partial native quiz batches without revealing answers", () => {
    const start = source.indexOf('if (packet.responseMode === "quiz")');
    const end = source.indexOf("} else {", start);
    const handler = source.slice(start, end);

    expect(handler).toContain("for (const delivered of deliveredQuizzes.reverse())");
    expect(handler).toContain("await deleteQuizSession(env, delivered.pollId)");
    expect(handler).toContain("buildQuizDeliveryFailureAnswer()");
    expect(handler).toContain("quiz_poll_cleanup_delete_failed");
    expect(handler).not.toContain("stopTelegramPoll(");
  });

  it("uses a safe fallback when native quiz delivery fails", () => {
    const start = source.indexOf("} catch (quizDeliveryError) {");
    const end = source.indexOf("if (!statusMessageHandled && claim.record.statusMessageId)", start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('logger.error("quiz_batch_delivery_failed"');
    expect(block).toContain("buildQuizDeliveryFailureAnswer()");
    expect(block).toContain("statusMessageHandled = true");
    expect(block).not.toContain("buildAnswerForStudent(packet");
  });
});
