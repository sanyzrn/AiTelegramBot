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

export async function groundedSearch(
  query: string,
  system: string,
  model: string,
  key: string,
): Promise<GroundedResult> {
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
        generationConfig: { maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!r.ok) {
    console.error("SEARCH_API_STATUS", r.status, "MODEL", model);
    throw Error("SEARCH_HTTP_" + r.status);
  }
  const j: GroundedResponse = await r.json(),
    c = j.candidates?.[0],
    g = c?.groundingMetadata || {},
    text = (c?.content?.parts || [])
      .filter((x: Part) => !x.thought && typeof x.text === "string")
      .map((x: Part) => x.text as string)
      .join("\n")
      .trim(),
    sources: Source[] = [
      ...new Map<string, Source>(
        (g.groundingChunks || [])
          .filter((x: { web?: { uri?: string; title?: string } }) =>
            /^https:\/\//.test(x.web?.uri || ""))
          .map((x: { web?: { uri?: string; title?: string } }) => [
            x.web!.uri as string,
            { title: x.web?.title, uri: x.web!.uri as string },
          ]),
      ).values(),
    ].slice(0, 5);
  if (!text) throw Error("SEARCH_EMPTY");
  if (!sources.length) {
    console.error(
      "SEARCH_NO_GROUNDING",
      JSON.stringify({
        model,
        queries: (g.webSearchQueries || []).length,
        hasEntryPoint: !!g.searchEntryPoint,
        finishReason: c?.finishReason,
      }),
    );
    throw Error("SEARCH_NO_SOURCES");
  }
  return {
    text:
      text +
      "\n\n📚 منابع:\n" +
      sources.map((x) => (x.title || "منبع") + "\n" + x.uri).join("\n"),
    usage: {
      input: j.usageMetadata?.promptTokenCount,
      output: j.usageMetadata?.candidatesTokenCount,
    },
    model,
  };
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
  return "🌐 جست‌وجوی آنلاین فعلاً پاسخ معتبر نداد؛ دوباره امتحان کن. ❤️";
}
