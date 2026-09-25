# Saeed AI · Telegram bot

## v10.3.0 provider-first AI architecture

**The Provider/Model selected in the admin settings is now the single authority for every smart feature.** When OpenRouter is active, no hidden request or forced fallback to Gemini happens anywhere — verified by 20 dedicated architecture tests (`tests/provider-first.test.mjs`).

- **All forced-Gemini paths removed.** Previously voice, PDF, receipts, reminder parsing, task extraction and the intent classifier silently switched to Gemini regardless of the active provider. Now chat, vision, OCR, STT, PDF, receipts, summarization and file analysis all run on the ACTIVE provider (`_shared/ai.ts` converts media to the standard multimodal parts: `image_url`, `input_audio`, PDF `file`).
- **Search follows the active provider.** With OpenRouter the «🌐 آنلاین» tool uses OpenRouter's web plugin and reports its citation annotations as sources (unsourced answers are still refused); Gemini keeps Google Search grounding. Chat auto-grounding remains Gemini-only and clearly labelled in the admin panel.
- **Model capabilities are resolved and enforced.** `_shared/capabilities.ts` reads the active model's input modalities (OpenRouter model API, cached; Gemini static knowledge). Tools the active model definitely cannot serve — image, audio, PDF — are refused up front with a precise message naming the model, before the daily quota is touched. The tools page and the admin models page show a Persian capability summary per provider.
- **Runtime graceful failure for uncertain models.** Router models (`openrouter/auto`) or unknown modalities resolve to «unknown»: the request is attempted, and a provider-side 400 is classified into precise Persian messages («مدل فعلی … از ورودی صوتی پشتیبانی نمی‌کنه») instead of a generic error.
- **OpenRouter-only deployments boot.** `ready()` accepts either provider key; a fresh install without an explicit provider row defaults to whichever provider actually has a key configured. Missing-key failures say exactly which key is missing.
- **Voice-out («بخونش») is explicit.** It is the dedicated Gemini TTS engine and stays available only while Gemini is the active provider; otherwise the bot explains precisely why, instead of secretly calling Gemini. The morning-briefing voice follows the same rule.
- **Deterministic operations stay AI-independent.** Recording/reading expenses, tasks, reminders, shopping and memories never call the AI; the AI only interprets free-form input, and success is only reported after the real database write. `failMessage` (`_shared/ai-errors.ts`) now names the active model and the real reason for every failure class.

## v10.2.0 smart expenses and the complete dashboard

**Expense logging is now genuinely conversational** (`_shared/life-expenses.ts`):

- **Several expenses in one message.** «چند تا هزینه ثبت کن حاجی» followed by one expense per line (or comma-separated, or even one spoken run-on sentence) registers every item, answers with a per-item summary, the batch total and a 🗑 delete button per row. Batch saves are idempotent against Telegram redelivery.
- **Spelled-out amounts parse exactly.** «خرید برنج دو میلیون و هشتصد هزار تومان» → ۲٬۸۰۰٬۰۰۰ تومان. The word engine covers compound numbers («هفتصد پنجاه»), «و نیم» half-scales («دو و نیم میلیون»), decimals («۲.۸ میلیون»), «نیم میلیون», rial→toman conversion and Persian/Arabic digits anywhere.
- **Command headers and politeness are understood.** «هزینه‌ها رو ثبت کن», «یه خرج ثبت کنم: …», «ثبت کن: …», plus filler words (حاجی، داداش، لطفاً) — while price questions («قیمت ناهار چقدره؟») still stay questions.
- **Voice expenses are executed for real.** «با ویس بگو هزینه ثبت کن…» transcribes verbatim, then the spoken text is parsed and saved; a permissive retry also catches items without a category word. The old behaviour (intent → «نتونستم تبدیل کنم») is gone.
- **The pending «💸 ثبت خرج» mode.** A bare header arms the mode, so the *next* message is parsed as an expense list no matter what the descriptions start with (migration `20260925120000` adds the state; the «🗂 روزمره» keyboard gained the button).
- **Deterministic routing.** Expense lines and headers are recognized by `isLifeCommand`, so the gateway forwards them to the processor without paying for a model call.

**Mini App dashboard: complete control with a minimal design** (`webapp/index.html` + `saeed-ai-webapp`):

- Six tabs — امروز، خرج‌ها، کارها، یادآور، خرید، بیشتر — in a compact minimal UI (Vazirmatn, theme-aware, haptics, skeletons, toasts).
- Everything the chat can do is now doable from the dashboard: add/edit/tick/delete/clear tasks, add reminders (with a datetime picker, validated), add/delete expenses, a smart quick-add that parses «میوه ۹۰۰ هزار تومان، برنج دو میلیون تومان» client-side, shopping add/tick/delete/clear, family share codes + join + leave, memories add/delete/clear, market/rain watchers, briefing toggles, city and timezone — 20 API actions, all Telegram-signature-scoped.
- 14-day spending chart with tap-for-value, category bars, today-vs-yesterday comparison, grouped expense history.

**Small fixes and tool polish**

- Colloquial suffixed commands now route without the menu: «خلاصه‌اش کن», «ترجمه‌ش کن», «بازنویسی‌ش کن», «کارها رو اضافه کن».
- The spoken-request detector understands «ثبت کن»/«انجام کن» phrasing, so narrated expense/registration voices are never misfiled as plain narration.
- Two webapp bugs fixed: `show()` bypassed the header render (date/greeting stayed empty), and Persian-digit hours produced `NaN` in the greeting logic.

Deploying v10.3.0: no new migration (schema unchanged from `20260925120000`); the deploy workflow checks the schema version before deploying.


**Current application release: 10.3.0.** GitHub `main` is the source of truth. Production is Supabase project `zurfsjfulddkjiicegxh`. Edge Function names (`saeed-ai-v7`, `saeed-ai-ui`, `saeed-ai-reminders`, `saeed-ai-webapp`) are deployment identifiers, **not** the application version. The release version and the required schema version live in `supabase/functions/_shared/version.ts`; every health endpoint reports the release.

## v10.1.0 every tool works without the menu

- **Photos and files pick their own tool.** The caption decides: «این هزینه رو ثبت کن» / «رسید» / «فاکتور» → receipt (confirmed before saving), «متنش رو بنویس» → OCR, «ترجمه کن» → translate, «خلاصه کن» → summary; anything else is analysed. A photo with **no caption** is checked for a receipt first and offered as an expense. A **text reply to an earlier photo or file** («ثبتش کن», «متنش رو بنویس») acts on that file. PDF receipts work too (`_shared/media-intent.ts`).
- **Every keyboard tool also works from typed text:** «رسید رو ثبت کن» (then just send the photo), «یه جوک بگو», «یه داستان کوتاه بنویس», «فال امروزم رو بگو», «یه معما بپرس», «روستم کن», alongside the existing summary/translate/rewrite/email/ideas/reminder/task/expense intents.
- A file-only tool (فایل‌خوان، تحلیل عکس، متن عکس، ثبت رسید) never leaves the bot «waiting»: typed text meanwhile is answered normally.

## v10.0.0 fixes, hardening and life upgrades

The full review that motivated this release is in [`docs/PROJECT_REVIEW.md`](docs/PROJECT_REVIEW.md).

**Bug fixes**
- Compound timers are summed («یک ساعت و نیم» = 90 min, «۱ ساعت و ۳۰ دقیقه», seconds, «یه ربع») and labels use Persian digits.
- The shopping list shows open and newest items first, has 🗑 per item and «🧹 پاک‌کردن خریده‌شده‌ها»; finished tasks are swept by completion time (`done_at`), so «↩️» undo keeps working.
- Processor history merges repeated roles like the gateway; a new request no longer erases another request's retry row.
- A delivered reminder is never re-queued when its acknowledgement fails; a reminder canceled mid-claim is released; «✅ انجام شد» removes the delivery buttons.
- Model answers render Markdown as Telegram HTML (with a plain-text fallback) instead of showing raw `**`/`###`.
- Enabling the briefing no longer writes `telegram_bot_user_access`; the claim RPC skips only explicitly disabled users. Callback queries are answered once.

**Performance, architecture and safety**
- One chat engine for gateway and processor: `_shared/ai.ts`, `history.ts`, `tone.ts` (single system prompt), `bot-config.ts` (30 s cache), `telegram.ts` (429 `retry_after`, one 5xx retry, non-JSON safe), `access.ts`, `menu.ts` and `gateway-route.ts`. The gateway's button/pending-tool routing is derived from the menu, not a hand-kept copy.
- Intent classification has a single 4.5 s deadline and a tighter hint; Google Search in ordinary chat shows its verified sources and can be switched off by the admin («🔎 جست‌وجوی چت»).
- The retention sweep moved from the user request path to the minute dispatcher; market data and forecasts are fetched once per tick.
- `?selftest` requires the webhook secret; a per-minute rate limit (`saeed_ai_rate_hit`) guards the gateway; reminder/task parsing and speech are charged against the daily quota; an optional `GITHUB_TOKEN` lifts the GitHub API limit.
- **All four functions type-check with `strict: true`.**

**New for users**
- 🗂 «روزمره» page, per-user time zones («منطقه زمانی Europe/Berlin», or automatically from «شهر من …»), «یادآورهام» with cancel buttons, briefing hour («صبح‌نامه ساعت ۸»), expense deletion («حذف آخرین خرج» and 🗑 buttons), `/md all` full-conversation export, PDF reading.
- 📅 **Weekly card** («خلاصه هفته», automatic Fridays 20:00 with «خلاصه هفته روشن»).
- 🧾 **Receipt photos** → expense draft, saved only after ✅.
- 👨‍👩‍👧 **Shared shopping list** («اشتراک لیست خرید» → «عضو لیست خرید ۱۲۳۴۵۶»), with notifications when someone buys or adds.
- 🔊 **Voice-out**: reply «بخونش» to any answer (Gemini TTS → MP3 voice); optional voice briefing («صبح‌نامه صوتی روشن»).
- 🔔 **Conditional alerts**: «وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن», «اگه فردا بارون اومد یادم بنداز چتر ببرم» — fired only from verified Navasan/Open-Meteo data.
- 🧠 **Opt-in memory**: «یادت باشه …», «حافظه‌هام» (view/delete), used in every answer.
- 📊 **Mini App dashboard** (`webapp/index.html` + `saeed-ai-webapp`): tasks, reminders timeline, 30-day spending chart, shopping list and briefing settings, authenticated by Telegram-signed `initData`.
- 🎲 Daily riddle with a spoiler answer in the briefing, 🍅 «پومودورو» sessions, and «ترجمه» as a reply to any message.

**Deploying v10:** apply `supabase/migrations/20260922120000_saeed_ai_v10_life_upgrades.sql` first. The deploy workflow now refuses to deploy when the live `saeed_ai_schema_version()` differs from `SCHEMA_VERSION`. To enable the dashboard, host `webapp/index.html` on any HTTPS static host, set `WEBAPP_URL` (see `.env.example`) and call the gateway's `?setup` once.

## v9.4.0 online search actually reaches the live web

- **Live-fact questions route to Google Search.** Phrases like «جستجوی آنلاین»، «سرچ کن»، «قیمت دلار امروز»، «خبرهای امروز» and English “who won the latest…” are classified as `web` instead of falling through to offline chat. Explicit search commands win over «چطور» how-to phrasing.
- **Regular Gemini chat uses the `google_search` tool.** The model can look up current facts mid-conversation instead of answering from training data as if it had no internet. Media/document tools still skip search to save quota.
- **Grounded search is hardened.** Thinking budget is minimized so thought tokens no longer swallow the visible answer (`SEARCH_EMPTY`), `maxOutputTokens` is raised, lite models are swapped for `gemini-3.5-flash`, and unsupported search models fall back to a known-good grounding model before failing. Processor web failures now use the same diagnostic `searchMessage` as the gateway.

## v9.3.1 colloquial city phrasing

- «شهرم رو پاک کن» now clears the city instead of being misread as a city name, and verb-first forms such as «شهرم رو بذار رشت» or «شهر من رو بذار رشت» capture the actual city; a genuine city starting with «را» (like راور) is untouched.
- *(Superseded in v10: `20260917000000_saeed_ai_base_schema.sql` now reproduces the pre-existing base tables and quota RPCs, so a brand-new project can be bootstrapped from `supabase/migrations`.)*

## v9.3.0 city-aware morning briefing

- Select city with «شهر من اصفهان»، «شهرم رشت» or `/city Isfahan`. Open-Meteo geocodes and saves coordinates; the default remains Tehran. Briefing stays opt-in.
- Weather-verified clothing tips, daily motivational notes, and a warm AI introduction with deterministic fallback if providers fail. No fabricated weather or market figures.
- Cron claims at most six recipients per tick and shares a seven-second total AI deadline. Apply the new city migration before deploying.

## v9.2.0 fixes and hardening

- **Voice honors the chosen tool.** Sending a voice after picking «🎙 صوت به متن»، «📝 خلاصه» یا «🌍 ترجمه» from the tools keyboard now runs exactly that operation; previously every voice was forced into the auto-execute flow and the selection was silently ignored.
- **Deleting the last task no longer errors.** Refreshing a task list with zero items sent an empty `inline_keyboard`, which Telegram rejects with HTTP 400; the empty markup is now omitted and the list degrades to a clean «فعلاً خالیه» message.
- **«انجام شد ۳» works.** Numeric task completion now accepts Persian digits and indexes the exact same 30-newest list the inline renderer shows, instead of a different 20-item query that could tick the wrong task.
- **The processor's web tool really searches.** Grounded Google Search moved to `_shared/web-search.ts`; a `web` intent classified inside the processor (for example while replying to a voice) now returns sourced answers instead of memory-based text presented as online results.
- **Admin flows fail closed.** An unknown or stale `pending_action` in `telegram_bot_admin_flow` no longer falls through to the OpenRouter model save; it is reported and dropped.
- **Honest shopping and delivery notices.** Duplicate shopping items are no longer counted as newly added, and the gateway reports a partially failed delivery instead of staying silent after a successful generation.

## v9.1.0 fixes and hardening

- **Tasks bulk delete works again.** The confirmation button was never forwarded by the gateway (missing from `MENUS`) and `tasks_delete_confirm` was rejected by the `keyboard_page` CHECK constraint; both are fixed (migration `20260921040749`) and guarded by `tests/gateway-routing.test.mjs`.
- **Tools keyboard buttons actually route.** Selecting خلاصه، ترجمه، بازنویسی، ایده‌پردازی، ایمیل، ماشین‌حساب or a fun tool now forwards the next message to the processor instead of silently downgrading it to chat.
- **`?setup` requires the derived webhook secret.** Re-registering the webhook now needs the `X-Telegram-Bot-Api-Secret-Token` header equal to `SHA-256("telegram-webhook:" + bot token)`; unauthorized calls get `401`.
- **Transient typing-indicator failures no longer fail or refund a valid request**, failed refunds are logged, and the model connectivity probe no longer misreports thinking models as broken.
- **History turns with repeated roles are merged** for strict OpenAI-compatible providers, and swept reminder cleanup now also removes reminders that exhausted their delivery attempts.

## Architecture

- `supabase/functions/saeed-ai-ui` — Telegram webhook **gateway**: authentication, rate limit, fast-path chat and grounded search; everything else is forwarded to the processor.
- `supabase/functions/saeed-ai-v7` — **processor**: tools, media (image, voice, PDF, Office), receipts, voice-out, admin panel and life commands. `core/` separates state, UI, transport, admin, media, model, voice, work and life.
- `supabase/functions/saeed-ai-reminders` — **minute dispatcher** (pg_cron + Vault secret): reminders, briefings, alerts, weekly cards and the retention sweep. Its logic lives in `_shared/dispatch.ts`.
- `supabase/functions/saeed-ai-webapp` — **Mini App API** for `webapp/index.html`.
- `supabase/functions/_shared/*.ts` — everything the functions share (provider-first AI adapter `ai.ts`, model capability resolver `capabilities.ts`, precise error messages `ai-errors.ts`, chat engine, Telegram transport, menus and routing, life features, parsers, time zones, briefing sources, TTS).

**Provider-first rule (v10.3.0):** the provider/model pair in `telegram_bot_config` is the only authority for AI features. Direct calls to `generativelanguage.googleapis.com` exist only inside the provider transports (`_shared/ai.ts`, `_shared/web-search.ts`, `_shared/tts.ts`, `_shared/morning-voice.ts`, `_shared/intent-model.ts`) and the admin's explicit endpoint test (`core/admin.ts`); `tests/provider-first.test.mjs` fails the build if any other file starts talking to Gemini directly or forces the provider back.

No file contains `@ts-nocheck`, `@ts-ignore` or `@ts-expect-error`, and every function's `deno.json` enables `strict`. **Edit the TypeScript modules directly**; do not add feature changes through string-replacement scripts. Preserve webhook and cron authentication and do not commit credentials or user data.

## Database and migrations

`supabase/migrations` now bootstraps a brand-new project: `20260917000000_saeed_ai_base_schema.sql` reconstructs the pre-Saeed-era tables, quota RPCs and retention cron jobs from production (idempotent, a no-op there). `tests/sql/check-migrations.sh` applies every migration **twice** to an empty PostgreSQL with stand-ins for Supabase-managed objects and runs a behavioural smoke test (quota, rate limit, constraints, briefing claim with invalid zones, reminder claim, schema version); `.github/workflows/migrations-check.yml` runs it on every migration change.

Migrations are still applied manually (for example with the Supabase CLI or dashboard), but the deploy workflow checks the live `saeed_ai_schema_version()` via the Management API and fails fast when the database is behind the code.

## Production release contract

`.github/workflows/deploy-supabase.yml` is the canonical production pipeline. It reads `APP_VERSION`/`SCHEMA_VERSION` from `version.ts` (nothing is hard-coded), type-checks every entrypoint and module, rejects suppressions, runs the complete Node test suite, verifies the live schema version, deploys processor → dispatcher → dashboard API → gateway, and checks the live health/version/capability flags of all four. The deployment secret is the existing `SUPABASE_DEPLOY_TOKEN`. A green unit test without deployment does not imply Telegram is running the new code.

## Core functionality (since v9)

- **Natural-language routing:** common requests for timers, reminders, tasks, expenses, shopping and calculations can work without opening a menu; other tools remain available. This does not promise arbitrary future tools execute automatically.
- **Voice:** automatically acts on identifiable requests. Replies to the original audio such as «تایپش کن»، «خلاصه‌ش کن» or «ترجمه‌ش کن» are accepted within the 15-minute retention period; a voice with no identifiable instruction shows options. Speech-to-text runs on the active provider (a model with audio input is required for voice under OpenRouter).
- **Tasks:** new items append rather than replace; per-user completion/deletion via inline buttons.
- **Reminders:** daily, weekly, monthly and every-N-hours recurrence, independent minute-based delivery, complete/snooze/cancel buttons. Telegram timer delivery is not a second-accurate phone alarm and can lag around a minute.
- **Shopping:** deduplicated additions; inline buttons refresh the original message, with a new-list fallback when editing fails. The webhook promptly acknowledges callbacks.
- **Expenses:** one-line registration and seven-day report; explicit currency is required. For example: «ناهار ۴۸۰ هزار تومان».
- **Morning briefing:** opt-in, disabled by default, covering tasks, upcoming reminders, expenses and independently sourced weather/market sections. Weather defaults to Tehran until the user selects a city. Rates that are stale or lack reliable timestamp/source are withheld, not invented.
- **UI:** Telegram collapsible reply keyboard, home message «بفرما حاجی چی تو ذهنته 😁» and configurable tone and answer length.

Health version and capability flags are checked on all four live functions; those flags confirm the code path is deployed, not that an actual Telegram end-to-end interaction succeeded.

## Verification and remaining feature limits

Run `deno check --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts supabase/functions/<fn>/core/*.ts` for each function, `deno check supabase/functions/_shared/*.ts`, `node --experimental-strip-types --test tests/*.test.mjs` and `tests/sql/check-migrations.sh` against an empty PostgreSQL; require a green canonical production deployment. Behavioural tests use an in-memory Supabase stand-in (`tests/helpers/fake-db.mjs`): `dispatch.test.mjs` (reminders, alerts, weekly card, briefing, sweep), `life-v10.test.mjs`, `webapp.test.mjs` (signed initData) and `v10-core.test.mjs` (Markdown rendering, Telegram retries, history, time zones, access). `tests/gateway-routing.test.mjs` additionally proves every reply-keyboard button is gateway-routable, every `pending_tool` is forwarded, the delete-confirmation page is accepted by the schema and the webhook `?setup` call is authenticated. `tests/v92.test.mjs` locks the empty-task-list markup, honest shopping counts, voice tool selection, admin flow fail-closed guard and the shared grounded search. `tests/v9-intent.test.mjs` locks live-fact and explicit online-search routing. Test a real voice, scheduled reminder delivery, shopping tick/undo and opt-in briefing in Telegram before claiming those scenarios are end-to-end verified. Rich all-in-one sentence parsing and calendar integration are not implemented yet; the Mini App must be hosted on a static HTTPS host of your choice (Supabase Edge Functions do not serve HTML).

## Recovery

The manually triggered `.github/workflows/import-supabase.yml` imports deployed source back into GitHub. **Do not run it after editing GitHub unless you intend to overwrite repository source.** This repository does not back up Supabase data, secrets, webhook configuration or the database. Unrelated historical content remains on branch `archive/pre-saeed-ai-import-20260919`.
