/** Reminders, timers, task persistence and profile for Saeed AI. */
import { handleLifeMessage, renderTasks } from "../../_shared/life.ts";
import type { TimerRequest } from "../../_shared/timer.ts";
import { admin, db } from "./state.ts";
import { send, tg } from "./transport.ts";
import { cfg, pref, save } from "./admin.ts";
import { ai } from "./model.ts";
import { LANG, SIZES, TONES } from "./menu.ts";

let lastSweep = 0;

export async function sweep() {
  if (Date.now() - lastSweep < 3600000) return;
  lastSweep = Date.now();
  try {
    const cutoff = new Date(Date.now() - 36 * 3600000).toISOString();
    await db.from("telegram_chat_messages").delete().lt("created_at", cutoff);
    await db
      .from("saeed_ai_voice_pending")
      .delete()
      .lt("expires_at", new Date().toISOString());
    await db
      .from("saeed_ai_retry")
      .delete()
      .lt("expires_at", new Date().toISOString());
    await db
      .from("saeed_ai_reminders")
      .delete()
      .eq("sent", true)
      .lt("created_at", cutoff);
    await db
      .from("saeed_ai_tasks")
      .delete()
      .eq("done", true)
      .lt("created_at", cutoff);
  } catch (e) {
    console.error("SWEEP", String(e).slice(0, 60));
  }
}

export async function scheduleRealTimer(id, chat, timer: TimerRequest, update) {
  if (!Number.isSafeInteger(update)) throw Error("TIMER_UPDATE");
  const due = new Date(Date.now() + timer.minutes * 60000);
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
    `✅ تایمر واقعی ${timer.minutes.toLocaleString("fa-IR")} دقیقه‌ای ثبت شد.\n⏰ موعد: ${due.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })} (تهران)\n🔔 حداکثر حدود یک دقیقه تأخیر ممکنه؛ این یادآور تلگرامیه، نه تایمر ثانیه‌ای گوشی.`,
    "tools", id);
}

export async function setReminder(id, chat, input, update = null) {
  // Reminder parsing uses Gemini regardless of the conversational provider.
  const s = { ...(await cfg()), provider: "gemini" };
  const tehran = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Tehran",
  });
  const r = await ai(
    s,
    [
      {
        role: "user",
        parts: [
          {
            text:
              "Current Tehran time: " +
              tehran +
              '. Parse this Persian reminder request into minified JSON {"note":string,"remind_at":string|null,"repeat_rule":"none|daily|weekly|monthly|hours","repeat_every_hours":number|null}. Return repeat_rule none unless the user explicitly asks to repeat. If repeating every N hours use rule hours and N=1..168; for every day, week or month use daily, weekly or monthly. Convert relative times to ISO8601 with +03:30 Tehran offset. A recurring reminder still needs an unambiguous FIRST occurrence; if unknown use null. Request: ' +
              input,
          },
        ],
      },
    ],
    "Output only minified JSON, no prose, no markdown.",
  );
  const m = /\{[\s\S]*\}/.exec(r.text || "");
  let j = null;
  try {
    j = JSON.parse(m?.[0] || "");
  } catch {}
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
  const rule = rules.includes(j?.repeat_rule) ? j.repeat_rule : "none";
  const hours = rule === "hours" ? Number(j?.repeat_every_hours) : null;
  if (rule === "hours" && (!Number.isInteger(hours) || hours < 1 || hours > 168)) {
    await send(chat, "⏰ فاصله تکرار باید بین ۱ تا ۱۶۸ ساعت باشه؛ زمان دقیق‌تر بگو.");
    return;
  }
  if (rule === "none" && /(?:هر\s*\d+\s*ساعت|هر\s*روز|روزانه|هفتگی|ماهانه|هر\s*هفته|هر\s*ماه)/iu.test(input)) {
    await send(chat, "⏰ تکرار رو دقیق متوجه نشدم؛ مثلاً «هر روز ساعت ۸ صبح یادم بنداز».");
    return;
  }
  const anchor = rule === "monthly" ? new Date(when.getTime() + 210 * 60000).getUTCDate() : null;
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
      when.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) +
      "\n\nوقتش که رسید همین‌جا خبرت می‌کنم. 😎",
    "tools",
    id,
  );
}

export async function saveTasks(id, chat, input, update = null) {
  const s = { ...(await cfg()), provider: "gemini" };
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
  const m = /\{[\s\S]*\}/.exec(r.text || "");
  let j = null;
  try {
    j = JSON.parse(m?.[0] || "");
  } catch {}
  const tasks = (j?.tasks || [])
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

export async function listTasks(id, chat) {
  return handleLifeMessage({ db, tg, send }, id, chat, "/tasks", 0);
}

export async function doneTask(id, chat, n) {
  const { data, error: readError } = await db
    .from("saeed_ai_tasks")
    .select("id,task")
    .eq("telegram_user_id", id)
    .eq("done", false)
    .order("id")
    .limit(20);
  if (readError) throw Error("TASK_READ");
  const t = (data || [])[n - 1];
  if (!t) {
    await send(chat, "🙈 تسکی با این شماره پیدا نشد؛ «✅ تسک‌ها» رو بزن تا لیست رو ببینی.");
    return;
  }
  const { error } = await db.from("saeed_ai_tasks").update({ done: true }).eq("id", t.id).eq("telegram_user_id", id).eq("done", false);
  if (error) throw Error("TASK_DONE");
  await renderTasks({ db, tg, send }, id, chat);
}

export async function profile(id, chat) {
  const p = await pref(id),
    s = await cfg(),
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const { data: usage } = await db
    .from("telegram_bot_daily_usage")
    .select("used")
    .eq("telegram_user_id", id)
    .eq("usage_day", day)
    .maybeSingle();
  const { data: u } = await db
    .from("telegram_bot_user_access")
    .select("daily_limit")
    .eq("telegram_user_id", id)
    .maybeSingle();
  const lim = u?.daily_limit ?? s.daily,
    limit = admin(id) || lim === 0 ? "نامحدود ♾" : lim + " پیام";
  const { count: msgs } = await db
    .from("telegram_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("telegram_user_id", id)
    .eq("role", "user");
  const { count: rems } = await db
    .from("saeed_ai_reminders")
    .select("id", { count: "exact", head: true })
    .eq("telegram_user_id", id)
    .eq("sent", false);
  const { count: tks } = await db
    .from("saeed_ai_tasks")
    .select("id", { count: "exact", head: true })
    .eq("telegram_user_id", id)
    .eq("done", false);
  await send(
    chat,
    "📋 پروفایل تو 👤\n\n🎭 لحن: " +
      (TONES[p.tone] || TONES.friendly) +
      "\n📏 اندازه پاسخ: " +
      SIZES[p.answer_length] +
      "\n🌐 زبان: " +
      LANG[p.language] +
      "\n\n📊 مصرف امروز: " +
      (usage?.used ?? 0) +
      " / " +
      limit +
      "\n💬 پیام‌های اخیرت توی حافظه: " +
      (msgs ?? 0) +
      "\n⏰ یادآورهای فعال: " +
      (rems ?? 0) +
      "\n✅ تسک‌های باز: " +
      (tks ?? 0),
    "settings",
    id,
  );
}
