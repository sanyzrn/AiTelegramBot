/** Saeed AI saeed-ai-ui config module: shared menus, runtime config and conversation history. */
import { GK, db } from "./state.ts";
import { readBotConfig } from "../../_shared/bot-config.ts";
import { readHistory as sharedHistory } from "../../_shared/history.ts";

/** Every reply-keyboard button, derived from the processor's menu definitions. */
export { MENUS, FORWARD_TOOLS } from "../../_shared/gateway-route.ts";
export { toneGuide } from "../../_shared/tone.ts";

export function config() {
  // Fresh installs default to the provider whose key is actually configured.
  return readBotConfig(db, Date.now(), { preferProvider: GK ? "gemini" : "openrouter" });
}

/** Merged-role history (strict providers reject repeated roles). */
export function readHistory(id: number, chat: number, row: number) {
  return sharedHistory(db, id, chat, row, 12);
}
