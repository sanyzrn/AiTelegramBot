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

DO $$ BEGIN ASSERT public.saeed_ai_schema_version() = '20260925120000', 'schema version'; END $$;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cron.job WHERE jobname IN ('telegram-chat-expire-15m','saeed-ai-v6-private-retention','saeed-ai-quota-prune','saeed-ai-reminders-every-minute')) = 4, 'cron jobs'; END $$;
ROLLBACK;
\echo SMOKE_OK
