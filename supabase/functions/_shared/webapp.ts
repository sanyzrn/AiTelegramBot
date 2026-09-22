/**
 * Telegram Mini App dashboard API. Every request carries Telegram's signed
 * initData; the HMAC is verified with the bot token before any database access.
 */
import { isAllowed, type AccessEnv } from "./access.ts";
import { expenseCategory } from "./life-expenses.ts";
import { localDay, safeTimeZone, timeZoneLabel } from "./timezone.ts";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, "0")).join("");

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/**
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the Telegram user id, or null when the signature, age or user is invalid.
 */
export async function verifyInitData(initData: string, botToken: string, now = Date.now(), maxAgeSec = 86400): Promise<number | null> {
  if (!initData || !botToken || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const expected = hex(await hmac(secret, check));
  let diff = expected.length ^ hash.length;
  for (let i = 0; i < Math.max(expected.length, hash.length); i++) diff |= (expected.charCodeAt(i) || 0) ^ (hash.charCodeAt(i) || 0);
  if (diff !== 0) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec || authDate - now / 1000 > 300) return null;
  try {
    const id = Number(JSON.parse(params.get("user") || "{}").id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Test helper and reference implementation of Telegram's signing. */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  params.set("hash", hex(await hmac(await hmac(enc.encode("WebAppData"), botToken), check)));
  return params.toString();
}

export type ApiResult = { status: number; body: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
type Db = any;

async function summary(db: Db, id: number, now: Date): Promise<Record<string, unknown>> {
  const { data: pref } = await db.from("saeed_ai_briefing_preferences")
    .select("enabled,send_hour,timezone,city_label,weekly_enabled,voice").eq("telegram_user_id", id).maybeSingle();
  const tz = safeTimeZone(pref?.timezone);
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { data: member } = await db.from("saeed_ai_shopping_members").select("owner_user_id").eq("member_user_id", id).maybeSingle();
  const owner = member?.owner_user_id ? Number(member.owner_user_id) : id;
  const [tasks, reminders, expenses, shopping] = await Promise.all([
    db.from("saeed_ai_tasks").select("id,task,done").eq("telegram_user_id", id).order("id", { ascending: false }).limit(30),
    db.from("saeed_ai_reminders").select("id,note,remind_at,repeat_rule").eq("telegram_user_id", id).eq("sent", false).eq("canceled", false).order("remind_at").limit(20),
    db.from("saeed_ai_expenses").select("description,amount_toman,created_at").eq("telegram_user_id", id).gte("created_at", since).limit(1000),
    db.from("saeed_ai_shopping").select("id,item,done").eq("telegram_user_id", owner).order("done", { ascending: true }).order("id", { ascending: false }).limit(40),
  ]);
  if (tasks.error || reminders.error || expenses.error || shopping.error) throw Error("WEBAPP_READ");
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(localDay(new Date(now.getTime() - i * 86400000), tz));
  const perDay = new Map(days.map((d) => [d, 0]));
  const perCategory = new Map<string, number>();
  for (const e of expenses.data || []) {
    const amount = Number(e.amount_toman);
    const day = localDay(new Date(e.created_at), tz);
    if (perDay.has(day)) perDay.set(day, perDay.get(day)! + amount);
    const cat = expenseCategory(e.description);
    perCategory.set(cat, (perCategory.get(cat) || 0) + amount);
  }
  return {
    timezone: tz,
    timezone_label: timeZoneLabel(tz),
    tasks: (tasks.data || []).reverse(),
    reminders: reminders.data || [],
    shopping: { shared: owner !== id, items: shopping.data || [] },
    expenses: {
      days: days.map((d) => ({ day: d, amount: perDay.get(d) || 0 })),
      categories: [...perCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, amount]) => ({ name, amount })),
      total: [...perDay.values()].reduce((s, v) => s + v, 0),
    },
    briefing: {
      enabled: !!pref?.enabled,
      send_hour: pref?.send_hour ?? 7,
      city: pref?.city_label || "تهران",
      weekly: !!pref?.weekly_enabled,
      voice: !!pref?.voice,
    },
  };
}

/** Every mutation is scoped to the verified user (or their shared shopping list). */
export async function handleWebApp(
  db: Db,
  access: AccessEnv,
  botToken: string,
  initData: string,
  payload: Record<string, unknown>,
  now = new Date(),
): Promise<ApiResult> {
  const id = await verifyInitData(initData, botToken, now.getTime());
  if (!id) return { status: 401, body: { error: "unauthorized" } };
  if (!(await isAllowed(db, access, id, { type: "private", id }))) return { status: 403, body: { error: "forbidden" } };
  const action = String(payload.action || "summary");
  const key = Number(payload.id);
  const needsKey = ["task_toggle", "task_delete", "reminder_cancel", "shop_toggle"].includes(action);
  if (needsKey && !Number.isSafeInteger(key)) return { status: 400, body: { error: "bad id" } };
  if (action === "summary") return { status: 200, body: await summary(db, id, now) };
  if (action === "task_toggle") {
    const { data: t } = await db.from("saeed_ai_tasks").select("done").eq("id", key).eq("telegram_user_id", id).maybeSingle();
    if (!t) return { status: 404, body: { error: "not found" } };
    await db.from("saeed_ai_tasks").update({ done: !t.done, done_at: t.done ? null : now.toISOString() }).eq("id", key).eq("telegram_user_id", id);
  } else if (action === "task_delete") {
    await db.from("saeed_ai_tasks").delete().eq("id", key).eq("telegram_user_id", id);
  } else if (action === "reminder_cancel") {
    await db.from("saeed_ai_reminders").update({ canceled: true, sent: true, status: "sent", lease_until: null }).eq("id", key).eq("telegram_user_id", id);
  } else if (action === "shop_toggle") {
    const { data: member } = await db.from("saeed_ai_shopping_members").select("owner_user_id").eq("member_user_id", id).maybeSingle();
    const owner = member?.owner_user_id ? Number(member.owner_user_id) : id;
    const { data: item } = await db.from("saeed_ai_shopping").select("done").eq("id", key).eq("telegram_user_id", owner).maybeSingle();
    if (!item) return { status: 404, body: { error: "not found" } };
    await db.from("saeed_ai_shopping").update({ done: !item.done, done_at: item.done ? null : now.toISOString() }).eq("id", key).eq("telegram_user_id", owner);
  } else if (action === "briefing_update") {
    const patch: Record<string, unknown> = {};
    if (typeof payload.enabled === "boolean") patch.enabled = payload.enabled;
    if (typeof payload.weekly === "boolean") patch.weekly_enabled = payload.weekly;
    if (typeof payload.voice === "boolean") patch.voice = payload.voice;
    if (payload.send_hour !== undefined) {
      const h = Number(payload.send_hour);
      if (!Number.isInteger(h) || h < 5 || h > 11) return { status: 400, body: { error: "send_hour must be 5-11" } };
      patch.send_hour = h;
    }
    if (!Object.keys(patch).length) return { status: 400, body: { error: "nothing to update" } };
    const { data: existing } = await db.from("saeed_ai_briefing_preferences").select("telegram_user_id").eq("telegram_user_id", id).maybeSingle();
    const { error } = existing
      ? await db.from("saeed_ai_briefing_preferences").update({ ...patch, updated_at: now.toISOString() }).eq("telegram_user_id", id)
      : await db.from("saeed_ai_briefing_preferences").insert({ telegram_user_id: id, telegram_chat_id: id, enabled: false, ...patch });
    if (error) throw Error("WEBAPP_PREF");
  } else return { status: 400, body: { error: "unknown action" } };
  return { status: 200, body: await summary(db, id, now) };
}
