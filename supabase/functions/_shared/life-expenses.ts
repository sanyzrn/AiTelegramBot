/** Expense logging, seven-day report with inline delete buttons, and undo. */
import { type LifeContext, showView } from "./life-context.ts";

const digits = (value: string) => value.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d) >= 0 ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const money = (n: bigint) => n.toLocaleString("fa-IR") + " تومان";
export const CATEGORY_WORDS = ["ناهار", "شام", "صبحانه", "بنزین", "تاکسی", "قهوه", "خوراک", "خرید", "قبض", "کرایه", "اجاره", "دارو", "نان", "سوخت", "پارکینگ", "سوپرمارکت"];

/** Currency must be explicit: never invent units or save a price question as spending. */
export function parseExpense(message: string): { description: string; amount: bigint } | "currency_missing" | null {
  const t = digits(message.trim().replace(/^\/(?:expense|spend)\s+/i, "").replace(/^خرج\s+/u, ""));
  if (/[?؟]/.test(t) || /^(?:قیمت|چقدر|هزینه\s*چقدر|آموزش)/u.test(t)) return null;
  const m = /^(.{2,100}?)\s+([\d,٬،]+)(?:\s*(هزار|میلیون|میلیارد))?\s*(تومان|تومن|ریال)?$/u.exec(t);
  if (!m) return null;
  const explicit = /^(?:\/expense|\/spend|خرج\s)/iu.test(message.trim());
  const category = new RegExp(`^(?:${CATEGORY_WORDS.join("|")})(?:\\s|$)`, "u").test(m[1] + " ");
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

/** First word of the description is the category («ناهار با بچه‌ها» → ناهار). */
export const expenseCategory = (description: string) => String(description).trim().split(/\s+/u)[0] || "سایر";

export async function saveExpense(c: LifeContext, id: number, chat: number, expense: { description: string; amount: bigint }, update: number | null) {
  const { data, error } = await c.db.from("saeed_ai_expenses").upsert({
    telegram_user_id: id, telegram_chat_id: chat, description: expense.description,
    amount_toman: expense.amount.toString(), telegram_update_id: update,
  }, { onConflict: "telegram_update_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw Error("EXPENSE_SAVE");
  return data;
}

export async function renderExpenses(c: LifeContext, id: number, chat: number, messageId?: number) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await c.db.from("saeed_ai_expenses").select("id,description,amount_toman,created_at")
    .eq("telegram_user_id", id).gte("created_at", from).order("created_at", { ascending: false }).limit(200);
  if (error) throw Error("EXPENSE_READ");
  const all = data || [];
  const total = all.reduce((sum: bigint, x: { amount_toman: string | number }) => sum + BigInt(x.amount_toman), 0n);
  const lines = all.slice(0, 15).map((x: { description: string; amount_toman: string | number }) => `• ${x.description}: ${money(BigInt(x.amount_toman))}`);
  const rows = all.slice(0, 10).map((x: { id: number; description: string }) => [{
    text: `🗑 ${x.description}`.slice(0, 40), callback_data: `exp:delete:${x.id}`,
  }]);
  await showView(c, {
    chat_id: chat,
    text: `💰 هزینه‌های ثبت‌شده ۷ روز گذشته (${all.length}${all.length === 200 ? "+" : ""} مورد)\n${lines.join("\n") || "موردی ثبت نشده."}\nجمع${all.length === 200 ? " ۲۰۰ مورد اخیر" : ""}: ${money(total)}` +
      (rows.length ? "\n\nثبت اشتباهی داشتی؟ از دکمه‌های 🗑 پاکش کن." : ""),
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  }, messageId);
}

export async function deleteLastExpense(c: LifeContext, id: number, chat: number) {
  const { data: last, error } = await c.db.from("saeed_ai_expenses").select("id,description,amount_toman")
    .eq("telegram_user_id", id).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw Error("EXPENSE_READ");
  if (!last) return c.send(chat, "هزینه‌ای برای حذف پیدا نشد.");
  const { error: deleteError } = await c.db.from("saeed_ai_expenses").delete().eq("id", last.id).eq("telegram_user_id", id);
  if (deleteError) throw Error("EXPENSE_DELETE");
  await c.send(chat, `🗑 حذف شد: ${last.description}، ${money(BigInt(last.amount_toman))}.`);
}

export async function expenseCallback(c: LifeContext, id: number, chat: number, key: number, messageId?: number) {
  const { error } = await c.db.from("saeed_ai_expenses").delete().eq("id", key).eq("telegram_user_id", id).select("id");
  if (error) throw Error("EXPENSE_DELETE");
  await renderExpenses(c, id, chat, messageId);
}
