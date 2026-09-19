-- Saeed AI v8: the original feature-pack migration forgot to extend the preference enums.
-- Preserve existing states and allow every v8 tool and menu page.
ALTER TABLE public.telegram_bot_preferences
  DROP CONSTRAINT IF EXISTS telegram_bot_preferences_pending_tool_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_pending_tool_check
  CHECK (pending_tool IN ('chat','web','repo','documents','image','ocr','transcribe','summarize','translate','rewrite','ideas','remind','calc','email','tasks','horoscope','trivia','story','joke','roast'));
ALTER TABLE public.telegram_bot_preferences
  DROP CONSTRAINT IF EXISTS telegram_bot_preferences_keyboard_page_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_keyboard_page_check
  CHECK (keyboard_page IN ('home','tools','settings','tones','length','language','privacy','reset','admin','users','models','quota','user_quota','voice','retry','fun','tasks'));
