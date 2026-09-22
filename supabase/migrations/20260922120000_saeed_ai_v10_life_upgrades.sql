-- Saeed AI v10.0.0: bug fixes and life upgrades. Additive and backward compatible:
-- the previous release keeps working if this is applied before the deploy.

-- Tasks: completion time, so the retention sweep never deletes a task that was
-- just ticked (it used created_at, which broke «↩️» undo for older tasks).
ALTER TABLE public.saeed_ai_tasks ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
UPDATE public.saeed_ai_tasks SET done_at = now() WHERE done AND done_at IS NULL;

-- Shopping: purchase time (weekly card, sweep) and family sharing.
ALTER TABLE public.saeed_ai_shopping ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
UPDATE public.saeed_ai_shopping SET done_at = now() WHERE done AND done_at IS NULL;
CREATE INDEX IF NOT EXISTS saeed_ai_shopping_owner_idx ON public.saeed_ai_shopping (telegram_user_id, done, id DESC);

CREATE TABLE IF NOT EXISTS public.saeed_ai_shopping_members (
  member_user_id BIGINT PRIMARY KEY CHECK (member_user_id > 0),
  owner_user_id BIGINT NOT NULL CHECK (owner_user_id > 0),
  member_name TEXT CHECK (member_name IS NULL OR char_length(member_name) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (member_user_id <> owner_user_id)
);
CREATE INDEX IF NOT EXISTS saeed_ai_shopping_members_owner_idx ON public.saeed_ai_shopping_members (owner_user_id);

CREATE TABLE IF NOT EXISTS public.saeed_ai_shopping_invites (
  code TEXT PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  owner_user_id BIGINT NOT NULL CHECK (owner_user_id > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Life preferences: any valid IANA zone, wider briefing hours, weekly card, voice.
ALTER TABLE public.saeed_ai_briefing_preferences DROP CONSTRAINT IF EXISTS saeed_ai_briefing_preferences_timezone_check;
ALTER TABLE public.saeed_ai_briefing_preferences DROP CONSTRAINT IF EXISTS saeed_ai_briefing_preferences_send_hour_check;
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_preferences_send_hour_check CHECK (send_hour BETWEEN 5 AND 11);
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_preferences_timezone_check CHECK (char_length(timezone) BETWEEN 3 AND 64);
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD COLUMN IF NOT EXISTS weekly_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_weekly_day DATE,
  ADD COLUMN IF NOT EXISTS voice BOOLEAN NOT NULL DEFAULT false;

-- A zone PostgreSQL does not know falls back to Tehran instead of raising:
-- the planner may evaluate AT TIME ZONE before any join or WHERE filter.
CREATE OR REPLACE FUNCTION public.saeed_ai_safe_tz(p_tz TEXT)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'Asia/Tehran' END
$$;
REVOKE ALL ON FUNCTION public.saeed_ai_safe_tz(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_safe_tz(TEXT) TO service_role;

-- Briefing claim: explicitly disabled users are skipped (LEFT JOIN), so enabling
-- the briefing no longer needs to write a telegram_bot_user_access row, and a
-- zone unknown to PostgreSQL is skipped instead of aborting the whole claim.
CREATE OR REPLACE FUNCTION public.saeed_ai_claim_briefings(p_limit INTEGER DEFAULT 30)
RETURNS TABLE (telegram_user_id BIGINT, telegram_chat_id BIGINT, local_day DATE)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
 WITH due AS (
  SELECT p.telegram_user_id, (now() AT TIME ZONE public.saeed_ai_safe_tz(p.timezone))::date AS day
  FROM public.saeed_ai_briefing_preferences p
  LEFT JOIN public.telegram_bot_user_access a ON a.telegram_user_id = p.telegram_user_id
  WHERE p.enabled
   AND coalesce(a.enabled, true)
   AND public.saeed_ai_safe_tz(p.timezone) = p.timezone
   AND extract(hour from now() AT TIME ZONE public.saeed_ai_safe_tz(p.timezone)) >= p.send_hour
   AND extract(hour from now() AT TIME ZONE public.saeed_ai_safe_tz(p.timezone)) < p.send_hour + 1
   AND (p.last_sent_day IS NULL OR p.last_sent_day < (now() AT TIME ZONE public.saeed_ai_safe_tz(p.timezone))::date)
   AND (p.lease_until IS NULL OR p.lease_until < now())
  ORDER BY p.telegram_user_id
  LIMIT LEAST(GREATEST(p_limit, 1), 50) FOR UPDATE OF p SKIP LOCKED
 ), claimed AS (
  UPDATE public.saeed_ai_briefing_preferences p
  SET lease_until = now() + interval '5 minutes'
  FROM due WHERE p.telegram_user_id = due.telegram_user_id
  RETURNING p.telegram_user_id, p.telegram_chat_id, due.day
 ) SELECT claimed.telegram_user_id, claimed.telegram_chat_id, claimed.day FROM claimed;
$$;
REVOKE ALL ON FUNCTION public.saeed_ai_claim_briefings(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_claim_briefings(INTEGER) TO service_role;

-- Preferences: receipt tool and the «🗂 روزمره» page.
ALTER TABLE public.telegram_bot_preferences DROP CONSTRAINT IF EXISTS telegram_bot_preferences_pending_tool_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_pending_tool_check
  CHECK (pending_tool IN ('chat','web','repo','documents','image','ocr','transcribe','summarize','translate','rewrite','ideas','remind','calc','email','tasks','receipt','horoscope','trivia','story','joke','roast'));
ALTER TABLE public.telegram_bot_preferences DROP CONSTRAINT IF EXISTS telegram_bot_preferences_keyboard_page_check;
ALTER TABLE public.telegram_bot_preferences
  ADD CONSTRAINT telegram_bot_preferences_keyboard_page_check
  CHECK (keyboard_page IN ('home','tools','life','settings','tones','length','language','privacy','reset','admin','users','models','quota','user_quota','voice','retry','fun','tasks','tasks_delete_confirm'));

-- Config: admin switch for Google Search in ordinary chat, optional search model.
ALTER TABLE public.telegram_bot_config DROP CONSTRAINT IF EXISTS telegram_bot_config_setting_key_check;
ALTER TABLE public.telegram_bot_config
  ADD CONSTRAINT telegram_bot_config_setting_key_check
  CHECK (setting_key IN ('model','provider','openrouter_model','daily_limit','search_model','chat_search'));

-- Opt-in long-term memory: only facts the user explicitly asked to remember.
CREATE TABLE IF NOT EXISTS public.saeed_ai_memories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
  fact TEXT NOT NULL CHECK (char_length(fact) BETWEEN 3 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, fact)
);

-- Conditional alerts (market thresholds, rain).
CREATE TABLE IF NOT EXISTS public.saeed_ai_watchers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
  telegram_chat_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('usd_above','usd_below','gold_above','gold_below','rain')),
  threshold BIGINT CHECK (threshold IS NULL OR threshold > 0),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 200),
  recurring BOOLEAN NOT NULL DEFAULT false,
  target_day DATE,
  last_fired_day DATE,
  fired_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'rain') = (threshold IS NULL))
);
CREATE INDEX IF NOT EXISTS saeed_ai_watchers_active_idx ON public.saeed_ai_watchers (kind) WHERE active;

-- Receipt drafts awaiting the user's ✅ (nothing reaches expenses before that).
CREATE TABLE IF NOT EXISTS public.saeed_ai_receipt_pending (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL CHECK (telegram_user_id > 0),
  telegram_chat_id BIGINT NOT NULL,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  amount_toman BIGINT NOT NULL CHECK (amount_toman > 0 AND amount_toman < 1000000000000),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-minute flood guard for the gateway.
CREATE TABLE IF NOT EXISTS public.saeed_ai_rate (
  telegram_user_id BIGINT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_user_id, bucket)
);

CREATE OR REPLACE FUNCTION public.saeed_ai_rate_hit(p_user_id BIGINT, p_limit INTEGER DEFAULT 20)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.saeed_ai_rate AS r (telegram_user_id, bucket, hits)
  VALUES (p_user_id, date_trunc('minute', now()), 1)
  ON CONFLICT (telegram_user_id, bucket) DO UPDATE SET hits = r.hits + 1
  RETURNING hits <= GREATEST(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION public.saeed_ai_rate_hit(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_rate_hit(BIGINT, INTEGER) TO service_role;

ALTER TABLE public.saeed_ai_shopping_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_shopping_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_receipt_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_rate ENABLE ROW LEVEL SECURITY;

-- Schema version checked by the deploy workflow before any function is deployed.
CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20260922120000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
