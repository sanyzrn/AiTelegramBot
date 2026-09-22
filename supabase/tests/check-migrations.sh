#!/usr/bin/env bash
# Applies supabase/tests/stubs.sql and every migration in order to an empty
# PostgreSQL, twice (idempotency), then runs the behavioural smoke test.
# Usage: PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… supabase/tests/check-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
run() { psql -v ON_ERROR_STOP=1 -q "$@"; }
run -f supabase/tests/stubs.sql
for pass in 1 2; do
  for f in supabase/migrations/*.sql; do
    # pg_cron / pg_net are Supabase-managed extensions; stubs.sql provides cron.*.
    sed -E '/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)/d' "$f" | run -f - || { echo "::error::migration failed (pass $pass): $f"; exit 1; }
  done
  echo "PASS $pass: all migrations applied"
done
run -f supabase/tests/smoke.sql
