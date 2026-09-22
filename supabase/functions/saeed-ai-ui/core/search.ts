/** Gateway binding of the shared grounded search; the Gemini key is injected. */
import { GK } from "./state.ts";
import { groundedSearch as grounded, searchMessage } from "../../_shared/web-search.ts";

export function groundedSearch(query: string, system: string, model: string) {
  return grounded(query, system, model, GK);
}

export { searchMessage };
