import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { nextOccurrence, type RepeatRule } from "../_shared/repeat.ts";
import { briefingExternalSections } from "../_shared/briefing-sources.ts";
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try { KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY; } catch {}
const db = BASE && KEY ? createClient(BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const configured = () => !!(db && TOKEN);
async function send(chatId: number, text: string, reminderId?: number) {
  const keyboard = reminderId ? { inline_keyboard: [
    [{ text: "✅ انجام شد", callback_data: `reminder:done:${reminderId}` }, { text: "⏰ ۱۰ دقیقه بعد", callback_data: `reminder:snooze:${reminderId}` }],
    [{ text: "🗑 لغو تکرارهای بعدی", callback_data: `reminder:cancel:${reminderId}` }],
  ] } : null;
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(keyboard ? { reply_markup: keyboard } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw Error(`TELEGRAM_${response.status}`);
}
async function dispatchReminders() {
  const { data, error } = await db!.rpc("saeed_ai_claim_due_reminders", { p_limit: 50 });
  if (error) throw Error("REMINDER_CLAIM_" + error.code);
  let sent = 0, failed = 0;
  for (const entry of data || []) {
    const { data: r, error: readError } = await db!.from("saeed_ai_reminders")
      .select("id,telegram_chat_id,note,remind_at,repeat_rule,repeat_every_hours,repeat_anchor_day,canceled")
      .eq("id", entry.id).eq("status", "processing").maybeSingle();
    if (readError || !r) { failed++; continue; }
    if (r.canceled) continue;
    try {
      await send(Number(r.telegram_chat_id), `⏰ یادآور: ${r.note}`, Number(r.id));
      const next = nextOccurrence(String(r.remind_at), r.repeat_rule as RepeatRule,
        r.repeat_every_hours === null ? null : Number(r.repeat_every_hours),
        r.repeat_anchor_day === null ? null : Number(r.repeat_anchor_day));
      const patch = next ? {
        remind_at: next, sent: false, status: "pending", attempt_count: 0,
        sent_at: new Date().toISOString(), lease_until: null, last_error: null,
      } : { sent: true, status: "sent", sent_at: new Date().toISOString(), lease_until: null, last_error: null };
      const { data: updated, error: saveError } = await db!.from("saeed_ai_reminders")
        .update(patch).eq("id", r.id).eq("status", "processing").eq("canceled", false).select("id");
      if (saveError || !updated?.length) throw Error("REMINDER_ACK");
      sent++;
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message.slice(0, 100) : "UNKNOWN";
      await db!.from("saeed_ai_reminders").update({
        status: Number(entry.attempt_count) >= 5 ? "failed" : "pending", lease_until: null, last_error: reason,
      }).eq("id", entry.id).eq("status", "processing").eq("canceled", false);
      console.error("REMINDER_DELIVERY", entry.id, reason);
    }
  }
  return { claimed: (data || []).length, sent, failed };
}
async function dispatchBriefings() {
  const { data, error } = await db!.rpc("saeed_ai_claim_briefings", { p_limit: 30 });
  if (error) throw Error("BRIEF_CLAIM_" + error.code);
  let sent = 0, failed = 0;
  for (const item of data || []) {
    const uid = Number(item.telegram_user_id), chat = Number(item.telegram_chat_id);
    try {
      const { data: p, error: prefError } = await db!.from("saeed_ai_briefing_preferences")
        .select("enabled,timezone").eq("telegram_user_id", uid).maybeSingle();
      if (prefError) throw Error("BRIEF_PREF");
      if (!p?.enabled) continue;
      const [tasks, rems, expenses] = await Promise.all([
        db!.from("saeed_ai_tasks").select("task").eq("telegram_user_id", uid).eq("done", false).order("id").limit(6),
        db!.from("saeed_ai_reminders").select("note,remind_at").eq("telegram_user_id", uid).eq("sent", false).eq("canceled", false).order("remind_at").limit(25),
        db!.from("saeed_ai_expenses").select("amount_toman").eq("telegram_user_id", uid).gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(200),
      ]);
      if (tasks.error || rems.error || expenses.error) throw Error("BRIEF_READ");
      const day = String(item.local_day);
      const offset = p.timezone === "Europe/Istanbul" ? 180 : 210;
      const start = new Date(Date.parse(day + "T00:00:00Z") - offset * 60000).getTime();
      const todayRems = (rems.data || []).filter((r: any) => { const at = new Date(r.remind_at).getTime(); return at >= start && at < start + 86400000; }).slice(0, 7);
      const total = (expenses.data || []).reduce((sum: bigint, x: any) => sum + BigInt(x.amount_toman), 0n);
      const body = `☀️ صبح‌نامه ${day}\n\n✅ کارهای باز:\n${(tasks.data || []).map((x: any) => "• " + x.task).join("\n") || "موردی نیست."}\n\n⏰ یادآورهای امروز:\n${todayRems.map((x: any) => "• " + x.note + "، " + new Date(x.remind_at).toLocaleTimeString("fa-IR", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit" })).join("\n") || "موردی نیست."}\n\n💰 خرج ثبت‌شده ۲۴ ساعت گذشته${(expenses.data || []).length === 200 ? " (۲۰۰ مورد اخیر)" : ""}: ${total.toLocaleString("fa-IR")} تومان\n\nبرای توقف: «صبح‌نامه خاموش».`;
      const external = await briefingExternalSections();
      await send(chat, body + "\n\n" + external);
      const { error: saveError } = await db!.from("saeed_ai_briefing_preferences")
        .update({ last_sent_day: day, lease_until: null }).eq("telegram_user_id", uid).eq("enabled", true);
      if (saveError) throw Error("BRIEF_ACK");
      sent++;
    } catch (e) {
      failed++;
      await db!.from("saeed_ai_briefing_preferences").update({ lease_until: null }).eq("telegram_user_id", uid);
      console.error("BRIEF_DELIVERY", uid, e instanceof Error ? e.message.slice(0, 80) : "UNKNOWN");
    }
  }
  return { claimed: (data || []).length, sent, failed };
}
Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.has("health"))
    return Response.json({ version: "8.0.1", configured: configured(), scheduled_reminders: true, v9_recurring: true, v9_briefings: true, v9_market_weather: true }, { headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!configured()) return new Response("Unavailable", { status: 503 });
  const candidate = request.headers.get("X-Saeed-Cron-Secret") || "";
  if (!/^[a-f0-9]{64}$/.test(candidate)) return new Response("Unauthorized", { status: 401 });
  const { data: authorized, error: authError } = await db!.rpc("saeed_ai_authenticate_reminder_cron", { p_candidate: candidate });
  if (authError || authorized !== true) return new Response("Unauthorized", { status: 401 });
  try {
    const reminders = await dispatchReminders();
    const briefings = await dispatchBriefings();
    return Response.json({ ok: true, reminders, briefings });
  } catch (e) {
    console.error("DISPATCH", e instanceof Error ? e.message.slice(0, 90) : "UNKNOWN");
    return Response.json({ ok: false, error: "dispatch_failed" }, { status: 500 });
  }
});
