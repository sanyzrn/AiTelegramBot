/** Google-Search-grounded answers shared by the gateway chat path and the
 * processor's web tool. Never invent sources; fail loudly on missing ones. */
export type GroundedResult = {
  text: string;
  usage: { input?: number | null; output?: number | null };
  model: string;
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

export async function groundedSearch(
  query: string,
  system: string,
  model: string,
  key: string,
): Promise<GroundedResult> {
  const primary = pickSearchModel(model);
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
        const { j } = await generateWithSearch(query, system, modelName, key, extras);
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
    return "⏳ سهمیه جست‌وجوی گوگل موقتاً پر شده؛ کمی بعد دوباره امتحان کن. ❤️";
  if (/SEARCH_HTTP_403/.test(reason))
    return "🌐 گوگل دسترسی جست‌وجوی این API را محدود کرده؛ فعلاً جست‌وجوی آنلاین در دسترس نیست. ❤️";
  if (/SEARCH_HTTP_401/.test(reason))
    return "🌐 کلید سرویس جست‌وجو اعتبارسنجی نشد؛ تنظیمات API باید بررسی بشه. ❤️";
  if (/SEARCH_HTTP_(400|404)/.test(reason))
    return "🌐 مدل جست‌وجو در API پذیرفته نشد؛ نام مدل و دسترسی Grounding باید بررسی بشه. ❤️";
  if (/SEARCH_NO_SOURCES/.test(reason))
    return "🌐 مدل پاسخ داد، اما لینک منبع معتبر برنگردوند. برای اینکه منبع ساختگی ندم، نتیجه رو منتشر نکردم. دوباره با سؤال دقیق‌تر امتحان کن. ❤️";
  if (/SEARCH_EMPTY/.test(reason))
    return "🌐 جست‌وجو اجرا شد ولی پاسخ قابل نمایشی برنگشت؛ دوباره با عبارت کوتاه‌تر امتحان کن. ❤️";
  return "🌐 جست‌وجوی آنلاین فعلاً پاسخ معتبر نداد؛ دوباره امتحان کن. ❤️";
}
