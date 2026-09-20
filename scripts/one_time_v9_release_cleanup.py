#!/usr/bin/env python3
"""One-time, guarded migration. Commit resulting TypeScript; do not use this script for future features."""
from pathlib import Path
import re

ROOT = Path('supabase/functions')
processor = ROOT / 'saeed-ai-v7/index.ts'
gateway = ROOT / 'saeed-ai-ui/index.ts'
dispatcher = ROOT / 'saeed-ai-reminders/index.ts'
life = ROOT / '_shared/life.ts'

def once(s: str, old: str, new: str, marker: str) -> str:
    if marker in s:
        print('already integrated:', marker)
        return s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'Expected one occurrence of {marker}, found {n}')
    print('integrated:', marker)
    return s.replace(old, new, 1)

p = processor.read_text()
p = once(p,
'''  try {
    await tg("editMessageReplyMarkup", {
      chat_id: chat,
      message_id: c.message.message_id,
    });
  } catch {}
  if (await handleLifeCallback({ db, tg, send }, id, chat, a)) return;''',
'''  // Keep life-action buttons until the original list is edited with fresh state.
  if (await handleLifeCallback({ db, tg, send }, id, chat, a, c.message.message_id)) return;
  try {
    await tg("editMessageReplyMarkup", {
      chat_id: chat,
      message_id: c.message.message_id,
    });
  } catch {}''',
'handleLifeCallback({ db, tg, send }, id, chat, a, c.message.message_id)')

pattern = r'async function listTasks\(id, chat\) \{\n  return handleLifeMessage\(\{ db, tg, send \}, id, chat, "/tasks", 0\);\n[\s\S]*?\n\}\n(?=async function doneTask)'
replacement = 'async function listTasks(id, chat) {\n  return handleLifeMessage({ db, tg, send }, id, chat, "/tasks", 0);\n}\n'
if 'async function listTasks(id, chat) {\n  return handleLifeMessage({ db, tg, send }, id, chat, "/tasks", 0);\n}\n' not in p:
    p, n = re.subn(pattern, replacement, p, count=1)
    if n != 1: raise SystemExit('Unexpected obsolete listTasks block')
    print('removed unreachable listTasks legacy branch')

p = once(p,
'''      reminders: true,
      tasks: true,
      profile: true,''',
'''      reminders: true,
      tasks: true,
      v9_recurring: true,
      v9_briefings: true,
      v9_market_weather: true,
      v9_tasks_append: true,
      v9_callback_refresh: true,
      v9_voice_auto: true,
      profile: true,''',
'v9_callback_refresh: true')
p = once(p, '      no_inline_output: true,', '      inline_task_shopping_actions: true,', 'inline_task_shopping_actions: true')
if p.count('version: "8.0.1"') not in (0, 2): raise SystemExit('Unexpected processor version count')
p = p.replace('version: "8.0.1"', 'version: "9.0.0"')
processor.write_text(p)

g = gateway.read_text()
g = once(g,
'''  if (!user?.id || !(await allowed(user.id, chat)))
    return out({ ok: true, ignored: true });
  EdgeRuntime.waitUntil(''',
'''  if (!user?.id || !(await allowed(user.id, chat)))
    return out({ ok: true, ignored: true });
  // Acknowledge Telegram's callback immediately, before the slower internal forward.
  if (c) {
    try {
      await tg("answerCallbackQuery", { callback_query_id: c.id });
    } catch (e) {
      console.error("CALLBACK_ACK", String(e).slice(0, 80));
    }
  }
  EdgeRuntime.waitUntil(''',
'console.error("CALLBACK_ACK"')
g = once(g,
'''      reminders: true,
      tasks: true,
      profile: true,''',
'''      reminders: true,
      tasks: true,
      v9_auto_tool_routing: true,
      v9_voice_reply: true,
      v9_callback_fast_ack: true,
      profile: true,''',
'v9_callback_fast_ack: true')
if g.count('version: "8.0.1"') not in (0, 2): raise SystemExit('Unexpected gateway version count')
g = g.replace('version: "8.0.1"', 'version: "9.0.0"')
gateway.write_text(g)

r = dispatcher.read_text()
if r.count('version: "8.0.1"') not in (0, 1): raise SystemExit('Unexpected dispatcher version count')
r = r.replace('version: "8.0.1"', 'version: "9.0.0"')
dispatcher.write_text(r)

l = life.read_text()
l = once(l,
'chat: number, callback: string): Promise<boolean> {',
'chat: number, callback: string, messageId?: number): Promise<boolean> {',
'callback: string, messageId?: number')
l = once(l,
'''  if (m[1] === "shop") {
    const { data, error } = await c.db.from("saeed_ai_shopping").update({ done: m[2] === "done" }).eq("id", key).eq("telegram_user_id", id).select("id");
    if (error) throw Error("SHOP_CALLBACK");
    await c.send(chat, data?.length ? "🛒 لیست خرید به‌روز شد." : "این کالا متعلق به شما نیست.");
    return true;
  }''',
'''  if (m[1] === "shop") {
    const desired = m[2] === "done";
    const { data, error } = await c.db.from("saeed_ai_shopping")
      .update({ done: desired }).eq("id", key).eq("telegram_user_id", id)
      .eq("done", !desired).select("id");
    if (error) throw Error("SHOP_CALLBACK");
    if (!data?.length) {
      await c.send(chat, "ℹ️ این دکمه قبلاً استفاده شده یا کالا متعلق به تو نیست. لیست خرید رو دوباره باز کن.");
      return true;
    }
    const { data: items, error: readError } = await c.db.from("saeed_ai_shopping")
      .select("id,item,done").eq("telegram_user_id", id).order("id").limit(30);
    if (readError) throw Error("SHOP_REFRESH");
    const rows = (items || []).map((x: any) => [{
      text: `${x.done ? "☑️" : "⬜"} ${x.item}`.slice(0, 60),
      callback_data: `shop:${x.done ? "undo" : "done"}:${x.id}`,
    }]);
    const view = {
      chat_id: chat,
      text: "🛒 لیست خرید:\\n" + ((items || []).map((x: any) => `${x.done ? "✅" : "▫️"} ${x.item}`).join("\\n") || "خالیه."),
      ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
    };
    if (messageId) {
      try {
        await c.tg("editMessageText", { ...view, message_id: messageId });
        return true;
      } catch (e) {
        console.error("SHOP_EDIT", String(e).slice(0, 80));
      }
    }
    await c.tg("sendMessage", view);
    return true;
  }''',
'SHOP_REFRESH')
life.write_text(l)

assert 'version: "8.0.1"' not in p+g+r
assert 'v9_callback_refresh: true' in p and 'v9_callback_fast_ack: true' in g
assert 'editMessageText' in l and 'SHOP_REFRESH' in l
assert 'async function doneTask' in p
print('PASS: consistent 9.0.0 release, fast callback acknowledgment, live shopping refresh and dead-code removal')
