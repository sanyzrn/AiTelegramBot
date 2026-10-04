/** Gateway binding of the shared provider-aware grounded search (see _shared/web-search.ts). */
import { groundedSearch as grounded, searchMessage } from "../../_shared/web-search.ts";
import type { BotConfig } from "../../_shared/bot-config.ts";
import type { AiKeys } from "../../_shared/ai.ts";

/** The ACTIVE provider decides the search transport; the caller supplies that user's keys. */
export function groundedSearch(
  query: string,
  system: string,
  cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter" | "search">,
  keys: AiKeys,
) {
  return grounded(query, system, cfg, keys);
}

export { searchMessage };
