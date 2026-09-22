-- Saeed AI base schema, reconstructed from the production project (read-only
-- inspection on 2026-09-22) so a brand-new Supabase project can be bootstrapped
-- from supabase/migrations alone. Every statement is idempotent: on production
-- it is a no-op, on an empty database it creates the pre-Saeed-era objects that
-- the later migrations alter.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Preferences and access -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_bot_preferences (
  telegram_user_id BIGINT PRIMARY KEY,
  tone TEXT NOT NULL DEFAULT 'friendly',
  answer_length TEXT NOT NULL DEFAULT 'balanced',
  language TEXT NOT NULL DEFAULT 'fa',
  pending_tool TEXT NOT NULL DEFAULT 'chat',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  keyboard_page TEXT NOT NULL DEFAULT 'home'
);
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_preferences ADD CONSTRAINT telegram_bot_preferences_tone_check
    CHECK (tone IN ('friendly','formal','romantic','professional','creative','witty'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_preferences ADD CONSTRAINT telegram_bot_preferences_answer_length_check
    CHECK (answer_length IN ('short','balanced','detailed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_preferences ADD CONSTRAINT telegram_bot_preferences_language_check
    CHECK (language IN ('fa','en','auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_preferences ADD CONSTRAINT telegram_bot_preferences_pending_tool_check
    CHECK (pending_tool IN ('chat','web','repo','documents','image','ocr','transcribe','summarize','translate','rewrite','ideas'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_preferences ADD CONSTRAINT telegram_bot_preferences_keyboard_page_check
    CHECK (keyboard_page IN ('home','tools','settings','tones','length','language','privacy','reset','admin','users','models','quota','user_quota','voice','retry'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.telegram_bot_user_access (
  telegram_user_id BIGINT PRIMARY KEY CHECK (telegram_user_id > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  daily_limit INTEGER CHECK (daily_limit >= 0 AND daily_limit <= 1000)
);

CREATE TABLE IF NOT EXISTS public.telegram_bot_config (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE public.telegram_bot_config ADD CONSTRAINT telegram_bot_config_setting_key_check
    CHECK (setting_key IN ('model','provider','openrouter_model','daily_limit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.telegram_bot_admin_flow (
  telegram_user_id BIGINT PRIMARY KEY CHECK (telegram_user_id > 0),
  pending_action TEXT NOT NULL CHECK (pending_action IN ('add_user','add_model','add_openrouter_model','set_daily_default','set_daily_user','remove_user')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  target_user_id BIGINT CHECK (target_user_id > 0)
);

-- Conversation (15-minute privacy window) ------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_chat_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','model')),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','photo','voice','audio')),
  body TEXT NOT NULL,
  telegram_update_id BIGINT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_chat_messages_expiry_idx ON public.telegram_chat_messages (created_at);
CREATE INDEX IF NOT EXISTS telegram_chat_messages_user_chat_id_idx ON public.telegram_chat_messages (telegram_user_id, telegram_chat_id, id DESC);

-- Daily quota -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_bot_daily_usage (
  telegram_user_id BIGINT NOT NULL,
  usage_day DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (telegram_user_id, usage_day)
);
CREATE TABLE IF NOT EXISTS public.telegram_bot_quota_events (
  telegram_update_id BIGINT PRIMARY KEY CONSTRAINT saeed_ai_quota_update_positive CHECK (telegram_update_id > 0),
  telegram_user_id BIGINT NOT NULL,
  usage_day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_bot_quota_events_created_idx ON public.telegram_bot_quota_events (created_at);

-- Telemetry, retry and voice clips -------------------------------------------
CREATE TABLE IF NOT EXISTS public.saeed_ai_metrics (
  telegram_update_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openrouter')),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','success','failed','unavailable')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saeed_ai_metrics_user_created_idx ON public.saeed_ai_metrics (telegram_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.saeed_ai_retry (
  original_update_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  source_message JSONB NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','failed','retrying','completed')),
  last_update_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saeed_ai_retry_expiry_idx ON public.saeed_ai_retry (expires_at);

CREATE TABLE IF NOT EXISTS public.saeed_ai_voice_pending (
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_message_id BIGINT NOT NULL,
  file_id TEXT NOT NULL,
  file_size INTEGER,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  PRIMARY KEY (telegram_user_id, telegram_message_id)
);

-- Service-role only: RLS on, no policies.
ALTER TABLE public.telegram_bot_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_admin_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_quota_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_retry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saeed_ai_voice_pending ENABLE ROW LEVEL SECURITY;

-- Quota RPCs (identical to production) ----------------------------------------
CREATE OR REPLACE FUNCTION public.saeed_ai_reserve_daily(p_user_id bigint, p_update_id bigint, p_is_admin boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare v_day date := (now() at time zone 'Asia/Tehran')::date; v_limit integer; v_used integer; v_default integer;
begin
 if p_user_id is null or p_user_id<=0 or p_update_id is null or p_update_id<=0 then raise exception 'invalid quota identifiers'; end if;
 perform pg_catalog.pg_advisory_xact_lock(p_user_id);
 select nullif(setting_value,'')::integer into v_default from public.telegram_bot_config where setting_key='daily_limit';
 select daily_limit into v_limit from public.telegram_bot_user_access where telegram_user_id=p_user_id;
 v_limit := coalesce(v_limit, case when p_is_admin then 0 else coalesce(v_default,40) end);
 select used into v_used from public.telegram_bot_daily_usage where telegram_user_id=p_user_id and usage_day=v_day;
 v_used := coalesce(v_used,0);
 if exists(select 1 from public.telegram_bot_quota_events where telegram_update_id=p_update_id) then return pg_catalog.jsonb_build_object('allowed',true,'duplicate',true,'used',v_used,'limit',v_limit);end if;
 if v_limit>0 and v_used>=v_limit then return pg_catalog.jsonb_build_object('allowed',false,'duplicate',false,'used',v_used,'limit',v_limit);end if;
 insert into public.telegram_bot_quota_events(telegram_update_id,telegram_user_id,usage_day) values(p_update_id,p_user_id,v_day);
 insert into public.telegram_bot_daily_usage(telegram_user_id,usage_day,used) values(p_user_id,v_day,1) on conflict(telegram_user_id,usage_day) do update set used=public.telegram_bot_daily_usage.used+1 returning used into v_used;
 return pg_catalog.jsonb_build_object('allowed',true,'duplicate',false,'used',v_used,'limit',v_limit);
end $function$;

CREATE OR REPLACE FUNCTION public.saeed_ai_refund_daily(p_update_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare v_user bigint; v_day date;
begin
 select telegram_user_id into v_user from public.telegram_bot_quota_events where telegram_update_id=p_update_id;
 if v_user is null then return false; end if;
 perform pg_catalog.pg_advisory_xact_lock(v_user);
 delete from public.telegram_bot_quota_events where telegram_update_id=p_update_id returning telegram_user_id,usage_day into v_user,v_day;
 if not found then return false; end if;
 update public.telegram_bot_daily_usage set used=greatest(used-1,0) where telegram_user_id=v_user and usage_day=v_day;
 return true;
end $function$;

REVOKE ALL ON FUNCTION public.saeed_ai_reserve_daily(bigint, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.saeed_ai_refund_daily(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_reserve_daily(bigint, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.saeed_ai_refund_daily(bigint) TO service_role;

-- Retention jobs (cron.schedule upserts by name) ------------------------------
SELECT cron.schedule('telegram-chat-expire-15m', '* * * * *',
  $$delete from public.telegram_chat_messages where created_at < now() - interval '15 minutes'$$);
SELECT cron.schedule('saeed-ai-v6-private-retention', '*/2 * * * *',
  $$delete from public.saeed_ai_retry where expires_at < now(); delete from public.saeed_ai_voice_pending where expires_at < now(); delete from public.saeed_ai_metrics where created_at < now() - interval '7 days';$$);
SELECT cron.schedule('saeed-ai-quota-prune', '17 0 * * *',
  $$delete from public.telegram_bot_quota_events where created_at < now()- interval '3 days'; delete from public.telegram_bot_daily_usage where usage_day < (now() at time zone 'Asia/Tehran')::date - 3;$$);
