-- Nexa v10.6.1: a user running on their OWN API key pays for their own usage,
-- so the bot-wide / per-user daily limit never applies to them. Users on the
-- admin's key keep the configured limits. Usage is still counted for stats.
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
 -- Personal API key (enabled) => unlimited (0 means no limit).
 if exists(select 1 from public.telegram_bot_user_api where telegram_user_id=p_user_id and enabled) then v_limit := 0; end if;
 select used into v_used from public.telegram_bot_daily_usage where telegram_user_id=p_user_id and usage_day=v_day;
 v_used := coalesce(v_used,0);
 if exists(select 1 from public.telegram_bot_quota_events where telegram_update_id=p_update_id) then return pg_catalog.jsonb_build_object('allowed',true,'duplicate',true,'used',v_used,'limit',v_limit);end if;
 if v_limit>0 and v_used>=v_limit then return pg_catalog.jsonb_build_object('allowed',false,'duplicate',false,'used',v_used,'limit',v_limit);end if;
 insert into public.telegram_bot_quota_events(telegram_update_id,telegram_user_id,usage_day) values(p_update_id,p_user_id,v_day);
 insert into public.telegram_bot_daily_usage(telegram_user_id,usage_day,used) values(p_user_id,v_day,1) on conflict(telegram_user_id,usage_day) do update set used=public.telegram_bot_daily_usage.used+1 returning used into v_used;
 return pg_catalog.jsonb_build_object('allowed',true,'duplicate',false,'used',v_used,'limit',v_limit);
end $function$;
REVOKE ALL ON FUNCTION public.saeed_ai_reserve_daily(bigint, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_reserve_daily(bigint, bigint, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20261005130000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
