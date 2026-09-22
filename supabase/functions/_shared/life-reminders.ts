/** Active reminders list with cancel buttons, reminder callbacks and Pomodoro sessions. */
import { type LifeContext } from "./life-context.ts";
import { faDigits } from "./format.ts";
import { formatLocal, userTimeZone } from "./timezone.ts";

const RULE_LABEL: Record<string, string> = { daily: "🔁 روزانه", weekly: "🔁 هفتگی", monthly: "🔁 ماهانه", hours: "🔁 ساعتی" };

export async function listReminders(c: LifeContext, id: number, chat: number) {
  const tz = await userTimeZone(c.db, id);
  const { data, error } = await c.db.from("saeed_ai_reminders").select("id,note,remind_at,repeat_rule")
    .eq("telegram_user_id", id).eq("sent", false).eq("canceled", false).order("remind_at").limit(15);
  if (error) throw Error("REM_LIST");
  const items = data || [];
  if (!items.length) return c.send(chat, "⏰ یادآور فعالی نداری. مثلاً بنویس «فردا ۸ صبح جلسه رو یادم بنداز».");
  await c.tg("sendMessage", {
    chat_id: chat,
    text: "⏰ یادآورهای فعالت:\n" + items.map((x: { note: string; remind_at: string; repeat_rule: string }) =>
      `▫️ ${x.note} — ${formatLocal(new Date(x.remind_at), tz)}${RULE_LABEL[x.repeat_rule] ? " " + RULE_LABEL[x.repeat_rule] : ""}`).join("\n") +
      "\n\nبرای لغو هر کدوم دکمه‌اش رو بزن.",
    reply_markup: {
      inline_keyboard: items.map((x: { id: number; note: string }) => [{ text: `🗑 ${x.note}`.slice(0, 40), callback_data: `reminder:cancel:${x.id}` }]),
    },
  });
}

/** done: acknowledge and remove the buttons; snooze: once per delivery; cancel: stop this and future occurrences. */
export async function reminderCallback(c: LifeContext, id: number, chat: number, action: string, key: number, messageId?: number) {
  const { data: r, error: readError } = await c.db.from("saeed_ai_reminders")
    .select("id,telegram_user_id,telegram_chat_id,note,repeat_rule,sent_at,canceled")
    .eq("id", key).eq("telegram_user_id", id).eq("telegram_chat_id", chat).maybeSingle();
  if (readError) throw Error("REM_CALLBACK_READ");
  if (action === "done") {
    // The buttons belong to one delivered occurrence: once handled they must disappear.
    if (messageId) {
      try {
        await c.tg("editMessageReplyMarkup", { chat_id: chat, message_id: messageId, reply_markup: { inline_keyboard: [] } });
      } catch { /* old message */ }
    }
    await c.send(chat, r && r.repeat_rule !== "none" && !r.canceled ? "✅ این نوبت انجام شد؛ نوبت بعدی سر وقتش میاد. 🌱" : "✅ انجام شد. 🌱");
    return;
  }
  if (!r || r.canceled) {
    await c.send(chat, "این یادآور فعال نیست.");
    return;
  }
  if (action === "cancel") {
    const { error } = await c.db.from("saeed_ai_reminders").update({ canceled: true, sent: true, status: "sent", lease_until: null }).eq("id", key).eq("telegram_user_id", id);
    if (error) throw Error("REM_CANCEL");
    await c.send(chat, r.repeat_rule !== "none" ? `✅ «${r.note}» و تکرارهای بعدی‌اش لغو شد.` : `✅ یادآور «${r.note}» لغو شد.`);
    return;
  }
  if (!r.sent_at || Date.now() - new Date(r.sent_at).getTime() > 2 * 86400000) {
    await c.send(chat, "مهلت تعویق این نوبت تموم شده.");
    return;
  }
  const snoozeKey = `${r.id}:${r.sent_at}`;
  const { data, error } = await c.db.from("saeed_ai_reminders").upsert({
    telegram_user_id: id, telegram_chat_id: chat, note: r.note, remind_at: new Date(Date.now() + 600000).toISOString(), snooze_key: snoozeKey,
  }, { onConflict: "snooze_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw Error("REM_SNOOZE");
  await c.send(chat, data ? "⏰ ده دقیقه دیگه دوباره خبرت می‌کنم." : "ℹ️ این نوبت قبلاً ده دقیقه عقب افتاده.");
}

/** Classic 25/5 Pomodoro built on real reminders; 1-4 sessions. */
export function pomodoroPlan(sessions: number, start = Date.now()): Array<{ at: Date; note: string }> {
  const n = Math.min(Math.max(Math.trunc(sessions) || 1, 1), 4);
  const plan: Array<{ at: Date; note: string }> = [];
  let t = start;
  for (let i = 1; i <= n; i++) {
    t += 25 * 60000;
    plan.push({
      at: new Date(t),
      note: i === n ? `🍅 پومودوروی ${faDigits(i)} تموم شد؛ آفرین! جلسه کامل شد 🎉` : `🍅 پومودوروی ${faDigits(i)} تموم شد؛ ۵ دقیقه استراحت کن ☕`,
    });
    if (i < n) {
      t += 5 * 60000;
      plan.push({ at: new Date(t), note: `☕ استراحت تموم شد؛ پومودوروی ${faDigits(i + 1)} از همین الان شروع شد 💪` });
    }
  }
  return plan;
}

export async function startPomodoro(c: LifeContext, id: number, chat: number, sessions: number, update: number | null) {
  const plan = pomodoroPlan(sessions);
  const tz = await userTimeZone(c.db, id);
  // The first row carries the Telegram update id, so a re-delivered webhook cannot double-book.
  const { data: first, error } = await c.db.from("saeed_ai_reminders").upsert({
    telegram_user_id: id, telegram_chat_id: chat, note: plan[0].note, remind_at: plan[0].at.toISOString(),
    repeat_rule: "none", telegram_update_id: update,
  }, { onConflict: "telegram_update_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw Error("POMODORO_SAVE");
  if (!first?.id) return c.send(chat, "ℹ️ این پومودورو قبلاً ثبت شده بود.");
  if (plan.length > 1) {
    const { error: restError } = await c.db.from("saeed_ai_reminders").insert(plan.slice(1).map((p) => ({
      telegram_user_id: id, telegram_chat_id: chat, note: p.note, remind_at: p.at.toISOString(), repeat_rule: "none",
    })));
    if (restError) throw Error("POMODORO_SAVE");
  }
  const sessionsCount = Math.ceil(plan.length / 2);
  await c.send(chat, `🍅 پومودورو شروع شد! ${faDigits(sessionsCount)} جلسه‌ی ۲۵ دقیقه‌ای${sessionsCount > 1 ? " با ۵ دقیقه استراحت بینشون" : ""}.\n⏰ پایان: ${formatLocal(plan[plan.length - 1].at, tz)}\nتمرکز کن، سر هر مرحله خبرت می‌کنم. برای لغو: «یادآورهام».`);
}
