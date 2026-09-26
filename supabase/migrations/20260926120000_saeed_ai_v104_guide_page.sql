-- Saeed AI v10.4.0: slimmer tools keyboard with a «📖 راهنما» guide page.
-- Every tool now starts from plain chat, photos, files or voice; the guide
-- page lists them with example phrases instead of one button per tool.
ALTER TABLE public.telegram_bot_preferences DROP CONSTRAINT IF EXISTS telegram_bot_preferences_keyboard_page_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_keyboard_page_check
  CHECK (keyboard_page IN ('home','tools','life','settings','tones','length','language','privacy','reset','admin','users','models','quota','user_quota','voice','retry','fun','tasks','tasks_delete_confirm','guide'));

-- Schema version checked by the deploy workflow before any function is deployed.
CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20260926120000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
