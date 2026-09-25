/** Telegram menus, preferences and guarded navigation. */
import { WEBAPP_URL, admin, db, tg } from "./state.ts";
import { GK, RK } from "./state.ts";
import { cfg, configSet, exportMd, flow, save, stats, testModel, type Pref } from "./admin.ts";
import { send } from "./transport.ts";
import { listTasks, profile } from "./life.ts";
import { handleLifeMessage } from "../../_shared/life.ts";
import { formatLocal, userTimeZone } from "../../_shared/timezone.ts";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL } from "../../_shared/bot-config.ts";
import { capabilityLine, resolveCapabilities } from "../../_shared/capabilities.ts";

import { ADMIN_PAGES, BUTTON_COMMANDS, DASHBOARD_BUTTON, TONES, SIZES, LANG, TOOLS } from "./menu.ts";
export { TONES, SIZES, LANG, TOOLS, MENU, rows, keyboard, toneGuide } from "./menu.ts";

/** Best-effort capability summary of the active provider (never blocks the menu). */
async function activeCapabilityLine(s: { provider: "gemini" | "openrouter"; gemini: string; openrouter: string }): Promise<string | null> {
  try {
    const caps = await Promise.race([
      resolveCapabilities(s, { timeoutMs: 4000 }),
      new Promise<null>((r) => setTimeout(() => r(null), 4500)),
    ]);
    return caps ? capabilityLine(caps) : null;
  } catch {
    return null;
  }
}

export async function show(id: number, chat: number, page: string) {
  if (ADMIN_PAGES.includes(page) && !admin(id))
    return;
  const p = await save(id, { keyboard_page: page }),
    s = await cfg();
  let body =
    {
      home: "بفرما حاجی چی تو ذهنته 😁",
      tools: "🧰 جعبه‌ابزار\nگزینه موردنظرت رو از کیبورد پایین انتخاب کن. 😎",
      life: "🗂 کارهای روزمره\nیادآور، تسک، خرید، خرج، هشدار، صبح‌نامه و پومودورو همه این‌جان. مستقیم هم می‌تونی بنویسی؛ مثلاً «ناهار ۴۸۰ هزار تومان»، «چند تا هزینه ثبت کن» بعد لیستش، یا «وقتی دلار از ۹۵ هزار رد شد خبرم کن». 😎",
      settings: `⚙️ تنظیمات شخصی\n🎭 ${TONES[p.tone]}\n📏 ${SIZES[p.answer_length]}\n🌐 ${LANG[p.language]}`,
      tones: "🎭 چه لحنی انتخاب می‌کنی؟",
      length: "📏 اندازه جواب رو انتخاب کن.",
      language: "🌐 زبان رو انتخاب کن.",
      privacy:
        "🔒 گفت‌وگوها فقط حدود ۱۵ دقیقه برای ادامه چت خونده می‌شن و به‌صورت دوره‌ای خودکار از دیتابیس پاک می‌شن؛ پیام‌های خود تلگرام باقی می‌مونن.",
      fun: "🎉 سرگرمی با Saeed AI 🎪\nیه گزینه رو انتخاب کن تا شروع کنیم! 😁",
      tasks: "✅ مدیر تسک‌ها\nکارهاتو بگو تا برات لیست کنم.",
      tasks_delete_confirm: "⚠️ تمام تسک‌های تو، حتی تسک‌های انجام‌شده، برای همیشه پاک می‌شن. مطمئنی؟ برای حذف، دکمه تأیید رو بزن؛ برای حفظ تسک‌ها انصراف بده.",
      reset: "⚠️ مطمئنی می‌خوای تاریخچه خودت رو پاک کنی؟",
      admin: `🛡 پنل مدیریت Saeed AI 👑\n🔎 جست‌وجوی گوگل در چت عادی: ${s.chatSearch && s.provider === "gemini" ? "روشن" : "خاموش (فقط با Gemini فعال)"}`,
      users: "👥 مدیریت کاربران\nبرای افزودن یا حذف شناسه عددی رو وارد می‌کنی.",
      models: `🤖 مدیریت مدل‌ها (فقط مدیر)\nفعال: ${s.provider}\nGemini: ${s.gemini}\nOpenRouter: ${s.openrouter}`,
      quota: `📊 سقف پیش‌فرض روزانه: ${s.daily === 0 ? "نامحدود" : s.daily + " پیام"}`,
      voice: "🎙 ویست رسید. از دکمه‌های پایین انتخاب کن چی کارش کنم. 😁",
      retry: "🙈 فعلاً پاسخت آماده نشد. از پایین «تلاش مجدد» رو بزن.",
    }[page] || "🏠 خانه";
  // Incompatible tools are surfaced, not silently broken: the tools page names
  // exactly what the ACTIVE model cannot accept right now. A slow capability
  // lookup must never stall the menu — the hint line is simply skipped.
  if (page === "tools" && s.provider === "openrouter") {
    const caps = await Promise.race([
      resolveCapabilities(s, { timeoutMs: 3000 }),
      new Promise<null>((r) => setTimeout(() => r(null), 3500)),
    ]);
    if (caps) {
      const blocked: string[] = [];
      if (caps.input.image === false) blocked.push("🖼 عکس");
      if (caps.input.audio === false) blocked.push("🎙 صوت");
      if (caps.input.pdf === false) blocked.push("📄 PDF");
      if (blocked.length)
        body += `\n\n⚠️ مدل فعلی (${s.openrouter}) فقط «${capabilityLine(caps)}» می‌فهمه؛ این‌ها فعلاً غیرفعالن: ${blocked.join("، ")}.`;
    }
  }
  if (page === "models") {
    // Both providers get a live capability summary; the "other" provider only
    // when its key exists (no key → the line simply stays unannotated).
    const orCaps = s.provider === "openrouter"
      ? await activeCapabilityLine(s)
      : RK ? await resolveCapabilities({ provider: "openrouter", gemini: s.gemini, openrouter: s.openrouter }, { timeoutMs: 4000 }).then((c) => capabilityLine(c)).catch(() => null) : null;
    const gmCaps = s.provider === "gemini"
      ? await activeCapabilityLine(s)
      : GK ? capabilityLine(await resolveCapabilities({ provider: "gemini", gemini: s.gemini, openrouter: s.openrouter })) : null;
    body = `🤖 مدیریت مدل‌ها (فقط مدیر)\nفعال: ${s.provider}\n🔵 OpenRouter: ${s.openrouter}${orCaps ? ` — ورودی: ${orCaps}` : ""}${!RK ? " (کلید ثبت نشده)" : ""}\n🟢 Gemini: ${s.gemini}${gmCaps ? ` — ورودی: ${gmCaps}` : ""}${!GK ? " (کلید ثبت نشده)" : ""}\n🔊 خروجی صوتی («بخونش»): ${s.provider === "gemini" && GK ? "فعال" : "فقط با Gemini فعال"}`;
  }
  if (page === "users") {
    const { data } = await db
      .from("telegram_bot_user_access")
      .select("telegram_user_id,enabled,daily_limit")
      .order("telegram_user_id")
      .limit(40);
    body +=
      "\n\n" +
      (data || [])
        .map(
          (x) =>
            (x.enabled ? "✅ " : "🚫 ") +
            x.telegram_user_id +
            " | " +
            (x.daily_limit ?? "پیش‌فرض"),
        )
        .join("\n");
  }
  await send(chat, body, page, id);
}

export async function navigate(id: number, chat: number, text: string, p: Pref) {
  const pages: Record<string, string> = {
    "🏠 خانه": "home",
    "🧰 ابزارها": "tools",
    "⚙️ تنظیمات": "settings",
    "🎭 لحن": "tones",
    "📏 اندازه پاسخ": "length",
    "🌐 زبان": "language",
    "🧠 حریم خصوصی": "privacy",
    "🗑 پاک‌کردن حافظه": "reset",
    "🛡 مدیریت": "admin",
    "👥 کاربران": "users",
    "🤖 مدل‌ها": "models",
    "📊 سهمیه روزانه": "quota",
    "🎉 سرگرمی": "fun",
    "✅ تسک‌ها": "tasks",
    "🗂 روزمره": "life",
  };
  if (pages[text]) {
    if (pages[text] === "home") await save(id, { pending_tool: "chat" });
    if (pages[text] === "tasks") {
      await save(id, { pending_tool: "tasks" });
      await listTasks(id, chat);
      return true;
    }
    await show(id, chat, pages[text]);
    return true;
  }
  // Life buttons are shortcuts for the equivalent typed command.
  if (BUTTON_COMMANDS[text]) {
    await save(id, { pending_tool: "chat", keyboard_page: "life" });
    await handleLifeMessage({ db, tg, send }, id, chat, BUTTON_COMMANDS[text], 0);
    return true;
  }
  if (text === DASHBOARD_BUTTON) {
    await send(chat, WEBAPP_URL
      ? "📊 داشبورد از دکمه‌ی پایین صفحه باز می‌شه."
      : "📊 داشبورد هنوز توسط مدیر فعال نشده.", "home", id);
    return true;
  }
  if (text === "⏰ یادآور") {
    await save(id, { pending_tool: "remind" });
    const tz = await userTimeZone(db, id);
    const { data: rems } = await db
      .from("saeed_ai_reminders")
      .select("note,remind_at")
      .eq("telegram_user_id", id)
      .eq("sent", false)
      .eq("canceled", false)
      .order("remind_at")
      .limit(8);
    await send(
      chat,
      (rems?.length
        ? "⏰ یادآورهای فعالت:\n" +
          rems.map((x) => "▫️ " + x.note + " — " + formatLocal(new Date(x.remind_at), tz)).join("\n") +
          "\n(برای لغو: «یادآورهام»)\n\n"
        : "") +
        "یادآور جدیدت رو بنویس؛ مثلاً «۴۵ دقیقه دیگه قابلمه رو خاموش کن» یا «تایمر یک ساعت و نیم بذار» 😉",
      "life",
      id,
    );
    return true;
  }
  if (text === "🗑 پاک‌کردن تسک‌ها") {
    await show(id, chat, "tasks_delete_confirm");
    return true;
  }
  if (text === "✅ تأیید حذف همه تسک‌ها") {
    if (p.keyboard_page !== "tasks_delete_confirm") {
      await send(chat, "⚠️ تأیید منقضی شده. از منوی تسک‌ها دوباره درخواست حذف بده.");
      return true;
    }
    const { error } = await db.from("saeed_ai_tasks").delete().eq("telegram_user_id", id);
    if (error) throw Error("TASKS_CLEAR");
    await save(id, { pending_tool: "chat", keyboard_page: "tasks" });
    await send(chat, "🗑 تسک‌ها با تأیید خودت پاک شدند. ✨", "tasks", id);
    return true;
  }
  if (text === "📋 پروفایل من") {
    await profile(id, chat);
    return true;
  }
  if (text === "❌ انصراف") {
    await db.from("saeed_ai_voice_pending").delete().eq("telegram_user_id", id);
    await db
      .from("telegram_bot_admin_flow")
      .delete()
      .eq("telegram_user_id", id);
    await save(id, { pending_tool: "chat" });
    await show(id, chat, "home");
    return true;
  }
  if (text === "✅ تأیید پاک‌کردن" && p.keyboard_page === "reset") {
    await db
      .from("telegram_chat_messages")
      .delete()
      .eq("telegram_user_id", id)
      .eq("telegram_chat_id", chat);
    await save(id, { pending_tool: "chat" });
    await show(id, chat, "home");
    return true;
  }
  for (const [k, v] of Object.entries(TONES))
    if (text === v) {
      await save(id, { tone: k, keyboard_page: "settings" });
      await send(chat, "✅ لحن " + v + " ثبت شد.", "settings", id);
      return true;
    }
  for (const [k, v] of Object.entries(SIZES))
    if (text === v) {
      await save(id, { answer_length: k, keyboard_page: "settings" });
      await send(chat, "✅ اندازه پاسخ " + v + " ثبت شد.", "settings", id);
      return true;
    }
  for (const [k, v] of Object.entries(LANG))
    if (text === v) {
      await save(id, { language: k, keyboard_page: "settings" });
      await send(chat, "✅ زبان " + v + " ثبت شد.", "settings", id);
      return true;
    }
  if (text === "📄 خروجی MD") {
    await exportMd(id, chat);
    return true;
  }
  if (admin(id)) {
    const tasks: Record<string, string> = {
      "➕ افزودن کاربر": "add_user",
      "🚫 حذف کاربر": "remove_user",
      "✏️ سقف پیش‌فرض": "set_daily_default",
      "👤 سهمیه کاربر": "set_daily_user",
      "✏️ مدل Gemini": "add_model",
      "✏️ مدل OpenRouter": "add_openrouter_model",
    };
    if (tasks[text]) {
      await flow(id, tasks[text]);
      await send(
        chat,
        tasks[text] === "set_daily_user"
          ? "شناسه و سهمیه رو بفرست، مثلاً 123456789:40"
          : tasks[text].includes("model")
            ? "شناسه مدل رو بفرست؛ اول اتصالش رو تست می‌کنم."
            : "شناسه یا عدد موردنظر رو بفرست.",
      );
      return true;
    }
    if (text === "🟢 Gemini" || text === "🔵 OpenRouter") {
      const s = await cfg(),
        provider = text === "🟢 Gemini" ? "gemini" : "openrouter";
      try {
        await testModel(provider, s[provider]);
        await configSet("provider", provider);
        await show(id, chat, "models");
      } catch {
        await send(chat, "🙈 اتصال برقرار نشد؛ سرویس قبلی حفظ شد.");
      }
      return true;
    }
    if (text === "↩️ پیش‌فرض Gemini" || text === "↩️ پیش‌فرض OpenRouter") {
      const provider = text.endsWith("Gemini") ? "gemini" : "openrouter",
        model =
          provider === "gemini"
            ? DEFAULT_GEMINI_MODEL
            : DEFAULT_OPENROUTER_MODEL;
      try {
        await testModel(provider, model);
        await configSet(
          provider === "gemini" ? "model" : "openrouter_model",
          model,
        );
        await show(id, chat, "models");
      } catch {
        await send(chat, "🙈 مدل پیش‌فرض پاسخ نداد؛ تنظیم قبلی حفظ شد.");
      }
      return true;
    }
    if (text === "📈 آمار و خطاها") {
      await stats(id, chat);
      return true;
    }
    if (text === "🔎 جست‌وجوی چت") {
      const s = await cfg();
      await configSet("chat_search", s.chatSearch ? "off" : "on");
      await send(chat, s.chatSearch
        ? "🔎 جست‌وجوی گوگل در چت عادی خاموش شد؛ فقط ابزار «🌐 آنلاین» جست‌وجو می‌کنه (کم‌هزینه‌تر و سریع‌تر)."
        : "🔎 جست‌وجوی گوگل در چت عادی روشن شد؛ جواب‌های زنده همراه با منبع میان.", "admin", id);
      return true;
    }
  }
  for (const [k, v] of Object.entries(TOOLS))
    if (text === v) {
      // Capability-aware tool activation: picking a tool the ACTIVE model
      // definitely cannot serve gets a precise refusal instead of arming a
      // button that would fail later on the first message.
      const s = await cfg();
      if (["image", "ocr", "receipt"].includes(k)) {
        const caps = await resolveCapabilities(s);
        if (caps.input.image === false)
          return send(chat, `🖼 مدل فعلی (${s[s.provider]}) پردازش تصویر رو پشتیبانی نمی‌کنه؛ «${v}» فعلاً غیرفعاله. مدل چندوجهی فعال کن یا متن رو بفرست. 💛`);
      }
      if (k === "transcribe") {
        const caps = await resolveCapabilities(s);
        if (caps.input.audio === false)
          return send(chat, `🎙 مدل فعلی (${s[s.provider]}) از ورودی صوتی پشتیبانی نمی‌کنه؛ «${v}» فعلاً غیرفعاله. مدل چندوجهی فعال کن یا پیامت رو تایپ کن. 💛`);
      }
      await save(id, { pending_tool: k });
      await send(
        chat,
        k === "repo"
          ? "💻 لینک مخزن عمومی GitHub رو بفرست."
          : k === "documents"
            ? "📄 فایل PDF، Word، Excel یا Markdown رو بفرست."
            : k === "web"
              ? "🌐 موضوعی که باید آنلاین بررسی کنم رو بنویس."
              : k === "receipt"
                ? "🧾 عکس رسید یا فاکتور رو بفرست؛ مبلغش رو می‌خونم و قبل از ثبت ازت تأیید می‌گیرم."
              : k === "expenses"
                ? "💸 ثبت خرج فعال شد؛ خرج‌هات رو بفرست — هر خط یکی یا همه با هم. اعداد حروفی هم می‌فهمم؛ مثلاً «خرید برنج دو میلیون و هشتصد هزار تومان»."
              : k === "calc"
                ? "🧮 محاسبه یا مسئله‌ات رو بنویس؛ مرحله‌به‌مرحله حلش می‌کنم."
                : k === "email"
                  ? "📧 موضوع و نکات کلیدی ایمیل رو بنویس؛ برات آماده‌اش می‌کنم."
                  : "✅ " + v + " فعال شد؛ پیام یا فایل بعدی رو بفرست.",
      );
      return true;
    }
  return false;
}
