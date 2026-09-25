/** Gateway binding of the shared provider-aware grounded search (see _shared/web-search.ts). */
import { GK, RK } from "./state.ts";
import { groundedSearch as grounded, searchMessage } from "../../_shared/web-search.ts";
import type { BotConfig } from "../../_shared/bot-config.ts";

/** The ACTIVE provider decides the search transport; keys are injected here. */
export function groundedSearch(query: string, system: string, cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter" | "search">) {
  return grounded(query, system, cfg, { gemini: GK, openrouter: RK });
}

export { searchMessage };
