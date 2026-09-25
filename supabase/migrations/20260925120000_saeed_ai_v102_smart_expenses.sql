-- Saeed AI v10.2.0: smart expenses and the completed Mini App dashboard.

-- The pending «💸 ثبت خرج» mode: several expenses in one message, spelled-out
-- amounts («دو میلیون و هشتصد هزار تومان»), voice expense registration.
ALTER TABLE public.telegram_bot_preferences DROP CONSTRAINT IF EXISTS telegram_bot_preferences_pending_tool_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_pending_tool_check
  CHECK (pending_tool IN ('chat','web','repo','documents','image','ocr','transcribe','summarize','translate','rewrite','ideas','remind','calc','email','tasks','receipt','horoscope','trivia','story','joke','roast','expenses'));

-- Schema version checked by the deploy workflow before any function is deployed.
CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20260925120000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
