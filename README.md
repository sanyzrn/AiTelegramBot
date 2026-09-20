# Saeed AI · Telegram bot

**Current application release: 9.0.0.** The GitHub `main` branch is the source of truth. Production uses Supabase project `zurfsjfulddkjiicegxh`. Edge Function names (`saeed-ai-v7`, `saeed-ai-ui`, `saeed-ai-reminders`) are legacy deployment identifiers; they are not the application version.

## Release and deployment contract

**Edit TypeScript source directly, review it and push to `main`.** Do not create new features through Python scripts that string-replace the large legacy entrypoints. The historical `scripts/*` integrations were one-off migrations, not the normal development process. Continue extracting typed modules from the legacy files in small, tested changes; `@ts-nocheck` remains on two entrypoints and is not yet safe to remove without a full typecheck/refactor.

`.github/workflows/deploy-supabase.yml` is the canonical production pipeline. It runs on changes to **any** `supabase/functions/_shared/**` module, all three function directories, the Supabase configuration and the deployment workflow itself. It checks webhook and cron authentication, runs the full Node regression suite and Deno type-checks every shared TypeScript module. It rejects inconsistent release versions, deploys the processor and reminder dispatcher before the Telegram gateway, then fetches the **live** health response from each function and requires the expected version and capabilities. A green unit test alone is **not** a deployment confirmation. Separate historical workflows should not be used for new production feature releases.

The deployment secret is the existing GitHub Actions `SUPABASE_DEPLOY_TOKEN`. Do not commit API credentials, webhook secrets or user data. Both Telegram Edge Functions authenticate `X-Telegram-Bot-Api-Secret-Token`; the cron dispatcher separately authenticates `X-Saeed-Cron-Secret` through its service-role-only verification RPC.

**Database migrations are not applied by the Edge Function deploy job.** Before introducing schema-dependent features, review and apply the needed migrations. The existing v8 setup includes `20260920090000_saeed_ai_reminders_tasks.sql`, `20260920205000_saeed_ai_v8_preference_states.sql` and `20260920205100_saeed_ai_v8_vault_cron_auth.sql`. The cron migration stores a random secret in Supabase Vault and configures the `saeed-ai-reminders-every-minute` job; do not paste it into the repository. Verify delivery with an actual reminder due in a few minutes. Health checks and `claimed: 0` alone cannot prove Telegram delivery.

## v9 functionality currently implemented

- **Natural-language tool routing:** common requests for timers, reminders, tasks, expenses, shopping and calculations work without first opening a menu. Other tools are also available in the tools menu; this is not a promise that arbitrary future tools will execute automatically.
- **Voice:** speech is executed automatically when it contains an identifiable request. Users may reply to the original voice with «تایپش کن»، «خلاصه‌ش کن» or «ترجمه‌ش کن» during the 15-minute retention window. No identifiable request results in a choice menu. Audio processing currently relies on Gemini even when OpenRouter is selected for text chat.
- **Tasks:** new items append rather than replacing existing tasks; the task list supports ownership-scoped completion and deletion using inline buttons.
- **Reminders:** explicit daily, weekly, monthly and every-N-hours recurrence, independent minute-based delivery, plus complete, snooze-ten-minutes and cancel buttons. Timers use the same notification infrastructure and may be delayed by up to roughly a minute, rather than being precise phone alarms.
- **Shopping:** additions are deduplicated; tapping an item's inline button edits the original shopping-list message with the new completion state and updated buttons. If Telegram rejects editing, a fresh list is sent instead. Callbacks are acknowledged promptly at the webhook gateway.
- **Expenses:** one-line registration and seven-day report. Amounts require an explicit currency; e.g. «ناهار ۴۸۰ هزار تومان». An ambiguous number is **not** silently stored.
- **Morning briefing:** opt-in, off by default, with tasks, upcoming reminders, recent expenses and independent weather/market source sections. Weather is currently configured for Tehran. External rates without valid source timestamps or stale rates are withheld rather than invented.
- **UI:** a native collapsible Telegram reply keyboard, concise home greeting «بفرما حاجی چی تو ذهنته 😁», and separately configurable tone and length.

Health release version is `9.0.0` on **all three deployed functions**. Processor flags include `v9_recurring`, `v9_briefings` and `v9_callback_refresh`; gateway flags include `v9_auto_tool_routing` and `v9_callback_fast_ack`; the dispatcher exposes `v9_recurring`, `v9_briefings` and `v9_market_weather`. These flags mean the named code path is present, not that a real Telegram end-to-end test was performed.

## Verification and known limits

Run `node --experimental-strip-types --test tests/*.test.mjs`; Deno-check `supabase/functions/_shared/*.ts`; then confirm the canonical deployment workflow is green and inspect all three live health endpoints. Test one real voice, one timed reminder delivery, a shopping-list tick/undo and an opt-in briefing in Telegram before treating those end-to-end scenarios as verified.

Remaining technical work: refactor and type-check the two oversized `@ts-nocheck` entrypoints without changing behavior. Richer all-in-one sentence parsing, selectable briefing cities, shared shopping lists, calendar/receipt integrations and a full daily dashboard are **not yet implemented**. Keep this README in sync with actual source and deployed behavior.

## Recovery

The manually triggered `.github/workflows/import-supabase.yml` imports deployed function source back into GitHub. **Do not run it after editing GitHub unless you deliberately intend to overwrite repository source with deployed code.** This repo is not a backup of Supabase data, secrets, webhook setup or the database. Historical unrelated project content remains on `archive/pre-saeed-ai-import-20260919`.
