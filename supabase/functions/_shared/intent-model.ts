import { inferToolIntent, type ToolIntent } from "./tool-intent.ts";
const names = ["chat", "remind", "tasks", "web", "repo", "summarize", "translate", "rewrite", "calc", "email", "ideas"] as const;
const allowed = new Set<string>(names);
const hint = /(?:یاد|ریم[ای]ندر|فردا|ساعت|دقیقه|امروز|هفته|خبر|قیمت|جست|آنلاین|بگرد|گوگل|گیت|ریپو|مخزن|خلاصه|ترجمه|بازنویسی|محاسبه|حساب|ایمیل|تسک|وظیفه|کارام|کارها|ایده|remind|tomorrow|search|latest|news|github|summari[sz]e|translate|rewrite|calculate|email|task)/iu;

/** Classify intent; never perform side effects. Fail closed to normal chat. */
export async function selectToolIntent(input: string, key: string, model: string): Promise<ToolIntent> {
  const direct = inferToolIntent(input);
  if (direct !== "chat" || !hint.test(input) || !key || !model) return direct;
  const instruction = "Classify the user's CURRENT instruction, not quoted text. Select chat for ordinary discussion or questions ABOUT a tool. Select remind only when the user wants an actual reminder scheduled; the reminder handler can ask for a missing time. Select tasks only if the user explicitly requests creating a NEW task list, which REPLACES their existing open tasks. Select repo only for an audit of a github.com/owner/repo link. Select web for an explicit request for live online information. Select the other tools only for a direct transformation of provided text. Never claim the action was performed. Return exactly one tool name.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const base = { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: input.slice(0, 4000) }] }], generationConfig: { temperature: 0, maxOutputTokens: 128 } };
  for (const native of [true, false]) {
    try {
      const payload = native ? { ...base, tools: [{ functionDeclarations: [{ name: "select_tool", description: "Select the appropriate tool", parameters: { type: "OBJECT", properties: { tool: { type: "STRING", enum: [...names] } }, required: ["tool"] } }] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["select_tool"] } } } : { ...base, systemInstruction: { parts: [{ text: instruction + ' Return JSON only, e.g. {"tool":"chat"}.' }] }, generationConfig: { ...base.generationConfig, responseMimeType: "application/json" } };
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
    } catch { /* Continue with a more widely supported JSON response. */ }
  }
  return direct;
}
