/** Gemini and OpenRouter request adapter bound to this function's keys (see _shared/ai.ts). */
import { keys } from "./state.ts";
import { generate, type Content } from "../../_shared/ai.ts";

/** `opts.search` enables Google Search grounding; sources are appended when the model grounded. */
export function ai(s, contents: Content[], system: string, opts: { search?: boolean; maxTokens?: number } = {}) {
  return generate(s, keys, contents, system, opts);
}
