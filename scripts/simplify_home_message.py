#!/usr/bin/env python3
"""Single-purpose, guarded, idempotent update to the Telegram home copy."""
from pathlib import Path

p = Path('supabase/functions/saeed-ai-v7/index.ts')
s = p.read_text(encoding='utf-8')
old = 'home: `✨ Saeed AI\\n🎭 ${TONES[p.tone] || TONES.friendly} | 📌 ${TOOLS[p.pending_tool] || TOOLS.chat}\\n\\nمنوی اصلی پایین صفحه‌ست؛ بفرما حاجی 😁`,'
new = 'home: "بفرما حاجی چی تو ذهنته 😁",'
if s.count(new) == 1 and old not in s:
    print('PASS: home copy already updated')
elif s.count(old) == 1 and new not in s:
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    print('PASS: replaced only the home copy')
else:
    raise SystemExit(f'Unexpected home text state: old={s.count(old)}, new={s.count(new)}')
