/**
 * Outlined BRɅIN wordmark artwork for the authenticated Owner Intelligence panel.
 * The supplied AERUNO Trial has no U+0245 glyph; its angular, crossbar-free uppercase A
 * outline is intentionally used as the BRɅIN Ʌ glyph. The source OTF is not bundled or served.
 */
export const OWNER_INTELLIGENCE_WORDMARK_GLYPHS = [
  { d: "M1618 1018C1618 1253 1427 1444 1192 1444H0V1186H1192C1285 1186 1360 1111 1360 1018C1360 926 1285 851 1192 851H0V593H1192C1285 593 1360 518 1360 425C1360 333 1285 258 1192 258H0V0H1192C1427 0 1618 191 1618 425C1618 540 1572 645 1497 722C1572 798 1618 903 1618 1018Z", x: 0 },
  { d: "M1654 0 1287 603V604C1476 647 1618 816 1618 1018C1618 1253 1427 1444 1192 1444H0V1186H1192C1285 1186 1360 1111 1360 1018C1360 926 1285 851 1192 851H0V0H258V593H989C1197 255 1295 95 1354 0Z", x: 1688 },
  { d: "M0 6H297L856 924L1414 6H1712L856 1442Z", x: 3399 },
  { d: "M0 1446V0H258V1446Z", x: 5181 },
  { d: "M1360 494C453 1112 906 803 0 1444V0H258V933L1618 5V1444H1360Z", x: 5509 }
] as const;

const FULL_WORDMARK_PATHS = OWNER_INTELLIGENCE_WORDMARK_GLYPHS
  .map((glyph) => `<path d="${glyph.d}" transform="translate(${glyph.x} 0)"/>`)
  .join("");

function wordmarkSvg(fillId: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7197 1446" role="img" aria-label="BRɅIN" focusable="false"><title>BRɅIN</title><defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.44" stop-color="#f1f2f4"/><stop offset="1" stop-color="#aeb3bb"/></linearGradient></defs><g fill="url(#${fillId})" transform="translate(0 1446) scale(1 -1)">${FULL_WORDMARK_PATHS}</g></svg>`;
}

export const OWNER_INTELLIGENCE_WORDMARK_SVG = wordmarkSvg("owner-intelligence-wordmark-fill");
export const OWNER_INTELLIGENCE_SIDEBAR_WORDMARK_SVG = wordmarkSvg("owner-intelligence-sidebar-wordmark-fill");

