#!/usr/bin/env python3
"""Small guarded source integration. Fail on upstream drift; repeated runs change nothing."""
from pathlib import Path

PROCESSOR = Path('supabase/functions/saeed-ai-v7/index.ts')
GATEWAY = Path('supabase/functions/saeed-ai-ui/index.ts')
DISPATCHER = Path('supabase/functions/saeed-ai-reminders/index.ts')
LIFE = Path('supabase/functions/_shared/life.ts')


def add_once(content: str, anchor: str, replacement: str, marker: str) -> str:
    if marker in content:
        return content
    count = content.count(anchor)
    if count != 1:
        raise RuntimeError(f'Expected precisely one anchor for {marker}: got {count}')
    return content.replace(anchor, replacement, 1)


def patch(file: Path, transformations: list[tuple[str, str, str]]) -> None:
    original = file.read_text(encoding='utf-8')
    changed = original
    for anchor, replacement, marker in transformations:
        changed = add_once(changed, anchor, replacement, marker)
    if changed != original:
        file.write_text(changed, encoding='utf-8')
        print('patched', file)
    else:
        print('already applied', file)


patch(DISPATCHER, [
    ('import { nextOccurrence, type RepeatRule } from "../_shared/repeat.ts";',
     'import { nextOccurrence, type RepeatRule } from "../_shared/repeat.ts";\nimport { briefingExternalSections } from "../_shared/briefing-sources.ts";',
     'import { briefingExternalSections }'),
    ('      await send(chat, body);',
     '      const external = await briefingExternalSections();\n      await send(chat, body + "\\n\\n" + external);',
     'const external = await briefingExternalSections();'),
    ('v9_briefings: true', 'v9_briefings: true, v9_market_weather: true', 'v9_market_weather: true'),
])

patch(LIFE, [
    ('/** Saeed AI v9 utilities; call only after authenticated private Telegram gate. */',
     'import { briefingExternalSections } from "./briefing-sources.ts";\n/** Saeed AI v9 utilities; call only after authenticated private Telegram gate. */',
     'import { briefingExternalSections }'),
    ('  if (!msg) return false;',
     '  if (!msg) return false;\n  if (/^(?:\\/briefing_test|صبح[‌\\s-]*نامه\\s+(?:تست|الان))$/iu.test(msg)) {\n    const sections = await briefingExternalSections();\n    await c.send(chat, "🧪 پیش‌نمایش منابع صبح‌نامه (فقط نمایش، بدون تغییر تنظیمات):\\n\\n" + sections);\n    return true;\n  }',
     'پیش‌نمایش منابع صبح‌نامه'),
])

patch(GATEWAY, [
    ('        const text = (m.text || "").trim();',
     '        const text = (m.text || "").trim();\n        if (/^صبح[‌\\s-]*نامه\\s+(?:تست|الان)$/iu.test(text)) return forward(update);',
     'if (/^صبح[‌\\s-]*نامه'),
])

for p in (DISPATCHER, LIFE, GATEWAY):
    assert 'briefingExternalSections' in p.read_text() or p == GATEWAY
print('PASS: briefing feeds and source preview are wired')
