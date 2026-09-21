# Dependency cleanup: completed 2026-09-21

Goal: preserve Saeed AI behavior while removing copied legacy imports and cross-module cycles.

## Resolved cycles

- Previously `saeed-ai-v7/core/transport.ts` imported `keyboard` from `ui.ts`, while `ui.ts` imported `send` from `transport.ts`.
- Previously `ui.ts` imported `listTasks`/`profile` from `life.ts`, while `life.ts` imported presentation constants from `ui.ts`.
- Now the pure `core/menu.ts` defines menu constants, tone guidance, row generation and keyboards with no imports. `transport.ts` and `life.ts` depend on `menu.ts`, not on the UI controller. `ui.ts` retains compatibility re-exports.
- Unused copied imports and redundant `EdgeRuntime` declarations were removed from processor/gateway entrypoints and core modules. Functional handlers were not rewritten.

## Permanent safeguards

- `tests/module-boundaries.test.mjs` detects unused named imports and cycles across all 16 core modules, and asserts the pure menu boundary.
- Canonical deploy Deno-checks all function entrypoints, core modules and shared modules, runs the Node regression suite, deploys three Supabase functions and verifies their live v9 health/capability flags.
- Refactor was merged through PR #1 after passing its CI. The branch-only one-off refactor workflow was removed before merging. No persistent Python source-patching workflow was added.
- Final production deploy: https://github.com/sanyzrn/AiTelegramBot/actions/runs/35557527137 . Supabase CLI is pinned to 2.45.5 to avoid the flaky `latest` release lookup.

## Separate limitations

Per-function TypeScript configuration still uses `strict: false`. Successful Deno checking without `@ts-nocheck` is not a claim of strict type safety; enabling strict is a separate refactor. Live health checks do not replace human Telegram end-to-end interaction tests.
