/**
 * Telegram Mini App dashboard API. Every request carries Telegram's signed
 * initData; the HMAC is verified with the bot token before any database access.
 * Actions cover the complete life surface: tasks, reminders, expenses, the
 * shared shopping list, long-term memories, conditional watchers and the
 * morning-briefing preferences (city, timezone, hour, weekly card, voice).
 */
import { isAllowed, type AccessEnv } from "./access.ts";
import { expenseCategory } from "./life-expenses.ts";
import { geocodeCity } from "./briefing-sources.ts";
import { isValidTimeZone, localDay, safeTimeZone, timeZoneLabel } from "./timezone.ts";

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

const bad = (error: string, status = 400): ApiResult => ({ status, body: { error } });
const text2 = (v: unknown): string | null => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 200 ? t : null;
};

async function summary(db: Db, id: number, now: Date): Promise<Record<string, unknown>> {
  const { data: pref } = await db.from("saeed_ai_briefing_preferences")
    .select("enabled,send_hour,timezone,city,city_label,weekly_enabled,voice").eq("telegram_user_id", id).maybeSingle();
  const tz = safeTimeZone(pref?.timezone);
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { data: member } = await db.from("saeed_ai_shopping_members").select("owner_user_id").eq("member_user_id", id).maybeSingle();
  const owner = member?.owner_user_id ? Number(member.owner_user_id) : id;
  const [tasks, reminders, expenses, shopping, shopMembers, memories, watchers] = await Promise.all([
    db.from("saeed_ai_tasks").select("id,task,done").eq("telegram_user_id", id).order("id", { ascending: false }).limit(50),
    db.from("saeed_ai_reminders").select("id,note,remind_at,repeat_rule").eq("telegram_user_id", id).eq("sent", false).eq("canceled", false).order("remind_at").limit(20),
    db.from("saeed_ai_expenses").select("id,description,amount_toman,created_at").eq("telegram_user_id", id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    db.from("saeed_ai_shopping").select("id,item,done").eq("telegram_user_id", owner).order("done", { ascending: true }).order("id", { ascending: false }).limit(40),
    db.from("saeed_ai_shopping_members").select("member_name").eq("owner_user_id", owner).limit(20),
    db.from("saeed_ai_memories").select("id,fact").eq("telegram_user_id", id).order("id").limit(30),
    db.from("saeed_ai_watchers").select("id,kind,note,recurring").eq("telegram_user_id", id).eq("active", true).order("id").limit(10),
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
  const openTasks = (tasks.data || []).filter((t: { done: boolean }) => !t.done);
  const openShopping = (shopping.data || []).filter((s: { done: boolean }) => !s.done);
  const todayKey = localDay(now, tz);
  return {
    timezone: tz,
    timezone_label: timeZoneLabel(tz),
    today: {
      spent: perDay.get(todayKey) || 0,
      tasks_open: openTasks.length,
      shopping_open: openShopping.length,
      next_reminder: (reminders.data || [])[0] ? { note: String((reminders.data || [])[0].note), at: String((reminders.data || [])[0].remind_at) } : null,
    },
    tasks: (tasks.data || []).reverse(),
    reminders: reminders.data || [],
    shopping: {
      shared: owner !== id,
      members: (shopMembers.data || []).map((m: { member_name: string | null }) => String(m.member_name || "عضو")),
      items: shopping.data || [],
    },
    expenses: {
      days: days.map((d) => ({ day: d, amount: perDay.get(d) || 0 })),
      categories: [...perCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, amount]) => ({ name, amount })),
      total: [...perDay.values()].reduce((s, v) => s + v, 0),
      list: (expenses.data || []).slice(0, 60).map((e: { id: number; description: string; amount_toman: string | number; created_at: string }) => ({
        id: e.id, description: e.description, amount: Number(e.amount_toman), created_at: e.created_at,
      })),
    },
    memories: memories.data || [],
    watchers: watchers.data || [],
    briefing: {
      enabled: !!pref?.enabled,
      send_hour: pref?.send_hour ?? 7,
      city: pref?.city_label || "تهران",
      city_name: pref?.city || "",
      weekly: !!pref?.weekly_enabled,
      voice: !!pref?.voice,
    },
  };
}

/** Insert-or-update the per-user life preferences row without ever enabling the briefing silently. */
async function patchPrefs(db: Db, id: number, patch: Record<string, unknown>, now: Date): Promise<void> {
  const { data: existing } = await db.from("saeed_ai_briefing_preferences").select("telegram_user_id").eq("telegram_user_id", id).maybeSingle();
  const { error } = existing
    ? await db.from("saeed_ai_briefing_preferences").update({ ...patch, updated_at: now.toISOString() }).eq("telegram_user_id", id)
    : await db.from("saeed_ai_briefing_preferences").insert({ telegram_user_id: id, telegram_chat_id: id, enabled: false, ...patch });
  if (error) throw Error("WEBAPP_PREF");
}

/** The shopping list owner of a (possibly shared) list. */
async function shoppingOwner(db: Db, id: number): Promise<number> {
  const { data: member } = await db.from("saeed_ai_shopping_members").select("owner_user_id").eq("member_user_id", id).maybeSingle();
  return member?.owner_user_id ? Number(member.owner_user_id) : id;
}

const WATCH_KINDS = new Set(["usd_above", "usd_below", "gold_above", "gold_below", "rain"]);

/** Every mutation is scoped to the verified user (or their shared shopping list). */
export async function handleWebApp(
  db: Db,
  access: AccessEnv,
  botToken: string,
  initData: string,
  payload: Record<string, unknown>,
  now = new Date(),
  // deno-lint-ignore no-explicit-any
  fetcher: any = fetch,
): Promise<ApiResult> {
  const id = await verifyInitData(initData, botToken, now.getTime());
  if (!id) return bad("unauthorized", 401);
  if (!(await isAllowed(db, access, id, { type: "private", id }))) return bad("forbidden", 403);
  const action = String(payload.action || "summary");
  const key = Number(payload.id);
  const needsKey = ["task_toggle", "task_delete", "task_edit", "reminder_cancel", "expense_delete", "shop_toggle", "shop_delete", "memory_delete", "watcher_cancel"].includes(action);
  if (needsKey && !Number.isSafeInteger(key)) return bad("bad id");

  if (action === "summary") return { status: 200, body: await summary(db, id, now) };

  /* ---- tasks ---- */
  if (action === "task_add") {
    const task = text2(payload.text ?? payload.task);
    if (!task) return bad("task must be 2-200 chars");
    const { count, error: countError } = await db.from("saeed_ai_tasks").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("done", false);
    if (countError) throw Error("WEBAPP_COUNT");
    if ((count ?? 0) >= 100) return bad("too many open tasks (max 100)");
    const { error } = await db.from("saeed_ai_tasks").insert({ telegram_user_id: id, task: task.slice(0, 200) });
    if (error) throw Error("WEBAPP_TASK_SAVE");
  } else if (action === "task_toggle") {
    const { data: t } = await db.from("saeed_ai_tasks").select("done").eq("id", key).eq("telegram_user_id", id).maybeSingle();
    if (!t) return bad("not found", 404);
    await db.from("saeed_ai_tasks").update({ done: !t.done, done_at: t.done ? null : now.toISOString() }).eq("id", key).eq("telegram_user_id", id);
  } else if (action === "task_edit") {
    const task = text2(payload.text);
    if (!task) return bad("task must be 2-200 chars");
    const { data } = await db.from("saeed_ai_tasks").update({ task: task.slice(0, 200) }).eq("id", key).eq("telegram_user_id", id).select("id");
    if (!data?.length) return bad("not found", 404);
  } else if (action === "task_delete") {
    await db.from("saeed_ai_tasks").delete().eq("id", key).eq("telegram_user_id", id);
  } else if (action === "task_clear") {
    const doneOnly = payload.done_only === true;
    const query = db.from("saeed_ai_tasks").delete().eq("telegram_user_id", id);
    if (doneOnly) query.eq("done", true);
    await query.select("id");
  }

  /* ---- reminders ---- */
  else if (action === "reminder_add") {
    const note = text2(payload.note);
    if (!note) return bad("note must be 2-200 chars");
    const when = new Date(String(payload.remind_at || ""));
    if (isNaN(+when) || +when <= now.getTime() || +when > now.getTime() + 30 * 86400000) return bad("remind_at must be a future ISO time within 30 days");
    const { count, error: countError } = await db.from("saeed_ai_reminders").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("sent", false).eq("canceled", false);
    if (countError) throw Error("WEBAPP_COUNT");
    if ((count ?? 0) >= 50) return bad("too many active reminders (max 50)");
    const { error } = await db.from("saeed_ai_reminders").insert({
      telegram_user_id: id, telegram_chat_id: id, note: note.slice(0, 300), remind_at: when.toISOString(), repeat_rule: "none",
    });
    if (error) throw Error("WEBAPP_REMINDER_SAVE");
  } else if (action === "reminder_cancel") {
    await db.from("saeed_ai_reminders").update({ canceled: true, sent: true, status: "sent", lease_until: null }).eq("id", key).eq("telegram_user_id", id);
  }

  /* ---- expenses ---- */
  else if (action === "expense_add") {
    const description = text2(payload.description);
    if (!description) return bad("description must be 2-200 chars");
    const amount = typeof payload.amount === "string" ? /^[1-9]\d{0,11}$/.test(payload.amount.trim()) ? BigInt(payload.amount.trim()) : null : Number(payload.amount);
    if (amount === null || (typeof amount === "number" && !(Number.isInteger(amount) && amount > 0)) || amount <= 0n || amount >= 1000000000000n) {
      return bad("amount must be a whole number of toman (1..999999999999)");
    }
    const { error } = await db.from("saeed_ai_expenses").insert({
      telegram_user_id: id, telegram_chat_id: id, description: description.slice(0, 200), amount_toman: String(amount),
    });
    if (error) throw Error("WEBAPP_EXPENSE_SAVE");
  } else if (action === "expenses_add") {
    // Quick-add batch: all or nothing, so a bad line never leaves half a list saved.
    const list = Array.isArray(payload.items) ? payload.items.slice(0, 31) : [];
    if (!list.length || list.length > 30) return bad("items must hold 1-30 expenses");
    const rows = [];
    for (const raw of list as Array<Record<string, unknown>>) {
      const description = text2(raw?.description);
      const amount = Number(raw?.amount);
      if (!description || !Number.isSafeInteger(amount) || amount <= 0 || amount >= 1000000000000) {
        return bad("every item needs a 2-200 char description and a whole toman amount");
      }
      rows.push({ telegram_user_id: id, telegram_chat_id: id, description: description.slice(0, 200), amount_toman: String(amount) });
    }
    const { error } = await db.from("saeed_ai_expenses").insert(rows);
    if (error) throw Error("WEBAPP_EXPENSE_SAVE");
  } else if (action === "expense_delete") {
    await db.from("saeed_ai_expenses").delete().eq("id", key).eq("telegram_user_id", id);
  }

  /* ---- shopping (owner-scoped for shared lists) ---- */
  else if (action === "shop_add") {
    const items = String(payload.items ?? payload.text ?? "").split(/[،,\n]/).map((x) => x.trim()).filter((x) => x.length >= 1 && x.length <= 120).slice(0, 20);
    if (!items.length) return bad("items required");
    const owner = await shoppingOwner(db, id);
    const { error } = await db.from("saeed_ai_shopping")
      .upsert(items.map((item) => ({ telegram_user_id: owner, item })), { onConflict: "telegram_user_id,item", ignoreDuplicates: true });
    if (error) throw Error("WEBAPP_SHOP_SAVE");
  } else if (action === "shop_toggle") {
    const owner = await shoppingOwner(db, id);
    const { data: item } = await db.from("saeed_ai_shopping").select("done").eq("id", key).eq("telegram_user_id", owner).maybeSingle();
    if (!item) return bad("not found", 404);
    await db.from("saeed_ai_shopping").update({ done: !item.done, done_at: item.done ? null : now.toISOString() }).eq("id", key).eq("telegram_user_id", owner);
  } else if (action === "shop_delete") {
    const owner = await shoppingOwner(db, id);
    await db.from("saeed_ai_shopping").delete().eq("id", key).eq("telegram_user_id", owner);
  } else if (action === "shop_clear_done") {
    const owner = await shoppingOwner(db, id);
    await db.from("saeed_ai_shopping").delete().eq("telegram_user_id", owner).eq("done", true).select("id");
  } else if (action === "shop_share") {
    if ((await shoppingOwner(db, id)) !== id) return bad("you already joined a shared list");
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const { error } = await db.from("saeed_ai_shopping_invites").insert({
      code, owner_user_id: id, expires_at: new Date(now.getTime() + 86400000).toISOString(),
    });
    if (error) throw Error("WEBAPP_INVITE");
    return { status: 200, body: { ok: true, code, ...(await summary(db, id, now)) } };
  } else if (action === "shop_join") {
    const code = String(payload.code || "").replace(/[^0-9]/g, "");
    if (!/^[0-9]{6}$/.test(code)) return bad("code must be 6 digits");
    const { data: invite } = await db.from("saeed_ai_shopping_invites").select("owner_user_id,expires_at").eq("code", code).maybeSingle();
    if (!invite || Date.parse(invite.expires_at) < now.getTime()) return bad("invalid or expired code");
    const owner = Number(invite.owner_user_id);
    if (owner === id) return bad("this code is your own list");
    const { data: own } = await db.from("saeed_ai_shopping_members").select("member_user_id").eq("owner_user_id", id).limit(1);
    if (own?.length) return bad("you already own a shared list; leave it first");
    const { error } = await db.from("saeed_ai_shopping_members").upsert({ member_user_id: id, owner_user_id: owner }, { onConflict: "member_user_id" });
    if (error) throw Error("WEBAPP_JOIN");
  } else if (action === "shop_leave") {
    const { data: left } = await db.from("saeed_ai_shopping_members").delete().eq("member_user_id", id).select("owner_user_id");
    if (!left?.length) await db.from("saeed_ai_shopping_members").delete().eq("owner_user_id", id).select("member_user_id");
  }

  /* ---- memories ---- */
  else if (action === "memory_add") {
    const fact = String(payload.fact ?? "").replace(/\s+/g, " ").trim();
    if (fact.length < 3 || fact.length > 300) return bad("fact must be 3-300 chars");
    const { count, error: countError } = await db.from("saeed_ai_memories").select("id", { count: "exact", head: true }).eq("telegram_user_id", id);
    if (countError) throw Error("WEBAPP_COUNT");
    if ((count ?? 0) >= 30) return bad("memory is full (max 30)");
    const { error } = await db.from("saeed_ai_memories").upsert({ telegram_user_id: id, fact }, { onConflict: "telegram_user_id,fact", ignoreDuplicates: true });
    if (error) throw Error("WEBAPP_MEMORY_SAVE");
  } else if (action === "memory_delete") {
    await db.from("saeed_ai_memories").delete().eq("id", key).eq("telegram_user_id", id);
  } else if (action === "memory_clear") {
    await db.from("saeed_ai_memories").delete().eq("telegram_user_id", id);
  }

  /* ---- watchers ---- */
  else if (action === "watcher_add") {
    const kind = String(payload.kind || "");
    if (!WATCH_KINDS.has(kind)) return bad("unknown watcher kind");
    const { count, error: countError } = await db.from("saeed_ai_watchers").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("active", true);
    if (countError) throw Error("WEBAPP_COUNT");
    if ((count ?? 0) >= 10) return bad("too many active alerts (max 10)");
    let threshold: number | null = null;
    let note: string;
    if (kind === "rain") {
      note = text2(payload.note) || "هوا بارونیه؛ چتر یادت نره ☔";
    } else {
      threshold = Number(payload.threshold);
      if (!Number.isInteger(threshold) || threshold <= 0) return bad("threshold must be a whole number");
      if (kind.startsWith("usd") && (threshold < 1000 || threshold > 10000000)) return bad("usd threshold out of range");
      if (kind.startsWith("gold") && (threshold < 100000 || threshold > 1000000000)) return bad("gold threshold out of range");
      const label = kind.startsWith("usd") ? "دلار" : "هر گرم طلای ۱۸ عیار";
      const above = kind.endsWith("above");
      note = `${label} ${above ? "از" : "به زیر"} ${threshold.toLocaleString("fa-IR")} تومان ${above ? "رد شد" : "رسید"}`;
    }
    const { error } = await db.from("saeed_ai_watchers").insert({
      telegram_user_id: id, telegram_chat_id: id, kind, threshold, note: note.slice(0, 200), recurring: kind === "rain", active: true,
    });
    if (error) throw Error("WEBAPP_WATCH_SAVE");
  } else if (action === "watcher_cancel") {
    await db.from("saeed_ai_watchers").update({ active: false }).eq("id", key).eq("telegram_user_id", id);
  }

  /* ---- briefing, city, timezone ---- */
  else if (action === "briefing_update") {
    const patch: Record<string, unknown> = {};
    if (typeof payload.enabled === "boolean") patch.enabled = payload.enabled;
    if (typeof payload.weekly === "boolean") patch.weekly_enabled = payload.weekly;
    if (typeof payload.voice === "boolean") patch.voice = payload.voice;
    if (payload.send_hour !== undefined) {
      const h = Number(payload.send_hour);
      if (!Number.isInteger(h) || h < 5 || h > 11) return bad("send_hour must be 5-11");
      patch.send_hour = h;
    }
    if (!Object.keys(patch).length) return bad("nothing to update");
    await patchPrefs(db, id, patch, now);
  } else if (action === "city_set") {
    const name = String(payload.city || "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 60 || /[<>{}$\\]/.test(name)) return bad("city must be 2-60 chars");
    const ref = await geocodeCity(name, fetcher);
    if (!ref) return bad("city not found");
    const patch: Record<string, unknown> = { city: name, city_lat: ref.lat, city_lon: ref.lon, city_label: ref.label };
    if (ref.timezone && isValidTimeZone(ref.timezone)) patch.timezone = ref.timezone;
    await patchPrefs(db, id, patch, now);
  } else if (action === "timezone_set") {
    const tz = String(payload.timezone || "").trim();
    if (!isValidTimeZone(tz)) return bad("unknown timezone");
    await patchPrefs(db, id, { timezone: tz }, now);
  } else return bad("unknown action");

  return { status: 200, body: { ok: true, ...(await summary(db, id, now)) } };
}
