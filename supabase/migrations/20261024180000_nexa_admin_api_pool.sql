-- Nexa 10.7: multiple bot-owned provider credentials, encrypted using Supabase Vault.
-- This pool is entirely separate from users' personal BYOK secrets.
CREATE TABLE IF NOT EXISTS public.nexa_admin_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gemini', 'openrouter', 'custom')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 120),
  base_url text,
  secret_name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nexa_admin_api_custom_url CHECK (
    (provider = 'custom' AND base_url ~ '^https://' AND length(base_url) <= 300)
    OR (provider <> 'custom' AND base_url IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS nexa_admin_api_one_active
  ON public.nexa_admin_api_keys (is_active) WHERE is_active;
ALTER TABLE public.nexa_admin_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nexa_admin_api_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nexa_admin_api_keys TO service_role;

-- The server is the only caller. Never expose decrypted values in the Admin HTTP responses.
CREATE OR REPLACE FUNCTION public.nexa_admin_api_get(p_id uuid)
RETURNS TABLE(provider text, model text, base_url text, api_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT k.provider, k.model, k.base_url, v.decrypted_secret
 FROM public.nexa_admin_api_keys k
 JOIN vault.decrypted_secrets v ON v.name = k.secret_name
 WHERE k.id = p_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_get(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_get(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_admin_api_active()
RETURNS TABLE(provider text, model text, base_url text, api_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT k.provider, k.model, k.base_url, v.decrypted_secret
 FROM public.nexa_admin_api_keys k
 JOIN vault.decrypted_secrets v ON v.name = k.secret_name
 WHERE k.is_active AND k.enabled LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_active() TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_admin_api_save(
  p_id uuid, p_provider text, p_label text, p_model text, p_base_url text, p_key text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_existing public.nexa_admin_api_keys%ROWTYPE;
  v_url text := NULLIF(btrim(p_base_url),'');
  v_name text;
  v_vault_id vault.secrets.id%TYPE;
BEGIN
  IF p_provider NOT IN ('gemini','openrouter','custom')
     OR length(btrim(p_label)) NOT BETWEEN 1 AND 60
     OR length(btrim(p_model)) NOT BETWEEN 1 AND 120
     OR (p_provider = 'custom' AND (v_url IS NULL OR v_url !~ '^https://' OR length(v_url)>300))
     OR (p_provider <> 'custom' AND v_url IS NOT NULL) THEN
     RAISE EXCEPTION 'invalid provider details';
  END IF;
  SELECT * INTO v_existing FROM public.nexa_admin_api_keys WHERE id=v_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.provider <> p_provider THEN RAISE EXCEPTION 'provider cannot change'; END IF;
    IF p_key IS NOT NULL AND length(btrim(p_key)) > 0 THEN
      IF length(btrim(p_key)) < 12 OR length(p_key)>512 OR btrim(p_key) ~ '[[:space:]]'
      THEN RAISE EXCEPTION 'invalid key'; END IF;
      SELECT id INTO v_vault_id FROM vault.secrets WHERE name=v_existing.secret_name;
      PERFORM vault.update_secret(v_vault_id,btrim(p_key));
    END IF;
    UPDATE public.nexa_admin_api_keys SET label=btrim(p_label),model=btrim(p_model),
      base_url=v_url,updated_at=now() WHERE id=v_id;
  ELSE
    IF p_key IS NULL OR length(btrim(p_key))<12 OR length(p_key)>512 OR btrim(p_key) ~ '[[:space:]]'
    THEN RAISE EXCEPTION 'api key required'; END IF;
    v_name := 'nexa_admin_pool_' || v_id::text;
    PERFORM vault.create_secret(btrim(p_key),v_name);
    INSERT INTO public.nexa_admin_api_keys(id,provider,label,model,base_url,secret_name)
      VALUES (v_id,p_provider,btrim(p_label),btrim(p_model),v_url,v_name);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_save(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_save(uuid,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_admin_api_activate(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.nexa_admin_api_keys%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(16423,1067);
  SELECT * INTO v_row FROM public.nexa_admin_api_keys WHERE id=p_id AND enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.nexa_admin_api_keys SET is_active=false,updated_at=now() WHERE is_active;
  UPDATE public.nexa_admin_api_keys SET is_active=true,updated_at=now() WHERE id=p_id;
  INSERT INTO public.telegram_bot_config(setting_key,setting_value,updated_at)
    VALUES ('provider',v_row.provider,now())
    ON CONFLICT (setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_activate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_activate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_admin_api_use_legacy(p_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_provider NOT IN ('gemini','openrouter','custom') THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(16423,1067);
  UPDATE public.nexa_admin_api_keys SET is_active=false,updated_at=now() WHERE is_active;
  INSERT INTO public.telegram_bot_config(setting_key,setting_value,updated_at)
    VALUES ('provider',p_provider,now())
    ON CONFLICT (setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_use_legacy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_use_legacy(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nexa_admin_api_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_name text; v_active boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(16423,1067);
  SELECT secret_name,is_active INTO v_name,v_active FROM public.nexa_admin_api_keys WHERE id=p_id FOR UPDATE;
  IF v_name IS NULL OR v_active THEN RETURN false; END IF;
  DELETE FROM public.nexa_admin_api_keys WHERE id=p_id;
  DELETE FROM vault.secrets WHERE name=v_name;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.nexa_admin_api_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexa_admin_api_delete(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.saeed_ai_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT '20261024180000'::text $$;
REVOKE ALL ON FUNCTION public.saeed_ai_schema_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saeed_ai_schema_version() TO service_role;
