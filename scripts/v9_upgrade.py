from pathlib import Path
bot_path=Path('supabase/functions/saeed-ai-v7/index.ts')
def swap(src,old,new,tag):
    if new in src: return src
    n=src.count(old)
    if n!=1: raise AssertionError(f'{tag}: expected one match, found {n}')
    return src.replace(old,new,1)
def upgrade(src):
    src=swap(src,'import { selectToolIntent } from "../_shared/intent-model.ts";', 'import { selectToolIntent } from "../_shared/intent-model.ts";\nimport { handleLifeMessage, handleLifeCallback } from "../_shared/life.ts";\nimport { calculateExact } from "../_shared/calculator.ts";', 'imports')
    src=swap(src,'async function setReminder(id, chat, input) {','async function setReminder(id, chat, input, update = null) {','reminder signature')
    src=swap(src,'''              '. Parse this Persian reminder request into strict minified JSON {"note":string,"remind_at":string}. Convert relative times (e.g. "20 minutes later", "tomorrow 8am") into ISO8601 with +03:30 offset. If no usable time, use null. Request: ' +''', '''              '. Parse this Persian reminder request into minified JSON {"note":string,"remind_at":string|null,"repeat_rule":"none|daily|weekly|monthly|hours","repeat_every_hours":number|null}. Return repeat_rule none unless the user explicitly asks to repeat. If repeating every N hours use rule hours and N=1..168; for every day, week or month use daily, weekly or monthly. Convert relative times to ISO8601 with +03:30 Tehran offset. A recurring reminder still needs an unambiguous FIRST occurrence; if unknown use null. Request: ' +''', 'reminder schema')
    src=swap(src,'''  const { error } = await db.from("saeed_ai_reminders").insert({
    telegram_user_id: id,
    telegram_chat_id: chat,
    note: String(j.note).slice(0, 300),
    remind_at: when.toISOString(),
  });
  if (error) throw Error("REMIND_SAVE");''', '''  const rules = ["none", "daily", "weekly", "monthly", "hours"];
  const rule = rules.includes(j?.repeat_rule) ? j.repeat_rule : "none";
  const hours = rule === "hours" ? Number(j?.repeat_every_hours) : null;
  if (rule === "hours" && (!Number.isInteger(hours) || hours < 1 || hours > 168)) {
    await send(chat, "⏰ فاصله تکرار باید بین ۱ تا ۱۶۸ ساعت باشه؛ زمان دقیق‌تر بگو.");
    return;
  }
  if (rule === "none" && /(?:هر\s*\d+\s*ساعت|هر\s*روز|روزانه|هفتگی|ماهانه|هر\s*هفته|هر\s*ماه)/iu.test(input)) {
    await send(chat, "⏰ تکرار رو دقیق متوجه نشدم؛ مثلاً «هر روز ساعت ۸ صبح یادم بنداز».");
    return;
  }
  const anchor = rule === "monthly" ? new Date(when.getTime() + 210 * 60000).getUTCDate() : null;
  const { data: created, error } = await db.from("saeed_ai_reminders")
    .upsert({
      telegram_user_id: id,
      telegram_chat_id: chat,
      note: String(j.note).slice(0, 300),
      remind_at: when.toISOString(),
      repeat_rule: rule,
      repeat_every_hours: hours,
      repeat_anchor_day: anchor,
      telegram_update_id: update,
    }, { onConflict: "telegram_update_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw Error("REMIND_SAVE");
  if (!created) return send(chat, "ℹ️ این یادآور قبلاً ثبت شده بود؛ دوباره اضافه نکردم.");''', 'reminder persistence')
    src=swap(src,'async function saveTasks(id, chat, input) {','async function saveTasks(id, chat, input, update = null) {','task signature')
    src=swap(src,'Extract a concise task list from this Persian text into strict minified JSON','Extract concise NEW tasks to APPEND (never replace existing tasks) from this Persian text into strict minified JSON','task prompt')
    src=swap(src,'''  await db
    .from("saeed_ai_tasks")
    .delete()
    .eq("telegram_user_id", id)
    .eq("done", false);
  const { error } = await db
    .from("saeed_ai_tasks")
    .insert(tasks.map((t) => ({ telegram_user_id: id, task: t })));
  if (error) throw Error("TASK_SAVE");''', '''  const { data: created, error } = await db.from("saeed_ai_tasks")
    .upsert(tasks.map((t, i) => ({
      telegram_user_id: id, task: t, source_update_id: update, source_item: i,
      priority: /(?:فوری|اولویت\s*بالا)/u.test(input) ? 1 : 2,
    })), { onConflict: "source_update_id,source_item", ignoreDuplicates: true })
    .select("id");
  if (error) throw Error("TASK_SAVE");
  if (!created?.length) return send(chat, "ℹ️ این تسک‌ها قبلاً ثبت شده بودن؛ دوباره اضافه نکردم.");''', 'append task persistence')
    src=swap(src,'"✅ لیست کارهات آماده‌ست:\\n" +','"✅ تسک‌ها به لیست قبلی اضافه شدن:\\n" +','task success copy')
    src=swap(src,'"\\n\\nبرای تیک زدن بنویس: انجام شد ۱ ✅ یا کار جدیدت رو بگو تا لیست تازه بشه."','"\\n\\nتسک جدید به این لیست اضافه می‌شه؛ قبلی‌ها حذف نمی‌شن."','task list copy')
    src=swap(src,'''  const { data } = await db
    .from("saeed_ai_tasks")
    .select("task,done")''','''  return handleLifeMessage({ db, tg, send }, id, chat, "/tasks", 0);
  const { data } = await db
    .from("saeed_ai_tasks")
    .select("task,done")''','inline task list')
    src=swap(src,'await db.from("saeed_ai_tasks").update({ done: true }).eq("id", t.id);','await db.from("saeed_ai_tasks").update({ done: true }).eq("id", t.id).eq("telegram_user_id", id);','task ownership')
    src=swap(src,'  if (a === "act:md") return exportMd(id, chat);','  if (await handleLifeCallback({ db, tg, send }, id, chat, a)) return;\n  if (a === "act:md") return exportMd(id, chat);','callback dispatch')
    src=swap(src,'''  if (p.pending_tool === "remind" && text) return setReminder(id, chat, text);
  if (p.pending_tool === "tasks" && text) return saveTasks(id, chat, text);
  if (await adminInput(id, chat, text)) return;''','''  if (p.pending_tool === "remind" && text) return setReminder(id, chat, text, update);
  if (p.pending_tool === "tasks" && text) return saveTasks(id, chat, text, update);
  if (await adminInput(id, chat, text)) return;
  if (await handleLifeMessage({ db, tg, send }, id, chat, (m.caption || text).trim(), update)) return;
  const exact = calculateExact(text);
  if (exact) return send(chat, exact);''','life dispatch')
    src=swap(src,'const safeTools = new Set(["remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas"]);','const safeTools = new Set(["remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas", "expenses", "shopping", "briefing"]);','allowlist')
    src=swap(src,'''  if (inferred === "remind") return setReminder(id, chat, requestText);
  if (inferred === "tasks") return saveTasks(id, chat, requestText);''','''  if (inferred === "remind") return setReminder(id, chat, requestText, update);
  if (inferred === "tasks") return saveTasks(id, chat, requestText, update);
  if (["expenses", "shopping", "briefing"].includes(inferred)) {
    if (await handleLifeMessage({ db, tg, send }, id, chat, requestText, update)) return;
    return send(chat, inferred === "expenses" ? "برای ثبت هزینه بنویس: ناهار ۴۸۰ هزار تومان؛ برای گزارش: خرج‌هام." : inferred === "shopping" ? "برای افزودن خرید بنویس: به لیست خرید اضافه کن شیر، نان." : "برای صبح‌نامه بنویس: صبح‌نامه روشن یا خاموش.");
  }
  if (inferred === "calc") return send(chat, "این فرمت محاسبه رو دقیق پشتیبانی نمی‌کنم. مثلاً «۱۲٪ از ۲ میلیون» یا «۱.۲ + ۳.۴» رو بفرست.");''','intent dispatch')
    return src
p=bot_path.read_text(encoding='utf8')
patched=upgrade(p)
assert patched==upgrade(patched), 'upgrade must be idempotent'
section=patched.split('async function saveTasks',1)[1].split('async function listTasks',1)[0]
assert '.delete()' not in section, 'must preserve existing tasks'
assert 'handleLifeCallback' in patched and 'telegram_update_id: update' in patched
bot_path.write_text(patched,encoding='utf8')
print('v9 guarded patch passed, preserving existing tasks')
