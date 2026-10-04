-- Nexa v10.5: self-service personal API keys for users outside the allowlist.
-- Secrets are encrypted at rest by Supabase Vault and are only readable through
-- service-role-only RPCs used by the Edge Functions.

CREATE TABLE IF NOT EXISTS public.telegram_bot_user_api (
  telegram_user_id BIGINT PRIMARY KEY CHECK (telegram_user_id > 0),
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openrouter')),
  secret_name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_bot_user_api ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_bot_user_api FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_bot_user_api TO service_role;

CREATE TABLE IF NOT EXISTS public.telegram_bot_onboarding (
  telegram_user_id BIGINT PRIMARY KEY CHECK (telegram_user_id > 0),
  pending_action TEXT NOT NULL CHECK (pending_action IN ('api_key')),
  provider TEXT CHECK (provider IN ('gemini','openrouter')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_bot_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_bot_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_bot_onboarding TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_user_api_set(
  p_user_id BIGINT,
  p_provider TEXT,
  p_api_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
  v_secret_id vault.secrets.id%TYPE;
BEGIN
  IF p_user_id <= 0 OR p_provider NOT IN ('gemini','openrouter') THEN
    RETURN false;
  END IF;
  IF p_api_key IS NULL OR length(btrim(p_api_key)) < 12 OR length(p_api_key) > 512 THEN
    RETURN false;
  END IF;

  v_name := 'nexa_user_api_' || p_user_id::text;
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(btrim(p_api_key), v_name);
  ELSE
    PERFORM vault.update_secret(v_secret_id, btrim(p_api_key));
  END IF;

  INSERT INTO public.telegram_bot_user_api (telegram_user_id, provider, secret_name, enabled, updated_at)
  VALUES (p_user_id, p_provider, v_name, true, now())
  ON CONFLICT (telegram_user_id) DO UPDATE
    SET provider = excluded.provider,
        secret_name = excluded.secret_name,
        enabled = true,
        updated_at = now();

  DELETE FROM public.telegram_bot_onboarding WHERE telegram_user_id = p_user_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_user_api_set(BIGINT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_user_api_set(BIGINT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_user_api_get(p_user_id BIGINT)
RETURNS TABLE(provider TEXT, api_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.provider, d.decrypted_secret
  FROM public.telegram_bot_user_api u
  JOIN vault.decrypted_secrets d ON d.name = u.secret_name
  WHERE u.telegram_user_id = p_user_id
    AND u.enabled = true
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.nexa_user_api_get(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_user_api_get(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_user_api_remove(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT secret_name INTO v_name
  FROM public.telegram_bot_user_api
  WHERE telegram_user_id = p_user_id;

  DELETE FROM public.telegram_bot_user_api WHERE telegram_user_id = p_user_id;
  DELETE FROM public.telegram_bot_onboarding WHERE telegram_user_id = p_user_id;
  IF v_name IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE name = v_name;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_user_api_remove(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_user_api_remove(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '20261004171500'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
