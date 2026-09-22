/** «خلاصه هفته»: a personal weekly card built only from the user's own records. */
import { type LifeContext } from "./life-context.ts";
import { faDigits } from "./format.ts";
import { expenseCategory, money } from "./life-expenses.ts";
import { localDay, userTimeZone } from "./timezone.ts";

const BARS = "▁▂▃▄▅▆▇█";

/** Seven-day sparkline, oldest day first; an all-zero week renders flat. */
export function sparkline(values: number[]): string {
  const max = Math.max(...values, 0);
  return values.map((v) => (max <= 0 ? BARS[0] : BARS[Math.min(BARS.length - 1, Math.round((v / max) * (BARS.length - 1)))])).join("");
}

export type WeeklyInput = {
  now: Date;
  tz: string;
  tasksDone: number;
  tasksOpen: number;
  bought: number;
  activeReminders: number;
  expenses: Array<{ description: string; amount_toman: string | number; created_at: string }>;
};

const CHEERS = [
  "هفته‌ی بعد هم با همین انرژی، قدم‌به‌قدم 💪",
  "هر کار کوچیکی که تموم شد یه برد واقعیه 🌱",
  "به خودت افتخار کن؛ ادامه‌ش با من 😎",
  "یه استراحت درست‌وحسابی هم حقته ☕",
];

export function renderWeekly(x: WeeklyInput): string {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(localDay(new Date(x.now.getTime() - i * 86400000), x.tz));
  const perDay = days.map(() => 0);
  const byCategory = new Map<string, bigint>();
  let total = 0n;
  for (const e of x.expenses) {
    const amount = BigInt(e.amount_toman);
    total += amount;
    const idx = days.indexOf(localDay(new Date(e.created_at), x.tz));
    if (idx >= 0) perDay[idx] += Number(amount);
    const cat = expenseCategory(e.description);
    byCategory.set(cat, (byCategory.get(cat) || 0n) + amount);
  }
  const top = [...byCategory.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 3);
  const cheer = CHEERS[Number(days[6].replace(/-/g, "")) % CHEERS.length];
  return [
    "📅 خلاصه‌ی هفته‌ی تو",
    `✅ کارهای انجام‌شده: ${faDigits(x.tasksDone)}${x.tasksOpen ? ` (هنوز ${faDigits(x.tasksOpen)} کار باز داری)` : ""}`,
    x.bought ? `🛒 اقلام خریده‌شده: ${faDigits(x.bought)}` : "",
    x.activeReminders ? `⏰ یادآورهای فعال: ${faDigits(x.activeReminders)}` : "",
    total > 0n
      ? `💰 خرج هفته: ${money(total)}\n${sparkline(perDay)}  (از ۷ روز پیش تا امروز)\n` +
        top.map(([cat, amount]) => `• ${cat}: ${money(amount)}`).join("\n")
      : "💰 این هفته خرجی ثبت نکردی.",
    cheer,
  ].filter(Boolean).join("\n\n");
}

export async function buildWeekly(c: LifeContext, id: number, now = new Date()): Promise<string> {
  const tz = await userTimeZone(c.db, id);
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const [done, open, bought, rems, exp] = await Promise.all([
    c.db.from("saeed_ai_tasks").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("done", true).gte("done_at", since),
    c.db.from("saeed_ai_tasks").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("done", false),
    c.db.from("saeed_ai_shopping").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("done", true).gte("done_at", since),
    c.db.from("saeed_ai_reminders").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("sent", false).eq("canceled", false),
    c.db.from("saeed_ai_expenses").select("description,amount_toman,created_at").eq("telegram_user_id", id).gte("created_at", since).limit(500),
  ]);
  if (done.error || open.error || exp.error) throw Error("WEEKLY_READ");
  return renderWeekly({
    now, tz,
    tasksDone: done.count ?? 0,
    tasksOpen: open.count ?? 0,
    bought: bought.error ? 0 : bought.count ?? 0,
    activeReminders: rems.error ? 0 : rems.count ?? 0,
    expenses: exp.data || [],
  });
}

export async function weeklyCommand(c: LifeContext, id: number, chat: number, text: string) {
  const toggle = /(روشن|فعال|خاموش|غیرفعال)\s*$/u.exec(text)?.[1];
  if (toggle) {
    const enabled = /^(?:روشن|فعال)$/u.test(toggle);
    const { data: existing, error: readError } = await c.db.from("saeed_ai_briefing_preferences").select("telegram_user_id").eq("telegram_user_id", id).maybeSingle();
    if (readError) throw Error("WEEKLY_PREF");
    const { error } = existing
      ? await c.db.from("saeed_ai_briefing_preferences").update({ weekly_enabled: enabled }).eq("telegram_user_id", id)
      : await c.db.from("saeed_ai_briefing_preferences").insert({ telegram_user_id: id, telegram_chat_id: chat, enabled: false, weekly_enabled: enabled });
    if (error) throw Error("WEEKLY_SAVE");
    return c.send(chat, enabled
      ? "✅ خلاصه‌ی هفته روشن شد؛ هر جمعه ساعت ۸ شب برات می‌فرستم 📅"
      : "✅ خلاصه‌ی هفته خاموش شد. هر وقت خواستی بنویس «خلاصه هفته».");
  }
  await c.send(chat, await buildWeekly(c, id) + "\n\nبرای دریافت خودکار هر جمعه: «خلاصه هفته روشن»");
}
