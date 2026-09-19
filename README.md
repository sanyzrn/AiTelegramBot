# Saeed AI · Telegram bot

Source of truth: this GitHub repository, after importing the currently deployed source. Production remains on Supabase project `zurfsjfulddkjiicegxh`; this repository does **not** deploy anything automatically yet.

## Import the live source without interrupting the bot

1. Create a Supabase personal access token at https://supabase.com/dashboard/account/tokens with permissions sufficient to read/download Edge Functions for this project. Do not share the token in a chat or commit it.
2. In this repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add `SUPABASE_ACCESS_TOKEN` with the token as its value.
3. Run **Actions → Import Saeed AI source → Run workflow** on `main`. It downloads the two production functions (`saeed-ai-ui` and `saeed-ai-v7`) using the Supabase CLI, checks the files, and commits the exported sources under `supabase/functions/`.
4. Check the new commit and source before enabling any deployment workflow. Editing a file in GitHub currently does not change the live bot.

The other historical Edge Functions remain untouched in Supabase. Database schema, migration SQL, user information, API keys, bot token, webhook secrets and `.env` files are **not** exported by this workflow. This is a source-code import only, not a database backup. Never commit credentials. The two functions currently use `verify_jwt = false` because the Telegram webhook is authenticated by its own secret-token verification; keep that check intact.

Old unrelated repository content is saved on branch [`archive/pre-saeed-ai-import-20260919`](../../tree/archive/pre-saeed-ai-import-20260919).
