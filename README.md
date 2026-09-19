# Saeed AI · Telegram bot

**Source of truth:** This private GitHub repository. Production is Supabase project `zurfsjfulddkjiicegxh`. GitHub Actions deploys both production functions and verifies their health.

## Production deployment

Edit the source in `supabase/functions/saeed-ai-v7/` (processing) or `supabase/functions/saeed-ai-ui/` (Telegram webhook gateway), review it, then push to `main`. `.github/workflows/deploy-supabase.yml` automatically deploys **only these two functions**, in that order, and checks both production health endpoints. A change to `supabase/config.toml` also triggers deployment. You can run the workflow manually from GitHub Actions. Production's `verify_jwt = false` settings match the existing Telegram webhook integration; **both functions must retain their own `X-Telegram-Bot-Api-Secret-Token` authentication check**.

Deployment requires `SUPABASE_DEPLOY_TOKEN`, a project-scoped GitHub Actions secret with Edge Functions write access. Rotate it before expiry. `SUPABASE_ACCESS_TOKEN` is used only for the separate source import. Never commit tokens, bot secrets or API keys.

## Conversation tone modes

In Telegram, choose **⚙️ تنظیمات → 🎭 لحن**. **😄 شوخ‌طبع** now has an explicit warm, lively, informal Iranian-Persian personality with jokes and emojis, while staying respectful in sensitive situations and answering requests directly. **🪷 عارفانه** is original Persian prose inspired by seventh-century Hijri mystical literature, without fabricated poetry attributions. The choice is saved per user and applies to both the Telegram gateway chat/search and the processing function's text, media and voice replies.

Production's `telegram_bot_preferences_tone_check` was updated in Supabase migration `20260919154210_saeed_ai_add_mystic_tone` and its exact SQL is tracked in `supabase/migrations/`. Existing tone choices are preserved. Database migrations are **not** automatically run by the Edge Functions-only deployment workflow; review and apply any new migrations before deploying features that depend on them.

## Source import / recovery (normally leave alone)

The manually triggered `.github/workflows/import-supabase.yml` downloads and commits currently deployed `saeed-ai-ui` and `saeed-ai-v7` sources. **Do not run it after editing GitHub source unless you deliberately intend to replace repository copies with the deployed versions.** Normal development flows from GitHub to Supabase, not vice versa.

The other historical Edge Functions remain untouched. User data, secrets, webhook configuration, and `.env` files are **not backed up** by source import. This repository is not a complete database backup. To reproduce the bot elsewhere, database schema, configuration, and privacy-safe data backup need separate review.

The unrelated old repository content is preserved on branch [`archive/pre-saeed-ai-import-20260919`](../../tree/archive/pre-saeed-ai-import-20260919).
