/** Receipt photo → expense, always confirmed by the user before anything is saved. */
import { type LifeContext } from "./life-context.ts";
import { money } from "./life-expenses.ts";

export type ReceiptDraft = { description: string; amount: bigint };

export const RECEIPT_PROMPT =
  'This image should be a shop receipt, invoice or card-reader slip. Extract ONLY what is printed. Return minified JSON {"is_receipt":boolean,"merchant":string|null,"category":string|null,"total":number|null,"currency":"toman"|"rial"|null}. category is ONE short Persian word such as سوپرمارکت، رستوران، دارو، قبض، پوشاک، بنزین، کافه. total is the final payable amount as a plain number. Iranian receipts are usually in rial (ریال) unless تومان is printed. Never guess missing numbers: use null.';

/** Validates the model's JSON; rial amounts must convert exactly to toman. */
export function parseReceiptJson(j: Record<string, unknown> | null): ReceiptDraft | null {
  if (!j || j.is_receipt !== true) return null;
  const total = Number(j.total);
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(total)) return null;
  const currency = j.currency === "toman" ? "toman" : j.currency === "rial" ? "rial" : null;
  if (!currency) return null;
  let amount = BigInt(total);
  if (currency === "rial") {
    if (amount % 10n) return null;
    amount /= 10n;
  }
  if (amount <= 0n || amount >= 1000000000000n) return null;
  const category = typeof j.category === "string" && j.category.trim() ? j.category.trim().split(/\s+/u)[0] : "خرید";
  const merchant = typeof j.merchant === "string" ? j.merchant.trim().slice(0, 60) : "";
  return { description: (merchant ? `${category} ${merchant}` : category).slice(0, 120), amount };
}

/** Store the draft and ask; nothing reaches saeed_ai_expenses until ✅. */
export async function proposeReceipt(c: LifeContext, id: number, chat: number, draft: ReceiptDraft) {
  const { data, error } = await c.db.from("saeed_ai_receipt_pending").insert({
    telegram_user_id: id, telegram_chat_id: chat, description: draft.description,
    amount_toman: draft.amount.toString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
  }).select("id").single();
  if (error || !data?.id) throw Error("RECEIPT_SAVE");
  await c.tg("sendMessage", {
    chat_id: chat,
    text: `🧾 از رسید این رو خوندم:\n• ${draft.description}: ${money(draft.amount)}\n\nثبتش کنم؟`,
    reply_markup: { inline_keyboard: [[
      { text: "✅ ثبت کن", callback_data: `rcpt:ok:${data.id}` },
      { text: "✏️ نه، خودم می‌نویسم", callback_data: `rcpt:no:${data.id}` },
    ]] },
  });
}

export async function receiptCallback(c: LifeContext, id: number, chat: number, action: string, key: number, messageId?: number) {
  const { data: draft, error } = await c.db.from("saeed_ai_receipt_pending").delete()
    .eq("id", key).eq("telegram_user_id", id).gt("expires_at", new Date().toISOString())
    .select("description,amount_toman").maybeSingle();
  if (error) throw Error("RECEIPT_READ");
  if (messageId) {
    try {
      await c.tg("editMessageReplyMarkup", { chat_id: chat, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    } catch { /* old message */ }
  }
  if (!draft) return c.send(chat, "⌛ این پیش‌نویس رسید منقضی شده یا قبلاً تصمیمش گرفته شده.");
  if (action === "no") return c.send(chat, "باشه، ثبت نکردم. خودت بنویس؛ مثلاً «سوپرمارکت ۳۴۰ هزار تومان».");
  const { error: saveError } = await c.db.from("saeed_ai_expenses").insert({
    telegram_user_id: id, telegram_chat_id: chat, description: draft.description, amount_toman: String(draft.amount_toman),
  });
  if (saveError) throw Error("RECEIPT_EXPENSE");
  await c.send(chat, `✅ ثبت شد: ${draft.description}، ${money(BigInt(draft.amount_toman))}.`);
}
