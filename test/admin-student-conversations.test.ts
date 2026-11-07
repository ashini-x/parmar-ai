import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("admin student directory and conversations", () => {
  const source = readFileSync(resolve(process.cwd(), "src/admin/dashboard.ts"), "utf8");

  it("shows the Telegram student ID in its own directory column", () => {
    expect(source).toContain("<th>Student</th><th>Telegram ID</th>");
    expect(source).toContain('<td class="mono">'+esc(u.telegram_user_id)+'</td>');
  });

  it("paginates the full student directory instead of silently stopping at the first page", () => {
    expect(source).toContain("async function loadMoreStudents()");
    expect(source).toContain("LIMIT ? OFFSET ?");
    expect(source).toContain("hasMore, page, limit, ownerTelegramUserId");
  });

  it("loads each student's saved question-and-answer history independently", () => {
    expect(source).toContain("/admin/api/questions?user_id='+id+'&limit=50&page=1");
    expect(source).toContain("q.answer_text");
    expect(source).toContain("esc(answer)");
    expect(source).toContain("studentConversationList");
    expect(source).toContain("async function loadMoreUserQuestions(id)");
  });

  it("validates student IDs and provides the actual question count in the detail API", () => {
    expect(source).toContain("Number.isSafeInteger(userId) || userId <= 0");
    expect(source).toContain("AS question_count");
    expect(source).toContain("AS last_question_at");
  });
});
