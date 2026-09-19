-- Applied to Saeed AI production via Supabase migration 20260919154210.
-- Preserve existing tone values and allow the new mystic setting.
ALTER TABLE public.telegram_bot_preferences
  DROP CONSTRAINT telegram_bot_preferences_tone_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_tone_check
  CHECK (tone = ANY (ARRAY['friendly'::text, 'formal'::text, 'romantic'::text, 'professional'::text, 'creative'::text, 'witty'::text, 'mystic'::text]));
