# Saeed AI · Telegram bot

**Source of truth:** This private GitHub repository. Production is Supabase project `zurfsjfulddkjiicegxh`. GitHub Actions deploys both bot functions and the scheduled-reminder dispatcher and verifies their health.

## Production deployment

Edit the source in `supabase/functions/saeed-ai-v7/` (processing) or `supabase/functions/saeed-ai-ui/` (Telegram webhook gateway), review it, then push to `main`. `.github/workflows/deploy-supabase.yml` automatically deploys the processor, the reminder dispatcher, and finally the Telegram gateway; it checks all three production health endpoints. A change to `supabase/config.toml` also triggers deployment. You can run the workflow manually from GitHub Actions. Production's `verify_jwt = false` settings match the existing Telegram webhook integration; **both functions must retain their own `X-Telegram-Bot-Api-Secret-Token` authentication check**.

Deployment requires `SUPABASE_DEPLOY_TOKEN`, a project-scoped GitHub Actions secret with Edge Functions write access. Rotate it before expiry. `SUPABASE_ACCESS_TOKEN` is used only for the separate source import. Never commit tokens, bot secrets or API keys.

## ⚠️ v8.0 upgrade — apply the migration FIRST

Version `8.0.1` adds two new tables and an atomic reminder-claim function. **Before** pushing the functions (or running the deploy workflow), apply the migration:

```bash
supabase db push   # or run supabase/migrations/20260920090000_saeed_ai_reminders_tasks.sql in the SQL editor
```

The deploy workflow checks the required migration files, but it does not apply migrations itself. Apply all v8 migrations before deploying.

### One-time setup for real scheduled reminders (Vault-secured)

Apply the following SQL migrations **before deploying**:

- `20260920090000_saeed_ai_reminders_tasks.sql`: reminder/task tables and atomic claim function.
- `20260920205000_saeed_ai_v8_preference_states.sql`: fixes missing database CHECK values for all new v8 tools and menu pages.
- `20260920205100_saeed_ai_v8_vault_cron_auth.sql`: generates a random 256-bit token inside **Supabase Vault**, grants its verification RPC exclusively to `service_role`, and creates/updates the one-minute pg_cron job with its authenticated request header. No secret value is checked into Git, pasted into SQL, or exposed in logs.

The third migration uses the existing Vault entries `saeed_ai_project_url` and `saeed_ai_publishable_key`. The dispatcher validates the dedicated `X-Saeed-Cron-Secret` header by calling the service-role-only database function. It intentionally does **not** require a duplicate `SAEED_AI_CRON_SECRET` Edge Function environment variable. No additional manual secret setup is needed after the Vault migration.

The pg_cron job name is `saeed-ai-reminders-every-minute`, schedule `* * * * *`. Verify its HTTP response JSON contains `"ok": true`, then test actual delivery with a reminder due in a few minutes. A successful response with `claimed: 0` proves polling but not message delivery. Without this job, reminders will not be delivered.

## Conversation tone modes

In Telegram, choose **⚙️ تنظیمات → 🎭 لحن**. **😄 شوخ‌طبع** has an explicit warm, lively, informal Iranian-Persian personality with jokes and emojis, while staying respectful in sensitive situations and answering requests directly. **🪷 عارفانه** is original Persian prose inspired by seventh-century Hijri mystical literature, without fabricated poetry attributions. The choice is saved per user and applies to both the Telegram gateway chat/search and the processing function's text, media and voice replies.

Production's `telegram_bot_preferences_tone_check` was updated in Supabase migration `20260919154210_saeed_ai_add_mystic_tone` and its exact SQL is tracked in `supabase/migrations/`. Existing tone choices are preserved. Database migrations are **not** automatically run by the Edge Functions-only deployment workflow; review and apply any new migrations before deploying features that depend on them.

## v8.0 feature pack

### 🛠 Practical tools (🧰 ابزارها)
- **⏰ یادآور** — smart reminder: write e.g. «۲۰ دقیقه دیگه قابلمه رو خاموش کن» and Gemini parses the time (Tehran timezone). The scheduled dispatcher delivers it independently of later user interaction. Active reminders are listed when opening the tool.
- **🧮 ماشین‌حساب** — step-by-step math solver; the solution is sent in a copyable block.
- **📧 ایمیل نگارش** — paste your key points, get a complete, polite Persian email (subject + body) in a copyable block.
- **✅ تسک‌ها** — say your tasks in free text, Gemini extracts a clean list. Tick items off with `انجام شد ۱`. Opening the tool shows your open tasks; 🗑 clears the list.
- **📋 پروفایل من** — your tone/length/language settings, today's quota usage, and live counts of reminders/tasks. Also available via `/profile`.

### 🎉 Fun corner (🎉 سرگرمی)
- **🔮 طالع** — a playful, clearly-for-fun daily horoscope (positive vibes only).
- **🧠 تست هوش** — an original riddle; the answer arrives as a hidden Telegram spoiler you tap to reveal.
- **📖 داستان** — an original Persian micro-story with a twist ending; send a theme for a custom one.
- **😂 جوک** — fresh, clean, smart Persian jokes.
- **🔥 روست** — a warm-hearted, obviously-joking roast that always ends with a compliment.

### Fixes & improvements in v8.0
- Retry flow no longer offers a stale "تلاش مجدد" for an older request (stale rows are cleared per new request).
- Webhook secret hash is computed once per isolate instead of on every request.
- Clearer, provider-specific AI failure messages (401/403 key issues, 404 model removed, 429 busy).
- Privacy text now honestly states that messages are auto-purged periodically by the new sweeper.
- An hourly in-request sweeper deletes old chat history, expired voice/retry rows, and old sent reminders/done tasks.
- The task button now opens the existing task list and clear-list controls instead of only switching input mode.
- Scheduled reminders use a separately authenticated dispatcher with atomic leases and retry state.
- The gateway now routes all new menu buttons and reminder/task free-text input to the processing function.
- `[media]`/`[tool]` history labels reflect the tool used, keeping chat context accurate.

## Source import / recovery (normally leave alone)

The manually triggered `.github/workflows/import-supabase.yml` downloads and commits currently deployed `saeed-ai-ui` and `saeed-ai-v7` sources. **Do not run it after editing GitHub source unless you deliberately intend to replace repository copies with the deployed versions.** Normal development flows from GitHub to Supabase, not vice versa.

The other historical Edge Functions remain untouched. User data, secrets, webhook configuration, and `.env` files are **not backed up** by source import. This repository is not a complete database backup. To reproduce the bot elsewhere, database schema, configuration, and privacy-safe data backup need separate review.

The unrelated old repository content is preserved on branch [`archive/pre-saeed-ai-import-20260919`](../../tree/archive/pre-saeed-ai-import-20260919).
