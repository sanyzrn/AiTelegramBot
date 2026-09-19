# Saeed AI · Telegram bot

**Source of truth:** This private GitHub repository. Production is Supabase project `zurfsjfulddkjiicegxh`. The first GitHub Actions deployment passed on 2026-09-19 (run `35451857630`); both production functions passed health checks.

## Production deployment

Edit the source in `supabase/functions/saeed-ai-v7/` (processing) or `supabase/functions/saeed-ai-ui/` (Telegram webhook gateway), review it, then push to `main`. `.github/workflows/deploy-supabase.yml` automatically deploys **only these two functions**, in that order, and checks both production health endpoints. A change to `supabase/config.toml` also triggers deployment. You can also run that workflow manually from GitHub Actions. Production's `verify_jwt = false` settings match the existing Telegram webhook integration; **both function source files must retain their own `X-Telegram-Bot-Api-Secret-Token` authentication check**. Do not remove or weaken it.

Deployment requires the GitHub Actions secret `SUPABASE_DEPLOY_TOKEN`, a project-scoped Supabase access token with the necessary Edge Functions write access. Rotate the token before expiry. The read-only `SUPABASE_ACCESS_TOKEN` is used only for source import; never commit tokens, bot secrets or API keys.

## Source import / recovery (normally leave alone)

The manually triggered `.github/workflows/import-supabase.yml` downloads and commits the currently deployed `saeed-ai-ui` and `saeed-ai-v7` sources. **Do not run it after editing GitHub source unless you deliberately intend to replace the repository copies with whatever is deployed in Supabase.** Normal development flows from GitHub to Supabase, not vice versa.

The other historical Edge Functions are untouched. Database schema, migration SQL, user data, secrets, webhook configuration, and `.env` files are **not backed up** by source import. This repository is not a database backup. To reproduce the entire bot elsewhere, migrations and database configuration need a separate, reviewed backup/export without personal data or secrets in Git.

The unrelated previous repository content is preserved on branch [`archive/pre-saeed-ai-import-20260919`](../../tree/archive/pre-saeed-ai-import-20260919).
