/** Markdown → Telegram HTML for model answers. Pure, no I/O. */

export const escapeHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

/**
 * Converts the Markdown subset models emit (headings, bold, italic, strike,
 * inline code, https links, bullets) to Telegram's HTML subset. Everything
 * else is escaped, so user or model text can never inject markup.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const tokens: string[] = [];
  const hold = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const out = lines.map((raw) => {
    let line = raw;
    let heading = false;
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      line = h[1];
      heading = true;
    }
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) return "──────────";
    line = line.replace(/^(\s*)[-*+]\s+(?=\S)/, "$1• ");
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) line = quote[1];
    // Protect inline code and links before escaping/formatting the rest.
    line = line.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
    line = line.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
      hold(`<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`));
    line = escapeHtml(line)
      .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<b>$1</b>")
      .replace(/__(?=\S)([^\n]*?\S)__/g, "<b>$1</b>")
      .replace(/~~(?=\S)([^\n]*?\S)~~/g, "<s>$1</s>")
      .replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=[\s).,!?؛،:]|$)/g, "$1<i>$2</i>");
    if (heading) line = `<b>${line}</b>`;
    if (quote) line = `<i>${line}</i>`;
    return line;
  }).join("\n");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

/** Plain-text fallback: drop Markdown markers but keep the words and link targets. */
export function stripMarkdown(markdown: string): string {
  return String(markdown)
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^\n]+?)\*\*/g, "$1")
    .replace(/__([^\n]+?)__/g, "$1")
    .replace(/~~([^\n]+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^(\s*)[-*+]\s+(?=\S)/gm, "$1• ");
}

/** Latin digits → Persian digits for user-facing numbers inside Persian text. */
export const faDigits = (s: string | number) =>
  String(s).replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)]);

/** Keeps audio under ~40 s so MP3 encoding stays well inside the Edge CPU budget. */
export const TTS_MAX_CHARS = 600;

/** Speech-friendly text: no Markdown, code, URLs or source lists. */
export function speechText(text: string): string {
  const cleaned = stripMarkdown(String(text || ""))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/📚 منابع:[\s\S]*$/u, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[•▫️☑️✅⬜]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (Array.from(cleaned).length <= TTS_MAX_CHARS) return cleaned;
  const cut = Array.from(cleaned).slice(0, TTS_MAX_CHARS).join("");
  const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("؛"), cut.lastIndexOf("!"), cut.lastIndexOf("؟"));
  return (end > TTS_MAX_CHARS * 0.5 ? cut.slice(0, end + 1) : cut) + " …";
}
