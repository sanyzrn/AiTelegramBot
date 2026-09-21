/** Saeed AI saeed-ai-v7 transport module. Source moved without behavioral rewrites. */
import { TOKEN, admin, esc } from "./state.ts";
import { keyboard } from "./menu.ts";

let HOOK = "";

export async function hook() {
  if (HOOK) return HOOK;
  const d = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("telegram-webhook:" + TOKEN),
    ),
  );
  HOOK = Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
  return HOOK;
}

export function equal(a, b) {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

export async function tg(method, data) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw Error("TELEGRAM_" + r.status);
  return j.result;
}

export async function send(chat, text, page = null, id = chat) {
  const a = Array.from(String(text || "…"));
  for (let i = 0; i < a.length; i += 3500)
    await tg("sendMessage", {
      chat_id: chat,
      text: a.slice(i, i + 3500).join(""),
      ...(page && i + 3500 >= a.length
        ? { reply_markup: keyboard(page, admin(id)) }
        : {}),
    });
}

export async function sendSpoiler(chat, q, a) {
  await send(chat, q);
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

export async function deliver(chat, text, tool, prompt) {
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
    [
      "summarize",
      "ocr",
      "transcribe",
      "translate",
      "rewrite",
      "tasks",
      "calc",
      "email",
    ].includes(tool) ||
    /خلاصه|summari[sz]e/i.test(prompt)
  ) {
    const ls = text.split("\n"),
      i =
        tool === "summarize" || /خلاصه/.test(prompt)
          ? ls.findIndex((x) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(x))
          : -1;
    if (i > 0) {
      parts.push(["text", ls.slice(0, i).join("\n").trim(), ""]);
      parts.push(["code", ls.slice(i).join("\n").trim(), ""]);
    } else parts.push(["code", text.trim(), ""]);
  } else parts.push(["text", text, ""]);
  for (const [type, t, l] of parts) {
    if (type === "code") await code(chat, t, l);
    else await send(chat, t);
  }
}
