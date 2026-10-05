/** Nexa saeed-ai-v7 admin module. Source moved without behavioral rewrites. */
import { chatCompletionsUrl, isValidCustomModel, normalizeBaseUrl } from "../../_shared/openai-compat.ts";
import { ACCESS, ADMIN, CK, GK, RK, TOKEN, admin, db } from "./state.ts";
import { isAllowed } from "../../_shared/access.ts";
import { clearBotConfigCache, readBotConfig } from "../../_shared/bot-config.ts";
import { clearCapabilityCache } from "../../_shared/capabilities.ts";
import { userAiContext } from "../../_shared/user-ai.ts";
import { send } from "./transport.ts";

export type Pref = { telegram_user_id: number; tone: string; answer_length: string; language: string; pending_tool: string; keyboard_page: string };
type Chat = { id?: unknown; type?: string } | undefined;

export function allowed(id: number, chat: Chat) {
  return isAllowed(db, ACCESS, id, chat);
}

export async function pref(id: number): Promise<Pref> {
  const { data, error } = await db
    .from("telegram_bot_preferences")
    .select(PREF_COLUMNS)
    .eq("telegram_user_id", id)
    .maybeSingle();
  if (error) throw Error("PREF");
  return (
    data || {
      telegram_user_id: id,
      tone: "friendly",
      answer_length: "balanced",
      language: "fa",
      pending_tool: "chat",
      keyboard_page: "home",
    }
  );
}

const PREF_COLUMNS = "telegram_user_id,tone,answer_length,language,pending_tool,keyboard_page";

/**
 * Partial update of only the changed columns; a whole-row read-modify-write
 * could overwrite a concurrent change (e.g. tone saved while a tool resets).
 */
export async function save(id: number, patch: Partial<Pref>): Promise<Pref> {
  const changes = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await db
    .from("telegram_bot_preferences")
    .update(changes)
    .eq("telegram_user_id", id)
    .select(PREF_COLUMNS)
    .maybeSingle();
  if (error) throw Error("SAVE");
  if (data) return data;
  const row = { ...(await pref(id)), ...changes };
  const { error: insertError } = await db
    .from("telegram_bot_preferences")
    .upsert(row, { onConflict: "telegram_user_id" });
  if (insertError) throw Error("SAVE");
  return row;
}

/** Runtime model config, cached for 30 s per isolate. When no provider row
 *  exists yet (fresh install), the provider whose key is configured wins. */
export function cfg() {
  return readBotConfig(db, Date.now(), { preferProvider: GK ? "gemini" : "openrouter" });
}

export async function userCfg(id: number) {
  return userAiContext(db, id, await cfg(), { gemini: GK, openrouter: RK, custom: CK });
}

export async function configSet(key: string, val: string | number) {
  const { error } = await db.from("telegram_bot_config").upsert(
    {
      setting_key: key,
      setting_value: String(val),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "setting_key" },
  );
  if (error) throw Error("CONFIG_WRITE");
  clearBotConfigCache();
  // Provider/model changes immediately re-resolve model capabilities.
  clearCapabilityCache();
}

export async function stats(id: number, chat: number) {
  if (!admin(id)) return;
  const since = new Date(Date.now() - 86400000).toISOString(),
    { data, error } = await db
      .from("saeed_ai_metrics")
      .select("status,input_tokens,output_tokens,telegram_user_id,error_code")
      .gte("created_at", since)
      .limit(5000);
  if (error) throw Error("STATS");
  const a = data || [],
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    { data: usage } = await db
      .from("telegram_bot_daily_usage")
      .select("telegram_user_id,used")
      .eq("usage_day", day);
  await send(
    chat,
    `📈 گزارش مدیر | ۲۴ ساعت اخیر\n📨 درخواست‌های ثبت‌شده: ${a.length}\n✅ موفق: ${a.filter((x) => x.status === "success").length}\n⚠️ ناموفق: ${a.filter((x) => x.status === "failed").length}\n🔢 توکن ورودی ثبت‌شده: ${a.reduce((s, x) => s + (x.input_tokens || 0), 0)}\n🔢 توکن خروجی ثبت‌شده: ${a.reduce((s, x) => s + (x.output_tokens || 0), 0)}\n\n📊 مصرف امروز:\n${(usage || []).map((x) => "👤 " + x.telegram_user_id + ": " + x.used).join("\n") || "هنوز آماری نداریم."}\n\n⚠️ فقط درخواست‌هایی که آمارشان ثبت شده در این گزارش‌اند.`,
    "admin",
    id,
  );
}

export async function flow(id: number, action: string) {
  const { error } = await db.from("telegram_bot_admin_flow").upsert({
    telegram_user_id: id,
    pending_action: action,
    target_user_id: null,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw Error("FLOW");
}

export async function testModel(provider: string, model: string, customBaseUrl = "") {
  let r: Response;
  if (provider === "gemini") {
    r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GK,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply OK" }] }],
          // Thinking models can spend a tiny budget on hidden thoughts and
          // return no visible text, which looked like a broken model. 256
          // tokens keep the connectivity probe reliable.
          generationConfig: { maxOutputTokens: 256 },
        }),
        signal: AbortSignal.timeout(18000),
      },
    );
  } else {
    const custom = provider === "custom";
    const base = custom ? normalizeBaseUrl(customBaseUrl) : null;
    if (custom && (!base || !CK || !model)) throw Error("CUSTOM_CONFIG");
    r = await fetch(custom ? chatCompletionsUrl(base!) : "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (custom ? CK : RK),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(18000),
      redirect: "error",
    });
  }
  if (!r.ok) throw Error("MODEL_" + r.status);
  const j = await r.json();
  if (
    !(provider === "gemini"
      ? j.candidates?.[0]?.content?.parts?.some((x: { text?: string }) => x.text)
      : j.choices?.[0]?.message?.content)
  )
    throw Error("NO_REPLY");
}

export async function adminInput(id: number, chat: number, text: string) {
  if (!admin(id)) return false;
  const { data, error } = await db
    .from("telegram_bot_admin_flow")
    .select("pending_action,expires_at")
    .eq("telegram_user_id", id)
    .maybeSingle();
  if (error) throw Error("FLOW");
  if (!data) return false;
  await db.from("telegram_bot_admin_flow").delete().eq("telegram_user_id", id);
  if (Date.parse(data.expires_at) < Date.now()) {
    await send(chat, "⌛ وقت این تغییر تموم شد؛ از پنل مدیریت دوباره شروع کن.");
    return true;
  }
  const a = data.pending_action;
  if (["add_user", "remove_user"].includes(a)) {
    if (
      !/^[1-9]\d{4,15}$/.test(text) ||
      !Number.isSafeInteger(Number(text)) ||
      (a === "remove_user" && text === ADMIN)
    ) {
      await send(chat, "🙈 شناسه کاربر معتبر نیست؛ دوباره از مدیریت شروع کن.");
      return true;
    }
    const { error: e } = await db.from("telegram_bot_user_access").upsert({
      telegram_user_id: Number(text),
      enabled: a === "add_user",
      updated_at: new Date().toISOString(),
    });
    if (e) throw Error("USER_WRITE");
    await send(
      chat,
      a === "add_user" ? "✅ کاربر فعال شد." : "✅ دسترسی کاربر قطع شد.",
    );
    return true;
  }
  if (a === "set_daily_default") {
    if (!/^\d{1,4}$/.test(text) || Number(text) > 1000) {
      await send(chat, "عدد ۰ تا ۱۰۰۰ بفرست؛ صفر یعنی نامحدود.");
      return true;
    }
    await configSet("daily_limit", Number(text));
    await send(chat, "✅ سقف روزانه ثبت شد.");
    return true;
  }
  if (a === "set_daily_user") {
    const m = /^([1-9]\d{4,15})\s*[:،,]\s*(\d{1,4})$/.exec(text);
    if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[2]) > 1000) {
      await send(chat, "فرمت درست: 123456789:40 ؛ صفر یعنی نامحدود.");
      return true;
    }
    const { data: u } = await db
      .from("telegram_bot_user_access")
      .select("enabled")
      .eq("telegram_user_id", Number(m[1]))
      .maybeSingle();
    if (!u?.enabled && m[1] !== ADMIN) {
      await send(chat, "این کاربر هنوز فعال نیست؛ اول اضافه‌اش کن.");
      return true;
    }
    const { error: e } = await db.from("telegram_bot_user_access").upsert({
      telegram_user_id: Number(m[1]),
      enabled: true,
      daily_limit: Number(m[2]),
      updated_at: new Date().toISOString(),
    });
    if (e) throw Error("QUOTA_WRITE");
    await send(chat, "✅ سهمیه اختصاصی ثبت شد.");
    return true;
  }
  if (a === "add_custom_url") {
    const baseUrl = normalizeBaseUrl(text);
    if (!baseUrl) {
      await send(chat, "🙈 آدرس باید یک https عمومی باشه، مثلاً https://api.openai.com/v1");
      return true;
    }
    await configSet("custom_base_url", baseUrl);
    await send(chat, "✅ آدرس Custom ثبت شد. حالا «✏️ مدل Custom» رو بزن و نام مدل رو بده." + (CK ? "" : "\n⚠️ هنوز CUSTOM_API_KEY در تنظیمات Edge Function ثبت نشده."));
    return true;
  }
  if (a !== "add_model" && a !== "add_openrouter_model" && a !== "add_custom_model") {
    // Unknown or stale flow actions must fail closed; previously any leftover
    // value fell through and was saved as the OpenRouter model identifier.
    await send(chat, "🤔 این درخواست مدیریتی شناسایی نشد؛ از پنل مدیریت دوباره شروع کن.");
    return true;
  }
  const provider = a === "add_model" ? "gemini" : a === "add_custom_model" ? "custom" : "openrouter",
    valid =
      provider === "gemini"
        ? /^[a-z][a-z0-9.-]{3,80}$/.test(text)
        : provider === "custom"
          ? isValidCustomModel(text)
          : /^[\w.~-]+\/[\w.:~-]{2,110}$/.test(text);
  if (!valid) {
    await send(chat, "🙈 شناسه مدل درست نیست.");
    return true;
  }
  const conf = await cfg();
  if (provider === "custom" && !normalizeBaseUrl(conf.customBaseUrl)) {
    await send(chat, "🙈 اول «🔗 آدرس Custom» رو ثبت کن.");
    return true;
  }
  await send(chat, "🔍 اتصال مدل رو امتحان می‌کنم…");
  try {
    await testModel(provider, text, conf.customBaseUrl);
    await configSet(provider === "gemini" ? "model" : provider === "custom" ? "custom_model" : "openrouter_model", text);
    await send(chat, "✅ مدل تست و ثبت شد.");
  } catch {
    await send(chat, "🙈 مدل پاسخ نداد؛ تنظیم قبلی حفظ شد.");
  }
  return true;
}

/** Every message still inside the privacy window (chat rows expire after 15 minutes). */
export async function exportAll(id: number, chat: number) {
  const { data, error } = await db
    .from("telegram_chat_messages")
    .select("role,body,created_at")
    .eq("telegram_user_id", id)
    .eq("telegram_chat_id", chat)
    .order("id", { ascending: true })
    .limit(200);
  if (error) throw Error("EXPORT");
  if (!data?.length)
    return send(chat, "گفت‌وگوی ذخیره‌شده‌ای نیست؛ پیام‌ها بعد از ۱۵ دقیقه برای حریم خصوصی پاک می‌شن. 😅");
  const body =
    "# گفت‌وگو با Nexa\n\n" +
    data
      .map((x) => `## ${x.role === "model" ? "🤖 Nexa" : "👤 من"} — ${new Date(x.created_at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}\n\n${x.body}`)
      .join("\n\n---\n\n");
  return documentSend(chat, body, "saeed-conversation.md");
}

export async function exportMd(id: number, chat: number) {
  const { data, error } = await db
    .from("telegram_chat_messages")
    .select("body")
    .eq("telegram_user_id", id)
    .eq("telegram_chat_id", chat)
    .eq("role", "model")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw Error("EXPORT");
  if (!data) return send(chat, "هنوز پاسخی برای خروجی نیست. 😅");
  return documentSend(chat, data.body, "saeed-last-answer.md");
}

export async function documentSend(chat: number, body: string, name: string) {
  const form = new FormData();
  form.append("chat_id", String(chat));
  form.append(
    "document",
    new Blob([body], { type: "text/markdown;charset=utf-8" }),
    name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80),
  );
  const r = await fetch(
    "https://api.telegram.org/bot" + TOKEN + "/sendDocument",
    { method: "POST", body: form, signal: AbortSignal.timeout(25000) },
  );
  if (!r.ok || !(await r.json()).ok) throw Error("DOCUMENT_SEND");
}
