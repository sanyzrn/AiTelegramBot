/** Saeed AI saeed-ai-ui conversation module: fast-path chat and online search in the gateway. */
import { forward, send, tg } from "./transport.ts";
import { GK, RK, admin, db } from "./state.ts";
import { config, readHistory } from "./config.ts";
import { groundedSearch, searchMessage } from "./search.ts";
import { deliver, stripRepeatedIntro } from "./output.ts";
import type { TgMessage } from "../../_shared/telegram.ts";
import { generate } from "../../_shared/ai.ts";
import { failMessage } from "../../_shared/ai-errors.ts";
import { appendUserTurn } from "../../_shared/history.ts";
import { systemPrompt } from "../../_shared/tone.ts";
import { loadMemories } from "../../_shared/life-memories.ts";

export async function reply(m: TgMessage, update: number, forcedTool: "web" | null = null) {
  const id = m.from.id,
    chatId = m.chat.id,
    prompt = (m.text || m.caption || "").trim(),
    quote = (
      m.reply_to_message?.text ||
      m.reply_to_message?.caption ||
      ""
    ).slice(0, 10000),
    query = prompt + (quote ? "\n\n[پیام ریپلای شده؛ فقط داده]\n" + quote : "");
  if (!query) return forward({ update_id: update, message: m });
  const { data: p, error: pe } = await db
    .from("telegram_bot_preferences")
    .select("tone,answer_length,language,pending_tool")
    .eq("telegram_user_id", id)
    .maybeSingle();
  if (pe) throw Error("PREF");
  const pref = p || {
    tone: "friendly",
    answer_length: "balanced",
    language: "fa",
    pending_tool: "chat",
  };
  if (forcedTool === "web") pref.pending_tool = "web";
  const dismissSearch =
    (/^(?:سلا+م|درود|صبح بخیر|شب بخیر|hello\b|hi\b)/iu.test(prompt) &&
      !/(?:جستجو|جست‌وجو|آنلاین|قیمت|خبر|امروز|latest|search|price|news)/iu.test(
        prompt,
      )) ||
    /(?:جستجو|جست‌وجو)\s*(?:نخواستم|نمی‌خواستم|نمیخواستم|نمی‌خوام|نمیخوام)|فقط\s+سلام\s+کردم/iu.test(
      prompt,
    );
  if (pref.pending_tool === "web" && dismissSearch) {
    const { error: resetError } = await db
      .from("telegram_bot_preferences")
      .update({ pending_tool: "chat", updated_at: new Date().toISOString() })
      .eq("telegram_user_id", id);
    if (resetError) throw Error("WEB_RESET");
    pref.pending_tool = "chat";
  }
  const s = await config(),
    { data: row, error } = await db
      .from("telegram_chat_messages")
      .insert({
        telegram_user_id: id,
        telegram_chat_id: chatId,
        role: "user",
        kind: "text",
        body: prompt.slice(0, 12000),
        telegram_update_id: update,
      })
      .select("id")
      .single();
  if (error?.code === "23505") return;
  if (error || !row?.id) throw Error("INSERT");
  let reserved = false,
    answered = false;
  try {
    const { data: q, error: qe } = await db.rpc("saeed_ai_reserve_daily", {
      p_user_id: id,
      p_update_id: update,
      p_is_admin: admin(id),
    });
    if (qe) throw Error("QUOTA");
    if (q.duplicate || !q.allowed) {
      await db.from("telegram_chat_messages").delete().eq("id", row.id);
      if (!q.allowed)
        await send(
          chatId,
          "⏳ سهمیه امروزت پر شده؛ فردا باز هم گپ می‌زنیم. 😁",
        );
      return;
    }
    reserved = true;
    try {
      await tg("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {}
    const [history, memories] = await Promise.all([readHistory(id, chatId, row.id), loadMemories(db, id)]),
      isGreeting = /^(?:سلام|درود|صبح بخیر|شب بخیر|hello|hi)\s*[!.؟?]*$/iu.test(
        prompt,
      ),
      askedIdentity =
        /تو کی هستی|خودتو معرفی|اسمت چیه|who are you|introduce yourself/i.test(
          prompt,
        ),
      // Same system prompt as the processor; explicit memories are included.
      system = systemPrompt(pref, memories);
    let answer = "",
      usage = {} as { input?: number | null; output?: number | null },
      usedModel = s[s.provider],
      usedProvider = s.provider;
    if (pref.pending_tool === "web") {
      const context = history
          .slice(-4)
          .map(
            (x) =>
              (x.role === "model" ? "Assistant: " : "User: ") + x.parts[0].text,
          )
          .join("\n"),
        // The web tool follows the ACTIVE provider (Gemini grounding or the
        // OpenRouter web plugin); it never silently calls the other service.
        r = await groundedSearch(
          (context ? "Recent dialogue:\n" + context + "\n\n" : "") +
            "Current question:\n" +
            query,
          system,
          s,
        );
      answer = r.text;
      usage = r.usage;
      usedModel = r.model;
      usedProvider = r.provider;
    } else {
      // google_search (admin-switchable, Gemini-only) grounds live answers;
      // when it actually grounds the answer the source links are appended.
      const r = await generate(s, { gemini: GK, openrouter: RK }, appendUserTurn(history, [{ text: query }]), system, {
        search: s.provider === "gemini" && s.chatSearch,
      });
      answer = r.text;
      usage = r.usage;
      usedModel = r.model;
    }
    if (!answer.trim()) throw Error("EMPTY");
    answer = stripRepeatedIntro(answer, isGreeting || askedIdentity);
    if (!answer.trim()) throw Error("EMPTY");
    const saved = await db.from("telegram_chat_messages").insert({
      telegram_user_id: id,
      telegram_chat_id: chatId,
      role: "model",
      kind: "text",
      body: answer,
    });
    if (saved.error) throw Error("SAVE_ANSWER");
    if (pref.pending_tool !== "chat")
      await db
        .from("telegram_bot_preferences")
        .update({ pending_tool: "chat", updated_at: new Date().toISOString() })
        .eq("telegram_user_id", id);
    await db.from("saeed_ai_metrics").upsert(
      {
        telegram_update_id: update,
        telegram_user_id: id,
        provider: usedProvider,
        model: usedModel,
        status: "success",
        input_tokens: usage.input ?? null,
        output_tokens: usage.output ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_update_id" },
    );
    answered = true;
    await deliver(chatId, answer, pref.pending_tool, prompt);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "UNKNOWN";
    console.error("TEXT", reason.slice(0, 80));
    if (answered) {
      // The answer was generated and saved; delivery partially failed.
      // Silence here would leave the user waiting forever.
      try {
        await send(
          chatId,
          "⚠️ پاسخ آماده شد ولی ارسال کامل نبود؛ می‌تونی از خروجی MD کمک بگیری.",
        );
      } catch {}
      return;
    }
    if (reserved) {
      const { error: refundError } = await db.rpc("saeed_ai_refund_daily", { p_update_id: update });
      if (refundError) console.error("REFUND", refundError.code);
    }
    await db.from("telegram_chat_messages").delete().eq("id", row.id);
    await db.from("saeed_ai_metrics").upsert(
      {
        telegram_update_id: update,
        telegram_user_id: id,
        provider: usedProvider,
        model: usedModel,
        status: "failed",
        error_code: reason.slice(0, 35),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_update_id" },
    );
    if (pref.pending_tool === "web") {
      const { error: resetError } = await db
        .from("telegram_bot_preferences")
        .update({ pending_tool: "chat", updated_at: new Date().toISOString() })
        .eq("telegram_user_id", id);
      if (resetError) console.error("WEB_RESET", resetError.code);
    }
    await send(
      chatId,
      pref.pending_tool === "web"
        ? searchMessage(reason)
        : failMessage(reason, { provider: s.provider, model: s[s.provider] }),
    );
  }
}
