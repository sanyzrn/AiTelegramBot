/** Runtime resolution of a selected bot-owned API credential from Supabase Vault.
 * Users' personal BYOK always takes precedence; this pool serves everyone else.
 */
import { isProvider, type BotConfig } from "./bot-config.ts";
import { normalizeBaseUrl } from "./openai-compat.ts";
import type { AiKeys } from "./ai.ts";

type RpcDb = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown; error?: { code?: string } | null;
  }>;
};

export type BotAiContext = { config: BotConfig; keys: AiKeys };
export async function resolveBotAi(
  db: RpcDb, base: BotConfig, envKeys: AiKeys,
): Promise<BotAiContext> {
  const response = await db.rpc("nexa_admin_api_active");
  if (response.error) {
    // Missing migrations must not make the app silently fall back to someone
    // else's provider/key. Deploy already requires the new schema version.
    throw Error("BOT_API_POOL_READ");
  }
  const row = (Array.isArray(response.data) ? response.data[0] : response.data) as {
    provider?: unknown; model?: unknown; base_url?: unknown; api_key?: unknown;
  } | null;
  if (!row) return { config: base, keys: envKeys }; // explicit legacy Secrets mode
  if (!isProvider(row.provider) || typeof row.api_key !== "string" || !row.api_key.trim() ||
      typeof row.model !== "string" || !row.model.trim()) throw Error("BOT_API_POOL_INVALID");
  if (row.provider === "custom") {
    const baseUrl = normalizeBaseUrl(String(row.base_url || ""));
    if (!baseUrl) throw Error("BOT_API_POOL_INVALID");
    return {
      config: { ...base, provider: "custom", custom: row.model, customBaseUrl: baseUrl },
      keys: { gemini: "", openrouter: "", custom: row.api_key },
    };
  }
  if (row.provider === "gemini") return {
    config: { ...base, provider: "gemini", gemini: row.model },
    keys: { gemini: row.api_key, openrouter: "", custom: "" },
  };
  return {
    config: { ...base, provider: "openrouter", openrouter: row.model },
    keys: { gemini: "", openrouter: row.api_key, custom: "" },
  };
}
