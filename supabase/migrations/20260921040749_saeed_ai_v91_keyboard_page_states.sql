-- Saeed AI v9.1: the tasks bulk-delete confirmation page was unreachable.
-- show("tasks_delete_confirm") saved keyboard_page = 'tasks_delete_confirm',
-- which the existing CHECK constraint rejected, so the whole request failed
-- with the generic router error and the confirmation keyboard never appeared.
-- Additive fix: keep every previously accepted value and add the missing page.
ALTER TABLE public.telegram_bot_preferences
  DROP CONSTRAINT telegram_bot_preferences_keyboard_page_check;

ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_keyboard_page_check
  CHECK (keyboard_page IN ('home','tools','settings','tones','length','language','privacy','reset','admin','users','models','quota','user_quota','voice','retry','fun','tasks','tasks_delete_confirm'));
