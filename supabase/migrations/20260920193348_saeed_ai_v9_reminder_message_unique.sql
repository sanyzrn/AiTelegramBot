-- Nonpartial uniqueness is required for PostgREST onConflict on reminder creation.
DROP INDEX IF EXISTS public.saeed_ai_reminder_message_once;
CREATE UNIQUE INDEX saeed_ai_reminder_message_once ON public.saeed_ai_reminders(telegram_update_id);
