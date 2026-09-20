#!/usr/bin/env python3
"""Idempotently wire automatic voice execution and reply-only voice transforms.
Fail closed if upstream source differs; never silently ship a partial patch.
"""
from pathlib import Path

PROCESSOR = Path('supabase/functions/saeed-ai-v7/index.ts')
GATEWAY = Path('supabase/functions/saeed-ai-ui/index.ts')
p = PROCESSOR.read_text(encoding='utf-8')
g = GATEWAY.read_text(encoding='utf-8')

def patch(which: str, before: str, after: str, marker: str) -> None:
    global p, g
    source = p if which == 'processor' else g
    if marker in source:
        print('already integrated:', marker)
        return
    if source.count(before) != 1:
        raise SystemExit(f'Unsafe {which} source anchor for {marker}: found {source.count(before)}')
    updated = source.replace(before, after, 1)
    if which == 'processor': p = updated
    else: g = updated
    print('integrated:', marker)

patch('processor',
      'import { parseTimerRequest, type TimerRequest } from "../_shared/timer.ts";',
      'import { parseTimerRequest, type TimerRequest } from "../_shared/timer.ts";\nimport { voiceFollowupMode, isSpokenRequest } from "../_shared/voice-intent.ts";',
      'import { voiceFollowupMode, isSpokenRequest }')

patch('processor',
      'async function chooseVoice(m) {',
      'async function chooseVoice(m, update) {',
      'async function chooseVoice(m, update) {')
patch('processor',
      '  if (error) throw Error("VOICE_SAVE");\n  await show(m.from.id, m.chat.id, "voice");\n}',
      '  if (error) throw Error("VOICE_SAVE");\n  // Keep the original Telegram message ID for explicit reply transformations.\n  // A voice is executed immediately without making the user pick a button.\n  await startWork(m, update, "execute", "", null);\n}',
      'A voice is executed immediately without making the user pick a button.')

patch('processor',
      '''  const s = await cfg();
  if (s.provider === "openrouter") {
    await send(
      chat,
      "🎙 الان از پس پردازش ویس برنمیام؛ متنش رو بفرست یا بعداً امتحان کن. 💛",
    );
    return;
  }
  const { data: removed } = await db
    .from("saeed_ai_voice_pending")
    .delete()
    .eq("telegram_user_id", id)
    .eq("telegram_message_id", item.telegram_message_id)
    .select("file_id")
    .maybeSingle();
  if (!removed) return;
  await save(id, { keyboard_page: "tools" });''',
      '''  // Do not consume the stored file: several replies may transform the same voice.
  // Audio requests use Gemini independently of the selected text-chat provider.
  await save(id, { keyboard_page: "tools" });''',
      'Do not consume the stored file: several replies may transform the same voice.')

patch('processor',
      '''  if (med?.type === "audio" && s.provider === "openrouter") {
    await send(chat, failMessage("AUDIO_UNSUPPORTED"));
    return;
  }''',
      '''  // Gemini handles voice even while OpenRouter is the normal chat provider.
  if (med?.type === "audio") s.provider = "gemini";''',
      'Gemini handles voice even while OpenRouter is the normal chat provider.')

VOICE_REPLY = '''async function handleVoiceReply(m, update) {
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
'''
patch('processor',
      'async function message(m, update) {',
      VOICE_REPLY + '\nasync function message(m, update) {',
      'async function handleVoiceReply(m, update) {')
patch('processor',
      '''    p = await pref(id);
  await sweep();
  if (/^\\/(start|menu|help)''',
      '''    p = await pref(id);
  await sweep();
  if (await handleVoiceReply(m, update)) return;
  if (/^\\/(start|menu|help)''',
      'if (await handleVoiceReply(m, update)) return;')
patch('processor',
      '  if (m.voice || m.audio) return chooseVoice(m);',
      '  if (m.voice || m.audio) return chooseVoice(m, update);',
      'return chooseVoice(m, update);')

# If STT produces nothing, offer only the voice action choices, not an invented result.
patch('processor',
      '      if (!spoken) throw Error("VOICE_TRANSCRIPT");',
      '''      if (!spoken) {
        await send(chat, "🎙 حاجی، صدات رو واضح نگرفتم؛ دوست داری تایپش کنم، خلاصه‌اش کنم یا ترجمه‌اش کنم؟ 💛", "voice", id);
        await metric(update, id, s, "success", speech.usage);
        await db.from("saeed_ai_retry").update({ status: "completed" })
          .eq("original_update_id", original).eq("telegram_user_id", id);
        await save(id, { pending_tool: "chat", keyboard_page: "voice" });
        return;
      }''',
      'صدات رو واضح نگرفتم؛ دوست داری تایپش کنم')

patch('processor',
      '''        const intent = await selectToolIntent(spoken, GK, s.gemini);
        if (intent === "remind")''',
      '''        const intent = await selectToolIntent(spoken, GK, s.gemini);
        if (intent === "chat" && !isSpokenRequest(spoken)) {
          await send(chat, "🎙 حاجی، توی این ویس درخواست مشخصی پیدا نکردم. دوست داری تایپش کنم، خلاصه‌اش کنم یا ترجمه‌اش کنم؟ 😁", "voice", id);
          await metric(update, id, s, "success", speech.usage);
          await db.from("saeed_ai_retry").update({ status: "completed" })
            .eq("original_update_id", original).eq("telegram_user_id", id);
          await save(id, { pending_tool: "chat", keyboard_page: "voice" });
          return;
        }
        if (intent === "remind")''',
      'توی این ویس درخواست مشخصی پیدا نکردم.')

patch('processor',
      '''      if (med?.type === "audio")
        await send(
          chat,
          tool === "execute" ? "📝 پاسخ ویس آماده شد؛ فقط تأییدِ ثبت واقعی یعنی تایمر یا یادآور ساخته شده." : "✅ انجام شد؛ ابزار بعدی رو از پایین انتخاب کن. 😁",
          "tools",
          id,
        );''',
      '''      // No redundant "done" message or menu after an actionable voice response.''',
      'No redundant "done" message or menu after an actionable voice response.')

patch('gateway',
      '''        const text = (m.text || "").trim();
        if (/^صبح''',
      '''        const text = (m.text || "").trim();
        // Reply transformations must reach the processor with original voice metadata.
        if (m.reply_to_message?.voice || m.reply_to_message?.audio) return forward(update);
        if (/^صبح''',
      'Reply transformations must reach the processor with original voice metadata.')

PROCESSOR.write_text(p, encoding='utf-8')
GATEWAY.write_text(g, encoding='utf-8')
print('PASS: automatic voice, explicit reply transformations, and no-command choice menu wired')
