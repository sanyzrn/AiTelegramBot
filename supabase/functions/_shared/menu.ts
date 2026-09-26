/** Pure Telegram menu definitions shared by the gateway and the processor; no imports. */
export const TONES: Record<string, string> = {
    friendly: "😊 دوستانه",
    formal: "👔 رسمی",
    romantic: "❤️ عاشقانه",
    professional: "🎯 تخصصی",
    creative: "🎨 خلاق",
    witty: "😄 شوخ‌طبع",
    mystic: "🪷 عارفانه",
  },
  SIZES: Record<string, string> = { short: "⚡ کوتاه", balanced: "📏 متعادل", detailed: "📚 مفصل" },
  LANG: Record<string, string> = { fa: "🇮🇷 فارسی", en: "🇬🇧 انگلیسی", auto: "🌐 خودکار" },
  TOOLS: Record<string, string> = {
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
    expenses: "💸 ثبت خرج",
    receipt: "🧾 ثبت رسید",
    horoscope: "🔮 طالع",
    trivia: "🧠 تست هوش",
    story: "📖 داستان",
    joke: "😂 جوک",
    roast: "🔥 روست",
  };

/** Buttons that are just shortcuts for a typed life command handled by _shared/life.ts. */
export const BUTTON_COMMANDS: Record<string, string> = {
  "🛒 لیست خرید": "لیست خرید",
  "💰 خرج‌ها": "خرج‌هام",
  "🔔 هشدارها": "هشدارهام",
  "☀️ صبح‌نامه": "صبح‌نامه",
  "📅 خلاصه هفته": "خلاصه هفته",
  "🍅 پومودورو": "پومودورو",
  "🧠 حافظه من": "حافظه‌هام",
  "🕰 منطقه زمانی": "منطقه زمانی",
  "🔕 یادآورهای فعال": "یادآورهام",
};

/** Opens the tools guide page (examples of every automatic tool). */
export const GUIDE_BUTTON = "📖 راهنمای ابزارها";

/** Label of the optional Telegram Mini App button (shown only when WEBAPP_URL is configured). */
export const DASHBOARD_BUTTON = "📊 داشبورد";

export const MENU: Record<string, string[][]> = {
  home: [["💬 گفتگو", "🧰 ابزارها"], ["🗂 روزمره", "⚙️ تنظیمات"]],
  // Every tool starts by itself from chat, photos, files or voice, so the tools
  // page is a guide plus the few things that are not a message.
  tools: [
    [GUIDE_BUTTON],
    ["🎉 سرگرمی", "📋 پروفایل من"],
    ["📄 خروجی MD", "🗂 روزمره"],
    ["🏠 خانه"],
  ],
  guide: [["🎉 سرگرمی", "🗂 روزمره"], ["🧰 ابزارها", "🏠 خانه"]],
  life: [
    ["⏰ یادآور", "✅ تسک‌ها"],
    ["🛒 لیست خرید", "💰 خرج‌ها"],
    ["💸 ثبت خرج", "🧾 ثبت رسید"],
    ["🔔 هشدارها", "☀️ صبح‌نامه"],
    ["📅 خلاصه هفته", "🍅 پومودورو"],
    ["🧠 حافظه من"],
    ["🔕 یادآورهای فعال"],
    ["🧰 ابزارها", "🏠 خانه"],
  ],
  fun: [
    ["🔮 طالع", "🧠 تست هوش"],
    ["📖 داستان", "😂 جوک"],
    ["🔥 روست"],
    ["🧰 ابزارها", "🏠 خانه"],
  ],
  tasks: [["🗑 پاک‌کردن تسک‌ها"], ["🗂 روزمره", "🏠 خانه"]],
  tasks_delete_confirm: [["✅ تأیید حذف همه تسک‌ها"], ["❌ انصراف"]],
  settings: [
    ["🎭 لحن", "📏 اندازه پاسخ"],
    ["🌐 زبان", "🧠 حریم خصوصی"],
    ["🕰 منطقه زمانی"],
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
  privacy: [["🗑 پاک‌کردن حافظه"], ["🧠 حافظه من"], ["⚙️ تنظیمات", "🏠 خانه"]],
  reset: [["✅ تأیید پاک‌کردن", "❌ انصراف"]],
  admin: [
    ["👥 کاربران", "🤖 مدل‌ها"],
    ["📊 سهمیه روزانه", "📈 آمار و خطاها"],
    ["🔎 جست‌وجوی چت"],
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

/** Pages that exist only for the admin. */
export const ADMIN_PAGES = ["admin", "users", "models", "quota"];

export function rows(page: string, isAdmin: boolean, withDashboard = false): string[][] {
  const r = (MENU[page] || MENU.home).map((x) => [...x]);
  if (page === "settings" && isAdmin) r.splice(r.length - 1, 0, ["🛡 مدیریت"]);
  if (page === "home" && withDashboard) r.splice(1, 0, [DASHBOARD_BUTTON]);
  return r;
}

/** Every text a reply keyboard can ever produce (the gateway forwards all of them). */
export function allButtons(): string[] {
  const set = new Set<string>(["🛡 مدیریت", DASHBOARD_BUTTON]);
  for (const page of Object.values(MENU)) for (const row of page) for (const b of row) set.add(b);
  // Older keyboards still on users' phones keep working after the slimming.
  for (const label of Object.values(TOOLS)) set.add(label);
  return [...set];
}

export const keyboard = (page: string, isAdmin: boolean, webAppUrl = "") => ({
  keyboard: rows(page, isAdmin, !!webAppUrl).map((row) =>
    row.map((text) => (text === DASHBOARD_BUTTON && webAppUrl ? { text, web_app: { url: webAppUrl } } : { text }))
  ),
  resize_keyboard: true,
  is_persistent: false,
  one_time_keyboard: true,
  input_field_placeholder: "پیامت رو بنویس حاجی… 💬",
});
