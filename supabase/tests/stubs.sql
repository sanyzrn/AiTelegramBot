-- Minimal stand-ins for Supabase-managed objects so the migration chain can be
-- verified on a plain PostgreSQL (CI and local). Never applied to Supabase.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- pg_cron: cron.schedule(name, schedule, command) upserts a job by name.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobname TEXT PRIMARY KEY, schedule TEXT NOT NULL, command TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true);
CREATE OR REPLACE FUNCTION cron.schedule(p_name TEXT, p_schedule TEXT, p_command TEXT) RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1::bigint $$;

-- Supabase Vault.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE, secret TEXT NOT NULL);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(p_secret TEXT, p_name TEXT) RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO vault.secrets (name, secret) VALUES (p_name, p_secret) RETURNING id $$;
