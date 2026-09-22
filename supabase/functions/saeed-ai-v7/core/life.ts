/** Reminders, timers, task persistence and profile for Saeed AI. */
import { handleLifeMessage, renderTasks } from "../../_shared/life.ts";
import { durationLabel, type TimerRequest } from "../../_shared/timer.ts";
import { parseJsonObject } from "../../_shared/ai.ts";
import { formatLocal, localParts, offsetLabel, timeZoneLabel, userTimeZone } from "../../_shared/timezone.ts";
import { loadMemories } from "../../_shared/life-memories.ts";
import { faDigits } from "../../_shared/format.ts";
import { admin, db } from "./state.ts";
import { send, tg } from "./transport.ts";
import { cfg, pref, save } from "./admin.ts";
import { ai } from "./model.ts";
import { LANG, SIZES, TONES } from "./menu.ts";

export async function scheduleRealTimer(id: number, chat: number, timer: TimerRequest, update: number) {
  if (!Number.isSafeInteger(update)) throw Error("TIMER_UPDATE");
  const due = new Date(Date.now() + timer.seconds * 1000);
  const tz = await userTimeZone(db, id);
  const { data: created, error } = await db.from("saeed_ai_reminders")
    .upsert({
      telegram_user_id: id,
      telegram_chat_id: chat,
      note: timer.note,
      remind_at: due.toISOString(),
      repeat_rule: "none",
      telegram_update_id: update,
    }, { onConflict: "telegram_update_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw Error("TIMER_SAVE");
  if (!created?.id) return send(chat, "ℹ️ این تایمر قبلاً ثبت شده بود؛ تایمر تکراری نساختم.");
  await save(id, { pending_tool: "chat" });
  await send(chat,
    `✅ تایمر واقعی ${durationLabel(timer.seconds)} ثبت شد.\n⏰ موعد: ${formatLocal(due, tz)} (${timeZoneLabel(tz)})\n🔔 حداکثر حدود یک دقیقه تأخیر ممکنه؛ این یادآور تلگرامیه، نه تایمر ثانیه‌ای گوشی.`,
    "tools", id);
}

export async function setReminder(id: number, chat: number, input: string, update: number | null = null) {
  // Reminder parsing uses Gemini regardless of the conversational provider.
  const s = { ...(await cfg()), provider: "gemini" as const };
  const tz = await userTimeZone(db, id);
  const now = new Date();
  const local = now.toLocaleString("en-US", {
    timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const offset = offsetLabel(tz, now);
  const r = await ai(
    s,
    [
      {
        role: "user",
        parts: [
          {
            text:
              `Current local time (${tz}, UTC${offset}): ${local}. ` +
              'Parse this Persian reminder request into minified JSON {"note":string,"remind_at":string|null,"repeat_rule":"none|daily|weekly|monthly|hours","repeat_every_hours":number|null}. Return repeat_rule none unless the user explicitly asks to repeat. If repeating every N hours use rule hours and N=1..168; for every day, week or month use daily, weekly or monthly. ' +
              `Convert relative times to ISO8601 with the ${offset} offset. A recurring reminder still needs an unambiguous FIRST occurrence; if unknown use null. Request: ` +
              input,
          },
        ],
      },
    ],
    "Output only minified JSON, no prose, no markdown.",
  );
  const j = parseJsonObject<{ note?: string; remind_at?: string; repeat_rule?: string; repeat_every_hours?: number }>(r.text);
  const when = j?.remind_at ? new Date(j.remind_at) : null;
  if (!j?.note || !when || isNaN(+when) || +when <= Date.now()) {
    await send(
      chat,
      "⏰ زمانش رو دقیق متوجه نشدم؛ مثلاً بنویس «۲۰ دقیقه دیگه قابلمه رو خاموش کن» یا «فردا ۸ صبح جلسه».",
    );
    return;
  }
  if (+when > Date.now() + 30 * 86400000) {
    await send(chat, "⏰ فعلاً تا ۳۰ روز آینده رو پوشش می‌دم؛ نزدیک‌تر بگو. 😉");
    return;
  }
  const rules = ["none", "daily", "weekly", "monthly", "hours"];
  const rule = rules.includes(String(j.repeat_rule)) ? String(j.repeat_rule) : "none";
  const hours = rule === "hours" ? Number(j.repeat_every_hours) : null;
  if (rule === "hours" && (hours === null || !Number.isInteger(hours) || hours < 1 || hours > 168)) {
    await send(chat, "⏰ فاصله تکرار باید بین ۱ تا ۱۶۸ ساعت باشه؛ زمان دقیق‌تر بگو.");
    return;
  }
  if (rule === "none" && /(?:هر\s*\d+\s*ساعت|هر\s*روز|روزانه|هفتگی|ماهانه|هر\s*هفته|هر\s*ماه)/iu.test(input)) {
    await send(chat, "⏰ تکرار رو دقیق متوجه نشدم؛ مثلاً «هر روز ساعت ۸ صبح یادم بنداز».");
    return;
  }
  const anchor = rule === "monthly" ? localParts(when, tz).day : null;
  const { data: created, error } = await db.from("saeed_ai_reminders")
    .upsert({
      telegram_user_id: id,
      telegram_chat_id: chat,
      note: String(j.note).slice(0, 300),
      remind_at: when.toISOString(),
      repeat_rule: rule,
      repeat_every_hours: hours,
      repeat_anchor_day: anchor,
      telegram_update_id: update,
    }, { onConflict: "telegram_update_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw Error("REMIND_SAVE");
  if (!created) return send(chat, "ℹ️ این یادآور قبلاً ثبت شده بود؛ دوباره اضافه نکردم.");
  await save(id, { pending_tool: "chat" });
  await send(
    chat,
    "✅ یادآور ثبت شد!\n📝 " +
      String(j.note).slice(0, 300) +
      "\n🕐 " +
      formatLocal(when, tz) +
      (tz !== "Asia/Tehran" ? ` (${timeZoneLabel(tz)})` : "") +
      "\n\nوقتش که رسید همین‌جا خبرت می‌کنم. 😎 (لیست و لغو: «یادآورهام»)",
    "tools",
    id,
  );
}

export async function saveTasks(id: number, chat: number, input: string, update: number | null = null) {
  const s = { ...(await cfg()), provider: "gemini" as const };
  const r = await ai(
    s,
    [
      {
        role: "user",
        parts: [
          {
            text:
              'Extract concise NEW tasks to APPEND (never replace existing tasks) from this Persian text into strict minified JSON {"tasks":[string]}. Max 10 short imperative Persian items, no invented deadlines. Text: ' +
              input,
          },
        ],
      },
    ],
    "Output only minified JSON, no prose, no markdown.",
  );
  const j = parseJsonObject<{ tasks?: unknown[] }>(r.text);
  const tasks = (Array.isArray(j?.tasks) ? j.tasks : [])
    .map((x) => String(x).trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 10);
  if (!tasks.length) {
    await send(chat, "🙈 تسکی پیدا نکردم؛ واضح‌تر بنویس، مثلاً «باید نون بخرم و به مامان زنگ بزنم».");
    return;
  }
  const { data: created, error } = await db.from("saeed_ai_tasks")
    .upsert(tasks.map((t, i) => ({
      telegram_user_id: id, task: t, source_update_id: update, source_item: i,
      priority: /(?:فوری|اولویت\s*بالا)/u.test(input) ? 1 : 2,
    })), { onConflict: "source_update_id,source_item", ignoreDuplicates: true })
    .select("id");
  if (error) throw Error("TASK_SAVE");
  if (!created?.length) return send(chat, "ℹ️ این تسک‌ها قبلاً ثبت شده بودن؛ دوباره اضافه نکردم.");
  await save(id, { pending_tool: "chat" });
  // The actual task list is the confirmation: users can tick, undo or delete immediately.
  await renderTasks({ db, tg, send }, id, chat);
}

export async function listTasks(id: number, chat: number) {
  return handleLifeMessage({ db, tg, send }, id, chat, "/tasks", 0);
}

export async function doneTask(id: number, chat: number, n: number) {
  // Numbering must match the rendered list exactly: the 30 newest tasks,
  // oldest first, done items included — otherwise «انجام شد ۳» ticks a
  // different task than the one the user sees at position 3.
  if (!Number.isSafeInteger(n) || n < 1 || n > 30) {
    await send(chat, "🙈 شماره تسک معتبر نیست؛ «✅ تسک‌ها» رو بزن تا لیست رو ببینی.");
    return;
  }
  const { data, error: readError } = await db
    .from("saeed_ai_tasks")
    .select("id,task,done")
    .eq("telegram_user_id", id)
    .order("id", { ascending: false })
    .limit(30);
  if (readError) throw Error("TASK_READ");
  const t = (data || []).reverse()[n - 1];
  if (!t) {
    await send(chat, "🙈 تسکی با این شماره پیدا نشد؛ «✅ تسک‌ها» رو بزن تا لیست رو ببینی.");
    return;
  }
  if (t.done) {
    await send(chat, "ℹ️ این تسک قبلاً انجام شده؛ با دکمه ↩️ می‌تونی برگردونیش.");
    return;
  }
  const { error } = await db.from("saeed_ai_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", t.id).eq("telegram_user_id", id).eq("done", false);
  if (error) throw Error("TASK_DONE");
  await renderTasks({ db, tg, send }, id, chat);
}

export async function profile(id: number, chat: number) {
  const p = await pref(id),
    s = await cfg(),
    tz = await userTimeZone(db, id),
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [usage, u, msgs, rems, tks, memories] = await Promise.all([
    db.from("telegram_bot_daily_usage").select("used").eq("telegram_user_id", id).eq("usage_day", day).maybeSingle(),
    db.from("telegram_bot_user_access").select("daily_limit").eq("telegram_user_id", id).maybeSingle(),
    db.from("telegram_chat_messages").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("role", "user"),
    db.from("saeed_ai_reminders").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("sent", false).eq("canceled", false),
    db.from("saeed_ai_tasks").select("id", { count: "exact", head: true }).eq("telegram_user_id", id).eq("done", false),
    loadMemories(db, id),
  ]);
  const lim = u.data?.daily_limit ?? s.daily,
    limit = admin(id) || lim === 0 ? "نامحدود ♾" : faDigits(lim) + " پیام";
  await send(
    chat,
    "📋 پروفایل تو 👤\n\n🎭 لحن: " +
      (TONES[p.tone] || TONES.friendly) +
      "\n📏 اندازه پاسخ: " +
      SIZES[p.answer_length] +
      "\n🌐 زبان: " +
      LANG[p.language] +
      "\n🕰 منطقه زمانی: " +
      timeZoneLabel(tz) +
      "\n\n📊 مصرف امروز: " +
      faDigits(usage.data?.used ?? 0) +
      " / " +
      limit +
      "\n💬 پیام‌های اخیرت توی حافظه: " +
      faDigits(msgs.count ?? 0) +
      "\n🧠 چیزهایی که خواستی یادم بمونه: " +
      faDigits(memories.length) +
      "\n⏰ یادآورهای فعال: " +
      faDigits(rems.count ?? 0) +
      "\n✅ تسک‌های باز: " +
      faDigits(tks.count ?? 0),
    "settings",
    id,
  );
}
