-- Behavioural smoke test of the migrated schema. Any failed assertion aborts.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.day', (now() AT TIME ZONE 'Asia/Tehran')::date::text, true);

-- Quota: reserve, duplicate, refund.
INSERT INTO public.telegram_bot_config (setting_key, setting_value) VALUES ('daily_limit', '2'), ('chat_search', 'off');
DO $$ DECLARE r jsonb; BEGIN
  r := public.saeed_ai_reserve_daily(42, 1001, false); ASSERT (r->>'allowed')::bool AND NOT (r->>'duplicate')::bool, 'first reserve';
  r := public.saeed_ai_reserve_daily(42, 1001, false); ASSERT (r->>'duplicate')::bool, 'duplicate update id';
  r := public.saeed_ai_reserve_daily(42, 1002, false); ASSERT (r->>'allowed')::bool, 'second reserve';
  r := public.saeed_ai_reserve_daily(42, 1003, false); ASSERT NOT (r->>'allowed')::bool, 'limit enforced';
  ASSERT public.saeed_ai_refund_daily(1002), 'refund';
  r := public.saeed_ai_reserve_daily(42, 1004, false); ASSERT (r->>'allowed')::bool, 'refunded slot reusable';
END $$;

-- Rate limit: third hit within the minute is refused with p_limit = 2.
DO $$ BEGIN
  ASSERT public.saeed_ai_rate_hit(7, 2); ASSERT public.saeed_ai_rate_hit(7, 2); ASSERT NOT public.saeed_ai_rate_hit(7, 2), 'rate limit';
END $$;

-- Preferences accept every v10 page and tool; unknown values are rejected.
INSERT INTO public.telegram_bot_preferences (telegram_user_id, pending_tool, keyboard_page) VALUES (42, 'receipt', 'life');
DO $$ BEGIN
  BEGIN UPDATE public.telegram_bot_preferences SET keyboard_page = 'nope' WHERE telegram_user_id = 42; RAISE EXCEPTION 'bad page accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Briefing claim: any IANA zone, legacy users without an access row are included,
-- explicitly disabled users are skipped, invalid zones never abort the claim.
INSERT INTO public.saeed_ai_briefing_preferences (telegram_user_id, telegram_chat_id, enabled, send_hour, timezone)
VALUES (1, 1, true, 5, 'Europe/Berlin'), (2, 2, true, 5, 'Asia/Tehran'), (3, 3, true, 5, 'Mars/Olympus');
UPDATE public.saeed_ai_briefing_preferences SET send_hour = GREATEST(5, LEAST(11, extract(hour FROM now() AT TIME ZONE timezone)::int))
WHERE timezone IN ('Europe/Berlin', 'Asia/Tehran');
INSERT INTO public.telegram_bot_user_access (telegram_user_id, enabled) VALUES (2, false);
DO $$ DECLARE n int; hour_ok bool; BEGIN
  SELECT extract(hour FROM now() AT TIME ZONE 'Europe/Berlin') BETWEEN 5 AND 11 INTO hour_ok;
  SELECT count(*) INTO n FROM public.saeed_ai_claim_briefings(10);
  ASSERT n = CASE WHEN hour_ok THEN 1 ELSE 0 END, format('claimed %s briefings', n);
END $$;

-- Tasks and shopping carry completion times; members and invites exist.
INSERT INTO public.saeed_ai_tasks (telegram_user_id, task, done, done_at) VALUES (42, 'x', true, now());
INSERT INTO public.saeed_ai_shopping (telegram_user_id, item, done, done_at) VALUES (42, 'شیر', true, now());
INSERT INTO public.saeed_ai_shopping_invites (code, owner_user_id, expires_at) VALUES ('123456', 42, now() + interval '1 day');
INSERT INTO public.saeed_ai_shopping_members (member_user_id, owner_user_id, member_name) VALUES (43, 42, 'مریم');
INSERT INTO public.saeed_ai_memories (telegram_user_id, fact) VALUES (42, 'گیاه‌خوارم');
INSERT INTO public.saeed_ai_watchers (telegram_user_id, telegram_chat_id, kind, threshold, note) VALUES (42, 42, 'usd_above', 95000, 'دلار');
INSERT INTO public.saeed_ai_watchers (telegram_user_id, telegram_chat_id, kind, note, recurring) VALUES (42, 42, 'rain', 'چتر', true);
INSERT INTO public.saeed_ai_receipt_pending (telegram_user_id, telegram_chat_id, description, amount_toman, expires_at) VALUES (42, 42, 'سوپرمارکت', 340000, now() + interval '1 day');
INSERT INTO public.saeed_ai_expenses (telegram_user_id, telegram_chat_id, description, amount_toman) VALUES (42, 42, 'سوپرمارکت', 340000), (42, 42, 'قهوه', 90000);
DO $$ BEGIN
  BEGIN INSERT INTO public.saeed_ai_watchers (telegram_user_id, telegram_chat_id, kind, note) VALUES (42, 42, 'usd_above', 'x'); RAISE EXCEPTION 'market alert without threshold accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Reminder claim still works with the v9 recurrence columns.
INSERT INTO public.saeed_ai_reminders (telegram_user_id, telegram_chat_id, note, remind_at, repeat_rule) VALUES (42, 42, 'test', now() - interval '1 minute', 'daily');
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM public.saeed_ai_claim_due_reminders(10); ASSERT n = 1, 'reminder claim'; END $$;

-- Personal API key => no daily limit; others keep it (limit is 2 here).
DO $$ DECLARE r jsonb; BEGIN
  PERFORM public.nexa_user_api_set(55, 'gemini', 'gemini-personal-key-123');
  FOR i IN 1..5 LOOP
    r := public.saeed_ai_reserve_daily(55, 2000 + i, false); ASSERT (r->>'allowed')::bool, 'personal key is unlimited';
  END LOOP;
  r := public.saeed_ai_reserve_daily(56, 2100, false); r := public.saeed_ai_reserve_daily(56, 2101, false);
  r := public.saeed_ai_reserve_daily(56, 2102, false); ASSERT NOT (r->>'allowed')::bool, 'admin-key user keeps the limit';
  UPDATE public.telegram_bot_user_api SET enabled = false WHERE telegram_user_id = 55;
  r := public.saeed_ai_reserve_daily(55, 2200, false); ASSERT NOT (r->>'allowed')::bool, 'disabled personal key falls back to the limit';
END $$;

-- Personal custom OpenAI-compatible provider: URL + model are stored next to the key.
DO $$ DECLARE r record; BEGIN
  ASSERT public.nexa_user_api_set(77, 'custom', 'sk-custom-secret-123', 'https://api.example.com/v1', 'my-model') = true, 'custom set';
  SELECT * INTO r FROM public.nexa_user_api_get(77);
  ASSERT r.provider = 'custom' AND r.api_key = 'sk-custom-secret-123' AND r.base_url = 'https://api.example.com/v1' AND r.model = 'my-model', 'custom get';
  ASSERT public.nexa_user_api_set(78, 'custom', 'sk-custom-secret-123', 'http://insecure.example.com', 'm') = false, 'custom requires https';
  ASSERT public.nexa_user_api_set(78, 'custom', 'sk-custom-secret-123', 'https://api.example.com/v1', NULL) = false, 'custom requires model';
  ASSERT public.nexa_user_api_set(79, 'gemini', 'gemini-secret-key-123') = true, 'builtin provider keeps 3-arg form';
  INSERT INTO public.telegram_bot_config (setting_key, setting_value) VALUES ('custom_base_url', 'https://api.example.com/v1'), ('custom_model', 'my-model');
  INSERT INTO public.saeed_ai_metrics (telegram_update_id, telegram_user_id, provider, model, status) VALUES (900001, 77, 'custom', 'my-model', 'success');
END $$;

DO $$ BEGIN ASSERT public.saeed_ai_schema_version() = '20261005130000', 'schema version'; END $$;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cron.job WHERE jobname IN ('telegram-chat-expire-15m','saeed-ai-v6-private-retention','saeed-ai-quota-prune','saeed-ai-reminders-every-minute')) = 4, 'cron jobs'; END $$;
DO $$ BEGIN INSERT INTO public.telegram_bot_preferences (telegram_user_id, keyboard_page) VALUES (43, 'guide'); END $$;
ROLLBACK;
\echo SMOKE_OK
