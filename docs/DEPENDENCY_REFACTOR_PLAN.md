# Dependency cleanup plan (2026-09-21)

Goal: preserve Saeed AI behavior while removing the copied legacy import headers and the cross-module cycles.

## Current cycles

- `saeed-ai-v7/core/transport.ts` imports `keyboard` from `ui.ts`, while `ui.ts` imports `send` from `transport.ts`.
- `ui.ts` imports `listTasks`/`profile` from `life.ts`, while `life.ts` imports presentation constants from `ui.ts`.

## Intended boundary

- `core/menu.ts` owns only pure menu constants, tone guidance, row generation and keyboard creation. It imports no other local core module.
- `core/transport.ts` imports `keyboard` from `menu.ts`; the Telegram transport must not import the UI controller.
- `core/life.ts` imports presentation constants from `menu.ts`, not `ui.ts`.
- `core/ui.ts` imports and re-exports menu primitives for backwards compatibility; it may depend on life/admin/transport, but these modules must not import it back.
- Each module imports only the bindings referenced by its implementation; irrelevant copied imports and unused `EdgeRuntime` declarations are removed.

## Acceptance checks

- `deno check` for all function entrypoints and all core/shared modules;
- Node regression suite;
- static detection of dead imports and dependency cycles in both core directories, with explicit module-boundary assertions;
- only merge tested changes, then verify production deploy and health endpoints;
- no persistent workflow or Python source patcher and no automatic write access to main.
