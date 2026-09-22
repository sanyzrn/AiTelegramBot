/** Conditional reminders: «وقتی دلار از ۹۵ هزار رد شد خبرم کن», «اگه فردا بارون اومد یادم بنداز». */
import { type LifeContext } from "./life-context.ts";
import { localDay, userTimeZone } from "./timezone.ts";

export type WatcherKind = "usd_above" | "usd_below" | "gold_above" | "gold_below" | "rain";
export type WatcherSpec = { kind: WatcherKind; threshold: number | null; note: string; recurring: boolean; tomorrow: boolean };

const digits = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".includes(d) ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** Pure parser; returns null when the condition is not one we can verify from a real source. */
export function parseWatcher(input: string): WatcherSpec | null {
  const t = digits(input.trim()).replace(/\s+/g, " ");
  if (!/^(?:وقتی|اگه|اگر|هر\s*وقت|هروقت)\s/u.test(t)) return null;
  const recurring = /^(?:هر\s*وقت|هروقت)/u.test(t);
  if (/(?:بارون|باران|برف|بارش)/u.test(t)) {
    const note = /(?:یادم\s+بنداز|خبرم\s+کن|بهم\s+بگو)\s*(?:که\s+)?(.{2,120})?$/u.exec(t)?.[1]?.trim();
    const tomorrow = /فردا/u.test(t);
    return { kind: "rain", threshold: null, note: note || "هوا بارونیه؛ چتر یادت نره ☔", recurring: recurring || !tomorrow, tomorrow };
  }
  const asset = /دلار/u.test(t) ? "usd" : /طلا/u.test(t) ? "gold" : null;
  if (!asset) return null;
  const above = /(?:رد\s*شد|بالا(?:ی|تر)|بیشتر|رسید|گذشت|بالا\s*رفت)/u.test(t);
  const below = /(?:زیر|کمتر|پایین)/u.test(t);
  if (above === below) return null;
  // «طلای ۱۸ عیار» is a karat, not the threshold.
  const m = /([0-9][0-9,٬،.]*)\s*(هزار|میلیون)?\s*(تومان|تومن|ریال)?/u.exec(t.replace(/[0-9]{2}\s*عیار/gu, ""));
  if (!m) return null;
  let value = Number(m[1].replace(/[,٬،]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (m[2] === "هزار") value *= 1000;
  if (m[2] === "میلیون") value *= 1000000;
  if (m[3] === "ریال") value /= 10;
  value = Math.round(value);
  // Sanity bounds shared with the market feed validation.
  if (asset === "usd" && (value < 1000 || value > 10000000)) return null;
  if (asset === "gold" && (value < 100000 || value > 1000000000)) return null;
  const label = asset === "usd" ? "دلار" : "هر گرم طلای ۱۸ عیار";
  return {
    kind: `${asset}_${above ? "above" : "below"}` as WatcherKind,
    threshold: value,
    note: `${label} ${above ? "از" : "به زیر"} ${value.toLocaleString("fa-IR")} تومان ${above ? "رد شد" : "رسید"}`,
    recurring: false,
    tomorrow: false,
  };
}

export async function addWatcher(c: LifeContext, id: number, chat: number, text: string): Promise<boolean> {
  const spec = parseWatcher(text);
  if (!spec) return false;
  const { count, error: countError } = await c.db.from("saeed_ai_watchers").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("active", true);
  if (countError) throw Error("WATCH_COUNT");
  if ((count ?? 0) >= 10) {
    await c.send(chat, "🔔 حداکثر ۱۰ هشدار فعال می‌تونی داشته باشی؛ با «هشدارهام» چندتاشو لغو کن.");
    return true;
  }
  const tz = await userTimeZone(c.db, id);
  const target = spec.tomorrow ? localDay(new Date(Date.now() + 86400000), tz) : null;
  const { error } = await c.db.from("saeed_ai_watchers").insert({
    telegram_user_id: id, telegram_chat_id: chat, kind: spec.kind, threshold: spec.threshold,
    note: spec.note.slice(0, 200), recurring: spec.recurring, target_day: target, active: true,
  });
  if (error) throw Error("WATCH_SAVE");
  await c.send(chat, spec.kind === "rain"
    ? `🔔 ثبت شد! ${spec.tomorrow ? "فردا" : "هر روز"} ساعت ۷ صبح پیش‌بینی هوای شهرت رو از Open-Meteo چک می‌کنم و اگه احتمال بارش بالا بود بهت می‌گم: «${spec.note}».`
    : `🔔 ثبت شد! هر چند دقیقه نرخ رو از Navasan چک می‌کنم و وقتی ${spec.note}، خبرت می‌کنم. (فقط با نرخ تازه و منبع‌دار)`);
  return true;
}

export async function listWatchers(c: LifeContext, id: number, chat: number) {
  const { data, error } = await c.db.from("saeed_ai_watchers").select("id,kind,note,recurring,target_day")
    .eq("telegram_user_id", id).eq("active", true).order("id").limit(10);
  if (error) throw Error("WATCH_LIST");
  const items = data || [];
  if (!items.length)
    return c.send(chat, "🔔 هشدار فعالی نداری. مثلاً بگو «وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن» یا «اگه فردا بارون اومد یادم بنداز چتر ببرم».");
  await c.tg("sendMessage", {
    chat_id: chat,
    text: "🔔 هشدارهای فعالت:\n" + items.map((x: { kind: string; note: string; recurring: boolean; target_day: string | null }) =>
      `▫️ ${x.kind === "rain" ? "☔ " : "💵 "}${x.note}${x.kind === "rain" ? (x.target_day ? " (فقط فردا)" : " (هر روز)") : ""}`).join("\n"),
    reply_markup: { inline_keyboard: items.map((x: { id: number; note: string }) => [{ text: `🗑 ${x.note}`.slice(0, 40), callback_data: `watch:cancel:${x.id}` }]) },
  });
}

export async function watcherCallback(c: LifeContext, id: number, chat: number, key: number) {
  const { data, error } = await c.db.from("saeed_ai_watchers").update({ active: false }).eq("id", key).eq("telegram_user_id", id).eq("active", true).select("note");
  if (error) throw Error("WATCH_CANCEL");
  await c.send(chat, data?.length ? `🔕 هشدار «${data[0].note}» لغو شد.` : "این هشدار دیگه فعال نیست.");
}

/** Market condition check against a verified quote. */
export function marketTriggered(kind: string, threshold: number, quote: { usd?: number | null; gold?: number | null }): boolean {
  const value = kind.startsWith("usd") ? quote.usd : quote.gold;
  if (!Number.isFinite(value as number)) return false;
  return kind.endsWith("above") ? (value as number) >= threshold : (value as number) <= threshold;
}

export const rainLikely = (probability: number) => Number.isFinite(probability) && probability >= 50;
