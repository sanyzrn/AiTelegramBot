/** Runtime model/provider configuration from telegram_bot_config, cached per isolate. */
import { pickSearchModel } from "./web-search.ts";

export type BotConfig = {
  provider: "gemini" | "openrouter";
  gemini: string;
  openrouter: string;
  search: string;
  daily: number;
  /** Google Search grounding for ordinary chat; admin-switchable, on by default. */
  chatSearch: boolean;
};

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";
const TTL_MS = 30000;
let cache: { at: number; value: BotConfig } | null = null;

export function parseBotConfig(rows: Array<{ setting_key: string; setting_value: string }>): BotConfig {
  const x = new Map(rows.map((v) => [v.setting_key, v.setting_value]));
  const daily = Number(x.get("daily_limit") ?? 40);
  return {
    provider: x.get("provider") === "openrouter" ? "openrouter" : "gemini",
    gemini: x.get("model") || DEFAULT_GEMINI_MODEL,
    openrouter: x.get("openrouter_model") || DEFAULT_OPENROUTER_MODEL,
    search: pickSearchModel(x.get("search_model") || x.get("model")),
    daily: Number.isFinite(daily) ? daily : 40,
    chatSearch: x.get("chat_search") !== "off",
  };
}

/** A 30-second cache removes several config round trips from every request. */
// deno-lint-ignore no-explicit-any
export async function readBotConfig(db: any, now = Date.now()): Promise<BotConfig> {
  if (cache && now - cache.at < TTL_MS) return { ...cache.value };
  const { data, error } = await db.from("telegram_bot_config").select("setting_key,setting_value");
  if (error) throw Error("CONFIG");
  const value = parseBotConfig(data || []);
  cache = { at: now, value };
  return { ...value };
}

export function clearBotConfigCache() {
  cache = null;
}
