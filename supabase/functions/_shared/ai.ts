/** Gemini / OpenRouter request adapter shared by gateway, processor and dispatcher. */
import { extractSources, formatSources, pickSearchModel } from "./web-search.ts";
import type { BotConfig } from "./bot-config.ts";
import type { Fetcher } from "./telegram.ts";

export type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
export type Content = { role: string; parts: Part[] };
export type AiKeys = { gemini: string; openrouter?: string };
export type AiResult = {
  text: string;
  usage: { input?: number | null; output?: number | null };
  model: string;
  provider: "gemini" | "openrouter";
  sources: number;
};

/**
 * `search` enables Google Search grounding (Gemini only). When the model
 * actually grounded its answer the verified source links are appended, so
 * live answers are never presented without their provenance.
 */
export async function generate(
  cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter"> & { search?: string },
  keys: AiKeys,
  contents: Content[],
  system: string,
  opts: { search?: boolean; maxTokens?: number; timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<AiResult> {
  const fetcher = opts.fetcher || fetch;
  if (cfg.provider === "gemini") {
    const useSearch = !!opts.search;
    const model = useSearch ? pickSearchModel(cfg.search || cfg.gemini) : cfg.gemini;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxTokens || 8192,
        // Thinking tokens must not swallow the visible answer of grounded calls.
        ...(useSearch ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
      },
    };
    if (useSearch) body.tools = [{ google_search: {} }];
    const r = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": keys.gemini, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs || 90000),
      },
    );
    if (!r.ok) throw Error("AI_" + r.status);
    const j = await r.json();
    const c = j.candidates?.[0];
    let text = (c?.content?.parts || [])
      .filter((x: { thought?: boolean }) => !x.thought)
      .map((x: { text?: string }) => x.text || "")
      .join("\n")
      .trim();
    const sources = useSearch ? extractSources(c?.groundingMetadata || j.groundingMetadata) : [];
    if (text && sources.length) text += formatSources(sources);
    return {
      text,
      usage: { input: j.usageMetadata?.promptTokenCount, output: j.usageMetadata?.candidatesTokenCount },
      model,
      provider: "gemini",
      sources: sources.length,
    };
  }
  if (!keys.openrouter) throw Error("AI_KEY");
  const messages = [
    { role: "system", content: system },
    ...contents.map((x) => {
      const txt = x.parts.filter((a) => a.text).map((a) => a.text).join("\n");
      const med = x.parts.find((a) => a.inlineData);
      return {
        role: x.role === "model" ? "assistant" : "user",
        content: med
          ? [
            { type: "text", text: txt },
            { type: "image_url", image_url: { url: `data:${med.inlineData!.mimeType};base64,${med.inlineData!.data}` } },
          ]
          : txt,
      };
    }),
  ];
  const r = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + keys.openrouter, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.openrouter, messages, max_tokens: Math.min(opts.maxTokens || 4096, 4096) }),
    signal: AbortSignal.timeout(opts.timeoutMs || 90000),
  });
  if (!r.ok) throw Error("AI_" + r.status);
  const j = await r.json();
  return {
    text: typeof j.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "",
    usage: { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens },
    model: cfg.openrouter,
    provider: "openrouter",
    sources: 0,
  };
}

/** Strict-JSON helper for small extraction prompts (reminders, tasks, receipts). */
export function parseJsonObject<T = Record<string, unknown>>(text: string): T | null {
  const m = /\{[\s\S]*\}/.exec(text || "");
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
