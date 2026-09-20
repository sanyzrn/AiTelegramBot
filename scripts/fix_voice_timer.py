#!/usr/bin/env python3
"""Guarded, idempotent fix for voice_execute timers. Fail rather than silently miss source anchors."""
from pathlib import Path

p = Path('supabase/functions/saeed-ai-v7/index.ts')
s = p.read_text(encoding='utf-8')

def replace_once(old: str, new: str, marker: str) -> None:
    global s
    if marker in s:
        print('already integrated:', marker)
        return
    if s.count(old) != 1:
        raise SystemExit(f'Unexpected voice-timer source anchor for {marker}: {s.count(old)}')
    s = s.replace(old, new, 1)
    print('integrated:', marker)

replace_once(
    'import { calculateExact } from "../_shared/calculator.ts";',
    'import { calculateExact } from "../_shared/calculator.ts";\nimport { parseTimerRequest, type TimerRequest } from "../_shared/timer.ts";',
    'import { parseTimerRequest, type TimerRequest }',
)

schedule = '''async function scheduleRealTimer(id, chat, timer: TimerRequest, update) {
  if (!Number.isSafeInteger(update)) throw Error("TIMER_UPDATE");
  const due = new Date(Date.now() + timer.minutes * 60000);
  const { data: created, error } = await db.from("saeed_ai_reminders")
    .upsert({
      telegram_user_id: id,
      telegram_chat_id: chat,
      note: timer.note,
      remind_at: due.toISOString(),
      repeat_rule: "none",
      telegram_update_id: update,
    }, { onConflict: "telegram_update_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw Error("TIMER_SAVE");
  if (!created?.id) return send(chat, "ℹ️ این تایمر قبلاً ثبت شده بود؛ تایمر تکراری نساختم.");
  await save(id, { pending_tool: "chat" });
  await send(chat,
    `✅ تایمر واقعی ${timer.minutes.toLocaleString("fa-IR")} دقیقه‌ای ثبت شد.\\n⏰ موعد: ${due.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })} (تهران)\\n🔔 حداکثر حدود یک دقیقه تأخیر ممکنه؛ این یادآور تلگرامیه، نه تایمر ثانیه‌ای گوشی.`,
    "tools", id);
}
'''
replace_once(
    'async function setReminder(id, chat, input, update = null) {',
    schedule + '\nasync function setReminder(id, chat, input, update = null) {',
    'async function scheduleRealTimer(',
)

replace_once(
    '  if (p.pending_tool === "remind" && text) return setReminder(id, chat, text, update);',
    '''  if (p.pending_tool === "remind" && text) {
    const timer = parseTimerRequest(text);
    if (timer) return scheduleRealTimer(id, chat, timer, update);
    if (/(?:تایمر|زمان[‌\\s-]*سنج|timer)/iu.test(text)) return send(chat, "⏰ مدت تایمر رو واضح بگو؛ مثلاً «تایمر ۷ دقیقه بذار». تایمرِ بدون مدت ثبت نمی‌کنم.");
    return setReminder(id, chat, text, update);
  }''',
    'const timer = parseTimerRequest(text);\n    if (timer) return scheduleRealTimer',
)

replace_once(
    '  if (await adminInput(id, chat, text)) return;\n  if (await handleLifeMessage(',
    '''  if (await adminInput(id, chat, text)) return;
  const directTimer = parseTimerRequest(text);
  if (directTimer) return scheduleRealTimer(id, chat, directTimer, update);
  if (/(?:تایمر|زمان[‌\\s-]*سنج|timer)/iu.test(text) &&
      /(?:بذار|بگذار|بزن|تنظیم\\s*کن|ست\\s*کن|شروع\\s*کن|set|start)/iu.test(text) &&
      !/(?:چرا|چطور|کار\\s*نمی[‌\\s]*کن|\\?|؟)/iu.test(text))
    return send(chat, "⏰ مدت تایمر رو دقیق بگو؛ مثلاً «تایمر ۷ دقیقه بذار». چیزی ثبت نکردم.");
  if (await handleLifeMessage(''',
    'const directTimer = parseTimerRequest(text);',
)

replace_once(
    '  if (inferred === "remind") return setReminder(id, chat, requestText, update);',
    '''  if (inferred === "remind") {
    const timer = parseTimerRequest(requestText);
    return timer ? scheduleRealTimer(id, chat, timer, update) : setReminder(id, chat, requestText, update);
  }''',
    'return timer ? scheduleRealTimer(id, chat, timer, update) : setReminder',
)

voice = '''    // /voice_execute is a two-stage operation: transcribe first, then actually run
    // the selected side-effecting tool. A generative response is NOT confirmation.
    if (tool === "execute" && med?.type === "audio") {
      const speech = await ai(
        { ...s, provider: "gemini" },
        [{ role: "user", parts: [
          { text: "Transcribe the Persian speech verbatim. Preserve quantities, numbers, time units and commands. Output ONLY the speech text. Never answer or execute it." },
          parts[1],
        ] }],
        "Speech-to-text only. No assistant response, no fictional action confirmations.",
      );
      const spoken = String(speech.text || "").trim().slice(0, 3000);
      if (!spoken) throw Error("VOICE_TRANSCRIPT");
      let performed = true;
      const timer = parseTimerRequest(spoken);
      if (timer) await scheduleRealTimer(id, chat, timer, update);
      else if (/(?:تایمر|زمان[‌\\s-]*سنج|timer)/iu.test(spoken))
        await send(chat, "⏰ زمان تایمر رو دقیق متوجه نشدم؛ مثلاً بگو «تایمر هفت دقیقه بذار». چیزی ثبت نکردم.");
      else {
        const intent = await selectToolIntent(spoken, GK, s.gemini);
        if (intent === "remind") await setReminder(id, chat, spoken, update);
        else if (intent === "tasks") await saveTasks(id, chat, spoken, update);
        else if (["expenses", "shopping", "briefing"].includes(intent)) {
          if (!(await handleLifeMessage({ db, tg, send }, id, chat, spoken, update)))
            await send(chat, "این درخواست رو نتونستم به ثبت واقعی تبدیل کنم؛ واضح‌تر بگو. چیزی ثبت نکردم.");
        } else {
          const answer = calculateExact(spoken);
          if (answer) await send(chat, answer);
          else {
            performed = false;
            parts.splice(0, parts.length, { text: "Verbatim user speech: " + spoken +
              "\\nRespond to the content only. You cannot access external tools in this branch. Never say that a timer, reminder, task, payment, message or other external operation was created or completed. If asked to perform one, clearly state that it was not done." });
          }
        }
      }
      if (performed) {
        await metric(update, id, s, "success", speech.usage);
        const { error: completeError } = await db.from("saeed_ai_retry")
          .update({ status: "completed" })
          .eq("original_update_id", original)
          .eq("telegram_user_id", id);
        if (completeError) console.error("VOICE_RETRY_COMPLETE", completeError.code);
        await save(id, { pending_tool: "chat", keyboard_page: "tools" });
        return;
      }
    }
'''
replace_once(
    '    let context = [];',
    voice + '    let context = [];',
    'Speech-to-text only. No assistant response, no fictional action confirmations.',
)

replace_once(
    '    const result = await ai(s, [...context, { role: "user", parts }], system);\n    if (!result.text?.trim()) throw Error("EMPTY");',
    '''    const result = await ai(s, [...context, { role: "user", parts }], system);
    if (tool === "execute" && med?.type === "audio" &&
        /(?:تایمر|یادآور|ریمایندر).{0,70}(?:تنظیم شد|ثبت شد|فعال شد|ساخته شد)/iu.test(result.text || ""))
      result.text = "⚠️ این اقدام واقعاً ثبت نشده؛ برای تنظیم تایمر یا یادآور، درخواست زمان‌دار و واضح بفرست.";
    if (!result.text?.trim()) throw Error("EMPTY");''',
    'این اقدام واقعاً ثبت نشده؛ برای تنظیم تایمر',
)

replace_once(
    '          "✅ انجام شد؛ ابزار بعدی رو از پایین انتخاب کن. 😁",',
    '          tool === "execute" ? "📝 پاسخ ویس آماده شد؛ فقط تأییدِ ثبت واقعی یعنی تایمر یا یادآور ساخته شده." : "✅ انجام شد؛ ابزار بعدی رو از پایین انتخاب کن. 😁",',
    '📝 پاسخ ویس آماده شد؛ فقط تأییدِ ثبت واقعی',
)

p.write_text(s, encoding='utf-8')
print('PASS: voice executor now schedules through a real DB write before success; direct timers also supported')
