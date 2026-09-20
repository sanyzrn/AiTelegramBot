#!/usr/bin/env python3
"""Apply the natural-language tool routing fix to both existing bot entrypoints.
Fail if upstream source changes: never silently deploy a partial patch.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
GATEWAY = BASE / 'supabase/functions/saeed-ai-ui/index.ts'
BOT = BASE / 'supabase/functions/saeed-ai-v7/index.ts'


def replace(source: str, old: str, new: str, label: str) -> str:
    if source.count(new) == 1 and source.count(old) == 0:
        return source  # idempotent
    if source.count(old) != 1:
        raise RuntimeError(f'{label}: expected one original anchor, found {source.count(old)}')
    return source.replace(old, new, 1)


def patch_gateway(source: str) -> str:
    source = replace(source,
        'import { createClient } from "npm:@supabase/supabase-js@2.57.0";\n',
        'import { createClient } from "npm:@supabase/supabase-js@2.57.0";\nimport { selectToolIntent } from "../_shared/intent-model.ts";\n', 'gateway import')
    source = replace(source, 'async function reply(m, update) {',
        'async function reply(m, update, forcedTool = null) {', 'gateway reply override')
    source = replace(source, '  const dismissSearch =\n',
        '  if (forcedTool === "web") pref.pending_tool = "web";\n  const dismissSearch =\n', 'gateway grounded search override')
    source = replace(source,
        '        return reply(m, update.update_id);\n',
        '''        // The menu is a shortcut, not a prerequisite for using a tool.
        const inferred = (p?.pending_tool === "chat" || !p?.pending_tool)
          ? await selectToolIntent(text, GK, (await config()).gemini)
          : "chat";
        if (inferred === "web") return reply(m, update.update_id, "web");
        if (inferred !== "chat")
          return forward({ ...update, message: { ...m, saeed_auto_tool: inferred } });
        return reply(m, update.update_id);
''', 'gateway dispatch')
    return source


def patch_bot(source: str) -> str:
    source = replace(source,
        'import { createClient } from "npm:@supabase/supabase-js@2.57.0";\n',
        'import { createClient } from "npm:@supabase/supabase-js@2.57.0";\nimport { selectToolIntent } from "../_shared/intent-model.ts";\n', 'bot import')
    source = replace(source,
        '''async function setReminder(id, chat, input) {
  const s = await cfg();
  if (s.provider !== "gemini") {
    await save(id, { pending_tool: "chat" });
    return send(chat, "⏰ یادآور هوشمند فعلاً با Gemini کار می‌کنه. 💛");
  }
''',
        '''async function setReminder(id, chat, input) {
  // The parser always uses Gemini, regardless of the conversational provider.
  const s = { ...(await cfg()), provider: "gemini" };
''', 'cross-provider reminders')
    source = replace(source,
        '''async function saveTasks(id, chat, input) {
  const s = await cfg();
  if (s.provider !== "gemini") {
    await save(id, { pending_tool: "chat" });
    return send(chat, "✅ تسک‌خوان فعلاً با Gemini کار می‌کنه. 💛");
  }
''',
        '''async function saveTasks(id, chat, input) {
  const s = { ...(await cfg()), provider: "gemini" };
''', 'cross-provider tasks')
    source = replace(source,
        '''  if (await adminInput(id, chat, text)) return;
  if (m.voice || m.audio) return chooseVoice(m);
''',
        '''  if (await adminInput(id, chat, text)) return;
  // A gateway-selected intent is validated against this local allowlist.
  const safeTools = new Set(["remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas"]);
  const requestText = (m.caption || text).trim();
  const inferred = p.pending_tool === "chat" && requestText
    ? safeTools.has(m.saeed_auto_tool)
      ? m.saeed_auto_tool
      : await selectToolIntent(requestText, GK, (await cfg()).gemini)
    : "chat";
  if (inferred === "remind") return setReminder(id, chat, requestText);
  if (inferred === "tasks") return saveTasks(id, chat, requestText);
  if (inferred === "repo") {
    const link = requestText.match(/https:\\/\\/github\\.com\\/[\\w-]+\\/[\\w.-]+(?:\\.git)?\\/?/i);
    if (link) return startWork(m, update, "repo", link[0], null);
  }
  if (m.voice || m.audio) return chooseVoice(m);
''', 'bot intent dispatch')
    source = replace(source,
        '''    tool = d
      ? "documents"
      : p.pending_tool === "chat" && isRepo
        ? "repo"
        : p.pending_tool;
''',
        '''    tool = d
      ? "documents"
      : inferred !== "chat"
        ? inferred
        : p.pending_tool === "chat" && isRepo
          ? "repo"
          : p.pending_tool;
''', 'bot tool execution')
    return source


def main() -> None:
    original_gateway = GATEWAY.read_text(encoding='utf-8')
    original_bot = BOT.read_text(encoding='utf-8')
    gateway = patch_gateway(original_gateway)
    bot = patch_bot(original_bot)
    assert patch_gateway(gateway) == gateway
    assert patch_bot(bot) == bot
    assert 'saeed_auto_tool' in gateway and 'setReminder(id, chat, requestText)' in bot
    assert 'forcedTool === "web"' in gateway and 'provider: "gemini"' in bot
    GATEWAY.write_text(gateway, encoding='utf-8')
    BOT.write_text(bot, encoding='utf-8')
    print('PASS: source anchors, idempotency, web grounding and cross-provider reminder routing')


if __name__ == '__main__':
    main()
