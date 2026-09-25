/**
 * Grounded web answers shared by the gateway chat path and the processor's
 * web tool. Provider-first: with OpenRouter active the search runs through
 * OpenRouter's web plugin (with citation annotations); Gemini keeps Google
 * Search grounding. Never invent sources; fail loudly on missing ones.
 */
import type { BotConfig } from "./bot-config.ts";
import type { Fetcher } from "./telegram.ts";

export type GroundedResult = {
  text: string;
  usage: { input?: number | null; output?: number | null };
  model: string;
  provider: "gemini" | "openrouter";
};

type Part = { text?: string; thought?: boolean };
type GroundingMetadata = {
  groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  webSearchQueries?: string[];
  searchEntryPoint?: unknown;
};
type GroundedResponse = {
  candidates?: Array<{
    content?: { parts?: Part[] };
    finishReason?: string;
    groundingMetadata?: GroundingMetadata;
  }>;
  groundingMetadata?: GroundingMetadata;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

type Source = { title?: string; uri: string };

/** Search-capable default; flash-lite and custom chat models often lack grounding. */
export const DEFAULT_SEARCH_MODEL = "gemini-3.5-flash";

export function pickSearchModel(configured?: string | null): string {
  const m = (configured || "").trim();
  if (!m) return DEFAULT_SEARCH_MODEL;
  // Lite variants historically reject or skip google_search grounding.
  if (/lite/i.test(m)) return DEFAULT_SEARCH_MODEL;
  return m;
}

export function extractSources(g: GroundingMetadata | undefined): Source[] {
  return [
    ...new Map<string, Source>(
      (g?.groundingChunks || [])
        .filter((x: { web?: { uri?: string; title?: string } }) =>
          /^https:\/\//.test(x.web?.uri || ""))
        .map((x: { web?: { uri?: string; title?: string } }) => [
          x.web!.uri as string,
          { title: x.web?.title, uri: x.web!.uri as string },
        ]),
    ).values(),
  ].slice(0, 5);
}

/** OpenRouter web-plugin citations (message.annotations[].url_citation). */
type UrlCitation = { annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }> };
export function extractAnnotationSources(j: unknown): Source[] {
  const message = (j as { choices?: Array<{ message?: UrlCitation }> })?.choices?.[0]?.message;
  const seen = new Map<string, Source>();
  for (const a of (message?.annotations || [])) {
    const uri = a?.url_citation?.url || "";
    if (/^https:\/\//.test(uri) && !seen.has(uri))
      seen.set(uri, { title: a.url_citation?.title, uri });
  }
  return [...seen.values()].slice(0, 5);
}

export function formatSources(sources: Source[]): string {
  return (
    "\n\n📚 منابع:\n" +
    sources.map((x) => (x.title || "منبع") + "\n" + x.uri).join("\n")
  );
}

async function generateWithSearch(
  query: string,
  system: string,
  model: string,
  key: string,
  bodyExtras: Record<string, unknown>,
): Promise<{ r: Response; j: GroundedResponse }> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                system +
                " Use real Google Search for current facts. Never invent sources.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        ...bodyExtras,
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!r.ok) {
    console.error("SEARCH_API_STATUS", r.status, "MODEL", model);
    throw Error("SEARCH_HTTP_" + r.status);
  }
  return { r, j: await r.json() };
}

async function generateWithOpenRouterWeb(
  query: string,
  system: string,
  model: string,
  key: string,
  fetcher: Fetcher,
): Promise<{ j: unknown; usage: { input?: number | null; output?: number | null }; text: string }> {
  const r = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system + " Use real web search for current facts. Never invent sources." },
        { role: "user", content: query },
      ],
      // OpenRouter's web plugin fetches real pages server-side and returns
      // citation annotations on the message; sources stay verifiable.
      plugins: [{ id: "web", max_results: 5 }],
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    console.error("SEARCH_API_STATUS", r.status, "MODEL", model);
    throw Error("SEARCH_HTTP_" + r.status);
  }
  const j: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } = await r.json();
  const text = typeof j.choices?.[0]?.message?.content === "string" ? j.choices[0].message.content.trim() : "";
  return { j, usage: { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens }, text };
}

/**
 * Grounded answer through the ACTIVE provider. With OpenRouter active this
 * must never touch the Gemini API: the web plugin supplies the sources.
 */
export async function groundedSearch(
  query: string,
  system: string,
  cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter" | "search">,
  keys: { gemini: string; openrouter?: string },
  fetcher: Fetcher = fetch,
): Promise<GroundedResult> {
  if (cfg.provider === "openrouter") {
    if (!keys.openrouter) throw Error("AI_KEY_OPENROUTER");
    const model = String(cfg.openrouter || "").trim().replace(/:online$/, "");
    if (!model) throw Error("SEARCH_EMPTY");
    const { j, usage, text } = await generateWithOpenRouterWeb(query, system, model, keys.openrouter, fetcher);
    if (!text) throw Error("SEARCH_EMPTY");
    const sources = extractAnnotationSources(j);
    if (!sources.length) {
      console.error("SEARCH_NO_GROUNDING", JSON.stringify({ model, provider: "openrouter" }));
      throw Error("SEARCH_NO_SOURCES");
    }
    return { text: text + formatSources(sources), usage, model, provider: "openrouter" };
  }
  if (!keys.gemini) throw Error("AI_KEY_GEMINI");
  const primary = pickSearchModel(cfg.search);
  const candidates = primary === DEFAULT_SEARCH_MODEL
    ? [primary, "gemini-2.5-flash"]
    : [primary, DEFAULT_SEARCH_MODEL, "gemini-2.5-flash"];
  let lastErr: Error = Error("SEARCH_EMPTY");
  for (const modelName of candidates) {
    // Thinking models can burn the whole token budget on thought parts and
    // return an empty visible answer; prefer minimal thinking first.
    const attempts: Array<Record<string, unknown>> = [
      {
        generationConfig: {
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      },
      { generationConfig: { maxOutputTokens: 8192 } },
    ];
    for (const extras of attempts) {
      try {
        const { j } = await generateWithSearch(query, system, modelName, keys.gemini, extras);
        const c = j.candidates?.[0],
          g = c?.groundingMetadata || j.groundingMetadata || {},
          text = (c?.content?.parts || [])
            .filter((x: Part) => !x.thought && typeof x.text === "string")
            .map((x: Part) => x.text as string)
            .join("\n")
            .trim(),
          sources = extractSources(g);
        if (!text) {
          lastErr = Error("SEARCH_EMPTY");
          continue;
        }
        if (!sources.length) {
          console.error(
            "SEARCH_NO_GROUNDING",
            JSON.stringify({
              model: modelName,
              queries: (g.webSearchQueries || []).length,
              hasEntryPoint: !!g.searchEntryPoint,
              finishReason: c?.finishReason,
            }),
          );
          lastErr = Error("SEARCH_NO_SOURCES");
          continue;
        }
        return {
          text: text + formatSources(sources),
          usage: {
            input: j.usageMetadata?.promptTokenCount,
            output: j.usageMetadata?.candidatesTokenCount,
          },
          model: modelName,
          provider: "gemini",
        };
      } catch (e) {
        lastErr = e instanceof Error ? e : Error("SEARCH_EMPTY");
        // Model/tool rejection: try the next attempt or model. Quota/auth: stop.
        if (/SEARCH_HTTP_(401|403|429)/.test(lastErr.message)) throw lastErr;
      }
    }
  }
  throw lastErr;
}

export function searchMessage(reason: string): string {
  if (/SEARCH_HTTP_429/.test(reason))
    return "⏳ سهمیه جست‌وجوی موقتاً پر شده؛ کمی بعد دوباره امتحان کن. ❤️";
  if (/SEARCH_HTTP_403/.test(reason))
    return "🌐 سرویس جست‌وجو دسترسی این API را محدود کرده؛ فعلاً جست‌وجوی آنلاین در دسترس نیست. ❤️";
  if (/SEARCH_HTTP_401/.test(reason))
    return "🌐 کلید سرویس جست‌وجو اعتبارسنجی نشد؛ تنظیمات API باید بررسی بشه. ❤️";
  if (/SEARCH_HTTP_(400|404)/.test(reason))
    return "🌐 مدل جست‌وجو در API پذیرفته نشد؛ نام مدل و دسترسی جست‌وجو باید بررسی بشه. ❤️";
  if (/SEARCH_NO_SOURCES/.test(reason))
    return "🌐 مدل پاسخ داد، اما لینک منبع معتبر برنگردوند. برای اینکه منبع ساختگی ندم، نتیجه رو منتشر نکردم. دوباره با سؤال دقیق‌تر امتحان کن. ❤️";
  if (/SEARCH_EMPTY/.test(reason))
    return "🌐 جست‌وجو اجرا شد ولی پاسخ قابل نمایشی برنگشت؛ دوباره با عبارت کوتاه‌تر امتحان کن. ❤️";
  return "🌐 جست‌وجوی آنلاین فعلاً پاسخ معتبر نداد؛ دوباره امتحان کن. ❤️";
}
