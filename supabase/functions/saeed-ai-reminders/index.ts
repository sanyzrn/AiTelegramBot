import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { APP_VERSION } from "../_shared/version.ts";
import { morningVoiceConfig, runTick } from "../_shared/dispatch.ts";
import { createTg, sendPlain } from "../_shared/telegram.ts";
import { sendVoice, synthesize } from "../_shared/tts.ts";
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const GKEY = Deno.env.get("GEMINI_API_KEY") || "";
const RKEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const TTS_MODEL = Deno.env.get("GEMINI_TTS_MODEL") || undefined;
let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try { KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY; } catch {}
const db = BASE && KEY ? createClient(BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const tg = createTg(TOKEN);
const configured = () => !!(db && TOKEN);

/** Reminder deliveries carry done / snooze / cancel buttons. */
async function send(chatId: number, text: string, reminderId?: number) {
  const keyboard = reminderId ? { inline_keyboard: [
    [{ text: "✅ انجام شد", callback_data: `reminder:done:${reminderId}` }, { text: "⏰ ۱۰ دقیقه بعد", callback_data: `reminder:snooze:${reminderId}` }],
    [{ text: "🗑 لغو تکرارهای بعدی", callback_data: `reminder:cancel:${reminderId}` }],
  ] } : null;
  await sendPlain(tg, chatId, text, keyboard ? { reply_markup: keyboard } : {});
}

const deps = () => ({
  db,
  send,
  sendHtml: async (chat: number, html: string) => { await tg("sendMessage", { chat_id: chat, text: html, parse_mode: "HTML" }); },
  // The briefing voice is short (intro + sign-off) so encoding stays within the
  // CPU budget. Voice-out is the Gemini TTS engine: it is offered only while
  // Gemini is the ACTIVE provider (no hidden Gemini call under OpenRouter).
  speak: GKEY ? async (chat: number, text: string) => {
    const voiceCfg = await morningVoiceConfig({ db, keys: { gemini: GKEY, openrouter: RKEY } }).catch(() => ({}) as Awaited<ReturnType<typeof morningVoiceConfig>>);
    if (voiceCfg.prefer === "openrouter") return;
    const { mp3, seconds } = await synthesize(text, GKEY, { model: TTS_MODEL, style: "Say cheerfully, like an energetic friend waking someone up, in Persian", timeoutMs: 20000 });
    await sendVoice(TOKEN, chat, mp3, seconds);
  } : undefined,
  keys: { gemini: GKEY, openrouter: RKEY },
});

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.has("health"))
    return Response.json({ version: APP_VERSION, configured: configured(), scheduled_reminders: true, v9_recurring: true, v9_briefings: true, v9_market_weather: true, v93_city_voice: true, v10_watchers: true, v10_weekly: true, v10_sweep: true, v10_timezones: true }, { headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!configured()) return new Response("Unavailable", { status: 503 });
  const candidate = request.headers.get("X-Saeed-Cron-Secret") || "";
  if (!/^[a-f0-9]{64}$/.test(candidate)) return new Response("Unauthorized", { status: 401 });
  const { data: authorized, error: authError } = await db!.rpc("saeed_ai_authenticate_reminder_cron", { p_candidate: candidate });
  if (authError || authorized !== true) return new Response("Unauthorized", { status: 401 });
  const result = await runTick(deps());
  return Response.json(result, { status: result.ok ? 200 : 500 });
});
