/** Saeed AI saeed-ai-v7 index module. Source moved without behavioral rewrites. */
import { APP_VERSION } from "../_shared/version.ts";
import { selectToolIntent } from "../_shared/intent-model.ts";
import { handleLifeMessage, handleLifeCallback } from "../_shared/life.ts";
import { calculateExact } from "../_shared/calculator.ts";
import { parseTimerRequest, normalizeTimerDigits } from "../_shared/timer.ts";
import { equal, hook, send, tg } from "./core/transport.ts";
import { GK, admin, db, ready, reply } from "./core/state.ts";
import { adminInput, allowed, cfg, exportMd, pref, save, stats } from "./core/admin.ts";
import { retry, startWork } from "./core/work.ts";
import { chooseVoice, handleVoiceReply, voiceAction } from "./core/voice.ts";
import { MENU, TOOLS, keyboard, navigate, rows, show } from "./core/ui.ts";
import { doneTask, profile, saveTasks, scheduleRealTimer, setReminder, sweep } from "./core/life.ts";
import { doc, media } from "./core/media.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function callbacks(c, update) {
  const id = c.from.id,
    chat = c.message.chat.id,
    a = c.data || "";
  try {
    await tg("answerCallbackQuery", { callback_query_id: c.id });
  } catch {}
  // Keep life-action buttons until the original list is edited with fresh state.
  if (await handleLifeCallback({ db, tg, send }, id, chat, a, c.message.message_id)) return;
  try {
    await tg("editMessageReplyMarkup", {
      chat_id: chat,
      message_id: c.message.message_id,
    });
  } catch {}
  if (a === "act:md") return exportMd(id, chat);
  if (a.startsWith("retry:")) return retry(id, chat, update);
  if (a.startsWith("voice:")) {
    const old = a.split(":")[2],
      act = old === "tasks" ? "execute" : old;
    return voiceAction(id, chat, act, update);
  }
  if (a === "v6:stats") return stats(id, chat);
  const maps = {
    "nav:home": "home",
    "nav:tools": "tools",
    "nav:settings": "settings",
    "nav:admin": "admin",
    "admin:users": "users",
    "admin:model": "models",
    "admin:quota": "quota",
    "nav:privacy": "privacy",
    "nav:tones": "tones",
    "nav:length": "length",
    "nav:language": "language",
  };
  if (maps[a]) {
    if (maps[a] === "home") await save(id, { pending_tool: "chat" });
    return show(id, chat, maps[a]);
  }
  if (a.startsWith("tool:")) {
    const tool = a.slice(5);
    if (Object.hasOwn(TOOLS, tool)) {
      await save(id, { pending_tool: tool });
      return show(id, chat, "tools");
    }
  }
  return show(id, chat, "home");
}


async function message(m, update) {
  const id = m.from.id,
    chat = m.chat.id,
    text = (m.text || "").trim(),
    p = await pref(id);
  await sweep();
  if (await handleVoiceReply(m, update)) return;
  if (/^\/(start|menu|help)(?:@\w+)?$/.test(text)) {
    await save(id, { pending_tool: "chat" });
    return show(id, chat, "home");
  }
  if (/^\/tools(?:@\w+)?$/.test(text)) return show(id, chat, "tools");
  if (/^\/settings(?:@\w+)?$/.test(text)) return show(id, chat, "settings");
  if (/^\/admin(?:@\w+)?$/.test(text))
    return admin(id)
      ? show(id, chat, "admin")
      : send(chat, "🔒 این بخش مخصوص مدیر باته. 😉");
  if (/^\/(stats|model)(?:@\w+)?$/.test(text))
    return admin(id)
      ? text.startsWith("/stats")
        ? stats(id, chat)
        : show(id, chat, "models")
      : send(chat, "🔒 این بخش مخصوص مدیر باته. 😉");
  if (/^\/md(?:@\w+)?$/.test(text)) return exportMd(id, chat);
  if (/^\/profile(?:@\w+)?$/.test(text)) return profile(id, chat);
  if (/^\/repo(?:@\w+)?$/.test(text)) {
    await save(id, { pending_tool: "repo" });
    return show(id, chat, "tools");
  }
  if (/^\/docs(?:@\w+)?$/.test(text)) {
    await save(id, { pending_tool: "documents" });
    return show(id, chat, "tools");
  }
  if (/^\/web(?:@\w+)?$/.test(text)) {
    await save(id, { pending_tool: "web" });
    return show(id, chat, "tools");
  }
  if (/^\/cancel(?:@\w+)?$/.test(text))
    return navigate(id, chat, "❌ انصراف", p);
  if (/^\/reset(?:@\w+)?$/.test(text)) return show(id, chat, "reset");
  if (/^\/retry(?:\s|@|$)/.test(text)) return retry(id, chat, update);
  if (
    /^\/(transcribe|voice_summary|voice_translate|voice_execute|voice_tasks)(?:\s|@|$)/.test(
      text,
    )
  ) {
    const key = text.match(
        /^\/(transcribe|voice_summary|voice_translate|voice_execute|voice_tasks)/,
      )?.[1],
      act = {
        transcribe: "transcribe",
        voice_summary: "summarize",
        voice_translate: "translate",
        voice_execute: "execute",
        voice_tasks: "execute",
      }[key];
    return voiceAction(id, chat, act, update);
  }
  const funTap = {
    "🔮 طالع": "horoscope",
    "🧠 تست هوش": "trivia",
    "📖 داستان": "story",
    "😂 جوک": "joke",
    "🔥 روست": "roast",
  }[text];
  if (funTap) return startWork(m, update, funTap, "", null);
  if (await navigate(id, chat, text, p)) return;
  // Persian-digit input is the norm here; «انجام شد ۳» must work like «انجام شد 3».
  const doneM = /^انجام\s*شد\s*([۰-۹\d]{1,2})$/u.exec(text);
  if (doneM) return doneTask(id, chat, Number(normalizeTimerDigits(doneM[1])));
  if (p.pending_tool === "remind" && text) {
    const timer = parseTimerRequest(text);
    if (timer) return scheduleRealTimer(id, chat, timer, update);
    if (/(?:تایمر|زمان[‌\s-]*سنج|timer)/iu.test(text)) return send(chat, "⏰ مدت تایمر رو واضح بگو؛ مثلاً «تایمر ۷ دقیقه بذار». تایمرِ بدون مدت ثبت نمی‌کنم.");
    return setReminder(id, chat, text, update);
  }
  if (p.pending_tool === "tasks" && text) return saveTasks(id, chat, text, update);
  if (await adminInput(id, chat, text)) return;
  const directTimer = parseTimerRequest(text);
  if (directTimer) return scheduleRealTimer(id, chat, directTimer, update);
  if (/(?:تایمر|زمان[‌\s-]*سنج|timer)/iu.test(text) &&
      /(?:بذار|بگذار|بزن|تنظیم\s*کن|ست\s*کن|شروع\s*کن|set|start)/iu.test(text) &&
      !/(?:چرا|چطور|کار\s*نمی[‌\s]*کن|\?|؟)/iu.test(text))
    return send(chat, "⏰ مدت تایمر رو دقیق بگو؛ مثلاً «تایمر ۷ دقیقه بذار». چیزی ثبت نکردم.");
  if (await handleLifeMessage({ db, tg, send }, id, chat, (m.caption || text).trim(), update)) return;
  const exact = calculateExact(text);
  if (exact) return send(chat, exact);
  // A gateway-selected intent is validated against this local allowlist.
  const safeTools = new Set(["remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas", "expenses", "shopping", "briefing"]);
  const requestText = (m.caption || text).trim();
  const inferred = p.pending_tool === "chat" && requestText
    ? safeTools.has(m.saeed_auto_tool)
      ? m.saeed_auto_tool
      : await selectToolIntent(requestText, GK, (await cfg()).gemini)
    : "chat";
  if (inferred === "remind") {
    const timer = parseTimerRequest(requestText);
    return timer ? scheduleRealTimer(id, chat, timer, update) : setReminder(id, chat, requestText, update);
  }
  if (inferred === "tasks") return saveTasks(id, chat, requestText, update);
  if (["expenses", "shopping", "briefing"].includes(inferred)) {
    if (await handleLifeMessage({ db, tg, send }, id, chat, requestText, update)) return;
    return send(chat, inferred === "expenses" ? "برای ثبت هزینه بنویس: ناهار ۴۸۰ هزار تومان؛ برای گزارش: خرج‌هام." : inferred === "shopping" ? "برای افزودن خرید بنویس: به لیست خرید اضافه کن شیر، نان." : "برای صبح‌نامه بنویس: صبح‌نامه روشن یا خاموش؛ شهرت رو هم می‌تونی با «شهر من اصفهان» انتخاب کنی.");
  }
  if (inferred === "calc") return send(chat, "این فرمت محاسبه رو دقیق پشتیبانی نمی‌کنم. مثلاً «۱۲٪ از ۲ میلیون» یا «۱.۲ + ۳.۴» رو بفرست.");
  if (inferred === "repo") {
    const link = requestText.match(/https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?\/?/i);
    if (link) return startWork(m, update, "repo", link[0], null);
  }
  if (m.voice || m.audio) return chooseVoice(m, update);
  const d = doc(m),
    med = media(m),
    input = (m.caption || text).trim(),
    isRepo = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?\/?$/.test(
      input,
    ),
    tool = d
      ? "documents"
      : inferred !== "chat"
        ? inferred
        : p.pending_tool === "chat" && isRepo
          ? "repo"
          : p.pending_tool;
  if (m.document && !d)
    return send(chat, "📎 فعلاً DOCX، XLSX، MD، TXT و CSV رو می‌خونم. 😁");
  if (tool === "documents" && !d)
    return send(chat, "📄 فایل موردنظر رو بفرست.");
  if (tool === "repo" && !isRepo)
    return send(chat, "💻 لینک اصلی مخزن عمومی GitHub رو بفرست.");
  if (!input && !med && !d)
    return send(chat, "😊 پیام یا فایل موردنظر رو بفرست.");
  await startWork(m, update, tool, input, null);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("health"))
    return reply({
      version: APP_VERSION,
      configured: ready(),
      tone_modes: true,
      fun_pack: true,
      reminders: true,
      tasks: true,
      v9_recurring: true,
      v9_briefings: true,
      v9_market_weather: true,
      v9_tasks_append: true,
      v9_callback_refresh: true,
      v9_voice_auto: true,
      profile: true,
      calculator: true,
      email_draft: true,
      auto_sweep: true,
      reply_keyboard_only: true,
      inline_task_shopping_actions: true,
      documents: true,
      voice: true,
      github: true,
    });
  if (req.method === "GET" && url.searchParams.has("selftest"))
    return reply({
      version: APP_VERSION,
      fun_menu:
        rows("fun", false).flat().length === 7 &&
        rows("fun", false).flat().includes("🔮 طالع"),
      tools_has_remind: rows("tools", false).flat().includes("⏰ یادآور"),
      tools_has_fun: rows("tools", false).flat().includes("🎉 سرگرمی"),
      tools_has_profile: rows("tools", false).flat().includes("📋 پروفایل من"),
      all_pages_reply: Object.keys(MENU).every(
        (page) => !!keyboard(page, false).keyboard,
      ),
      home_buttons: rows("home", false).flat(),
      home_minimal: rows("home", false).flat().length === 3,
      github_in_tools: rows("tools", false).flat().includes("💻 GitHub"),
      tone_in_settings: rows("settings", false).flat().includes("🎭 لحن"),
      md_in_tools: rows("tools", false).flat().includes("📄 خروجی MD"),
      admin_hidden:
        !rows("home", false).flat().includes("🛡 مدیریت") &&
        !rows("settings", false).flat().includes("🛡 مدیریت"),
      admin_in_settings: rows("settings", true).flat().includes("🛡 مدیریت"),
      voice_actions_slash:
        rows("voice", false)
          .flat()
          .filter((x) => x.startsWith("/")).length === 4,
      voice_execute_present: rows("voice", false)
        .flat()
        .some(
          (x) => x.startsWith("/voice_execute") && x.includes("انجام درخواست"),
        ),
      voice_tasks_removed: !rows("voice", false)
        .flat()
        .some((x) => x.startsWith("/voice_tasks")),
      no_inline_markup: true,
    });
  if (req.method !== "POST") return new Response("Not found", { status: 404 });
  if (!ready()) return new Response("Unavailable", { status: 503 });
  if (
    !equal(
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
      await hook(),
    )
  )
    return new Response("Unauthorized", { status: 401 });
  let update;
  try {
    const raw = await req.text();
    if (raw.length > 128000) throw Error();
    update = JSON.parse(raw);
    if (!Number.isSafeInteger(update.update_id)) throw Error();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const c = update.callback_query,
    m = update.message,
    user = c?.from || m?.from,
    chat = c?.message?.chat || m?.chat;
  if (!user?.id || !(await allowed(user.id, chat)))
    return reply({ ok: true, ignored: true });
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        if (c) await callbacks(c, update.update_id);
        else if (m) await message(m, update.update_id);
      } catch (e) {
        console.error("ROUTER", String(e).slice(0, 100));
        try {
          await send(chat.id, "🙈 این بخش قاطی کرد؛ /start رو بزن. 😅");
        } catch {}
      }
    })(),
  );
  return reply({ ok: true });
});
