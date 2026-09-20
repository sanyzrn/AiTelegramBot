/** Saeed AI saeed-ai-ui transport module. Source moved without behavioral rewrites. */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { selectToolIntent } from "../../_shared/intent-model.ts";
import { BASE, LEGACY, TOKEN, admin, db } from "./state.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

let HOOK = "";

export async function hook() {
  if (HOOK) return HOOK;
  const d = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("telegram-webhook:" + TOKEN),
    ),
  );
  HOOK = Array.from(d, (v) => v.toString(16).padStart(2, "0")).join("");
  return HOOK;
}

export function equal(a, b) {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  let n = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    n |= (x[i] || 0) ^ (y[i] || 0);
  return n === 0;
}

export async function tg(method, data) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    }),
    j = await r.json();
  if (!r.ok || !j.ok) throw Error("TG_" + r.status);
  return j.result;
}

export async function send(chat, text) {
  const a = Array.from(String(text || "…"));
  for (let i = 0; i < a.length; i += 3400)
    await tg("sendMessage", {
      chat_id: chat,
      text: a.slice(i, i + 3400).join(""),
    });
}

export async function forward(update) {
  const r = await fetch(BASE + "/functions/v1/saeed-ai-v7", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": await hook(),
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw Error("FORWARD_" + r.status);
}

export async function allowed(id, chat) {
  if (!Number.isSafeInteger(id) || chat?.type !== "private" || chat.id !== id)
    return false;
  if (admin(id)) return true;
  const { data, error } = await db
    .from("telegram_bot_user_access")
    .select("enabled")
    .eq("telegram_user_id", id)
    .maybeSingle();
  return !error && (data ? data.enabled === true : LEGACY.includes(String(id)));
}
