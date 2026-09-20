# Saeed AI · Telegram bot

**Current application release: 9.0.0.** GitHub `main` is the source of truth. Production is Supabase project `zurfsjfulddkjiicegxh`. Edge Function names (`saeed-ai-v7`, `saeed-ai-ui`, `saeed-ai-reminders`) are legacy deployment identifiers, **not** the application version.

## Architecture: modular and checked

The processor and Telegram gateway have both been split into separate, explicit TypeScript modules. The original `index.ts` files now contain webhook entrypoint/orchestration rather than all application logic. Neither entrypoint nor its extracted `core/*.ts` files contains `@ts-nocheck`, `@ts-ignore`, or `@ts-expect-error`.

- `supabase/functions/saeed-ai-v7/index.ts`: processor HTTP handler, authenticated callbacks and request routing. Its `core/` modules separate state, Telegram/UI, transport, administration, media, AI provider, voice, work execution and personal-life tools.
- `supabase/functions/saeed-ai-ui/index.ts`: Telegram gateway HTTP handler. Its `core/` modules separate state, transport, output formatting, configuration, grounded search and conversation processing.
- `supabase/functions/_shared/*.ts`: shared parsers, intent selection, calculations, reminder recurrence, briefing data and life utilities. `saeed-ai-reminders` remains the dedicated scheduled dispatcher.

The legacy per-function `deno.json` configs still use `strict: false`; **this is not a claim of full strict-mode typing**. All files are actually Deno type-checked with the relevant configs, without file-wide typecheck suppression. Gradually enabling stricter compiler options can be a separate, test-driven improvement, not a pretext to disable type checking.

**Edit the TypeScript modules directly.** Do not add feature changes through string-replacement Python scripts. The one-time AST migration, temporary audit workflow and migration workflow were removed after a green refactor and production deployment. Preserve webhook and cron authentication and do not commit credentials or user data.

## Production release contract

`.github/workflows/deploy-supabase.yml` is the canonical production pipeline. It triggers on changes in **any** `supabase/functions/_shared/**` file, both Telegram function directories, the reminder dispatcher, Supabase config and the deployment workflow. Before deployment it checks the TypeScript entrypoints **and every extracted `core/*.ts` module**, the shared modules and reminder dispatcher, rejects typecheck suppressions and inconsistent release versions, validates authentication/capabilities and runs the complete Node test suite. It deploys the processor, reminder dispatcher and then gateway, and checks **live** v9 health/version/capability responses for all three. A green unit test without deployment does not imply Telegram is running the new code.

The deployment secret is the existing GitHub Actions `SUPABASE_DEPLOY_TOKEN`. Both Telegram Edge Functions authenticate the `X-Telegram-Bot-Api-Secret-Token`; cron separately authenticates `X-Saeed-Cron-Secret` using a service-role-only RPC.

**Schema migrations are not automatically applied** by this Edge Functions workflow. The v8 setup includes `20260920090000_saeed_ai_reminders_tasks.sql`, `20260920205000_saeed_ai_v8_preference_states.sql` and `20260920205100_saeed_ai_v8_vault_cron_auth.sql`. The cron migration keeps its secret in Supabase Vault and configures `saeed-ai-reminders-every-minute`.

## v9 functionality currently implemented

- **Natural-language routing:** common requests for timers, reminders, tasks, expenses, shopping and calculations can work without opening a menu; other tools remain available. This does not promise arbitrary future tools execute automatically.
- **Voice:** automatically acts on identifiable requests. Replies to the original audio such as «تایپش کن»، «خلاصه‌ش کن» or «ترجمه‌ش کن» are accepted within the 15-minute retention period; a voice with no identifiable instruction shows options. Gemini is used for audio even if text chat is configured for OpenRouter.
- **Tasks:** new items append rather than replace; per-user completion/deletion via inline buttons.
- **Reminders:** daily, weekly, monthly and every-N-hours recurrence, independent minute-based delivery, complete/snooze/cancel buttons. Telegram timer delivery is not a second-accurate phone alarm and can lag around a minute.
- **Shopping:** deduplicated additions; inline buttons refresh the original message, with a new-list fallback when editing fails. The webhook promptly acknowledges callbacks.
- **Expenses:** one-line registration and seven-day report; explicit currency is required. For example: «ناهار ۴۸۰ هزار تومان».
- **Morning briefing:** opt-in, disabled by default, covering tasks, upcoming reminders, expenses and independently sourced weather/market sections. Weather currently uses Tehran. Rates that are stale or lack reliable timestamp/source are withheld, not invented.
- **UI:** Telegram collapsible reply keyboard, home message «بفرما حاجی چی تو ذهنته 😁» and configurable tone and answer length.

Health version `9.0.0` and capability flags are checked on all three live functions; those flags confirm the code path is deployed, not that an actual Telegram end-to-end interaction succeeded.

## Verification and remaining feature limits

Run `deno check --config supabase/functions/saeed-ai-v7/deno.json supabase/functions/saeed-ai-v7/index.ts supabase/functions/saeed-ai-v7/core/*.ts`, the equivalent check for `saeed-ai-ui`, `deno check supabase/functions/_shared/*.ts`, and `node --experimental-strip-types --test tests/*.test.mjs`; require a green canonical production deployment. Test a real voice, scheduled reminder delivery, shopping tick/undo and opt-in briefing in Telegram before claiming those scenarios are end-to-end verified. Rich all-in-one sentence parsing, user-selected briefing cities, shared shopping lists, calendar/receipt integrations and a dedicated daily dashboard are not implemented yet.

## Recovery

The manually triggered `.github/workflows/import-supabase.yml` imports deployed source back into GitHub. **Do not run it after editing GitHub unless you intend to overwrite repository source.** This repository does not back up Supabase data, secrets, webhook configuration or the database. Unrelated historical content remains on branch `archive/pre-saeed-ai-import-20260919`.
