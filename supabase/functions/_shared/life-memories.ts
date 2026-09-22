/** Opt-in long-term memory: only facts the user explicitly asks the bot to remember. */
import { type LifeContext, showView } from "./life-context.ts";
import { faDigits } from "./format.ts";

export const MAX_MEMORIES = 30;

/** «یادت باشه فردا ساعت ۸…» is a reminder, not a memory. */
export const looksTimed = (fact: string) =>
  /(?:ساعت\s*[0-9۰-۹]|فردا|پس[‌\s-]*فردا|امشب|دقیقه\s*(?:دیگه|بعد)|ساعت\s*دیگه|هفته\s*(?:بعد|دیگه)|\bat\s+\d|tomorrow|tonight)/iu.test(fact);

export function cleanFact(raw: string): string | null {
  const fact = String(raw || "").replace(/\s+/g, " ").replace(/^[«"']+|[»"'.!؛]+$/g, "").trim();
  if (fact.length < 3 || fact.length > 300) return null;
  return fact;
}

export async function loadMemories(
  // deno-lint-ignore no-explicit-any
  db: any,
  id: number,
): Promise<string[]> {
  try {
    const { data, error } = await db.from("saeed_ai_memories").select("fact").eq("telegram_user_id", id).order("id").limit(MAX_MEMORIES);
    if (error) return [];
    return (data || []).map((x: { fact: string }) => String(x.fact));
  } catch {
    return [];
  }
}

export async function addMemory(c: LifeContext, id: number, chat: number, raw: string): Promise<boolean> {
  if (looksTimed(raw)) return false;
  const fact = cleanFact(raw);
  if (!fact) {
    await c.send(chat, "🧠 چیزی که باید یادم بمونه رو کامل‌تر بگو؛ مثلاً «یادت باشه من گیاه‌خوارم».");
    return true;
  }
  const { count, error: countError } = await c.db.from("saeed_ai_memories").select("id", { count: "exact", head: true }).eq("telegram_user_id", id);
  if (countError) throw Error("MEMORY_COUNT");
  if ((count ?? 0) >= MAX_MEMORIES) {
    await c.send(chat, `🧠 حافظه‌ت پره (حداکثر ${faDigits(MAX_MEMORIES)} مورد). با «حافظه‌هام» چند تا رو پاک کن.`);
    return true;
  }
  const { data, error } = await c.db.from("saeed_ai_memories").upsert({ telegram_user_id: id, fact }, { onConflict: "telegram_user_id,fact", ignoreDuplicates: true }).select("id");
  if (error) throw Error("MEMORY_SAVE");
  await c.send(chat, data?.length
    ? `🧠 باشه، یادم می‌مونه: «${fact}»\nهر وقت خواستی با «حافظه‌هام» ببین یا پاکش کن.`
    : "🧠 اینو از قبل می‌دونستم 😉");
  return true;
}

export async function renderMemories(c: LifeContext, id: number, chat: number, messageId?: number) {
  const { data, error } = await c.db.from("saeed_ai_memories").select("id,fact").eq("telegram_user_id", id).order("id").limit(MAX_MEMORIES);
  if (error) throw Error("MEMORY_READ");
  const items = data || [];
  const rows = items.map((x: { id: number; fact: string }) => [{ text: `🗑 ${x.fact}`.slice(0, 40), callback_data: `mem:delete:${x.id}` }]);
  if (items.length) rows.push([{ text: "🧹 پاک‌کردن همه", callback_data: "mem:clear:0" }]);
  await showView(c, {
    chat_id: chat,
    text: items.length
      ? "🧠 چیزهایی که خواستی یادم بمونه:\n" + items.map((x: { fact: string }) => `▫️ ${x.fact}`).join("\n") +
        "\n\nفقط وقتی خودت بگی «یادت باشه …» چیزی اینجا ذخیره می‌شه."
      : "🧠 هنوز چیزی ازت یادم نیست. بگو «یادت باشه من قهوه بدون شکر دوست دارم» تا توی جواب‌هام در نظرش بگیرم.",
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  }, messageId);
}

export async function clearMemories(c: LifeContext, id: number, chat: number, messageId?: number) {
  const { error } = await c.db.from("saeed_ai_memories").delete().eq("telegram_user_id", id);
  if (error) throw Error("MEMORY_CLEAR");
  if (messageId) return renderMemories(c, id, chat, messageId);
  await c.send(chat, "🧹 همه‌ی حافظه‌های بلندمدتت پاک شد.");
}

export async function memoryCallback(c: LifeContext, id: number, chat: number, action: string, key: number, messageId?: number) {
  if (action === "clear") return clearMemories(c, id, chat, messageId);
  const { error } = await c.db.from("saeed_ai_memories").delete().eq("id", key).eq("telegram_user_id", id);
  if (error) throw Error("MEMORY_DELETE");
  await renderMemories(c, id, chat, messageId);
}
