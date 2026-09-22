/** Saeed AI saeed-ai-ui output module: answer post-processing and delivery. */
import { tg } from "./transport.ts";
import { escapeHtml } from "../../_shared/format.ts";
import { sendRich } from "../../_shared/telegram.ts";

export const esc = escapeHtml;

export function stripRepeatedIntro(text, asked) {
  if (asked) return text;
  return (
    String(text)
      .replace(
        /^\s*(?:(?:سلام(?: دوباره)?|درود)[!،,.\s]*)?من\s+(?:سعید\s*(?:AI|ای‌آی)|Saeed\s*AI)\s+هستم[!،,.:\s]*/iu,
        "",
      )
      .trim() || text
  );
}

/** Fenced code becomes copyable <pre> blocks; prose is rendered from Markdown. */
export async function deliver(chat, answer, tool, prompt) {
  const sections = [],
    rx = /```([A-Za-z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
  let offset = 0,
    m;
  while ((m = rx.exec(answer)) && sections.length < 32) {
    const before = answer.slice(offset, m.index).trim();
    if (before) sections.push({ type: "text", value: before });
    if (m[2].trim())
      sections.push({ type: "code", value: m[2].trim(), language: m[1] });
    offset = rx.lastIndex;
  }
  if (sections.some((x) => x.type === "code")) {
    const tail = answer.slice(offset).trim();
    if (tail) sections.push({ type: "text", value: tail });
  } else if (tool === "summarize" || /خلاصه|summari[sz]e/i.test(prompt)) {
    const lines = answer.split("\n"),
      idx = lines.findIndex((x) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(x));
    if (idx > 0) {
      if (lines.slice(0, idx).join("\n").trim())
        sections.push({
          type: "text",
          value: lines.slice(0, idx).join("\n").trim(),
        });
      sections.push({
        type: "code",
        value: lines.slice(idx).join("\n").trim(),
      });
    } else sections.push({ type: "code", value: answer.trim() });
  } else if (["translate", "rewrite", "ocr", "transcribe"].includes(tool))
    sections.push({ type: "code", value: answer.trim() });
  else sections.push({ type: "text", value: answer });
  for (const part of sections) {
    if (part.type === "text") {
      await sendRich(tg, chat, part.value);
      continue;
    }
    const chars = Array.from(part.value),
      lang = /^[A-Za-z0-9_+#-]{1,25}$/.test(part.language || "")
        ? part.language.toLowerCase()
        : "";
    for (let i = 0; i < chars.length; i += 2500) {
      const data = esc(chars.slice(i, i + 2500).join("")),
        block = lang
          ? `<pre><code class="language-${esc(lang)}">${data}</code></pre>`
          : `<pre>${data}</pre>`;
      await tg("sendMessage", {
        chat_id: chat,
        parse_mode: "HTML",
        text: block,
      });
    }
  }
}
