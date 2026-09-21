/** Saeed AI saeed-ai-ui config module. Source moved without behavioral rewrites. */
import { db } from "./state.ts";

export const MENUS = new Set([
  "💬 گفتگو",
  "🌐 آنلاین",
  "🧰 ابزارها",
  "💻 GitHub",
  "📄 فایل‌خوان",
  "🎭 لحن",
  "⚙️ تنظیمات",
  "📄 خروجی MD",
  "🧠 حریم خصوصی",
  "🛡 مدیریت",
  "🏠 خانه",
  "🖼 تحلیل عکس",
  "🔤 متن عکس",
  "🎙 صوت به متن",
  "📝 خلاصه",
  "🌍 ترجمه",
  "✍️ بازنویسی",
  "💡 ایده‌پردازی",
  "📏 اندازه پاسخ",
  "🌐 زبان",
  "🗑 پاک‌کردن حافظه",
  "✅ تأیید پاک‌کردن",
  "❌ انصراف",
  "👥 کاربران",
  "🤖 مدل‌ها",
  "📊 سهمیه روزانه",
  "➕ افزودن کاربر",
  "🚫 حذف کاربر",
  "🟢 Gemini",
  "🔵 OpenRouter",
  "✏️ مدل Gemini",
  "✏️ مدل OpenRouter",
  "↩️ پیش‌فرض Gemini",
  "↩️ پیش‌فرض OpenRouter",
  "✏️ سقف پیش‌فرض",
  "👤 سهمیه کاربر",
  "📈 آمار و خطاها",
  "😊 دوستانه",
  "👔 رسمی",
  "❤️ عاشقانه",
  "🎯 تخصصی",
  "🎨 خلاق",
  "😄 شوخ‌طبع",
  "🪷 عارفانه",
  "⚡ کوتاه",
  "📏 متعادل",
  "📚 مفصل",
  "🇮🇷 فارسی",
  "🇬🇧 انگلیسی",
  "🌐 خودکار",
  "⏰ یادآور",
  "🧮 ماشین‌حساب",
  "📧 ایمیل نگارش",
  "✅ تسک‌ها",
  "🗑 پاک‌کردن تسک‌ها",
  "✅ تأیید حذف همه تسک‌ها",
  "📋 پروفایل من",
  "🎉 سرگرمی",
  "🔮 طالع",
  "🧠 تست هوش",
  "📖 داستان",
  "😂 جوک",
  "🔥 روست",
]);

export function toneGuide(tone) {
  if (tone === "witty")
    return "Be a consistently upbeat, genuinely kind, very playful Iranian-Persian friend. Use lively colloquial banter, clever original jokes and funny observations, warm affection, and natural emojis (usually 1-3, more when the user is playful). Say حاجی occasionally when it fits, not in every reply. Answer the actual request first; do not become a repetitive comedian, invent facts, or make fun of the user. For grief, illness, danger or distress be sincerely gentle instead of cracking jokes. Honor explicitly requested formal writing and preserve technical accuracy.";
  if (tone === "mystic")
    return "Reply in original Persian prose inspired by seventh-century Hijri (thirteenth-century) Sufi literature: musical, luminous, tender, contemplative and subtly poetic, with elegant old-fashioned diction and original metaphors of the heart, light and the journey. Address the user as ای دوست when natural. Occasionally compose an ORIGINAL short verse if the request welcomes poetry; never quote or attribute invented lines to Rumi, Saadi or another poet. Answer the concrete question accurately and intelligibly; keep code, URLs, numbers and safety advice plain and precise. Be gentle with sensitive topics.";
  return "Follow the selected tone naturally without sacrificing accuracy or the requested output format.";
}

export async function config() {
  const { data, error } = await db
    .from("telegram_bot_config")
    .select("setting_key,setting_value");
  if (error) throw Error("CONFIG");
  const x = new Map((data || []).map((v) => [v.setting_key, v.setting_value]));
  return {
    provider: x.get("provider") === "openrouter" ? "openrouter" : "gemini",
    gemini: x.get("model") || "gemini-3.5-flash-lite",
    openrouter: x.get("openrouter_model") || "google/gemma-4-26b-a4b-it:free",
    search: x.get("search_model") || x.get("model") || "gemini-3.5-flash-lite",
  };
}

export async function readHistory(id, chat, row) {
  const since = new Date(Date.now() - 900000).toISOString(),
    h = await db
      .from("telegram_chat_messages")
      .select("role,body")
      .eq("telegram_user_id", id)
      .eq("telegram_chat_id", chat)
      .lt("id", row)
      .gte("created_at", since)
      .order("id", { ascending: false })
      .limit(12);
  if (h.error) throw Error("HISTORY");
  const turns = (h.data || [])
    .reverse()
    .map((x) => ({
      role: x.role === "model" ? "model" : "user",
      parts: [{ text: x.body.slice(0, 3000) }],
    }));
  // Merge consecutive same-role turns: failed answers delete the model row and
  // strict OpenAI-compatible providers reject non-alternating roles.
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.parts[0].text += "\n" + turn.parts[0].text;
    } else merged.push(turn);
  }
  return merged;
}
