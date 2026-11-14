function telegramEntityToken(index: number): string {
  return "\u0001TG_ENTITY_" + index + "\u0001";
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function renderTelegramInlineMarkdown(value: string, stash: (html: string) => string): string {
  let text = value;

  // Protect code and links before escaping and emphasis processing.
  text = text.replace(/\x60([^\x60\n]+)\x60/gu, (_match, code: string) =>
    stash("<code>" + escapeTelegramHtml(code) + "</code>"),
  );

  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/giu, (_match, label: string, url: string) =>
    stash('<a href="' + escapeTelegramHtml(url) + '">' + escapeTelegramHtml(label) + "</a>"),
  );

  text = escapeTelegramHtml(text);

  return text
    .replace(/\*\*([^\n*]+)\*\*/gu, "<b>$1</b>")
    .replace(/(?<![\p{L}\p{N}])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?![\p{L}\p{N}])/gu, "<b>$1</b>")
    .replace(/__([^_\n]+)__/gu, "<b>$1</b>")
    .replace(/(?<![\p{L}\p{N}])_([^\s_\n](?:[^_\n]*[^\s_\n])?)_(?![\p{L}\p{N}])/gu, "<i>$1</i>")
    .replace(/\|\|([^|\n]+)\|\|/gu, "<tg-spoiler>$1</tg-spoiler>")
    .replace(/~~([^~\n]+)~~/gu, "<s>$1</s>");
}

/**
 * Render restrained Markdown as valid Telegram HTML. Raw HTML from an AI
 * answer, user message, or source passage is escaped; only this formatter's
 * allow-listed tags are emitted.
 */
export function formatTelegramHtml(input: string): string {
  const value = String(input ?? "").replace(/\r\n?/gu, "\n");
  const entities: string[] = [];
  const stash = (html: string): string => {
    const token = telegramEntityToken(entities.length);
    entities.push(html);
    return token;
  };

  const protectedText = value.replace(
    /\x60{3}([a-z0-9_+-]+)?[ \t]*\n([\s\S]*?)\x60{3}/giu,
    (_match, language: string | undefined, code: string) => {
      const body = escapeTelegramHtml(code.replace(/\n+$/u, ""));
      if (language) {
        return stash('<pre><code class="language-' + language.toLowerCase() + '">' + body + "</code></pre>");
      }
      return stash("<pre>" + body + "</pre>");
    },
  );

  const lines = protectedText.split("\n").map((rawLine) => {
    const quote = rawLine.match(/^ {0,3}>[ \t]?(.*)$/u);
    const heading = rawLine.match(/^ {0,3}#{1,3}[ \t]+(.+)$/u);
    let line: string;

    if (quote) {
      line = "<blockquote>" + renderTelegramInlineMarkdown(quote[1], stash) + "</blockquote>";
    } else if (heading) {
      line = "<b>" + renderTelegramInlineMarkdown(heading[1], stash) + "</b>";
    } else {
      line = renderTelegramInlineMarkdown(rawLine, stash);
    }

    if (/^(?:🟢[ \t]*)?Final answer$/iu.test(line) || /^परमार्थAI by BRɅIN\.$/u.test(line)) {
      line = "<b>" + line + "</b>";
    } else if (/^(?:📖[ \t]*|👻[ \t]*)?Fatman Mode is (?:ON|OFF)\.$/u.test(line)) {
      line = "<b>" + line + "</b>";
    } else if (!/^(?:https?:|mailto:|www\.)/iu.test(line)) {
      const label = line.match(/^((?:📌[ \t]*)?[^:\n]{1,36}:)([ \t]+.*)?$/u);
      if (label) line = "<b>" + label[1] + "</b>" + (label[2] ?? "");
    }

    if (/^[-*][ \t]+/u.test(line)) line = "• " + line.replace(/^[-*][ \t]+/u, "");
    return line;
  });

  const rendered = lines.join("\n");
  return entities.reduce(
    (output, html, index) => output.split(telegramEntityToken(index)).join(html),
    rendered,
  );
}

/**
 * Native Telegram quiz questions and option labels currently support custom
 * emoji entities only, not regular bold/italic text. Remove paired Markdown
 * markers there rather than letting asterisks appear literally.
 */
export function stripTelegramMarkdownMarkers(input: string): string {
  return String(input ?? "")
    .replace(/\*\*([^\n*]+)\*\*/gu, "$1")
    .replace(/(?<![\p{L}\p{N}])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?![\p{L}\p{N}])/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/(?<![\p{L}\p{N}])_([^\s_\n](?:[^_\n]*[^\s_\n])?)_(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\|\|([^|\n]+)\|\|/gu, "$1")
    .replace(/~~([^~\n]+)~~/gu, "$1");
}
