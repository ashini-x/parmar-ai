import { describe, expect, it } from "vitest";
import { formatTelegramHtml, stripTelegramMarkdownMarkers } from "../src/telegram/formatting";

describe("Telegram rich-text formatter", () => {
  it("converts common bold, italic, spoiler and strikethrough markers", () => {
    expect(formatTelegramHtml("**Article 23** and *forced labour* _important_ ||hidden|| ~~incorrect~~")).toBe(
      "<b>Article 23</b> and <b>forced labour</b> <i>important</i> <tg-spoiler>hidden</tg-spoiler> <s>incorrect</s>",
    );
  });

  it("leaves the removed answer banner undecorated and formats useful labels", () => {
    expect(formatTelegramHtml("🟢 Final answer\n\nArticle 23:\nIt prohibits forced labour.")).toBe(
      "🟢 Final answer\n\n<b>Article 23:</b>\nIt prohibits forced labour.",
    );
    expect(formatTelegramHtml("📌 SSC Focus: Remember Article 23.")).toBe(
      "<b>📌 SSC Focus:</b> Remember Article 23.",
    );
  });

  it("does not bold numeric times as labels", () => {
    expect(formatTelegramHtml("10:30 PM")).toBe("10:30 PM");
  });

  it("converts Markdown headings and bullet markers", () => {
    expect(formatTelegramHtml("## Key points\n- First point\n- **Second point**")).toBe(
      "<b>Key points</b>\n• First point\n• <b>Second point</b>",
    );
  });

  it("formats blockquotes without trusting raw HTML", () => {
    expect(formatTelegramHtml("> **Remember:** Article 23")).toBe(
      "<blockquote><b>Remember:</b> Article 23</blockquote>",
    );
  });

  it("escapes raw HTML and ampersands instead of trusting model output", () => {
    expect(formatTelegramHtml("<b>not trusted</b> & pH < 7")).toBe(
      "&lt;b&gt;not trusted&lt;/b&gt; &amp; pH &lt; 7",
    );
  });

  it("supports inline and fenced code without interpreting their contents", () => {
    expect(formatTelegramHtml("Use \x60A * B\x60.\n\n\x60\x60\x60html\n<b>literal</b>\n\x60\x60\x60")).toBe(
      "Use <code>A * B</code>.\n\n<pre><code class=\"language-html\">&lt;b&gt;literal&lt;/b&gt;</code></pre>",
    );
  });

  it("links only HTTP(S) Markdown URLs", () => {
    expect(formatTelegramHtml("[official source](https://example.com/a?x=1&y=2)")).toBe(
      '<a href="https://example.com/a?x=1&amp;y=2">official source</a>',
    );
    expect(formatTelegramHtml("[unsafe](javascript:alert(1))")).toBe(
      "[unsafe](javascript:alert(1))",
    );
  });

  it("does not interpret multiplication asterisks without paired emphasis markers", () => {
    expect(formatTelegramHtml("A * B * C")).toBe("A * B * C");
  });

  it("strips paired Markdown wrappers from native poll labels", () => {
    expect(stripTelegramMarkdownMarkers("**Article 23** and *forced labour*")).toBe(
      "Article 23 and forced labour",
    );
    expect(stripTelegramMarkdownMarkers("A * B * C")).toBe("A * B * C");
    expect(stripTelegramMarkdownMarkers("_important_ and ||hidden|| ~~wrong~~")).toBe(
      "important and hidden wrong",
    );
  });

  it("preserves ordinary text without adding unnecessary tags", () => {
    expect(formatTelegramHtml("Hello students.\nNew doubt?")).toBe("Hello students.\nNew doubt?");
  });
});
