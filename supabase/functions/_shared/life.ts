import { briefingExternalSections, geocodeCity, fetchCityWeather, type CityRef } from "./briefing-sources.ts";
/** Private-chat life utilities. All mutations are scoped to their Telegram owner. */
export type LifeContext = {
  db: any;
  tg: (method: string, payload: Record<string, unknown>) => Promise<any>;
  send: (chat: number, text: string) => Promise<any>;
};
const digits = (value: string) => value.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d) >= 0 ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const money = (n: bigint) => n.toLocaleString("fa-IR") + " تومان";
const safeId = (raw: string) => /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

/** Currency must be explicit: never invent units or save a price question as spending. */
export function parseExpense(message: string): { description: string; amount: bigint } | "currency_missing" | null {
  const t = digits(message.trim().replace(/^\/(?:expense|spend)\s+/i, "").replace(/^خرج\s+/u, ""));
  if (/[?؟]/.test(t) || /^(?:قیمت|چقدر|هزینه\s*چقدر|آموزش)/u.test(t)) return null;
  const m = /^(.{2,100}?)\s+([\d,٬،]+)(?:\s*(هزار|میلیون|میلیارد))?\s*(تومان|تومن|ریال)?$/u.exec(t);
  if (!m) return null;
  const explicit = /^(?:\/expense|\/spend|خرج\s)/iu.test(message.trim());
  const category = /^(?:ناهار|شام|صبحانه|بنزین|تاکسی|قهوه|خوراک|خرید|قبض|کرایه|اجاره|دارو|نان|سوخت|پارکینگ|سوپرمارکت)(?:\s|$)/u.test(m[1] + " ");
  if (!explicit && !category) return null;
  if (!m[4]) return "currency_missing";
  const raw = m[2].replace(/[,٬،]/g, "");
  if (!/^\d{1,12}$/.test(raw)) return null;
  const multiplier = ({ هزار: 1000n, میلیون: 1000000n, میلیارد: 1000000000n } as Record<string, bigint>)[m[3]] || 1n;
  let amount = BigInt(raw) * multiplier;
  if (m[4] === "ریال") { if (amount % 10n) return null; amount /= 10n; }
  if (amount <= 0n || amount >= 1000000000000n) return null;
  return { description: m[1].trim().slice(0, 200), amount };
}

/** Use exactly the same renderer for initial task lists and inline refreshes. */
export async function renderTasks(c: LifeContext, id: number, chat: number, messageId?: number): Promise<void> {
  const { data, error } = await c.db.from("saeed_ai_tasks")
    .select("id,task,done,priority,due_at").eq("telegram_user_id", id)
    .order("id", { ascending: false }).limit(30);
  if (error) throw Error("TASK_READ");
  const tasks = (data || []).reverse();
  const rows = tasks.map((x: any) => [{
    text: `${x.done ? "↩️" : "✅"} ${String(x.task).slice(0, 40)}`,
    callback_data: `task:${x.done ? "undo" : "done"}:${x.id}`,
  }, { text: "🗑", callback_data: `task:delete:${x.id}` }]);
  const view = {
    chat_id: chat,
    text: "✅ تسک‌های من:\n" + (tasks.map((x: any) => `${x.done ? "☑️" : "▫️"} ${x.task}`).join("\n") || "فعلاً خالیه. یک کار جدید بگو."),
    // Telegram rejects an empty inline_keyboard with a 400, which used to turn
    // "delete the last task" into a generic router error.
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  };
  if (messageId) {
    try {
      await c.tg("editMessageText", { ...view, message_id: messageId });
      return;
    } catch (e) {
      // Telegram rejects editing deleted/old messages and identical content.
      if (/message is not modified/i.test(String(e))) return;
      console.error("TASK_EDIT", String(e).slice(0, 80));
    }
  }
  await c.tg("sendMessage", view);
}

/** City commands for the morning briefing. Question-y phrases never mutate anything. Returns true when the message was recognized. */
const CITY_NAME_BAD = /[?؟!،,]|چیه|چی\s*هست|کجاست|کدوم|کدام|چطور|چقدر|چند|پاک|حذف|نمی|بگو|باشه|لطف|بذار|بگذار|بزار|تنظیم|ثبت/u;
// Clearing accepts the attached «شهرم» form exactly like setting and showing do.
const cityClear = /^(?:\/city\s+(?:clear|reset|off|remove|delete)|شهر(?:م|\s+صبح[‌\s-]*نامه(?:\s+من)?|\s+من)?\s*(?:رو\s*)?(?:پاک|حذف)\s+کن)$/iu;
const cityShow = /^(?:\/city|شهر\s*من|شهرم)(?:\s*(?:چیه|چی\s*هست)\s*[?؟]?|\s*[?؟])?$/iu;
// The verb-first colloquial order («شهرم رو بذار رشت») must capture the city, not the verbs.
const citySet = /^(?:\/city\s+(.+?)|شهر(?:\s+صبح[‌\s-]*نامه)?(?:\s+من)?\s*[:：]\s*(.+?)|شهر\s+صبح[‌\s-]*نامه\s+(.+?)|(?:شهر\s*من|شهرم)\s+(?:رو\s+|را\s+)?(?:بذار|بگذار|بزار|ثبت\s*کن|تنظیم\s*کن)\s+(.+?)|(?:شهر\s*من|شهرم)\s+(.+?))(?:\s+(?:رو|را))?(?:\s+(?:بذار|بگذار|بزار|ثبت\s*کن|تنظیم\s*کن))?\s*$/iu;

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
  const patch = { city: name, city_lat: ref.lat, city_lon: ref.lon, city_label: ref.label };
  const { data: existing, error: readError } = await c.db.from("saeed_ai_briefing_preferences").select("telegram_user_id,enabled").eq("telegram_user_id", id).maybeSingle();
  if (readError) throw Error("BRIEF_CITY_READ");
  // Update keeps an existing subscription exactly as it is; insert never enables silently.
  const { error: saveError } = existing
    ? await c.db.from("saeed_ai_briefing_preferences").update(patch).eq("telegram_user_id", id)
    : await c.db.from("saeed_ai_briefing_preferences").insert({ telegram_user_id: id, telegram_chat_id: chat, enabled: false, ...patch });
  if (saveError) throw Error("BRIEF_CITY_SAVE");
  const weather = await fetchCityWeather(ref, fetch, Date.now());
  await c.send(chat, [
    `🏙 ثبت شد! شهرت رو ${ref.label} گذاشتم.`,
    "از این به بعد صبح‌نامه هوای همین‌جا رو چک می‌کنه و بهت می‌گه چی بپوشی 👕",
    weather ? "\n" + weather.line : "",
    existing?.enabled ? "" : "\nراستی صبح‌نامه‌ت خاموشه؛ بگو «صبح‌نامه روشن» تا هر روز صبح سر حوصله‌ام باشم 🙂",
  ].filter(Boolean).join("\n"));
  return true;
}

export async function handleLifeMessage(c: LifeContext, id: number, chat: number, text: string, update: number): Promise<boolean> {
  const msg = text.trim();
  if (!msg) return false;
  const briefTest = /^(?:\/briefing_test|صبح[‌\s-]*نامه\s+(?:تست|الان))$/iu.exec(msg);
  if (briefTest) {
    const { data: pref } = await c.db.from("saeed_ai_briefing_preferences").select("city_lat,city_lon,city_label").eq("telegram_user_id", id).maybeSingle();
    const city: CityRef | null = pref?.city_lat !== null && pref?.city_lat !== undefined ? { lat: Number(pref.city_lat), lon: Number(pref.city_lon), label: String(pref.city_label || "شهر تو") } : null;
    const sections = await briefingExternalSections(fetch, Date.now(), city);
    await c.send(chat, `🧪 پیش‌نمایش منابع صبح‌نامه برای ${city?.label || "تهران"} (فقط نمایش، بدون تغییر تنظیمات):\n\n` + sections);
    return true;
  }
  if (await handleCityMessage(c, id, chat, msg)) return true;
  const brief = /^(?:\/briefing(?:\s+(on|off))?|صبح[‌\s-]*نامه(?:\s+(روشن|خاموش|فعال|غیرفعال))?)$/iu.exec(msg);
  if (brief) {
    const mode = brief[1] || brief[2] || "";
    if (!mode) {
      const { data, error } = await c.db.from("saeed_ai_briefing_preferences").select("enabled,send_hour,timezone,city_label").eq("telegram_user_id", id).maybeSingle();
      if (error) throw Error("BRIEF_PREF");
      await c.send(chat, data?.enabled
        ? `☀️ صبح‌نامه روشنه؛ هر روز ساعت ${data.send_hour}:۰۰ به وقت ${data.timezone} برایت می‌فرستم${data.city_label ? ` و هوای ${data.city_label} رو هم چک می‌کنم 🌤` : ""}.\nبرای خاموش‌کردن: «صبح‌نامه خاموش»`
        : "☀️ صبح‌نامه خاموشه. بگو «صبح‌نامه روشن» تا هر روز صبح یه پیام پرانرژی با برنامه‌ات و هوای شهرت برات بفرستم 🙂");
      return true;
    }
    const enabled = /^(?:on|روشن|فعال)$/iu.test(mode);
    if (enabled) {
      const { error: accessError } = await c.db.from("telegram_bot_user_access").upsert({ telegram_user_id: id, enabled: true }, { onConflict: "telegram_user_id" });
      if (accessError) throw Error("BRIEF_ACCESS");
    }
    const { data: saved, error } = await c.db.from("saeed_ai_briefing_preferences").upsert({ telegram_user_id: id, telegram_chat_id: chat, enabled, lease_until: null, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" }).select("send_hour,timezone,city_label,enabled").maybeSingle();
    if (error) throw Error("BRIEF_SAVE");
    await c.send(chat, saved?.enabled
      ? `✅ صبح‌نامه روشن شد! 🎉\nهر روز ساعت ${saved.send_hour}:۰۰ صبح یه پیام دوستانه برات می‌فرستم: برنامه‌ی امروزت، هوای ${saved.city_label || "تهران"} و اینکه چی بپوشی 🌤\nاگه شهر دیگه‌ای زندگی می‌کنی، فقط بگو «شهر من ...» تا هوای همون‌جا رو نگاه کنم.\nهوا و قیمت‌ها فقط با منبع معتبر میان؛ خودم چیزی از خودم نمی‌سازم.\nخاموش‌کردنش هم راحته: «صبح‌نامه خاموش».`
      : "✅ صبح‌نامه خاموش شد. هر وقت دلت خواست برگردی، همین‌جا منتظرم 🙂");
    return true;
  }
  if (/^(?:\/expenses|خرج[‌\s-]*هام|گزارش\s*خرج(?:‌|\s)*ها)$/iu.test(msg)) {
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await c.db.from("saeed_ai_expenses").select("description,amount_toman,created_at").eq("telegram_user_id", id).gte("created_at", from).order("created_at", { ascending: false }).limit(200);
    if (error) throw Error("EXPENSE_READ");
    const total = (data || []).reduce((sum: bigint, x: any) => sum + BigInt(x.amount_toman), 0n);
    const lines = (data || []).slice(0, 15).map((x: any) => `• ${x.description}: ${money(BigInt(x.amount_toman))}`);
    await c.send(chat, `💰 هزینه‌های ثبت‌شده ۷ روز گذشته (${(data || []).length}${(data || []).length === 200 ? "+" : ""} مورد)\n${lines.join("\n") || "موردی ثبت نشده."}\nجمع${(data || []).length === 200 ? " ۲۰۰ مورد اخیر" : ""}: ${money(total)}`);
    return true;
  }
  const expense = parseExpense(msg);
  if (expense === "currency_missing") { await c.send(chat, "💰 مبلغ رو با واحد مشخص کن؛ مثلاً «ناهار ۴۸۰ هزار تومان»."); return true; }
  if (expense) {
    const { data, error } = await c.db.from("saeed_ai_expenses").upsert({ telegram_user_id: id, telegram_chat_id: chat, description: expense.description, amount_toman: expense.amount.toString(), telegram_update_id: update }, { onConflict: "telegram_update_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (error) throw Error("EXPENSE_SAVE");
    await c.send(chat, data ? `✅ ثبت شد: ${expense.description}، ${money(expense.amount)}.` : "ℹ️ این هزینه قبلاً ثبت شده بود؛ دوباره اضافه نکردم.");
    return true;
  }
  const add = /^(?:\/shopping\s+add\s+|به\s+لیست\s+خرید\s+اضافه\s+کن\s+|لیست\s+خرید\s*[:：]\s*)(.+)$/iu.exec(msg);
  if (add) {
    const items = add[1].split(/[،,\n]/u).map((x) => x.trim()).filter((x) => x.length && x.length <= 120).slice(0, 20);
    if (!items.length) { await c.send(chat, "کالاهای خرید رو با ویرگول جدا کن."); return true; }
    const { data: added, error } = await c.db.from("saeed_ai_shopping").upsert(items.map((item) => ({ telegram_user_id: id, item })), { onConflict: "telegram_user_id,item", ignoreDuplicates: true }).select("id");
    if (error) throw Error("SHOP_SAVE");
    const newCount = added?.length ?? 0;
    await c.send(chat, newCount ? `🛒 ${newCount.toLocaleString("fa-IR")} قلم به لیست خرید اضافه شد. برای دیدنش «لیست خرید» رو بفرست.` : "ℹ️ همه این‌ها قبلاً توی لیست خرید بودن؛ چیزی اضافه نکردم.");
    return true;
  }
  if (/^(?:\/shopping|لیست\s+خرید|خرید[‌\s-]*هام)$/iu.test(msg)) {
    const { data, error } = await c.db.from("saeed_ai_shopping").select("id,item,done").eq("telegram_user_id", id).order("id").limit(30);
    if (error) throw Error("SHOP_READ");
    const rows = (data || []).map((x: any) => [{ text: `${x.done ? "☑️" : "⬜"} ${x.item}`.slice(0, 60), callback_data: `shop:${x.done ? "undo" : "done"}:${x.id}` }]);
    await c.tg("sendMessage", { chat_id: chat, text: "🛒 لیست خرید:\n" + ((data || []).map((x: any) => `${x.done ? "✅" : "▫️"} ${x.item}`).join("\n") || "خالیه. با «به لیست خرید اضافه کن شیر، نان» شروع کن."), ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
    return true;
  }
  if (/^(?:\/tasks|تسک[‌\s-]*هام|کارهای\s+من)$/iu.test(msg)) {
    await renderTasks(c, id, chat);
    return true;
  }
  const edit = /^\/task\s+(delete|edit)\s+(\d{1,16})(?:\s+([\s\S]{1,200}))?$/i.exec(digits(msg));
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
  return false;
}

export async function handleLifeCallback(c: LifeContext, id: number, chat: number, callback: string, messageId?: number): Promise<boolean> {
  const m = /^(task|shop|reminder):(done|delete|undo|snooze|cancel):(\d{1,16})$/.exec(callback);
  if (!m) return false;
  const key = safeId(m[3]);
  if (!Number.isSafeInteger(key)) return true;
  if (m[1] === "task") {
    const query = c.db.from("saeed_ai_tasks");
    const desired = m[2] === "done";
    const { data, error } = m[2] === "delete"
      ? await query.delete().eq("id", key).eq("telegram_user_id", id).select("id")
      : await query.update({ done: desired }).eq("id", key).eq("telegram_user_id", id).eq("done", !desired).select("id");
    if (error) throw Error("TASK_CALLBACK");
    // Always refresh instead of claiming success for old buttons or sending a separate success bubble.
    await renderTasks(c, id, chat, messageId);
    if (!data?.length) console.info("TASK_STALE_CALLBACK", id, key);
    return true;
  }
  if (m[1] === "shop") {
    const desired = m[2] === "done";
    const { data, error } = await c.db.from("saeed_ai_shopping")
      .update({ done: desired }).eq("id", key).eq("telegram_user_id", id)
      .eq("done", !desired).select("id");
    if (error) throw Error("SHOP_CALLBACK");
    if (!data?.length) {
      await c.send(chat, "ℹ️ این دکمه قبلاً استفاده شده یا کالا متعلق به تو نیست. لیست خرید رو دوباره باز کن.");
      return true;
    }
    const { data: items, error: readError } = await c.db.from("saeed_ai_shopping")
      .select("id,item,done").eq("telegram_user_id", id).order("id").limit(30);
    if (readError) throw Error("SHOP_REFRESH");
    const rows = (items || []).map((x: any) => [{
      text: `${x.done ? "☑️" : "⬜"} ${x.item}`.slice(0, 60),
      callback_data: `shop:${x.done ? "undo" : "done"}:${x.id}`,
    }]);
    const view = {
      chat_id: chat,
      text: "🛒 لیست خرید:\n" + ((items || []).map((x: any) => `${x.done ? "✅" : "▫️"} ${x.item}`).join("\n") || "خالیه."),
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    };
    if (messageId) {
      try {
        await c.tg("editMessageText", { ...view, message_id: messageId });
        return true;
      } catch (e) {
        console.error("SHOP_EDIT", String(e).slice(0, 80));
      }
    }
    await c.tg("sendMessage", view);
    return true;
  }
  const { data: r, error: readError } = await c.db.from("saeed_ai_reminders").select("id,telegram_user_id,telegram_chat_id,note,repeat_rule,sent_at,canceled").eq("id", key).eq("telegram_user_id", id).eq("telegram_chat_id", chat).maybeSingle();
  if (readError) throw Error("REM_CALLBACK_READ");
  if (!r || r.canceled) { await c.send(chat, "این یادآور فعال نیست."); return true; }
  if (m[2] === "cancel") {
    const { error } = await c.db.from("saeed_ai_reminders").update({ canceled: true, sent: true, status: "sent", lease_until: null }).eq("id", key).eq("telegram_user_id", id);
    if (error) throw Error("REM_CANCEL");
    await c.send(chat, "✅ تکرارهای بعدی این یادآور لغو شد.");
    return true;
  }
  if (m[2] === "done") { await c.send(chat, "✅ انجام شد. 🌱"); return true; }
  if (!r.sent_at || Date.now() - new Date(r.sent_at).getTime() > 2 * 86400000) { await c.send(chat, "مهلت تعویق این نوبت تموم شده."); return true; }
  const snoozeKey = `${r.id}:${r.sent_at}`;
  const { data, error } = await c.db.from("saeed_ai_reminders").upsert({ telegram_user_id: id, telegram_chat_id: chat, note: r.note, remind_at: new Date(Date.now() + 600000).toISOString(), snooze_key: snoozeKey }, { onConflict: "snooze_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw Error("REM_SNOOZE");
  await c.send(chat, data ? "⏰ ده دقیقه دیگه دوباره خبرت می‌کنم." : "ℹ️ این نوبت قبلاً ده دقیقه عقب افتاده.");
  return true;
}
