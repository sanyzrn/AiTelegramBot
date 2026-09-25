/* Deterministic guardrails for voice commands. Narration must not trigger tools. */
export type VoiceFollowup = "transcribe" | "summarize" | "translate";

export function voiceFollowupMode(input: string): VoiceFollowup | null {
  const text = input.normalize("NFKC").replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").trim();
  if (!text || /(?:نکن|نمی[‌\s]*خوام|don't|do not)/iu.test(text)) return null;
  if (/(?:ترجمه(?:‌|\s)*(?:اش|ش|اشو|شو)?|translate)/iu.test(text) && /(?:کن|بده|بفرست|translate)/iu.test(text)) return "translate";
  if (/(?:خلاصه(?:‌|\s)*(?:اش|ش|اشو|شو)?|summari[sz]e)/iu.test(text) && /(?:کن|بده|بفرست|summari[sz]e)/iu.test(text)) return "summarize";
  if (/(?:تایپ(?:‌|\s)*(?:اش|ش|اشو|شو)?|پیاده(?:‌|\s)*کن|رونویسی|متن(?:ش|ش رو|ش را)?|transcrib)/iu.test(text) && /(?:کن|بده|بفرست|بنویس|در\s*بیار|transcrib)/iu.test(text)) return "transcribe";
  return null;
}

/** A spoken non-tool request can be answered; plain narration needs the choice menu. */
export function isSpokenRequest(input: string): boolean {
  const text = input.normalize("NFKC").replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").trim();
  if (!text) return false;
  if (/[؟?]/u.test(text) || /^(?:چی|چیه|چرا|چطور|چگونه|کی|کجا|چه\s+طور|میشه|می‌شه|میتونی|می‌تونی|آیا|how|what|why|when|where)\s/iu.test(text)) return true;
  if (/(?:یادم\s*بنداز|یه\s+تایمر|یک\s+تایمر|به\s+لیست\s+خرید\s+اضافه\s*کن|(?:هزینه|خرج)[\s\S]*ثبت)/iu.test(text)) return true;
  return /(?:^|[\s،؛])(?:بگو|بگی|بده|بدی|بنویس|بنویسی|بذار|بگذار|بزن|بساز|درست\s*کن|طراحی\s*کن|تنظیم\s*کن|ست\s*کن|شروع\s*کن|انجام\s*بده|انجام\s*کن|حساب\s*کن|محاسبه\s*کن|ترجمه\s*کن|خلاصه\s*کن|ثبت\s*کن|بررسی\s*کن|تحلیل\s*کن|جستجو\s*کن|جست‌وجو\s*کن|پیدا\s*کن|مقایسه\s*کن|توضیح\s*بده|جواب\s*بده|tell\s+me|write|create|calculate|remind\s+me)(?:[\s،؛.!؟?]|$)/iu.test(text) || /(?:می[‌\s]*خوام|می[‌\s]*خواهم|لطفاً|لطفا|please)\s+.{0,100}(?:بگی|بده|بذار|بگذاری|بنویسی|بسازی|کنی|کن|بفرستی)/iu.test(text);
}
