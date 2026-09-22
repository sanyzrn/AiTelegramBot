/** Short conversational context shared by the gateway and the processor. */
export type Turn = { role: "user" | "model"; parts: Array<{ text: string }> };

/**
 * Consecutive same-role turns are merged: failed answers delete the model row
 * and strict OpenAI-compatible providers reject non-alternating roles.
 */
export function mergeTurns(rows: Array<{ role: string; body: string }>): Turn[] {
  const merged: Turn[] = [];
  for (const row of rows) {
    const role = row.role === "model" ? "model" : "user";
    const text = String(row.body || "").slice(0, 3000);
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else merged.push({ role, parts: [{ text }] });
  }
  // A context must never start with an assistant turn for strict providers.
  while (merged[0]?.role === "model") merged.shift();
  return merged;
}

/** Last `limit` rows from the 15-minute privacy window before `beforeId`, oldest first. */
export async function readHistory(
  // deno-lint-ignore no-explicit-any
  db: any,
  id: number,
  chat: number,
  beforeId: number,
  limit = 12,
): Promise<Turn[]> {
  const h = await db
    .from("telegram_chat_messages")
    .select("role,body")
    .eq("telegram_user_id", id)
    .eq("telegram_chat_id", chat)
    .lt("id", beforeId)
    .gte("created_at", new Date(Date.now() - 900000).toISOString())
    .order("id", { ascending: false })
    .limit(limit);
  if (h.error) throw Error("HISTORY");
  return mergeTurns((h.data || []).reverse());
}

/** Pre-existing user turns end with a user message; merge the new prompt into it. */
export function appendUserTurn(history: Turn[], parts: Turn["parts"] | Array<Record<string, unknown>>) {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = history.map((t) => ({
    role: t.role,
    parts: [...t.parts],
  }));
  const last = contents[contents.length - 1];
  if (last && last.role === "user") last.parts.push(...(parts as Array<Record<string, unknown>>));
  else contents.push({ role: "user", parts: [...(parts as Array<Record<string, unknown>>)] });
  return contents;
}
