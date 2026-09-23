/**
 * Smart tool choice for photos and files: the caption (or a text reply to the
 * file) decides the tool, so nobody has to open the tools keyboard first.
 * An explicitly selected, compatible tool still wins.
 */
export type MediaKind = "photo" | "pdf" | "office";

/** «این هزینه رو ثبت کن», «رسید», «فاکتور خرید» … → expense from the picture. */
export const RECEIPT_WORDS =
  /(?:رسید|فاکتور|فیش|قبض|صورت[\s‌]*حساب|هزینه|خرج|پرداخت(?:ی)?|مبلغ|سفارش|خرید(?:م)?|receipt|invoice|bill|expense)/iu;
/** «متنش رو بنویس», «تایپش کن», «استخراج کن» → OCR. */
const OCR_WORDS = /(?:متن(?:ش|ِ)?|تایپ|استخراج|بنویس(?:ش)?|بخون(?:ش)?|ocr|extract|text)/iu;
const TRANSLATE_WORDS = /(?:ترجمه|translate)/iu;
const SUMMARY_WORDS = /(?:خلاصه|summari[sz]e|tl;?dr)/iu;
/** Tools that make sense for each kind of file when the user picked them explicitly. */
const COMPATIBLE: Record<MediaKind, string[]> = {
  photo: ["receipt", "ocr", "image", "translate", "summarize", "rewrite", "ideas", "documents"],
  pdf: ["receipt", "documents", "summarize", "translate", "ocr"],
  office: ["documents", "summarize", "translate", "rewrite", "ideas"],
};

export function mediaTool(kind: MediaKind, caption: string, pending = "chat"): string {
  const text = String(caption || "").trim();
  if (pending !== "chat" && COMPATIBLE[kind].includes(pending)) return pending;
  if (RECEIPT_WORDS.test(text) && kind !== "office") return "receipt";
  if (TRANSLATE_WORDS.test(text)) return kind === "photo" ? "translate" : "documents";
  if (SUMMARY_WORDS.test(text)) return kind === "photo" ? "summarize" : "documents";
  if (kind === "photo" && OCR_WORDS.test(text)) return "ocr";
  return kind === "photo" ? "image" : "documents";
}

/** A text-only request that needs a file first («رسید رو ثبت کن» without a photo). */
export const ASKS_FOR_RECEIPT = /(?:رسید|فاکتور|فیش|صورت[\s‌]*حساب|receipt|invoice)/iu;
