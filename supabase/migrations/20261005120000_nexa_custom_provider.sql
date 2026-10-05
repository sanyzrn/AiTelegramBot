-- Nexa v10.6: «Custom (OpenAI-compatible)» provider for personal API keys.
-- A personal custom endpoint stores its base URL and model next to the Vault-encrypted key.

ALTER TABLE public.telegram_bot_user_api
  ADD COLUMN IF NOT EXISTS base_url TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.telegram_bot_user_api DROP CONSTRAINT IF EXISTS telegram_bot_user_api_provider_check;
ALTER TABLE public.telegram_bot_user_api
  ADD CONSTRAINT telegram_bot_user_api_provider_check CHECK (provider IN ('gemini','openrouter','custom'));
ALTER TABLE public.telegram_bot_user_api DROP CONSTRAINT IF EXISTS telegram_bot_user_api_custom_check;
ALTER TABLE public.telegram_bot_user_api
  ADD CONSTRAINT telegram_bot_user_api_custom_check CHECK (
    provider <> 'custom' OR (base_url ~ '^https://' AND length(base_url) <= 300 AND length(btrim(model)) BETWEEN 1 AND 120)
  );

ALTER TABLE public.telegram_bot_onboarding
  ADD COLUMN IF NOT EXISTS base_url TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.telegram_bot_onboarding DROP CONSTRAINT IF EXISTS telegram_bot_onboarding_pending_action_check;
ALTER TABLE public.telegram_bot_onboarding
  ADD CONSTRAINT telegram_bot_onboarding_pending_action_check
  CHECK (pending_action IN ('api_key','custom_url','custom_model'));
ALTER TABLE public.telegram_bot_onboarding DROP CONSTRAINT IF EXISTS telegram_bot_onboarding_provider_check;
ALTER TABLE public.telegram_bot_onboarding
  ADD CONSTRAINT telegram_bot_onboarding_provider_check CHECK (provider IN ('gemini','openrouter','custom'));


-- Bot-wide custom provider settings, admin flow actions and telemetry rows.
ALTER TABLE public.telegram_bot_config DROP CONSTRAINT IF EXISTS telegram_bot_config_setting_key_check;
ALTER TABLE public.telegram_bot_config
  ADD CONSTRAINT telegram_bot_config_setting_key_check
  CHECK (setting_key IN ('model','provider','openrouter_model','daily_limit','search_model','chat_search','custom_model','custom_base_url'));

ALTER TABLE public.telegram_bot_admin_flow DROP CONSTRAINT IF EXISTS telegram_bot_admin_flow_pending_action_check;
ALTER TABLE public.telegram_bot_admin_flow
  ADD CONSTRAINT telegram_bot_admin_flow_pending_action_check
  CHECK (pending_action IN ('add_user','add_model','add_openrouter_model','add_custom_model','add_custom_url','set_daily_default','set_daily_user','remove_user'));

ALTER TABLE public.saeed_ai_metrics DROP CONSTRAINT IF EXISTS saeed_ai_metrics_provider_check;
ALTER TABLE public.saeed_ai_metrics
  ADD CONSTRAINT saeed_ai_metrics_provider_check CHECK (provider IN ('gemini','openrouter','custom'));

DROP FUNCTION IF EXISTS public.nexa_user_api_set(BIGINT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.nexa_user_api_set(
  p_user_id BIGINT,
  p_provider TEXT,
  p_api_key TEXT,
  p_base_url TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
  v_secret_id vault.secrets.id%TYPE;
  v_base TEXT;
  v_model TEXT;
BEGIN
  IF p_user_id <= 0 OR p_provider NOT IN ('gemini','openrouter','custom') THEN
    RETURN false;
  END IF;
  IF p_api_key IS NULL OR length(btrim(p_api_key)) < 12 OR length(p_api_key) > 512 THEN
    RETURN false;
  END IF;
  IF p_provider = 'custom' THEN
    v_base := btrim(p_base_url);
    v_model := btrim(p_model);
    IF v_base IS NULL OR v_base !~ '^https://' OR length(v_base) > 300
       OR v_model IS NULL OR length(v_model) NOT BETWEEN 1 AND 120 THEN
      RETURN false;
    END IF;
  END IF;

  v_name := 'nexa_user_api_' || p_user_id::text;
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(btrim(p_api_key), v_name);
  ELSE
    PERFORM vault.update_secret(v_secret_id, btrim(p_api_key));
  END IF;

  INSERT INTO public.telegram_bot_user_api (telegram_user_id, provider, secret_name, base_url, model, enabled, updated_at)
  VALUES (p_user_id, p_provider, v_name, v_base, v_model, true, now())
  ON CONFLICT (telegram_user_id) DO UPDATE
    SET provider = excluded.provider,
        secret_name = excluded.secret_name,
        base_url = excluded.base_url,
        model = excluded.model,
        enabled = true,
        updated_at = now();

  DELETE FROM public.telegram_bot_onboarding WHERE telegram_user_id = p_user_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_user_api_set(BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_user_api_set(BIGINT,TEXT,TEXT,TEXT,TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.nexa_user_api_get(BIGINT);
CREATE OR REPLACE FUNCTION public.nexa_user_api_get(p_user_id BIGINT)
RETURNS TABLE(provider TEXT, api_key TEXT, base_url TEXT, model TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.provider, d.decrypted_secret, u.base_url, u.model
  FROM public.telegram_bot_user_api u
  JOIN vault.decrypted_secrets d ON d.name = u.secret_name
  WHERE u.telegram_user_id = p_user_id
    AND u.enabled = true
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.nexa_user_api_get(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_user_api_get(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20261005120000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
