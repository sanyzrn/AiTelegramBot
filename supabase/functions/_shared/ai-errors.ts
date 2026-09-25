/**
 * User-facing Persian messages for every AI/provider failure. Precise by
 * design: each message names the actual reason (and the active model when
 * relevant) instead of a generic «مشکلی پیش اومد».
 */
import { searchMessage } from "./web-search.ts";

export type AiErrorContext = {
  /** Active provider, e.g. "openrouter". */
  provider?: string;
  /** Active model identifier, e.g. "google/gemma-4-26b-a4b-it:free". */
  model?: string;
};

const modelNote = (ctx: AiErrorContext) => (ctx.model ? ` (${ctx.model})` : "");

export function failMessage(err: unknown, ctx: AiErrorContext = {}): string {
  const s = String(err instanceof Error ? err.message : err);
  if (/AI_KEY_GEMINI/.test(s))
    return "🔑 کلید Gemini تنظیم نشده؛ الان سرویس فعال همین باشه. مدیر باید کلیدش رو ثبت کنه یا از پنل مدیریت، Provider رو عوض کنه. 💛";
  if (/AI_KEY_OPENROUTER/.test(s))
    return "🔑 کلید OpenRouter تنظیم نشده؛ الان سرویس فعال همین باشه. مدیر باید کلیدش رو ثبت کنه یا از پنل مدیریت، Provider رو عوض کنه. 💛";
  if (/AI_AUDIO_UNSUPPORTED/.test(s))
    return `🎙 مدل فعلی${modelNote(ctx)} از ورودی صوتی پشتیبانی نمی‌کنه؛ پیامت رو تایپ کن یا از مدیر بخواه مدل چندوجهی (با قابلیت صوت) فعال کنه. 💛`;
  if (/AI_IMAGE_UNSUPPORTED/.test(s))
    return `🖼 مدل فعلی${modelNote(ctx)} پردازش تصویر رو پشتیبانی نمی‌کنه؛ متنش رو بنویس یا از مدیر بخواه مدل دارای قابلیت تصویر فعال کنه. 💛`;
  if (/AI_PDF_UNSUPPORTED/.test(s))
    return `📄 مدل فعلی${modelNote(ctx)} فایل PDF رو نمی‌خونه؛ فایل متنی (TXT، MD، Word یا Excel) بفرست یا از مدیر بخواه مدل دارای قابلیت PDF فعال کنه. 💛`;
  if (/AI_AUDIO_FAILED/.test(s))
    return `🎙 پردازش این صدا با مدل فعلی${modelNote(ctx)} انجام نشد. اگه مطمئنی ویس سالمه، از مدیر بخواه مدل چندوجهی فعال کنه یا پیامت رو تایپ کن. 💛`;
  if (/AI_IMAGE_FAILED/.test(s))
    return `🖼 پردازش این تصویر با مدل فعلی${modelNote(ctx)} انجام نشد. اگه عکس سالمه، دوباره بفرست یا از مدیر بخواه مدل دارای قابلیت تصویر فعال بشه. 💛`;
  if (/AI_PDF_FAILED/.test(s))
    return `📄 خوندن این PDF با مدل فعلی${modelNote(ctx)} انجام نشد. اگه فایل سالمه، دوباره بفرست یا نسخه متنی (TXT/MD) بده. 💛`;
  if (/AI_MEDIA/.test(s))
    return "📦 این نوع فایل رو Provider فعلی نمی‌پذیره؛ عکس، PDF، Word، Excel، TXT یا CSV بفرست. 😊";
  if (/TTS_PROVIDER/.test(s))
    return `🔊 ساخت صدای خروجی فقط با موتور Gemini فعاله؛ الان Provider فعال ${ctx.provider === "openrouter" ? "OpenRouter" : "سرویس دیگه‌ای"} ـه. متن جواب همین‌جا برات نوشته شده. 💛`;
  if (/AI_(401|403)/.test(s))
    return "🔑 دسترسی به سرویس هوش مصنوعی مشکل داره؛ به مدیر خبر بده. 💛";
  if (/AI_402/.test(s))
    return "💳 اعتبار سرویس هوش مصنوعی کافی نیست؛ مدیر باید شارژش کنه. 💛";
  if (/AI_404/.test(s))
    return "🤖 مدل فعلی دیگه در دسترس نیست؛ از پنل مدیریت مدل جدید انتخاب بشه. 💛";
  if (/FILE_LARGE/.test(s))
    return "📦 فایل زیادی بزرگه؛ لطفاً کوچیک‌تر بفرست. 😊";
  if (/TTS_|VOICE_SEND/.test(s))
    return "🔇 الان نتونستم صداش رو بسازم؛ کمی بعد دوباره «بخونش» رو بفرست. 💛";
  if (/GH_/.test(s))
    return "💻 الان امکان بررسی کامل این مخزن نیست؛ لینک یا حجمش رو بررسی کن. 😅";
  if (/SEARCH_/.test(s))
    return searchMessage(s);
  if (/429/.test(s))
    return "⏳ الان یکم شلوغه؛ کمی بعد دوباره امتحان کن. 😅";
  return "🙈 این درخواست درست انجام نشد؛ دوباره امتحان کن. 💛";
}
