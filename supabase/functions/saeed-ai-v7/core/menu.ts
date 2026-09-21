/** Pure Telegram menu definitions and formatting; no database or network imports. */
export const TONES = {
    friendly: "😊 دوستانه",
    formal: "👔 رسمی",
    romantic: "❤️ عاشقانه",
    professional: "🎯 تخصصی",
    creative: "🎨 خلاق",
    witty: "😄 شوخ‌طبع",
    mystic: "🪷 عارفانه",
  },
  SIZES = { short: "⚡ کوتاه", balanced: "📏 متعادل", detailed: "📚 مفصل" },
  LANG = { fa: "🇮🇷 فارسی", en: "🇬🇧 انگلیسی", auto: "🌐 خودکار" },
  TOOLS = {
    chat: "💬 گفتگو",
    web: "🌐 آنلاین",
    repo: "💻 GitHub",
    documents: "📄 فایل‌خوان",
    image: "🖼 تحلیل عکس",
    ocr: "🔤 متن عکس",
    transcribe: "🎙 صوت به متن",
    summarize: "📝 خلاصه",
    translate: "🌍 ترجمه",
    rewrite: "✍️ بازنویسی",
    ideas: "💡 ایده‌پردازی",
    remind: "⏰ یادآور",
    calc: "🧮 ماشین‌حساب",
    email: "📧 ایمیل نگارش",
    tasks: "✅ تسک‌ها",
    horoscope: "🔮 طالع",
    trivia: "🧠 تست هوش",
    story: "📖 داستان",
    joke: "😂 جوک",
    roast: "🔥 روست",
  };

export function toneGuide(tone) {
  if (tone === "witty")
    return "Be a consistently upbeat, genuinely kind, very playful Iranian-Persian friend. Use lively colloquial banter, clever original jokes and funny observations, warm affection, and natural emojis (usually 1-3, more when the user is playful). Say حاجی occasionally when it fits, not in every reply. Answer the actual request first; do not become a repetitive comedian, invent facts, or make fun of the user. For grief, illness, danger or distress be sincerely gentle instead of cracking jokes. Honor explicitly requested formal writing and preserve technical accuracy.";
  if (tone === "mystic")
    return "Reply in original Persian prose inspired by seventh-century Hijri (thirteenth-century) Sufi literature: musical, luminous, tender, contemplative and subtly poetic, with elegant old-fashioned diction and original metaphors of the heart, light and the journey. Address the user as ای دوست when natural. Occasionally compose an ORIGINAL short verse if the request welcomes poetry; never quote or attribute invented lines to Rumi, Saadi or another poet. Answer the concrete question accurately and intelligibly; keep code, URLs, numbers and safety advice plain and precise. Be gentle with sensitive topics.";
  return "Follow the selected tone naturally without sacrificing accuracy or the requested output format.";
}

export const MENU = {
  home: [["💬 گفتگو", "🧰 ابزارها"], ["⚙️ تنظیمات"]],
  tools: [
    ["🌐 آنلاین", "💻 GitHub"],
    ["📄 فایل‌خوان", "🖼 تحلیل عکس"],
    ["🔤 متن عکس", "🎙 صوت به متن"],
    ["📝 خلاصه", "🌍 ترجمه"],
    ["✍️ بازنویسی", "💡 ایده‌پردازی"],
    ["⏰ یادآور", "🧮 ماشین‌حساب"],
    ["📧 ایمیل نگارش", "✅ تسک‌ها"],
    ["📋 پروفایل من", "🎉 سرگرمی"],
    ["📄 خروجی MD", "💬 گفتگو"],
    ["🏠 خانه"],
  ],
  fun: [
    ["🔮 طالع", "🧠 تست هوش"],
    ["📖 داستان", "😂 جوک"],
    ["🔥 روست"],
    ["🧰 ابزارها", "🏠 خانه"],
  ],
  tasks: [["🗑 پاک‌کردن تسک‌ها"], ["🧰 ابزارها", "🏠 خانه"]],
  tasks_delete_confirm: [["✅ تأیید حذف همه تسک‌ها"], ["❌ انصراف"]],
  settings: [
    ["🎭 لحن", "📏 اندازه پاسخ"],
    ["🌐 زبان", "🧠 حریم خصوصی"],
    ["🏠 خانه"],
  ],
  tones: [
    ["😊 دوستانه", "👔 رسمی"],
    ["❤️ عاشقانه", "🎯 تخصصی"],
    ["🎨 خلاق", "😄 شوخ‌طبع"],
    ["🪷 عارفانه"],
    ["⚙️ تنظیمات", "🏠 خانه"],
  ],
  length: [["⚡ کوتاه", "📏 متعادل"], ["📚 مفصل"], ["⚙️ تنظیمات", "🏠 خانه"]],
  language: [
    ["🇮🇷 فارسی", "🇬🇧 انگلیسی"],
    ["🌐 خودکار"],
    ["⚙️ تنظیمات", "🏠 خانه"],
  ],
  privacy: [["🗑 پاک‌کردن حافظه"], ["⚙️ تنظیمات", "🏠 خانه"]],
  reset: [["✅ تأیید پاک‌کردن", "❌ انصراف"]],
  admin: [
    ["👥 کاربران", "🤖 مدل‌ها"],
    ["📊 سهمیه روزانه", "📈 آمار و خطاها"],
    ["⚙️ تنظیمات", "🏠 خانه"],
  ],
  users: [
    ["➕ افزودن کاربر", "🚫 حذف کاربر"],
    ["🛡 مدیریت", "🏠 خانه"],
  ],
  models: [
    ["🟢 Gemini", "🔵 OpenRouter"],
    ["✏️ مدل Gemini", "✏️ مدل OpenRouter"],
    ["↩️ پیش‌فرض Gemini", "↩️ پیش‌فرض OpenRouter"],
    ["🛡 مدیریت", "🏠 خانه"],
  ],
  quota: [
    ["✏️ سقف پیش‌فرض", "👤 سهمیه کاربر"],
    ["🛡 مدیریت", "🏠 خانه"],
  ],
  voice: [
    ["/transcribe 📝 تایپ متن", "/voice_summary ⚡ خلاصه"],
    ["/voice_translate 🌍 ترجمه", "/voice_execute 🚀 انجام درخواست"],
    ["❌ انصراف"],
  ],
  retry: [["/retry 🔄 تلاش مجدد"], ["🏠 خانه"]],
};

export function rows(page, isAdmin) {
  const r = (MENU[page] || MENU.home).map((x) => [...x]);
  if (page === "settings" && isAdmin) r.splice(2, 0, ["🛡 مدیریت"]);
  return r;
}

export const keyboard = (page, isAdmin) => ({
  keyboard: rows(page, isAdmin).map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true,
  is_persistent: false,
  one_time_keyboard: true,
  input_field_placeholder: "پیامت رو بنویس حاجی… 💬",
});
