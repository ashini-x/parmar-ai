import type { AnswerPacket } from "../config/env";

/**
 * Add a compact heading only to successful text answers to student questions.
 * Progress, notices, refusals and quiz polls use separate delivery paths and
 * must not be decorated as final answers.
 */
export function formatSuccessfulQuestionAnswer(answer: string, packet: Pick<AnswerPacket, "responseMode" | "answerScope" | "isNotice">): string {
  if (
    packet.responseMode !== "text" ||
    packet.answerScope === "out_of_scope" ||
    packet.isNotice === true
  ) {
    return answer;
  }

  const body = answer.trim();
  if (!body) return answer;
  return "🟢 Final answer\n\n" + body;
}
