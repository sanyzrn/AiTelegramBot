/** Gemini and OpenRouter request adapter: no UI, database or media dependencies. */
import { GK, RK } from "./state.ts";
import { pickSearchModel } from "../../_shared/web-search.ts";

export async function ai(s, contents, system, opts: { search?: boolean } = {}) {
  if (s.provider === "gemini") {
    const useSearch = !!opts.search;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    };
    if (useSearch) {
      body.tools = [{ google_search: {} }];
      body.generationConfig = {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "minimal" },
      };
    }
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(useSearch ? pickSearchModel(s.search || s.gemini) : s.gemini) +
        ":generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": GK, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      },
    );
    if (!r.ok) throw Error("AI_" + r.status);
    const j = await r.json();
    return {
      text: (j.candidates?.[0]?.content?.parts || [])
        .filter((x) => !x.thought)
        .map((x) => x.text || "")
        .join("\n"),
      usage: {
        input: j.usageMetadata?.promptTokenCount,
        output: j.usageMetadata?.candidatesTokenCount,
      },
    };
  }
  if (!RK) throw Error("AI_KEY");
  const messages = [
      { role: "system", content: system },
      ...contents.map((x) => {
        const txt = x.parts
            .filter((a) => a.text)
            .map((a) => a.text)
            .join("\n"),
          med = x.parts.find((a) => a.inlineData);
        return {
          role: x.role === "model" ? "assistant" : "user",
          content: med
            ? [
                { type: "text", text: txt },
                {
                  type: "image_url",
                  image_url: {
                    url:
                      "data:" +
                      med.inlineData.mimeType +
                      ";base64," +
                      med.inlineData.data,
                  },
                },
              ]
            : txt,
        };
      }),
    ],
    r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + RK,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: s.openrouter, messages, max_tokens: 4096 }),
      signal: AbortSignal.timeout(90000),
    });
  if (!r.ok) throw Error("AI_" + r.status);
  const j = await r.json();
  return {
    text: j.choices?.[0]?.message?.content || "",
    usage: {
      input: j.usage?.prompt_tokens,
      output: j.usage?.completion_tokens,
    },
  };
}
