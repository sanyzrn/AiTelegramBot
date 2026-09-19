-- Saeed AI feature pack (v8.0): smart reminders + task list.
-- Apply this migration BEFORE deploying the new function versions.
-- Safe to re-run (IF NOT EXISTS guards).

-- Smart reminders: parsed by Gemini, delivered on the user's next interaction.
CREATE TABLE IF NOT EXISTS public.saeed_ai_reminders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  note TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saeed_ai_reminders_due
  ON public.saeed_ai_reminders (telegram_user_id, remind_at)
  WHERE sent = false;

-- Upgrade safely if an earlier draft of this migration was already applied.
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE public.saeed_ai_reminders ADD COLUMN IF NOT EXISTS last_error TEXT;
DO $$ BEGIN
  ALTER TABLE public.saeed_ai_reminders ADD CONSTRAINT saeed_ai_reminders_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.saeed_ai_reminders ADD CONSTRAINT saeed_ai_reminders_attempt_count_check
    CHECK (attempt_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Task list: extracted from free text by Gemini, per user.
CREATE TABLE IF NOT EXISTS public.saeed_ai_tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  task TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saeed_ai_tasks_user
  ON public.saeed_ai_tasks (telegram_user_id, done);

-- Row level security: tables are only touched via the service role key
-- (Edge Functions), so RLS stays enabled with no permissive policies.
ALTER TABLE public.saeed_ai_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_tasks ENABLE ROW LEVEL SECURITY;

-- Atomically lease due reminders so overlapping cron runs cannot send duplicates.
-- The function is callable only by the service role used inside the dispatcher.
CREATE OR REPLACE FUNCTION public.saeed_ai_claim_due_reminders(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (id BIGINT, telegram_chat_id BIGINT, note TEXT, attempt_count INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT r.id
    FROM public.saeed_ai_reminders AS r
    WHERE r.sent = false
      AND r.status IN ('pending', 'processing')
      AND r.remind_at <= now()
      AND (r.lease_until IS NULL OR r.lease_until < now())
      AND r.attempt_count < 5
    ORDER BY r.remind_at, r.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), claimed AS (
    UPDATE public.saeed_ai_reminders AS r
    SET status = 'processing',
        lease_until = now() + interval '5 minutes',
        attempt_count = r.attempt_count + 1,
        last_error = NULL
    FROM candidates AS c
    WHERE r.id = c.id
    RETURNING r.id, r.telegram_chat_id, r.note, r.attempt_count
  )
  SELECT claimed.id, claimed.telegram_chat_id, claimed.note, claimed.attempt_count FROM claimed;
$$;

REVOKE ALL ON FUNCTION public.saeed_ai_claim_due_reminders(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_claim_due_reminders(INTEGER) TO service_role;
