import { briefingExternalSections, geocodeCity, fetchCityWeather, type CityRef } from "./briefing-sources.ts";
import { type LifeContext, safeId, showView } from "./life-context.ts";
import { RX, toLatinDigits } from "./life-commands.ts";
import { deleteLastExpense, expenseCallback, parseExpense, renderExpenses, saveExpense, money } from "./life-expenses.ts";
import {
  addShopping, clearDoneShopping, joinShopping, leaveShopping, listShopping, removeShopping, shareShopping, shoppingCallback,
} from "./life-shopping.ts";
import { listReminders, reminderCallback, startPomodoro } from "./life-reminders.ts";
import { addMemory, clearMemories, memoryCallback, renderMemories } from "./life-memories.ts";
import { addWatcher, listWatchers, watcherCallback } from "./life-watchers.ts";
import { weeklyCommand } from "./life-weekly.ts";
import { receiptCallback } from "./receipt.ts";
import { isValidTimeZone, timeZoneLabel, userTimeZone } from "./timezone.ts";
import { faDigits } from "./format.ts";
/** Private-chat life utilities. All mutations are scoped to their Telegram owner. */
export type { LifeContext } from "./life-context.ts";
export { parseExpense } from "./life-expenses.ts";

/** Use exactly the same renderer for initial task lists and inline refreshes. */
export async function renderTasks(c: LifeContext, id: number, chat: number, messageId?: number): Promise<void> {
  const { data, error } = await c.db.from("saeed_ai_tasks")
    .select("id,task,done,priority,due_at").eq("telegram_user_id", id)
    .order("id", { ascending: false }).limit(30);
  if (error) throw Error("TASK_READ");
  const tasks = (data || []).reverse();
  const rows = tasks.map((x: { id: number; task: string; done: boolean }) => [{
    text: `${x.done ? "↩️" : "✅"} ${String(x.task).slice(0, 40)}`,
    callback_data: `task:${x.done ? "undo" : "done"}:${x.id}`,
  }, { text: "🗑", callback_data: `task:delete:${x.id}` }]);
  await showView(c, {
    chat_id: chat,
    text: "✅ تسک‌های من:\n" + (tasks.map((x: { task: string; done: boolean }) => `${x.done ? "☑️" : "▫️"} ${x.task}`).join("\n") || "فعلاً خالیه. یک کار جدید بگو."),
    // Telegram rejects an empty inline_keyboard with a 400, which used to turn
    // "delete the last task" into a generic router error.
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  }, messageId);
}

/** City commands for the morning briefing. Question-y phrases never mutate anything. Returns true when the message was recognized. */
const CITY_NAME_BAD = /[?؟!،,]|چیه|چی\s*هست|کجاست|کدوم|کدام|چطور|چقدر|چند|پاک|حذف|نمی|بگو|باشه|لطف|بذار|بگذار|بزار|تنظیم|ثبت/u;
// Clearing accepts the attached «شهرم» form exactly like setting and showing do.
const cityClear = /^(?:\/city\s+(?:clear|reset|off|remove|delete)|شهر(?:م|\s+صبح[‌\s-]*نامه(?:\s+من)?|\s+من)?\s*(?:رو\s*)?(?:پاک|حذف)\s+کن)$/iu;
const cityShow = /^(?:\/city|شهر\s*من|شهرم)(?:\s*(?:چیه|چی\s*هست)\s*[?؟]?|\s*[?؟])?$/iu;
// The verb-first colloquial order («شهرم رو بذار رشت») must capture the city, not the verbs.
const citySet = /^(?:\/city\s+(.+?)|شهر(?:\s+صبح[‌\s-]*نامه)?(?:\s+من)?\s*[:：]\s*(.+?)|شهر\s+صبح[‌\s-]*نامه\s+(.+?)|(?:شهر\s*من|شهرم)\s+(?:رو\s+|را\s+)?(?:بذار|بگذار|بزار|ثبت\s*کن|تنظیم\s*کن)\s+(.+?)|(?:شهر\s*من|شهرم)\s+(.+?))(?:\s+(?:رو|را))?(?:\s+(?:بذار|بگذار|بزار|ثبت\s*کن|تنظیم\s*کن))?\s*$/iu;

/** Insert-or-update the per-user life preferences row without ever enabling the briefing silently. */
async function patchLifePrefs(c: LifeContext, id: number, chat: number, patch: Record<string, unknown>) {
  const { data: existing, error: readError } = await c.db.from("saeed_ai_briefing_preferences").select("telegram_user_id,enabled").eq("telegram_user_id", id).maybeSingle();
  if (readError) throw Error("LIFE_PREF_READ");
  const { error } = existing
    ? await c.db.from("saeed_ai_briefing_preferences").update(patch).eq("telegram_user_id", id)
    : await c.db.from("saeed_ai_briefing_preferences").insert({ telegram_user_id: id, telegram_chat_id: chat, enabled: false, ...patch });
  if (error) throw Error("LIFE_PREF_SAVE");
  return existing;
}

export async function handleCityMessage(c: LifeContext, id: number, chat: number, msg: string): Promise<boolean> {
  if (cityClear.test(msg)) {
    const { error } = await c.db.from("saeed_ai_briefing_preferences").update({ city: null, city_lat: null, city_lon: null, city_label: null }).eq("telegram_user_id", id);
    if (error) throw Error("BRIEF_CITY_CLEAR");
    await c.send(chat, "✅ شهرت پاک شد؛ فعلاً به‌جاش هوای تهران رو نگاه می‌کنم. هر وقت خواستی دوباره بگو «شهر من ...» 🏙");
    return true;
  }
  if (cityShow.test(msg)) {
    const { data, error } = await c.db.from("saeed_ai_briefing_preferences").select("city_label,enabled").eq("telegram_user_id", id).maybeSingle();
    if (error) throw Error("BRIEF_CITY_SHOW");
    await c.send(chat, data?.city_label
      ? `🏙 شهرت رو ${data.city_label} گذاشتی${data.enabled ? "؛ صبح‌نامه‌هات هوای همین‌جا رو می‌گن 🌤" : ""}. برای عوض‌کردن بگو «شهر من ...».`
      : "هنوز شهری انتخاب نکردی! بگو «شهر من اصفهان» یا «/city Isfahan» تا صبح‌نامه هوای شهر خودت رو برات بیاره 🌤");
    return true;
  }
  const m = citySet.exec(msg);
  if (!m) return false;
  const name = [m[1], m[2], m[3], m[4], m[5]].find((x) => x?.trim())?.trim().replace(/\s+/g, " ").replace(/^[«'"“]+|[»'"”]+$/g, "").replace(/^(?:رو|را)\s+/u, "") || "";
  if (name.length < 2 || name.length > 60 || !/[\p{L}\p{N}]/u.test(name) || CITY_NAME_BAD.test(name)) {
    await c.send(chat, "🤔 اسم شهر رو واضح بنویس؛ مثلاً «شهر من اصفهان» یا «/city Isfahan». سؤال دیگه‌ای هم داری بپرس!");
    return true;
  }
  const ref = await geocodeCity(name);
  if (!ref) {
    await c.send(chat, `هرچه گشتم شهری به اسم «${name}» پیدا نکردم 🤔 انگلیسی یا رسمی‌ترش رو امتحان کن؛ مثلاً «شهر من Isfahan» یا «شهر من رشت». فعلاً چیزی هم عوض نکردم.`);
    return true;
  }
  // The city's own zone keeps reminders and the briefing on local time.
  const patch: Record<string, unknown> = { city: name, city_lat: ref.lat, city_lon: ref.lon, city_label: ref.label };
  if (ref.timezone && isValidTimeZone(ref.timezone)) patch.timezone = ref.timezone;
  const existing = await patchLifePrefs(c, id, chat, patch);
  const weather = await fetchCityWeather(ref, fetch, Date.now());
  await c.send(chat, [
    `🏙 ثبت شد! شهرت رو ${ref.label} گذاشتم.`,
    "از این به بعد صبح‌نامه هوای همین‌جا رو چک می‌کنه و بهت می‌گه چی بپوشی 👕",
    weather ? "\n" + weather.line : "",
    patch.timezone && patch.timezone !== "Asia/Tehran" ? `🕰 منطقه زمانی‌ات هم ${timeZoneLabel(String(patch.timezone))} شد.` : "",
    existing?.enabled ? "" : "\nراستی صبح‌نامه‌ت خاموشه؛ بگو «صبح‌نامه روشن» تا هر روز صبح سر حوصله‌ام باشم 🙂",
  ].filter(Boolean).join("\n"));
  return true;
}

async function timezoneMessage(c: LifeContext, id: number, chat: number, msg: string): Promise<boolean> {
  if (RX.timezoneShow.test(msg)) {
    const tz = await userTimeZone(c.db, id);
    await c.send(chat, `🕰 منطقه زمانی‌ات: ${timeZoneLabel(tz)} (${tz})\nیادآورها و صبح‌نامه با همین ساعت تنظیم می‌شن.\nبرای تغییر: «منطقه زمانی Europe/Berlin» یا فقط شهرت رو بگو: «شهر من برلین».`);
    return true;
  }
  const m = RX.timezoneSet.exec(msg);
  if (!m) return false;
  const raw = (m[1] || m[2] || "").trim();
  let tz = isValidTimeZone(raw) ? raw : "";
  if (!tz) {
    const ref = await geocodeCity(raw);
    if (ref?.timezone && isValidTimeZone(ref.timezone)) tz = ref.timezone;
  }
  if (!tz) {
    await c.send(chat, `«${raw}» رو به عنوان منطقه زمانی نشناختم. مثلاً «منطقه زمانی Europe/Berlin» یا «منطقه زمانی تورنتو».`);
    return true;
  }
  await patchLifePrefs(c, id, chat, { timezone: tz });
  await c.send(chat, `✅ منطقه زمانی‌ات ${timeZoneLabel(tz)} (${tz}) شد. یادآورهای جدید و صبح‌نامه از این به بعد با این ساعت حساب می‌شن.`);
  return true;
}

async function briefingMessage(c: LifeContext, id: number, chat: number, msg: string): Promise<boolean> {
  const hour = RX.briefingHour.exec(msg);
  if (hour) {
    const h = Number(toLatinDigits(hour[1] || hour[2] || ""));
    if (!Number.isInteger(h) || h < 5 || h > 11) {
      await c.send(chat, "⏰ ساعت صبح‌نامه باید بین ۵ تا ۱۱ صبح باشه؛ مثلاً «صبح‌نامه ساعت ۸».");
      return true;
    }
    await patchLifePrefs(c, id, chat, { send_hour: h, updated_at: new Date().toISOString() });
    await c.send(chat, `✅ از این به بعد صبح‌نامه ساعت ${faDigits(h)}:۰۰ صبح میاد ☀️`);
    return true;
  }
  const voice = RX.briefingVoice.exec(msg);
  if (voice) {
    const on = /^(?:on|روشن|فعال)$/iu.test(voice[1] || voice[2] || "");
    await patchLifePrefs(c, id, chat, { voice: on });
    await c.send(chat, on ? "🔊 صبح‌نامه از این به بعد یه ویس کوتاه پرانرژی هم داره!" : "🔇 ویس صبح‌نامه خاموش شد.");
    return true;
  }
  const brief = RX.briefing.exec(msg);
  if (!brief) return false;
  const mode = brief[1] || brief[2] || "";
  if (!mode) {
    const { data, error } = await c.db.from("saeed_ai_briefing_preferences").select("enabled,send_hour,timezone,city_label").eq("telegram_user_id", id).maybeSingle();
    if (error) throw Error("BRIEF_PREF");
    await c.send(chat, data?.enabled
      ? `☀️ صبح‌نامه روشنه؛ هر روز ساعت ${faDigits(data.send_hour)}:۰۰ به وقت ${timeZoneLabel(data.timezone)} برایت می‌فرستم${data.city_label ? ` و هوای ${data.city_label} رو هم چک می‌کنم 🌤` : ""}.\nتغییر ساعت: «صبح‌نامه ساعت ۸» · ویس: «صبح‌نامه صوتی روشن» · خاموش: «صبح‌نامه خاموش»`
      : "☀️ صبح‌نامه خاموشه. بگو «صبح‌نامه روشن» تا هر روز صبح یه پیام پرانرژی با برنامه‌ات و هوای شهرت برات بفرستم 🙂");
    return true;
  }
  const enabled = /^(?:on|روشن|فعال)$/iu.test(mode);
  // Access is enforced by the claim RPC itself (explicitly disabled users are skipped),
  // so enabling the briefing no longer writes a telegram_bot_user_access row.
  const { data: saved, error } = await c.db.from("saeed_ai_briefing_preferences").upsert({ telegram_user_id: id, telegram_chat_id: chat, enabled, lease_until: null, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" }).select("send_hour,timezone,city_label,enabled").maybeSingle();
  if (error) throw Error("BRIEF_SAVE");
  await c.send(chat, saved?.enabled
    ? `✅ صبح‌نامه روشن شد! 🎉\nهر روز ساعت ${faDigits(saved.send_hour)}:۰۰ صبح یه پیام دوستانه برات می‌فرستم: برنامه‌ی امروزت، هوای ${saved.city_label || "تهران"}، اینکه چی بپوشی و یه معمای کوچیک 🌤\nاگه شهر دیگه‌ای زندگی می‌کنی، فقط بگو «شهر من ...» تا هوای همون‌جا رو نگاه کنم. ساعتش هم با «صبح‌نامه ساعت ۸» عوض می‌شه.\nهوا و قیمت‌ها فقط با منبع معتبر میان؛ خودم چیزی از خودم نمی‌سازم.\nخاموش‌کردنش هم راحته: «صبح‌نامه خاموش».`
    : "✅ صبح‌نامه خاموش شد. هر وقت دلت خواست برگردی، همین‌جا منتظرم 🙂");
  return true;
}

export async function handleLifeMessage(c: LifeContext, id: number, chat: number, text: string, update: number): Promise<boolean> {
  const msg = text.trim();
  if (!msg) return false;
  if (RX.briefingTest.test(msg)) {
    const { data: pref } = await c.db.from("saeed_ai_briefing_preferences").select("city_lat,city_lon,city_label").eq("telegram_user_id", id).maybeSingle();
    const city: CityRef | null = pref?.city_lat !== null && pref?.city_lat !== undefined ? { lat: Number(pref.city_lat), lon: Number(pref.city_lon), label: String(pref.city_label || "شهر تو") } : null;
    const sections = await briefingExternalSections(fetch, Date.now(), city);
    await c.send(chat, `🧪 پیش‌نمایش منابع صبح‌نامه برای ${city?.label || "تهران"} (فقط نمایش، بدون تغییر تنظیمات):\n\n` + sections);
    return true;
  }
  if (await handleCityMessage(c, id, chat, msg)) return true;
  if (await briefingMessage(c, id, chat, msg)) return true;
  if (await timezoneMessage(c, id, chat, msg)) return true;
  if (RX.expensesReport.test(msg)) {
    await renderExpenses(c, id, chat);
    return true;
  }
  if (RX.expenseDeleteLast.test(msg)) {
    await deleteLastExpense(c, id, chat);
    return true;
  }
  const expense = parseExpense(msg);
  if (expense === "currency_missing") { await c.send(chat, "💰 مبلغ رو با واحد مشخص کن؛ مثلاً «ناهار ۴۸۰ هزار تومان»."); return true; }
  if (expense) {
    const data = await saveExpense(c, id, chat, expense, update);
    await c.send(chat, data ? `✅ ثبت شد: ${expense.description}، ${money(expense.amount)}.\nاشتباه بود؟ بنویس «حذف آخرین خرج».` : "ℹ️ این هزینه قبلاً ثبت شده بود؛ دوباره اضافه نکردم.");
    return true;
  }
  const add = RX.shoppingAdd.exec(msg);
  if (add) {
    await addShopping(c, id, chat, add[1]);
    return true;
  }
  if (RX.shoppingList.test(msg)) {
    await listShopping(c, id, chat);
    return true;
  }
  const remove = RX.shoppingRemove.exec(msg);
  if (remove) {
    await removeShopping(c, id, chat, remove[1]);
    return true;
  }
  if (RX.shoppingClearDone.test(msg)) {
    await clearDoneShopping(c, id, chat);
    return true;
  }
  if (RX.shoppingShare.test(msg)) {
    await shareShopping(c, id, chat);
    return true;
  }
  const join = RX.shoppingJoin.exec(msg);
  if (join) {
    await joinShopping(c, id, chat, toLatinDigits(join[1] || join[2]));
    return true;
  }
  if (RX.shoppingLeave.test(msg)) {
    await leaveShopping(c, id, chat);
    return true;
  }
  if (RX.tasksList.test(msg)) {
    await renderTasks(c, id, chat);
    return true;
  }
  const edit = RX.taskEdit.exec(toLatinDigits(msg));
  if (edit) {
    if (edit[1] === "edit" && !edit[3]?.trim()) { await c.send(chat, "متن جدید تسک رو هم بنویس."); return true; }
    const taskId = safeId(edit[2]);
    if (!Number.isSafeInteger(taskId)) return true;
    const query = c.db.from("saeed_ai_tasks");
    const { data, error } = edit[1] === "delete" ? await query.delete().eq("id", taskId).eq("telegram_user_id", id).select("id") : await query.update({ task: String(edit[3] || "").trim().slice(0, 200) }).eq("id", taskId).eq("telegram_user_id", id).select("id");
    if (error) throw Error("TASK_MODIFY");
    await c.send(chat, data?.length ? "✅ تسک اصلاح شد." : "این تسک پیدا نشد یا متعلق به شما نیست.");
    return true;
  }
  if (RX.remindersList.test(msg)) {
    await listReminders(c, id, chat);
    return true;
  }
  const pomodoro = RX.pomodoro.exec(msg);
  if (pomodoro) {
    await startPomodoro(c, id, chat, Number(toLatinDigits(pomodoro[1] || pomodoro[2] || "1")), update || null);
    return true;
  }
  if (RX.weekly.test(msg)) {
    await weeklyCommand(c, id, chat, msg);
    return true;
  }
  if (RX.memoryClear.test(msg)) {
    await clearMemories(c, id, chat);
    return true;
  }
  if (RX.memoryList.test(msg)) {
    await renderMemories(c, id, chat);
    return true;
  }
  const memory = RX.memoryAdd.exec(msg);
  if (memory && await addMemory(c, id, chat, memory[1])) return true;
  if (RX.watchersList.test(msg)) {
    await listWatchers(c, id, chat);
    return true;
  }
  if (RX.watcherAdd.test(msg) && await addWatcher(c, id, chat, msg)) return true;
  return false;
}

export async function handleLifeCallback(c: LifeContext, id: number, chat: number, callback: string, messageId?: number): Promise<boolean> {
  const m = /^(task|shop|reminder|exp|mem|watch|rcpt):(done|delete|undo|snooze|cancel|clear|ok|no):(\d{1,16})$/.exec(callback);
  if (!m) return false;
  const key = safeId(m[3]);
  if (!Number.isSafeInteger(key)) return true;
  if (m[1] === "task") {
    const query = c.db.from("saeed_ai_tasks");
    const desired = m[2] === "done";
    const { data, error } = m[2] === "delete"
      ? await query.delete().eq("id", key).eq("telegram_user_id", id).select("id")
      : await query.update({ done: desired, done_at: desired ? new Date().toISOString() : null }).eq("id", key).eq("telegram_user_id", id).eq("done", !desired).select("id");
    if (error) throw Error("TASK_CALLBACK");
    // Always refresh instead of claiming success for old buttons or sending a separate success bubble.
    await renderTasks(c, id, chat, messageId);
    if (!data?.length) console.info("TASK_STALE_CALLBACK", id, key);
    return true;
  }
  if (m[1] === "shop") await shoppingCallback(c, id, chat, m[2], key, messageId);
  else if (m[1] === "exp") await expenseCallback(c, id, chat, key, messageId);
  else if (m[1] === "mem") await memoryCallback(c, id, chat, m[2], key, messageId);
  else if (m[1] === "watch") await watcherCallback(c, id, chat, key);
  else if (m[1] === "rcpt") await receiptCallback(c, id, chat, m[2], key, messageId);
  else await reminderCallback(c, id, chat, m[2], key, messageId);
  return true;
}
