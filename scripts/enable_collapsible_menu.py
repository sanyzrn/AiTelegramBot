#!/usr/bin/env python3
"""Make Saeed AI's native Telegram reply keyboard collapsible, without removing it."""
from pathlib import Path

path = Path("supabase/functions/saeed-ai-v7/index.ts")
source = path.read_text(encoding="utf-8")
old = '''  resize_keyboard: true,
  is_persistent: true,
  one_time_keyboard: false,
  input_field_placeholder: "پیامت رو بنویس حاجی… 💬",'''
new = '''  resize_keyboard: true,
  is_persistent: false,
  one_time_keyboard: true,
  input_field_placeholder: "پیامت رو بنویس حاجی… 💬",'''
if source.count(new) == 1 and old not in source:
    print("PASS: collapsible keyboard already configured")
elif source.count(old) == 1 and new not in source:
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("PASS: native reply keyboard can hide automatically and reopen via Telegram menu button")
else:
    raise SystemExit("ERROR: unexpected keyboard configuration; refusing unsafe patch")
