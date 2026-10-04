/** Saeed AI saeed-ai-ui index module: Telegram webhook gateway. */
import { APP_VERSION } from "../_shared/version.ts";
import { selectToolIntent } from "../_shared/intent-model.ts";
import { forwardsPendingTool, mustForward } from "../_shared/gateway-route.ts";
import { ACCESS, BASE, RATE_LIMIT, WEBAPP_URL, admin, db, out, ready } from "./core/state.ts";
import { esc, stripRepeatedIntro } from "./core/output.ts";
import { MENUS, readHistory, userConfig } from "./core/config.ts";
import { reply } from "./core/conversation.ts";
import { groundedSearch, searchMessage } from "./core/search.ts";
import { allowed, equal, forward, hook, send, tg, withinRate } from "./core/transport.ts";
import type { TgUpdate } from "../_shared/telegram.ts";
import { validatePersonalApiKey } from "../_shared/user-ai.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/**
 * Chat menu button for the Mini App. The label is Latin on purpose: Telegram
 * renders an RTL label outside the collapsed button, inside the input box.
 */
const menuButton = () => ({ type: "web_app", text: "Dashboard", web_app: { url: WEBAPP_URL } });
let menuSynced = false;

/** Keeps the button in sync after every deploy without a manual ?setup call. */
async function syncMenuButton() {
  if (menuSynced || !WEBAPP_URL) return;
  menuSynced = true;
  try {
    await tg("setChatMenuButton", { menu_button: menuButton() });
  } catch (e) {
    menuSynced = false;
    console.error("MENU_BUTTON", String(e).slice(0, 80));
  }
}

let nameSynced = false;

/** Telegram's top bar is bot-profile data, not Mini App HTML. Keep it branded too. */
async function syncBotName() {
  if (nameSynced) return;
  nameSynced = true;
  try {
    await tg("setMyName", { name: "Nexa" });
  } catch (e) {
    nameSynced = false;
    console.error("BOT_NAME", String(e).slice(0, 80));
  }
}

const accessButtons = () => ({
  inline_keyboard: [
    [{ text: "📨 ارسال Chat ID برای مدیر", callback_data: "nexa:access:request" }],
    [{ text: "🔑 از API شخصی خودم استفاده می‌کنم", callback_data: "nexa:byok:start" }],
  ],
});

async function sendAccessMenu(userId: number) {
  await tg("sendMessage", {
    chat_id: userId,
    text:
      "👋 هنوز به Nexa اضافه نشدی.\n\n" +
      "🆔 Chat ID شما: " + userId + "\n\n" +
      "دو راه داری:\n" +
      "1) شناسه‌ات رو برای مدیر بفرستی و درخواست اضافه‌شدن بدی.\n" +
      "2) با API Key شخصی خودت از Nexa استفاده کنی.",
    reply_markup: accessButtons(),
  });
}

async function requestAccess(
  user: { id: number; first_name?: string; last_name?: string; username?: string },
) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "بدون نام";
  const username = user.username ? "@" + user.username : "—";
  await tg("sendMessage", {
    chat_id: Number(ACCESS.adminId),
    text:
      "📨 درخواست دسترسی Nexa\n" +
      "👤 " + name + "\n" +
      "🔗 " + username + "\n" +
      "🆔 Chat ID: " + user.id,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ افزودن این کاربر", callback_data: "nexa:approve:" + user.id },
      ]],
    },
  });
  await tg("sendMessage", {
    chat_id: user.id,
    text: "✅ درخواستت برای مدیر ارسال شد. بعد از تأیید، همین‌جا بهت خبر می‌دم.",
  });
}

async function startByok(userId: number) {
  await tg("sendMessage", {
    chat_id: userId,
    text: "🔑 سرویس API شخصی‌ات رو انتخاب کن:",
    reply_markup: {
      inline_keyboard: [[
        { text: "🔵 OpenRouter", callback_data: "nexa:byok:openrouter" },
        { text: "🟢 Gemini", callback_data: "nexa:byok:gemini" },
      ]],
    },
  });
}

async function chooseByokProvider(userId: number, provider: "gemini" | "openrouter") {
  const { error } = await db.from("telegram_bot_onboarding").upsert({
    telegram_user_id: userId,
    pending_action: "api_key",
    provider,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" });
  if (error) throw Error("ONBOARD_SAVE");
  await tg("sendMessage", {
    chat_id: userId,
    text:
      "🔐 حالا API Key " + (provider === "openrouter" ? "OpenRouter" : "Gemini") + " رو بفرست.\n\n" +
      "کلید فقط برای حساب خودت استفاده می‌شه و داخل Supabase Vault رمزگذاری می‌شه. " +
      "بعد از دریافت هم سعی می‌کنم پیام حاوی کلید رو پاک کنم. بهتره یک کلید جدا و محدود برای Nexa بسازی.\n\n" +
      "⏱ این مرحله ۱۰ دقیقه اعتبار داره.",
  });
}

async function handleUnauthorized(update: TgUpdate, user: NonNullable<TgUpdate["message"]>["from"], chat: { id: number; type?: string }) {
  if (chat.type !== "private" || chat.id !== user.id) return;

  const { data: accessRow } = await db.from("telegram_bot_user_access")
    .select("enabled").eq("telegram_user_id", user.id).maybeSingle();
  if (accessRow?.enabled === false) {
    await tg("sendMessage", { chat_id: user.id, text: "🚫 دسترسی این حساب توسط مدیر غیرفعال شده." });
    return;
  }

  const callback = update.callback_query;
  if (callback) {
    try { await tg("answerCallbackQuery", { callback_query_id: callback.id }); } catch {}
    const action = callback.data || "";
    if (action === "nexa:access:request") return requestAccess(user);
    if (action === "nexa:byok:start") return startByok(user.id);
    if (action === "nexa:byok:openrouter") return chooseByokProvider(user.id, "openrouter");
    if (action === "nexa:byok:gemini") return chooseByokProvider(user.id, "gemini");
    return sendAccessMenu(user.id);
  }

  const message = update.message;
  if (message?.text) {
    const { data: flow } = await db.from("telegram_bot_onboarding")
      .select("pending_action,provider,expires_at")
      .eq("telegram_user_id", user.id)
      .maybeSingle();
    if (flow?.pending_action === "api_key" && Date.parse(flow.expires_at) > Date.now() &&
        (flow.provider === "gemini" || flow.provider === "openrouter")) {
      const key = message.text.trim();
      try {
        if (message.message_id)
          await tg("deleteMessage", { chat_id: user.id, message_id: message.message_id });
      } catch {}
      if (!(await validatePersonalApiKey(flow.provider, key))) {
        await tg("sendMessage", {
          chat_id: user.id,
          text: "❌ این API Key اعتبارسنجی نشد. کلید درست رو دوباره بفرست یا /start رو بزن و مسیر دیگه‌ای انتخاب کن.",
        });
        return;
      }
      const { data: saved, error } = await db.rpc("nexa_user_api_set", {
        p_user_id: user.id,
        p_provider: flow.provider,
        p_api_key: key,
      });
      if (error || saved !== true) throw Error("USER_API_SAVE");
      await tg("sendMessage", {
        chat_id: user.id,
        text:
          "✅ API Key شخصی‌ات امن ذخیره شد و از این به بعد درخواست‌های AI خودت با همون کلید اجرا می‌شن.\n" +
          "برای شروع /start رو بزن. 🚀",
      });
      return;
    }
  }
  await sendAccessMenu(user.id);
}

async function approveAccess(targetId: number, adminId: number) {
  const { error } = await db.from("telegram_bot_user_access").upsert({
    telegram_user_id: targetId,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" });
  if (error) throw Error("ACCESS_APPROVE");
  await tg("sendMessage", {
    chat_id: targetId,
    text: "✅ مدیر دسترسی شما به Nexa رو تأیید کرد. /start رو بزن و شروع کن. 🚀",
  });
  await tg("sendMessage", {
    chat_id: adminId,
    text: "✅ کاربر " + targetId + " به Nexa اضافه شد.",
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("health"))
    return out({
      version: APP_VERSION,
      configured: ready(),
      tone_modes: true,
      fun_pack: true,
      reminders: true,
      tasks: true,
      v9_auto_tool_routing: true,
      v9_voice_reply: true,
      v9_callback_fast_ack: true,
      profile: true,
      reply_keyboard_gateway: true,
      copyable_blocks: true,
      conversation_context: true,
      search_model_configurable: true,
      search_live_facts_routing: true,
      chat_google_search_tool: true,
      v10_rate_limit: true,
      v10_shared_engine: true,
      v10_life_routing: true,
    });
  const secretOk = async () => ready() && equal(req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", await hook());
  // Diagnostics and webhook setup are privileged: only a caller that already
  // knows the webhook secret (SHA-256 of "telegram-webhook:<bot token>") may use them.
  if (req.method === "GET" && url.searchParams.has("selftest")) {
    if (!(await secretOk())) return out({ ok: false }, 401);
    const rx = /```([A-Za-z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g,
      m = "مقدمه.\n```python\nprint(1)\n```\nپایان.".match(rx),
      t = stripRepeatedIntro(
        "سلام دوباره! من نکسا هستم. پاسخ اصلی اینجاست.",
        false,
      );
    return out({
      version: APP_VERSION,
      fun_labels_routed: [
        "⏰ یادآور",
        "🎉 سرگرمی",
        "🔮 طالع",
        "🔥 روست",
        "📋 پروفایل من",
        "🛒 لیست خرید",
      ].every((x) => MENUS.has(x)),
      menu_routes: MENUS.size,
      normal_text_processor: typeof reply === "function",
      copy_block_parsing: m?.length === 1,
      html_escaped: esc("<&>") === "&lt;&amp;&gt;",
      intro_removed: t === "پاسخ اصلی اینجاست.",
      context_query_enabled: typeof readHistory === "function",
      privacy_window_minutes: 15,
      proxy_target: "saeed-ai-v7",
      search_uses_config_model: typeof groundedSearch === "function",
      search_error_diagnostics: [
        "SEARCH_HTTP_403",
        "SEARCH_HTTP_429",
        "SEARCH_NO_SOURCES",
      ].every((x) => searchMessage(x).length > 45),
    });
  }
  if (req.method === "GET" && url.searchParams.has("setup")) {
    if (!(await secretOk())) return out({ ok: false }, 401);
    try {
      await tg("setWebhook", {
        url: BASE + "/functions/v1/saeed-ai-ui",
        secret_token: await hook(),
        allowed_updates: ["message", "callback_query"],
        max_connections: 2,
        drop_pending_updates: false,
      });
      // The Mini App dashboard is reachable from the chat menu button when configured.
      if (WEBAPP_URL)
        await tg("setChatMenuButton", { menu_button: menuButton() });
      await tg("setMyName", { name: "Nexa" });
      return out({ ok: true, webhook_registered: true, dashboard_menu: !!WEBAPP_URL, bot_name: "Nexa" });
    } catch (e) {
      console.error("SETUP", String(e));
      return out({ ok: false }, 502);
    }
  }
  if (req.method !== "POST") return out({ error: "Not found" }, 404);
  if (!ready()) return out({ error: "Not configured" }, 503);
  if (!(await secretOk())) return out({ error: "Unauthorized" }, 401);
  let update: TgUpdate;
  try {
    const raw = await req.text();
    if (raw.length > 128000) throw Error();
    update = JSON.parse(raw);
    if (!Number.isSafeInteger(update.update_id)) throw Error();
  } catch {
    return out({ error: "Bad update" }, 400);
  }
  const c = update.callback_query,
    m = update.message,
    user = c?.from || m?.from,
    chat = c?.message?.chat || m?.chat;
  if (!user?.id || !chat?.id) return out({ ok: true, ignored: true });

  if (!(await allowed(user.id, chat))) {
    EdgeRuntime.waitUntil(handleUnauthorized(update, user, chat));
    return out({ ok: true, onboarding: true });
  }

  // Acknowledge Telegram's callback immediately, before the slower internal forward.
  if (c) {
    try {
      await tg("answerCallbackQuery", { callback_query_id: c.id });
    } catch (e) {
      console.error("CALLBACK_ACK", String(e).slice(0, 80));
    }
  }

  if (c && admin(user.id) && /^nexa:approve:\\d+$/.test(c.data || "")) {
    const target = Number((c.data || "").split(":").at(-1));
    if (Number.isSafeInteger(target) && target > 0)
      EdgeRuntime.waitUntil(approveAccess(target, user.id));
    return out({ ok: true, approved: target });
  }
  // The one-time menu-button sync runs beside the update, never in front of it.
  EdgeRuntime.waitUntil(Promise.all([syncMenuButton(), syncBotName()]));
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        if (c) return forward(update);
        if (!m) return;
        if (!admin(user.id) && !(await withinRate(user.id, RATE_LIMIT))) {
          await send(user.id, "🐢 یکم آروم‌تر حاجی! چند ثانیه صبر کن و دوباره بفرست. 😅");
          return;
        }
        const text = (m.text || "").trim();
        if (mustForward(m)) return forward(update);
        const { data: state } = await db
          .from("telegram_bot_admin_flow")
          .select("pending_action")
          .eq("telegram_user_id", user.id)
          .maybeSingle();
        if (admin(user.id) && state?.pending_action) return forward(update);
        const { data: p } = await db
          .from("telegram_bot_preferences")
          .select("pending_tool")
          .eq("telegram_user_id", user.id)
          .maybeSingle();
        // Every processor-side pending_tool must be forwarded, otherwise the
        // tools keyboard promises an action the gateway silently downgrades to chat.
        if (forwardsPendingTool(p?.pending_tool)) return forward(update);
        // The menu is a shortcut, not a prerequisite for using a tool.
        const userAi = await userConfig(user.id);
        const inferred = (p?.pending_tool === "chat" || !p?.pending_tool)
          ? await selectToolIntent(text, userAi.config, userAi.keys)
          : "chat";
        if (inferred === "web") return reply(m, update.update_id, "web");
        if (inferred !== "chat")
          return forward({ ...update, message: { ...m, saeed_auto_tool: inferred } });
        return reply(m, update.update_id);
      } catch (e) {
        console.error("ROUTER", String(e).slice(0, 80));
        await send(user.id, "🙈 مشکلی پیش اومد؛ /start رو دوباره بزن. 😅");
      }
    })(),
  );
  return out({ ok: true });
});
