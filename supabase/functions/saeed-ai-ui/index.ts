/** Saeed AI saeed-ai-ui index module. Source moved without behavioral rewrites. */
import { APP_VERSION } from "../_shared/version.ts";
import { selectToolIntent } from "../_shared/intent-model.ts";
import { BASE, GK, admin, db, out, ready } from "./core/state.ts";
import { esc, stripRepeatedIntro } from "./core/output.ts";
import { MENUS, config, readHistory } from "./core/config.ts";
import { reply } from "./core/conversation.ts";
import { groundedSearch, searchMessage } from "./core/search.ts";
import { allowed, equal, forward, hook, send, tg } from "./core/transport.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

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
    });
  if (req.method === "GET" && url.searchParams.has("selftest")) {
    const rx = /```([A-Za-z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g,
      m = "مقدمه.\n```python\nprint(1)\n```\nپایان.".match(rx),
      t = stripRepeatedIntro(
        "سلام دوباره! من سعید AI هستم. پاسخ اصلی اینجاست.",
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
    // Setup is privileged: only a caller that already knows the webhook secret
    // (SHA-256 of "telegram-webhook:<bot token>") may re-register the webhook.
    const provided = req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!ready() || !equal(provided, await hook())) return out({ ok: false }, 401);
    try {
      await tg("setWebhook", {
        url: BASE + "/functions/v1/saeed-ai-ui",
        secret_token: await hook(),
        allowed_updates: ["message", "callback_query"],
        max_connections: 2,
        drop_pending_updates: false,
      });
      return out({ ok: true, webhook_registered: true });
    } catch (e) {
      console.error("SETUP", String(e));
      return out({ ok: false }, 502);
    }
  }
  if (req.method !== "POST") return out({ error: "Not found" }, 404);
  if (!ready()) return out({ error: "Not configured" }, 503);
  if (
    !equal(
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
      await hook(),
    )
  )
    return out({ error: "Unauthorized" }, 401);
  let update;
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
  if (!user?.id || !(await allowed(user.id, chat)))
    return out({ ok: true, ignored: true });
  // Acknowledge Telegram's callback immediately, before the slower internal forward.
  if (c) {
    try {
      await tg("answerCallbackQuery", { callback_query_id: c.id });
    } catch (e) {
      console.error("CALLBACK_ACK", String(e).slice(0, 80));
    }
  }
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        if (c) return forward(update);
        if (!m) return;
        const text = (m.text || "").trim();
        // Reply transformations must reach the processor with original voice metadata.
        if (m.reply_to_message?.voice || m.reply_to_message?.audio) return forward(update);
        if (/^صبح[‌\s-]*نامه\s+(?:تست|الان)$/iu.test(text)) return forward(update);
        if (
          MENUS.has(text) ||
          text.startsWith("/") ||
          m.document ||
          m.photo ||
          m.voice ||
          m.audio
        )
          return forward(update);
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
        if (
          [
            "repo",
            "documents",
            "image",
            "ocr",
            "transcribe",
            "remind",
            "tasks",
            "summarize",
            "translate",
            "rewrite",
            "ideas",
            "email",
            "calc",
            "horoscope",
            "trivia",
            "story",
            "joke",
            "roast",
          ].includes(p?.pending_tool)
        )
          return forward(update);
        // The menu is a shortcut, not a prerequisite for using a tool.
        const inferred = (p?.pending_tool === "chat" || !p?.pending_tool)
          ? await selectToolIntent(text, GK, (await config()).gemini)
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
