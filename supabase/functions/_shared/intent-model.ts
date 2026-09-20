import { inferToolIntent, type ToolIntent } from "./tool-intent.ts";
const names = ["chat", "remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas", "expenses", "shopping", "briefing"] as const;
const allowed = new Set<string>(names);
const hint = /(?:یاد|ریم[ای]ندر|فردا|ساعت|دقیقه|امروز|هفته|خبر|قیمت|جست|آنلاین|بگرد|گوگل|گیت|ریپو|مخزن|خلاصه|ترجمه|بازنویسی|محاسبه|حساب|ایمیل|تسک|وظیفه|کارام|کارها|ایده|خرج|هزینه|ناهار|بنزین|خرید|صبح.نامه|remind|tomorrow|search|latest|news|github|summari[sz]e|translate|rewrite|calculate|email|task|expense|shopping|briefing)/iu;
/** Classify only; allowlisted output cannot execute arbitrary tools. Fail closed to chat. */
export async function selectToolIntent(input: string, key: string, model: string): Promise<ToolIntent> {
  const direct = inferToolIntent(input);
  if (direct !== "chat" || !hint.test(input) || !key || !model) return direct;
  const instruction = "Classify the user's CURRENT instruction, not quoted text or examples. chat for general questions or discussion ABOUT capabilities. remind only for actual scheduling requests; missing time must be clarified. tasks only for explicit request to APPEND new tasks, never replace existing tasks. expenses only for explicit recording/reporting of spending, never prices or hypothetical examples. shopping only for an actual shopping list request. briefing only for opting in/out of the morning digest or checking its state. repo only for GitHub repository audit with a valid github.com/owner/repo link. web only when current external information is requested. Other tools only for direct user-requested transformations. Classify; do not claim execution. Return one tool name.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const base = { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: input.slice(0, 4000) }] }], generationConfig: { temperature: 0, maxOutputTokens: 128 } };
  for (const native of [true, false]) {
    try {
      const payload = native ? { ...base, tools: [{ functionDeclarations: [{ name: "select_tool", description: "Select exactly one action category, no execution", parameters: { type: "OBJECT", properties: { tool: { type: "STRING", enum: [...names] } }, required: ["tool"] } }] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["select_tool"] } } } : { ...base, systemInstruction: { parts: [{ text: instruction + ' Return JSON only, e.g. {"tool":"chat"}.' }] }, generationConfig: { ...base.generationConfig, responseMimeType: "application/json" } };
      const response = await fetch(url, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(18000) });
      if (!response.ok) continue;
      const parts = (await response.json()).candidates?.[0]?.content?.parts || [];
      const call = parts.find((part: any) => part.functionCall?.name === "select_tool");
      let tool = call?.functionCall?.args?.tool;
      if (!tool) {
        try { tool = JSON.parse(parts.map((part: any) => part.text || "").join("")).tool; } catch { /* invalid model output */ }
      }
      if (!allowed.has(tool)) continue;
      if (tool === "repo" && !/https:\/\/github\.com\/[\w-]+\/[\w.-]+/i.test(input)) return "chat";
      return tool as ToolIntent;
    } catch { /* Fall back to JSON if native tool calling is unavailable. */ }
  }
  return direct;
}
