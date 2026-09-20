import { briefingExternalSections } from "./briefing-sources.ts";
/** Saeed AI v9 utilities; call only after authenticated private Telegram gate. */
export type LifeContext = { db: any; tg: (method: string, payload: Record<string, unknown>) => Promise<any>; send: (chat: number, text: string) => Promise<any> };
const digits = (value: string) => value.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d) >= 0 ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const money = (n: bigint) => n.toLocaleString("fa-IR") + " تومان";
const safeId = (raw: string) => /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
/** Currency must be explicit: no ambiguous amount is silently saved. */
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
export async function handleLifeMessage(c: LifeContext, id: number, chat: number, text: string, update: number): Promise<boolean> {
  const msg = text.trim();
  if (!msg) return false;
  if (/^(?:\/briefing_test|صبح[‌\s-]*نامه\s+(?:تست|الان))$/iu.test(msg)) {
    const sections = await briefingExternalSections();
    await c.send(chat, "🧪 پیش‌نمایش منابع صبح‌نامه (فقط نمایش، بدون تغییر تنظیمات):\n\n" + sections);
    return true;
  }
  const brief = /^(?:\/briefing(?:\s+(on|off))?|صبح[‌\s-]*نامه(?:\s+(روشن|خاموش|فعال|غیرفعال))?)$/iu.exec(msg);
  if (brief) {
    const mode = brief[1] || brief[2] || "";
    if (!mode) {
      const { data, error } = await c.db.from("saeed_ai_briefing_preferences").select("enabled,send_hour,timezone").eq("telegram_user_id", id).maybeSingle();
      if (error) throw Error("BRIEF_PREF");
      await c.send(chat, data?.enabled ? `☀️ صبح‌نامه روشنه؛ ساعت ${data.send_hour}:۰۰ به وقت ${data.timezone}. برای خاموش‌کردن: «صبح‌نامه خاموش»` : "☀️ صبح‌نامه خاموشه. برای فعال‌کردن: «صبح‌نامه روشن»");
      return true;
    }
    const enabled = /^(?:on|روشن|فعال)$/iu.test(mode);
    if (enabled) {
      const { error: accessError } = await c.db.from("telegram_bot_user_access").upsert({ telegram_user_id: id, enabled: true }, { onConflict: "telegram_user_id" });
      if (accessError) throw Error("BRIEF_ACCESS");
    }
    const { error } = await c.db.from("saeed_ai_briefing_preferences").upsert({ telegram_user_id: id, telegram_chat_id: chat, enabled, lease_until: null, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" });
    if (error) throw Error("BRIEF_SAVE");
    await c.send(chat, enabled ? "✅ صبح‌نامه فعال شد. هر روز ساعت ۷ صبح به وقت تهران، تسک‌ها و یادآورهای امروز رو می‌فرستم. اطلاعات آب‌وهوا و ارز بدون منبع معتبر اضافه نمی‌شن. ☀️" : "✅ صبح‌نامه خاموش شد.");
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
    const { error } = await c.db.from("saeed_ai_shopping").upsert(items.map((item) => ({ telegram_user_id: id, item })), { onConflict: "telegram_user_id,item", ignoreDuplicates: true });
    if (error) throw Error("SHOP_SAVE");
    await c.send(chat, `🛒 ${items.length} قلم به لیست خرید اضافه شد. برای دیدنش «لیست خرید» رو بفرست.`);
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
    const { data, error } = await c.db.from("saeed_ai_tasks").select("id,task,done,priority,due_at").eq("telegram_user_id", id).eq("done", false).order("id").limit(20);
    if (error) throw Error("TASK_READ");
    const rows = (data || []).map((x: any) => [{ text: `✅ ${String(x.task).slice(0, 40)}`, callback_data: `task:done:${x.id}` }, { text: "🗑", callback_data: `task:delete:${x.id}` }]);
    await c.tg("sendMessage", { chat_id: chat, text: "✅ کارهای باز:\n" + ((data || []).map((x: any) => `• ${x.task}`).join("\n") || "فعلاً خالیه. یک کار جدید بگو."), ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
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
    const { data, error } = m[2] === "delete" ? await query.delete().eq("id", key).eq("telegram_user_id", id).select("id") : await query.update({ done: true }).eq("id", key).eq("telegram_user_id", id).eq("done", false).select("id");
    if (error) throw Error("TASK_CALLBACK");
    await c.send(chat, data?.length ? "✅ انجام شد." : "ℹ️ قبلاً انجام شده یا دسترسی نداری.");
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
