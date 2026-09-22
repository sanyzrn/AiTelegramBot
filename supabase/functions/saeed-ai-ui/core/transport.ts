/** Saeed AI saeed-ai-ui transport module: webhook secret, Telegram output and processor forwarding. */
import { ACCESS, BASE, TOKEN, db, tg } from "./state.ts";
import { isAllowed } from "../../_shared/access.ts";
import { safeEqual, sendPlain, webhookSecret, type TgUpdate } from "../../_shared/telegram.ts";

let HOOK = "";

export async function hook() {
  if (!HOOK) HOOK = await webhookSecret(TOKEN);
  return HOOK;
}

export const equal = safeEqual;
export { tg };

export function send(chat: number, text: string) {
  return sendPlain(tg, chat, text);
}

export async function forward(update: TgUpdate) {
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

export function allowed(id: number, chat: { id?: unknown; type?: string } | undefined) {
  return isAllowed(db, ACCESS, id, chat);
}

/**
 * Per-minute flood guard (the daily quota alone let one user burst hundreds of
 * requests). Fails open on a database error so a missing RPC never blocks chat.
 */
export async function withinRate(id: number, limit: number) {
  const { data, error } = await db.rpc("saeed_ai_rate_hit", { p_user_id: id, p_limit: limit });
  if (error) {
    console.error("RATE", error.code);
    return true;
  }
  return data !== false;
}
