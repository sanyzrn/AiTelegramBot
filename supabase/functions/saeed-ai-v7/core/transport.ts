/** Saeed AI saeed-ai-v7 transport module: Telegram output helpers bound to this bot. */
import { TOKEN, WEBAPP_URL, admin, esc, tg } from "./state.ts";
import { keyboard } from "./menu.ts";
import { safeEqual, sendPlain, sendRich, webhookSecret } from "../../_shared/telegram.ts";

let HOOK = "";

export async function hook() {
  if (!HOOK) HOOK = await webhookSecret(TOKEN);
  return HOOK;
}

export const equal = safeEqual;
export { tg };

/** Plain text; the reply keyboard of `page` is attached to the last chunk. */
export function send(chat, text, page = null, id = chat) {
  return sendPlain(tg, chat, text, page ? { reply_markup: keyboard(page, admin(id), WEBAPP_URL) } : {});
}

export async function sendSpoiler(chat, q, a) {
  await sendRich(tg, chat, q);
  await tg("sendMessage", {
    chat_id: chat,
    text: "پاسخ: <tg-spoiler>" + esc(a.slice(0, 3500)) + "</tg-spoiler>",
    parse_mode: "HTML",
  });
}

async function code(chat, body, lang = "") {
  const a = Array.from(String(body));
  for (let i = 0; i < a.length; i += 2500) {
    const s = esc(a.slice(i, i + 2500).join("")),
      l = /^[\w+#-]{1,25}$/.test(lang) ? lang.toLowerCase() : "";
    await tg("sendMessage", {
      chat_id: chat,
      text: l
        ? '<pre><code class="language-' + esc(l) + '">' + s + "</code></pre>"
        : "<pre>" + s + "</pre>",
      parse_mode: "HTML",
    });
  }
}

/** Split fenced code into copyable blocks; prose is rendered from Markdown. */
export function sections(text, tool, prompt) {
  const parts = [],
    rx = /```([A-Za-z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
  let end = 0,
    m;
  while ((m = rx.exec(text)) && parts.length < 30) {
    if (text.slice(end, m.index).trim())
      parts.push(["text", text.slice(end, m.index).trim(), ""]);
    if (m[2].trim()) parts.push(["code", m[2].trim(), m[1]]);
    end = rx.lastIndex;
  }
  if (parts.length) {
    if (text.slice(end).trim())
      parts.push(["text", text.slice(end).trim(), ""]);
  } else if (
    ["summarize", "ocr", "transcribe", "translate", "rewrite", "tasks", "calc", "email"].includes(tool) ||
    /خلاصه|summari[sz]e/i.test(prompt)
  ) {
    const ls = text.split("\n"),
      i =
        tool === "summarize" || /خلاصه|summari[sz]e/i.test(prompt)
          ? ls.findIndex((x) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(x))
          : -1;
    if (i > 0) {
      parts.push(["text", ls.slice(0, i).join("\n").trim(), ""]);
      parts.push(["code", ls.slice(i).join("\n").trim(), ""]);
    } else parts.push(["code", text.trim(), ""]);
  } else parts.push(["text", text, ""]);
  return parts;
}

export async function deliver(chat, text, tool, prompt) {
  for (const [type, t, l] of sections(text, tool, prompt)) {
    if (type === "code") await code(chat, t, l);
    else await sendRich(tg, chat, t);
  }
}
