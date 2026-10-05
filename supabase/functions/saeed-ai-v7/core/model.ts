/** Gemini, OpenRouter and custom OpenAI-compatible request adapter bound to this function's keys (see _shared/ai.ts). */
import { generate, type AiKeys, type Content } from "../../_shared/ai.ts";
import type { ProviderCfg } from "../../_shared/bot-config.ts";

/** `opts.search` enables Google Search grounding; sources are appended when the model grounded. */
export function ai(
  s: ProviderCfg,
  keys: AiKeys,
  contents: Content[],
  system: string,
  opts: { search?: boolean; maxTokens?: number } = {},
) {
  return generate(s, keys, contents, system, opts);
}
