/** Per-user AI credentials. Personal keys override the bot-wide provider/key only for that user. */
import { isProvider, type BotConfig, type Provider } from "./bot-config.ts";
import { chatCompletionsUrl, normalizeBaseUrl } from "./openai-compat.ts";
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
    const row = (Array.isArray(data) ? data[0] : data) as
      { provider?: unknown; api_key?: unknown; base_url?: unknown; model?: unknown } | null;
    const provider = isProvider(row?.provider) ? row!.provider as Provider : null;
    const key = typeof row?.api_key === "string" ? row.api_key.trim() : "";
    if (!provider || !key) return { config: base, keys: serverKeys, personal: false };

    if (provider === "custom") {
      // A personal custom endpoint carries its own URL and model; the bot-wide
      // custom settings are never mixed in (they may point to another account).
      const baseUrl = normalizeBaseUrl(String(row?.base_url || ""));
      const model = String(row?.model || "").trim();
      if (!baseUrl || !model) return { config: base, keys: serverKeys, personal: false };
      return {
        config: { ...base, provider, custom: model, customBaseUrl: baseUrl },
        keys: { gemini: "", openrouter: "", custom: key },
        personal: true,
      };
    }
    return {
      config: { ...base, provider },
      keys: provider === "gemini"
        ? { gemini: key, openrouter: "", custom: "" }
        : { gemini: "", openrouter: key, custom: "" },
      personal: true,
    };
  } catch {
    return { config: base, keys: serverKeys, personal: false };
  }
}

export async function validatePersonalApiKey(
  provider: Provider,
  apiKey: string,
  fetcher: Fetcher = fetch,
  custom?: { baseUrl: string; model: string },
): Promise<boolean> {
  const key = apiKey.trim();
  if (key.length < 12 || key.length > 512 || /\s/.test(key)) return false;
  try {
    let response: Response;
    if (provider === "custom") {
      const baseUrl = normalizeBaseUrl(custom?.baseUrl || "");
      const model = String(custom?.model || "").trim();
      if (!baseUrl || !model) return false;
      // One tiny completion proves the URL, the key AND the model name at once.
      response = await fetcher(chatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 8 }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } else if (provider === "openrouter") {
      response = await fetcher("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: { Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(10000),
      });
    } else {
      response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        method: "GET",
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(10000),
      });
    }
    return response.ok;
  } catch {
    return false;
  }
}
