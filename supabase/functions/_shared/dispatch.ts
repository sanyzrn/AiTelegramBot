/**
 * Minute dispatcher logic (reminders, briefings, alerts, weekly cards, sweep).
 * Pure dependencies are injected so every path is unit-testable without Deno.
 */
import { nextOccurrence, type RepeatRule } from "./repeat.ts";
import { fetchCityWeather, fetchIranMarket, type CityRef, type Fetcher, type Market, type Weather } from "./briefing-sources.ts";
import { composeMorningVoice, dayQuote, type MorningFacts, type VoiceConfig } from "./morning-voice.ts";
import { briefingIntro } from "./briefing-intro.ts";
import { dayRiddle } from "./riddles.ts";
import { escapeHtml } from "./format.ts";
import { formatLocalTime, localDay, localParts, safeTimeZone, startOfLocalDay } from "./timezone.ts";
import { marketTriggered, rainLikely } from "./life-watchers.ts";
import { buildWeekly } from "./life-weekly.ts";
import { runSweep, shouldSweep } from "./sweep.ts";

export type DispatchDeps = {
  // deno-lint-ignore no-explicit-any
  db: any;
  /** Plain text, optionally with the reminder's inline buttons. */
  send: (chat: number, text: string, reminderId?: number) => Promise<void>;
  /** HTML message (used for the riddle spoiler). */
  sendHtml: (chat: number, html: string) => Promise<void>;
  /** Optional voice-out for the briefing intro. */
  speak?: (chat: number, text: string) => Promise<void>;
  fetcher?: Fetcher;
  now?: () => Date;
  keys?: { gemini?: string; openrouter?: string };
};

const TEHRAN: CityRef = { lat: 35.6892, lon: 51.389, label: "تهران" };

/** Per-tick caches: the market feed and each city's forecast are fetched once, not per user. */
function tickCache(deps: DispatchDeps) {
  const fetcher = deps.fetcher || fetch;
  let market: Promise<Market | null> | null = null;
  const weather = new Map<string, Promise<Weather | null>>();
  const zones = new Map<number, Promise<string>>();
  return {
    market: () => (market ??= fetchIranMarket(fetcher, (deps.now?.() || new Date()).getTime())),
    weather: (city: CityRef) => {
      const key = `${city.lat.toFixed(3)},${city.lon.toFixed(3)}`;
      if (!weather.has(key)) weather.set(key, fetchCityWeather(city, fetcher, (deps.now?.() || new Date()).getTime()));
      return weather.get(key)!;
    },
    zone: (uid: number) => {
      if (!zones.has(uid))
        zones.set(uid, Promise.resolve(deps.db.from("saeed_ai_briefing_preferences").select("timezone").eq("telegram_user_id", uid).maybeSingle())
          .then((r: { data?: { timezone?: string } }) => safeTimeZone(r?.data?.timezone)).catch(() => safeTimeZone(null)));
      return zones.get(uid)!;
    },
  };
}
type Cache = ReturnType<typeof tickCache>;

export async function dispatchReminders(deps: DispatchDeps, cache: Cache = tickCache(deps)) {
  const { db } = deps;
  const now = deps.now?.() || new Date();
  const { data, error } = await db.rpc("saeed_ai_claim_due_reminders", { p_limit: 50 });
  if (error) throw Error("REMINDER_CLAIM_" + error.code);
  let sent = 0, failed = 0;
  for (const entry of data || []) {
    const { data: r, error: readError } = await db.from("saeed_ai_reminders")
      .select("id,telegram_user_id,telegram_chat_id,note,remind_at,repeat_rule,repeat_every_hours,repeat_anchor_day,canceled")
      .eq("id", entry.id).eq("status", "processing").maybeSingle();
    if (readError || !r) { failed++; continue; }
    if (r.canceled) {
      // Canceled between claim and read: release it instead of leaving it "processing" forever.
      await db.from("saeed_ai_reminders").update({ status: "sent", sent: true, lease_until: null }).eq("id", r.id);
      continue;
    }
    // Compute the next occurrence BEFORE sending: a failure after a successful
    // send used to reset the row to pending and deliver it a second time.
    let next: string | null = null;
    try {
      const tz = await cache.zone(Number(r.telegram_user_id));
      next = nextOccurrence(String(r.remind_at), r.repeat_rule as RepeatRule,
        r.repeat_every_hours === null ? null : Number(r.repeat_every_hours),
        r.repeat_anchor_day === null ? null : Number(r.repeat_anchor_day), now, tz);
    } catch (e) {
      console.error("REMINDER_NEXT", r.id, e instanceof Error ? e.message : "UNKNOWN");
    }
    try {
      await deps.send(Number(r.telegram_chat_id), `⏰ یادآور: ${r.note}`, Number(r.id));
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message.slice(0, 100) : "UNKNOWN";
      await db.from("saeed_ai_reminders").update({
        status: Number(entry.attempt_count) >= 5 ? "failed" : "pending", lease_until: null, last_error: reason,
      }).eq("id", entry.id).eq("status", "processing").eq("canceled", false);
      console.error("REMINDER_DELIVERY", entry.id, reason);
      continue;
    }
    // Delivered: never revert to pending. Retry the acknowledgement a few times.
    const patch = next ? {
      remind_at: next, sent: false, status: "pending", attempt_count: 0,
      sent_at: now.toISOString(), lease_until: null, last_error: null,
    } : { sent: true, status: "sent", sent_at: now.toISOString(), lease_until: null, last_error: null };
    let acked = false;
    for (let attempt = 0; attempt < 3 && !acked; attempt++) {
      const { data: updated, error: saveError } = await db.from("saeed_ai_reminders")
        .update(patch).eq("id", r.id).eq("status", "processing").select("id");
      acked = !saveError && !!updated?.length;
    }
    if (!acked) console.error("REMINDER_ACK", r.id);
    sent++;
  }
  return { claimed: (data || []).length, sent, failed };
}

/** The morning voice follows the same provider/model settings as the chat AI. */
export async function morningVoiceConfig(deps: Pick<DispatchDeps, "db" | "keys">): Promise<VoiceConfig> {
  try {
    const { data, error } = await deps.db.from("telegram_bot_config").select("setting_key,setting_value");
    if (error || !data) return {};
    const x = new Map<string, string>((data || []).map((v: { setting_key: string; setting_value: string }) => [String(v.setting_key), String(v.setting_value)]));
    return {
      geminiKey: deps.keys?.gemini || undefined,
      openrouterKey: deps.keys?.openrouter || undefined,
      geminiModel: x.get("model") || undefined,
      openrouterModel: x.get("openrouter_model") || undefined,
      prefer: x.get("provider") === "openrouter" ? "openrouter" : "gemini",
    };
  } catch {
    return {};
  }
}

export async function dispatchBriefings(deps: DispatchDeps, cache: Cache = tickCache(deps)) {
  const { db } = deps;
  const { data, error } = await db.rpc("saeed_ai_claim_briefings", { p_limit: 6 });
  if (error) throw Error("BRIEF_CLAIM_" + error.code);
  let sent = 0, failed = 0;
  const voiceCfg = (data || []).length ? await morningVoiceConfig(deps) : {};
  for (const item of data || []) {
    const uid = Number(item.telegram_user_id), chat = Number(item.telegram_chat_id);
    const now = deps.now?.() || new Date();
    try {
      const { data: p, error: prefError } = await db.from("saeed_ai_briefing_preferences")
        .select("enabled,timezone,city,city_lat,city_lon,city_label,voice").eq("telegram_user_id", uid).maybeSingle();
      if (prefError) throw Error("BRIEF_PREF");
      if (!p?.enabled) continue;
      const tz = safeTimeZone(p.timezone);
      const [tasks, rems, expenses] = await Promise.all([
        db.from("saeed_ai_tasks").select("task").eq("telegram_user_id", uid).eq("done", false).order("id").limit(6),
        db.from("saeed_ai_reminders").select("note,remind_at").eq("telegram_user_id", uid).eq("sent", false).eq("canceled", false).order("remind_at").limit(25),
        db.from("saeed_ai_expenses").select("amount_toman").eq("telegram_user_id", uid).gte("created_at", new Date(now.getTime() - 86400000).toISOString()).limit(200),
      ]);
      if (tasks.error || rems.error || expenses.error) throw Error("BRIEF_READ");
      const day = String(item.local_day);
      const start = startOfLocalDay(day, tz).getTime();
      const todayRems = (rems.data || []).filter((r: { remind_at: string }) => {
        const at = new Date(r.remind_at).getTime();
        return at >= start && at < start + 86400000;
      }).slice(0, 7);
      const total = (expenses.data || []).reduce((sum: bigint, x: { amount_toman: string | number }) => sum + BigInt(x.amount_toman), 0n);
      const city: CityRef = p.city_lat !== null && p.city_lat !== undefined && p.city_lon !== null && p.city_lon !== undefined
        ? { lat: Number(p.city_lat), lon: Number(p.city_lon), label: String(p.city_label || "شهر تو") } : TEHRAN;
      const dayLabel = new Intl.DateTimeFormat("fa-IR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now);
      const [weather, market] = await Promise.all([cache.weather(city), cache.market()]);
      // Six users per claim: weather/market 6.5s (shared per tick) + shared AI deadline 7s + Telegram send
      // per user, with headroom for database IO, stay below the five-minute lease.
      const facts: MorningFacts = {
        dayLabel, cityLabel: city.label,
        weather: weather?.values ? { ...weather.values } : null,
        tasks: (tasks.data || []).map((x: { task: string }) => String(x.task)),
        reminders: todayRems.map((r: { note: string; remind_at: string }) => ({ note: String(r.note), time: formatLocalTime(new Date(r.remind_at), tz) })),
        expense: total > 0n ? total.toLocaleString("fa-IR") + " تومان" : null,
        marketKnown: !!market,
      };
      const voice = await composeMorningVoice(voiceCfg, facts, deps.fetcher || fetch);
      // briefingIntro supplies the deterministic fallbackIntro without repeating the sourced weather.
      const intro = briefingIntro(voice, facts);
      const { signoff } = dayQuote(day);
      const body = [
        `☀️ صبح‌نامه ${dayLabel}`,
        intro,
        todayRems.length ? "⏰ یادآورهای امروز:\n" + todayRems.map((x: { note: string; remind_at: string }) => "• " + x.note + "، " + formatLocalTime(new Date(x.remind_at), tz)).join("\n") : "",
        (tasks.data || []).length ? "✅ کارهای باز:\n" + (tasks.data || []).map((x: { task: string }) => "• " + x.task).join("\n") : "",
        total > 0n ? `💰 خرج ثبت‌شده ۲۴ ساعت گذشته${(expenses.data || []).length === 200 ? " (۲۰۰ مورد اخیر)" : ""}: ${total.toLocaleString("fa-IR")} تومان` : "",
        weather?.line || "🌤 آب‌وهوا: منبع معتبر فعلاً در دسترس نیست.",
        market?.line || "",
        signoff,
        "اگه دوست نداشتی، فقط بگو «صبح‌نامه خاموش» 🌙",
      ].filter(Boolean).join("\n\n");
      await deps.send(chat, body);
      const { error: saveError } = await db.from("saeed_ai_briefing_preferences")
        .update({ last_sent_day: day, lease_until: null }).eq("telegram_user_id", uid).eq("enabled", true);
      if (saveError) throw Error("BRIEF_ACK");
      sent++;
      // Extras never fail the (already delivered) briefing.
      const riddle = dayRiddle(day);
      try {
        await deps.sendHtml(chat, `🎲 چالش امروز: ${escapeHtml(riddle.question)}\nجواب: <tg-spoiler>${escapeHtml(riddle.answer)}</tg-spoiler>`);
      } catch (e) {
        console.error("BRIEF_RIDDLE", uid, e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN");
      }
      // Voice-out is the dedicated Gemini TTS engine: with OpenRouter active
      // there is no hidden Gemini call — the briefing stays text-only.
      if (p.voice && deps.speak && voiceCfg.prefer !== "openrouter") {
        try {
          await deps.speak(chat, intro + " " + signoff);
        } catch (e) {
          console.error("BRIEF_VOICE", uid, e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN");
        }
      }
    } catch (e) {
      failed++;
      await db.from("saeed_ai_briefing_preferences").update({ lease_until: null }).eq("telegram_user_id", uid);
      console.error("BRIEF_DELIVERY", uid, e instanceof Error ? e.message.slice(0, 80) : "UNKNOWN");
    }
  }
  return { claimed: (data || []).length, sent, failed };
}

/** Market alerts every 10 minutes and rain alerts at 07:00 local time. At most once per alert. */
export async function dispatchWatchers(deps: DispatchDeps, cache: Cache = tickCache(deps)) {
  const { db } = deps;
  const now = deps.now?.() || new Date();
  let fired = 0;
  if (now.getUTCMinutes() % 10 === 0) {
    const { data: market, error } = await db.from("saeed_ai_watchers").select("id,telegram_chat_id,kind,threshold,note")
      .eq("active", true).in("kind", ["usd_above", "usd_below", "gold_above", "gold_below"]).limit(200);
    if (error) throw Error("WATCH_READ");
    if ((market || []).length) {
      const quote = (await cache.market())?.values;
      for (const w of market || []) {
        if (!quote || !marketTriggered(w.kind, Number(w.threshold), quote)) continue;
        // Claim first (at most once): a concurrent tick cannot fire it again.
        const { data: claimed } = await db.from("saeed_ai_watchers").update({ active: false, fired_at: now.toISOString() })
          .eq("id", w.id).eq("active", true).select("id");
        if (!claimed?.length) continue;
        const value = w.kind.startsWith("usd") ? quote.usd : quote.gold;
        try {
          await deps.send(Number(w.telegram_chat_id), `🔔 هشدار: ${w.note}!\nنرخ فعلی: ${Number(value).toLocaleString("fa-IR")} تومان (منبع: Navasan-API، غیررسمی)`);
          fired++;
        } catch (e) {
          console.error("WATCH_SEND", w.id, e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN");
        }
      }
    }
  }
  const { data: rain, error: rainError } = await db.from("saeed_ai_watchers")
    .select("id,telegram_user_id,telegram_chat_id,note,recurring,target_day,last_fired_day")
    .eq("active", true).eq("kind", "rain").limit(200);
  if (rainError) throw Error("WATCH_READ");
  for (const w of rain || []) {
    const uid = Number(w.telegram_user_id);
    const tz = await cache.zone(uid);
    const local = localParts(now, tz);
    const today = localDay(now, tz);
    if (w.target_day && today > w.target_day) {
      await db.from("saeed_ai_watchers").update({ active: false }).eq("id", w.id);
      continue;
    }
    if (local.hour !== 7 || (w.target_day && today !== w.target_day) || w.last_fired_day === today) continue;
    const claim = db.from("saeed_ai_watchers").update({ last_fired_day: today, ...(w.target_day ? { active: false } : {}) }).eq("id", w.id);
    const { data: claimed } = await (w.last_fired_day ? claim.eq("last_fired_day", w.last_fired_day) : claim.is("last_fired_day", null)).select("id");
    if (!claimed?.length) continue;
    const { data: p } = await db.from("saeed_ai_briefing_preferences").select("city_lat,city_lon,city_label").eq("telegram_user_id", uid).maybeSingle();
    const city: CityRef = p?.city_lat != null && p?.city_lon != null ? { lat: Number(p.city_lat), lon: Number(p.city_lon), label: String(p.city_label || "شهر تو") } : TEHRAN;
    const weather = await cache.weather(city);
    if (!weather?.values || !rainLikely(weather.values.rain)) continue;
    try {
      await deps.send(Number(w.telegram_chat_id), `☔ ${w.note}\nاحتمال بارش امروز در ${city.label}: ${Math.round(weather.values.rain).toLocaleString("fa-IR")}٪ (منبع: Open-Meteo)`);
      fired++;
    } catch (e) {
      console.error("WATCH_SEND", w.id, e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN");
    }
  }
  return { fired };
}

/** «خلاصه هفته» on Friday 20:00 local time for users who opted in. */
export async function dispatchWeekly(deps: DispatchDeps) {
  const { db } = deps;
  const now = deps.now?.() || new Date();
  const { data, error } = await db.from("saeed_ai_briefing_preferences")
    .select("telegram_user_id,telegram_chat_id,timezone,last_weekly_day").eq("weekly_enabled", true).limit(500);
  if (error) throw Error("WEEKLY_READ");
  let sent = 0;
  for (const p of data || []) {
    if (sent >= 10) break;
    const tz = safeTimeZone(p.timezone);
    const local = localParts(now, tz);
    const today = localDay(now, tz);
    if (local.weekday !== 5 || local.hour !== 20 || p.last_weekly_day === today) continue;
    const claim = db.from("saeed_ai_briefing_preferences").update({ last_weekly_day: today }).eq("telegram_user_id", p.telegram_user_id);
    const { data: claimed } = await (p.last_weekly_day ? claim.eq("last_weekly_day", p.last_weekly_day) : claim.is("last_weekly_day", null)).select("telegram_user_id");
    if (!claimed?.length) continue;
    try {
      const card = await buildWeekly({ db, tg: async () => undefined, send: async () => undefined }, Number(p.telegram_user_id), now);
      await deps.send(Number(p.telegram_chat_id), card + "\n\nخاموش‌کردن: «خلاصه هفته خاموش»");
      sent++;
    } catch (e) {
      console.error("WEEKLY_SEND", p.telegram_user_id, e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN");
    }
  }
  return { sent };
}

/** One dispatcher tick: every section is isolated so one failure cannot starve the others. */
export async function runTick(deps: DispatchDeps) {
  const cache = tickCache(deps);
  const result: Record<string, unknown> = {};
  const sections: Array<[string, () => Promise<unknown>]> = [
    ["reminders", () => dispatchReminders(deps, cache)],
    ["briefings", () => dispatchBriefings(deps, cache)],
    ["watchers", () => dispatchWatchers(deps, cache)],
    ["weekly", () => dispatchWeekly(deps)],
  ];
  let ok = true;
  for (const [name, run] of sections) {
    try {
      result[name] = await run();
    } catch (e) {
      ok = false;
      result[name] = { error: e instanceof Error ? e.message.slice(0, 60) : "UNKNOWN" };
      console.error("DISPATCH", name, result[name]);
    }
  }
  const now = deps.now?.() || new Date();
  if (shouldSweep(now)) result.sweep_failed = await runSweep(deps.db, now.getTime());
  return { ok, ...result };
}
