# Saeed AI v9 life core release

This release deploys the version-controlled v9 modules: additive tasks, exact decimal arithmetic, scheduled recurring reminders with private inline controls, natural-language routing for personal utilities, opt-in briefing, expense tracking, shopping lists. Features must be validated through the production deploy workflow and real Telegram end-to-end checks. Morning briefing defaults OFF. Weather, live currency and events are intentionally omitted unless sourced and verified. No existing reminders or tasks are removed by migration.

## v9.2.0 review layer

- Voice tool selection: `chooseVoice` now maps an explicit pending_tool (`transcribe`, `summarize`, `translate`) onto the voice pipeline; the auto-execute flow remains the default.
- Empty task lists omit `reply_markup` instead of sending an empty `inline_keyboard` (Telegram 400).
- Numeric task completion accepts Persian digits and reads the same 30-newest window that `renderTasks` displays.
- Grounded Google Search extracted to `_shared/web-search.ts` and wired into the processor's `web` tool; `cfg()` exposes the configurable `search` model there too.
- `adminInput` fails closed on unknown/stale admin flow actions instead of writing an OpenRouter model id.
- Shopping additions report only genuinely inserted rows; the gateway warns when delivery fails after a successful generation.
- Guarded by `tests/v92.test.mjs`.

## v9.1.0 hotfix layer

- Tasks bulk delete: the gateway now forwards the confirmation button and the `keyboard_page` CHECK constraint accepts `tasks_delete_confirm` (migration `20260921040749`); the flow failed end-to-end before.
- Tools keyboard: every processor-side `pending_tool` (summarize, translate, rewrite, ideas, email, calc and the fun pack) is forwarded by the gateway instead of silently degrading to plain chat.
- Security: `?setup` webhook registration now requires the derived `X-Telegram-Bot-Api-Secret-Token` value.
- Reliability: typing-indicator failures no longer fail or refund a request, refunds log their own failures, failed reminders are swept, consecutive same-role history turns are merged, and the model probe budgets 256 tokens for thinking models.
- Release hygiene: `APP_VERSION` lives in `_shared/version.ts`; deploy workflow greps and live health checks consume `9.1.0`; `tests/gateway-routing.test.mjs` locks the routing invariants.
