/** Per-user AI credentials. Personal keys override the bot-wide provider/key only for that user. */
import type { BotConfig } from "./bot-config.ts";
import type { AiKeys } from "./ai.ts";
import type { Fetcher } from "./telegram.ts";

export type UserAiContext = {
  config: BotConfig;
  keys: AiKeys;
  personal: boolean;
};

type RpcDb = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error?: { code?: string } | null }>;
};

export async function userAiContext(
  db: RpcDb,
  userId: number,
  base: BotConfig,
  serverKeys: AiKeys,
): Promise<UserAiContext> {
  try {
    const { data, error } = await db.rpc("nexa_user_api_get", { p_user_id: userId });
    if (error) {
      console.error("USER_API_READ", error.code || "RPC");
      return { config: base, keys: serverKeys, personal: false };
    }
    const row = Array.isArray(data) ? data[0] : data as { provider?: unknown; api_key?: unknown } | null;
    const provider = row?.provider === "gemini" || row?.provider === "openrouter" ? row.provider : null;
    const key = typeof row?.api_key === "string" ? row.api_key.trim() : "";
    if (!provider || !key) return { config: base, keys: serverKeys, personal: false };

    return {
      config: { ...base, provider },
      keys: provider === "gemini"
        ? { gemini: key, openrouter: "" }
        : { gemini: "", openrouter: key },
      personal: true,
    };
  } catch {
    return { config: base, keys: serverKeys, personal: false };
  }
}

export async function validatePersonalApiKey(
  provider: "gemini" | "openrouter",
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const key = apiKey.trim();
  if (key.length < 12 || key.length > 512 || /\s/.test(key)) return false;
  try {
    const response = provider === "openrouter"
      ? await fetcher("https://openrouter.ai/api/v1/key", {
          method: "GET",
          headers: { Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(10000),
        })
      : await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
          method: "GET",
          headers: { "x-goog-api-key": key },
          signal: AbortSignal.timeout(10000),
        });
    return response.ok;
  } catch {
    return false;
  }
}
