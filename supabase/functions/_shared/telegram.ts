/** Telegram Bot API transport shared by every Edge Function. */
import { markdownToTelegramHtml, stripMarkdown } from "./format.ts";

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
// deno-lint-ignore no-explicit-any
export type Tg = (method: string, payload: Record<string, unknown>) => Promise<any>;

/** Error carrying Telegram's description so callers can react to e.g. "message is not modified". */
export class TelegramError extends Error {
  constructor(public status: number, public description: string) {
    super(`TELEGRAM_${status}${description ? ": " + description.slice(0, 120) : ""}`);
  }
}

/** Webhook secret derived from the bot token: SHA-256("telegram-webhook:" + token). */
export async function webhookSecret(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("telegram-webhook:" + token)),
  );
  return Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let n = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) n |= (x[i] || 0) ^ (y[i] || 0);
  return n === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bot API caller. Non-JSON bodies (HTML error pages) never crash the parser,
 * 429 responses honour a short retry_after, and 5xx gets one quick retry.
 */
export function createTg(token: string, fetcher: Fetcher = fetch, wait = sleep): Tg {
  return async function tg(method, payload) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      // deno-lint-ignore no-explicit-any
      let j: any = null;
      try {
        j = await r.json();
      } catch { /* HTML or empty error page */ }
      if (r.ok && j?.ok) return j.result;
      const retryAfter = Number(j?.parameters?.retry_after);
      if (attempt < 2 && r.status === 429 && Number.isFinite(retryAfter) && retryAfter <= 5) {
        await wait(retryAfter * 1000 + 100);
        continue;
      }
      if (attempt < 1 && r.status >= 500) {
        await wait(700);
        continue;
      }
      throw new TelegramError(r.status, String(j?.description || ""));
    }
  };
}

/** Split long text on paragraph/line boundaries, never inside a code point. */
export function splitText(text: string, max = 3500): string[] {
  const chars = Array.from(String(text || "…"));
  const out: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + max, chars.length);
    if (end < chars.length) {
      const window = chars.slice(start, end).join("");
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      if (cut > max * 0.5) end = start + Array.from(window.slice(0, cut)).length + 1;
    }
    const piece = chars.slice(start, end).join("").trim();
    if (piece) out.push(piece);
    start = end;
  }
  return out.length ? out : ["…"];
}

/** Plain text; optional reply markup is attached to the last chunk only. */
export async function sendPlain(tg: Tg, chat: number, text: string, extra: Record<string, unknown> = {}) {
  const parts = splitText(text, 3500);
  for (let i = 0; i < parts.length; i++)
    await tg("sendMessage", { chat_id: chat, text: parts[i], ...(i === parts.length - 1 ? extra : {}) });
}

/**
 * Model answers: Markdown is rendered to Telegram HTML so users never see raw
 * ** or ### markers. Any parse rejection falls back to stripped plain text.
 */
export async function sendRich(tg: Tg, chat: number, markdown: string, extra: Record<string, unknown> = {}) {
  const parts = splitText(markdown, 3000);
  for (let i = 0; i < parts.length; i++) {
    const tail = i === parts.length - 1 ? extra : {};
    try {
      await tg("sendMessage", {
        chat_id: chat,
        text: markdownToTelegramHtml(parts[i]),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...tail,
      });
    } catch (e) {
      if (!(e instanceof TelegramError) || e.status !== 400) throw e;
      await tg("sendMessage", { chat_id: chat, text: stripMarkdown(parts[i]), ...tail });
    }
  }
}
