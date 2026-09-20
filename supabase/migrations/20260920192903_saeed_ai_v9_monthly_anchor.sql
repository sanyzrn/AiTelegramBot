-- Follow-up migration applied to production; keep first monthly day across February.
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS repeat_anchor_day SMALLINT;
DO $$ BEGIN ALTER TABLE public.saeed_ai_reminders ADD CONSTRAINT saeed_ai_repeat_anchor_day_check CHECK (repeat_anchor_day IS NULL OR repeat_anchor_day BETWEEN 1 AND 31); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
