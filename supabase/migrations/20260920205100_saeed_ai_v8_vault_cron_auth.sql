-- Saeed AI: one-time, zero-hardcoded-secret reminder dispatch via Vault + pg_cron.
-- Requires existing Vault secrets saeed_ai_project_url and saeed_ai_publishable_key.
-- Safe on rerun: preserve a previously created dedicated secret; update the job in place.
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'saeed_ai_reminder_cron_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'saeed_ai_reminder_cron_token');
  END IF;
END $setup$;

CREATE OR REPLACE FUNCTION public.saeed_ai_authenticate_reminder_cron(p_candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $auth$
  SELECT coalesce(
    length(p_candidate) = 64
    AND EXISTS(
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'saeed_ai_reminder_cron_token'
      AND decrypted_secret = p_candidate
    ), false
  );
$auth$;
REVOKE ALL ON FUNCTION public.saeed_ai_authenticate_reminder_cron(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_authenticate_reminder_cron(TEXT) TO service_role;

-- Update the existing job rather than creating a second job. The old function
-- continues accepting its existing Authorization header during this transition.
SELECT cron.schedule(
  'saeed-ai-reminders-every-minute',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='saeed_ai_project_url') || '/functions/v1/saeed-ai-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='saeed_ai_publishable_key'),
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='saeed_ai_publishable_key'),
        'X-Saeed-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='saeed_ai_reminder_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    ) AS request_id;
  $job$
);
