/**
 * Tool-intent classifier. Provider-first: classification runs on the
 * ACTIVE provider/model, never on a hardcoded second service. When the
 * active provider has no key, classification is skipped (fail closed to
 * the deterministic regex intents) instead of silently calling Gemini.
 */
import { inferToolIntent, type ToolIntent } from "./tool-intent.ts";
import { parseJsonObject } from "./ai.ts";
import type { BotConfig } from "./bot-config.ts";
import type { Fetcher } from "./telegram.ts";

const names = ["chat", "remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas", "expenses", "shopping", "briefing", "receipt", "joke", "story", "horoscope", "trivia", "roast"] as const;
const allowed = new Set<string>(names);
// Only phrases that plausibly name a tool trigger the extra classification call.
const hint = /(?:یاد(?:م|ت|آور)|ریم[ای]ندر|فردا|ساعت|دقیقه|امروز|هفته|خبر|قیمت|نرخ|جست|سرچ|آنلاین|بگرد|گوگل|گیت|ریپو|مخزن|خلاصه|ترجمه|بازنویسی|محاسبه|حساب\s*کن|ایمیل|تسک|وظیفه|کارام|کارها|ایده|خرج|هزینه|ناهار|بنزین|خرید|صبح.نامه|شهر\s*من|شهرم|شهر\s*صبح.نامه|آب\s*و\s*هوا|هوا|طلا|سکه|دلار|یورو|بورس|مسکن|بیت|نتیجه|امتیاز|برنده|رئیس|چه\s*کسی|remind|tomorrow|search|latest|news|price|weather|today|current|who\s+(?:won|is)|github|summari[sz]e|translate|rewrite|calculate|email|task|expense|shopping|briefing|\/city|رسید|فاکتور|جوک|داستان|قصه|فال|طالع|معما|چیستان|روست)/iu;
/** One shared deadline for both attempts: classification must never stall a reply. */
export const CLASSIFY_DEADLINE_MS = 4500;
export const needsClassifier = (input: string) => hint.test(input);

const INSTRUCTION = "Classify the user's CURRENT instruction, not quoted text or examples. chat for general questions or discussion ABOUT capabilities. remind only for actual scheduling requests; missing time must be clarified. tasks only for explicit request to APPEND new tasks, never replace existing tasks. expenses only for explicit recording/reporting of spending, never prices or hypothetical examples. shopping only for an actual shopping list request. briefing only for opting in/out of the morning digest or checking its state. repo only for GitHub repository audit with a valid github.com/owner/repo link. web for current external information: live prices, news, weather, scores, who/what is latest, or any explicit online search request. receipt when the user wants to record a receipt/invoice/bill as an expense. joke, story, horoscope, trivia (riddle) and roast only when the user asks for that entertainment. Other tools only for direct user-requested transformations. Classify; do not claim execution. Return one tool name.";

function finalize(tool: unknown, input: string, direct: ToolIntent): ToolIntent {
  const t = String(tool || "");
  if (!allowed.has(t)) return direct;
  if (t === "repo" && !/https:\/\/github\.com\/[\w-]+\/[\w.-]+/i.test(input)) return "chat";
  return t as ToolIntent;
}

/** Gemini path: native function calling, then strict-JSON on failure. */
async function classifyGemini(input: string, key: string, model: string, deadline: AbortSignal): Promise<ToolIntent> {
  const direct = inferToolIntent(input);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const base = { systemInstruction: { parts: [{ text: INSTRUCTION }] }, contents: [{ role: "user", parts: [{ text: input.slice(0, 4000) }] }], generationConfig: { temperature: 0, maxOutputTokens: 128 } };
  for (const native of [true, false]) {
    if (deadline.aborted) break;
    try {
      const payload = native ? { ...base, tools: [{ functionDeclarations: [{ name: "select_tool", description: "Select exactly one action category, no execution", parameters: { type: "OBJECT", properties: { tool: { type: "STRING", enum: [...names] } }, required: ["tool"] } }] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["select_tool"] } } } : { ...base, systemInstruction: { parts: [{ text: INSTRUCTION + ' Return JSON only, e.g. {"tool":"chat"}.' }] }, generationConfig: { ...base.generationConfig, responseMimeType: "application/json" } };
      const response = await fetch(url, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: deadline });
      if (!response.ok) continue;
      const parts = (await response.json()).candidates?.[0]?.content?.parts || [];
      const call = parts.find((part: any) => part.functionCall?.name === "select_tool");
      let tool: unknown = call?.functionCall?.args?.tool;
      if (!tool) {
        try { tool = JSON.parse(parts.map((part: any) => part.text || "").join("")).tool; } catch { /* invalid model output */ }
      }
      const verdict = finalize(tool, input, direct);
      if (allowed.has(String(tool || ""))) return verdict;
    } catch { /* Fall back to JSON if native tool calling is unavailable. */ }
  }
  return direct;
}

/** OpenRouter path: one strict-JSON chat completion on the active model. */
async function classifyOpenRouter(input: string, key: string, model: string, deadline: AbortSignal, fetcher: Fetcher): Promise<ToolIntent> {
  const direct = inferToolIntent(input);
  try {
    const r = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INSTRUCTION + ' Return JSON only, e.g. {"tool":"chat"}.' },
          { role: "user", content: input.slice(0, 4000) },
        ],
        max_tokens: 48,
        temperature: 0,
      }),
      signal: deadline,
    });
    if (!r.ok) return direct;
    const j = await r.json();
    const tool = parseJsonObject<{ tool?: string }>(String(j.choices?.[0]?.message?.content || ""))?.tool;
    return finalize(tool, input, direct);
  } catch {
    return direct;
  }
}

/** Classify only; allowlisted output cannot execute arbitrary tools. Fail closed to chat. */
export async function selectToolIntent(
  input: string,
  cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter">,
  keys: { gemini: string; openrouter?: string },
  fetcher: Fetcher = fetch,
): Promise<ToolIntent> {
  const direct = inferToolIntent(input);
  if (direct !== "chat" || !hint.test(input)) return direct;
  const isGemini = cfg.provider === "gemini";
  const key = (isGemini ? keys.gemini : keys.openrouter) || "";
  const model = String((isGemini ? cfg.gemini : cfg.openrouter) || "").trim();
  // No key for the ACTIVE provider: no hidden calls to the other provider.
  if (!key || !model) return direct;
  const deadline = AbortSignal.timeout(CLASSIFY_DEADLINE_MS);
  return isGemini
    ? classifyGemini(input, key, model, deadline)
    : classifyOpenRouter(input, key, model, deadline, fetcher);
}
