/** Saeed AI saeed-ai-v7 voice module. Source moved without behavioral rewrites. */
import { voiceFollowupMode } from "../../_shared/voice-intent.ts";
import { db } from "./state.ts";
import { startWork } from "./work.ts";
import { send } from "./transport.ts";
import { show } from "./ui.ts";
import { pref, save } from "./admin.ts";
import type { TgMessage } from "../../_shared/telegram.ts";

export async function chooseVoice(m: TgMessage, update: number) {
  const a = m.voice || m.audio;
  if (!a) return;
  const { error } = await db.from("saeed_ai_voice_pending").upsert(
    {
      telegram_user_id: m.from.id,
      telegram_chat_id: m.chat.id,
      telegram_message_id: m.message_id,
      file_id: a.file_id,
      file_size: a.file_size,
      expires_at: new Date(Date.now() + 900000).toISOString(),
    },
    { onConflict: "telegram_user_id,telegram_message_id" },
  );
  if (error) throw Error("VOICE_SAVE");
  // Keep the original Telegram message ID for explicit reply transformations.
  // An explicit voice-capable tool picked from the tools keyboard wins;
  // otherwise the voice is executed automatically without a button prompt.
  const p = await pref(m.from.id),
    tool = ["transcribe", "summarize", "translate"].includes(p.pending_tool)
      ? p.pending_tool
      : "execute";
  await startWork(m, update, tool, "", null);
}

export async function voiceAction(id: number, chat: number, act: string, update: number) {
  const { data: item, error } = await db
    .from("saeed_ai_voice_pending")
    .select("*")
    .eq("telegram_user_id", id)
    .eq("telegram_chat_id", chat)
    .gt("expires_at", new Date().toISOString())
    .order("telegram_message_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw Error("VOICE_READ");
  if (!item) {
    await send(chat, "⌛ ویس قبلی منقضی شده؛ دوباره بفرست.");
    await show(id, chat, "tools");
    return;
  }
  if (act === "cancel") {
    await db
      .from("saeed_ai_voice_pending")
      .delete()
      .eq("telegram_user_id", id)
      .eq("telegram_message_id", item.telegram_message_id);
    await show(id, chat, "home");
    return;
  }
  // Do not consume the stored file: several replies may transform the same voice.
  // Audio requests use Gemini independently of the selected text-chat provider.
  await save(id, { keyboard_page: "tools" });
  const m = {
    from: { id },
    chat: { id: chat, type: "private" },
    message_id: item.telegram_message_id,
    voice: { file_id: item.file_id, file_size: item.file_size },
    text: "",
  };
  await startWork(m, update, act, "", null);
}

export async function handleVoiceReply(m: TgMessage, update: number) {
  const action = voiceFollowupMode((m.text || "").trim());
  const replied = m.reply_to_message;
  if (!action || !replied?.message_id || !(replied.voice || replied.audio)) return false;
  // Fetch ONLY a still-valid voice uploaded by this same private-chat user.
  // No fallback to an arbitrary Telegram file_id if ownership or TTL fails.
  const { data: original, error } = await db.from("saeed_ai_voice_pending")
    .select("file_id,file_size")
    .eq("telegram_user_id", m.from.id)
    .eq("telegram_chat_id", m.chat.id)
    .eq("telegram_message_id", replied.message_id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw Error("VOICE_REPLY_LOOKUP");
  if (!original) {
    await send(m.chat.id, "⌛ حاجی، دسترسی به اون ویس تموم شده. دوباره بفرست تا برات انجامش بدم. 💛");
    return true;
  }
  const clip = { file_id: original.file_id, file_size: original.file_size };
  const source = {
    ...m, text: "", caption: "", reply_to_message: null,
    voice: replied.voice ? clip : null,
    audio: replied.audio ? { ...replied.audio, ...clip } : null,
  };
  await startWork(source, update, action, "", null);
  return true;
}
