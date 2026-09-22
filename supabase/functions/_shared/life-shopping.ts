/** Shopping list: newest and open items first, deletion, and family sharing. */
import { type LifeContext, showView } from "./life-context.ts";
import { faDigits } from "./format.ts";

const MAX_ITEMS = 40;

/** Members of a shared list read and write the owner's rows. */
export async function shoppingOwner(c: LifeContext, id: number): Promise<number> {
  const { data, error } = await c.db.from("saeed_ai_shopping_members").select("owner_user_id").eq("member_user_id", id).maybeSingle();
  if (error) throw Error("SHOP_MEMBER");
  return data?.owner_user_id ? Number(data.owner_user_id) : id;
}

async function members(c: LifeContext, owner: number): Promise<Array<{ member_user_id: number; member_name: string | null }>> {
  const { data, error } = await c.db.from("saeed_ai_shopping_members").select("member_user_id,member_name").eq("owner_user_id", owner);
  if (error) throw Error("SHOP_MEMBERS");
  return data || [];
}

/** Open items first, newest first, so a long list never hides what was just added. */
export async function renderShopping(c: LifeContext, owner: number, chat: number, messageId?: number, shared = false) {
  const { data, error } = await c.db.from("saeed_ai_shopping").select("id,item,done")
    .eq("telegram_user_id", owner).order("done", { ascending: true }).order("id", { ascending: false }).limit(MAX_ITEMS + 1);
  if (error) throw Error("SHOP_READ");
  const items = (data || []).slice(0, MAX_ITEMS);
  // deno-lint-ignore no-explicit-any
  const rows: any[] = items.map((x: { id: number; item: string; done: boolean }) => [
    { text: `${x.done ? "☑️" : "⬜"} ${x.item}`.slice(0, 60), callback_data: `shop:${x.done ? "undo" : "done"}:${x.id}` },
    { text: "🗑", callback_data: `shop:delete:${x.id}` },
  ]);
  if (items.some((x: { done: boolean }) => x.done)) rows.push([{ text: "🧹 پاک‌کردن خریده‌شده‌ها", callback_data: `shop:clear:${owner}` }]);
  const more = (data || []).length > MAX_ITEMS ? `\n… و موارد قدیمی‌تر (فقط ${faDigits(MAX_ITEMS)} مورد اول نمایش داده می‌شه)` : "";
  await showView(c, {
    chat_id: chat,
    text: `🛒 لیست خرید${shared ? " مشترک 👨‍👩‍👧" : ""}:\n` +
      (items.map((x: { item: string; done: boolean }) => `${x.done ? "✅" : "▫️"} ${x.item}`).join("\n") ||
        "خالیه. با «به لیست خرید اضافه کن شیر، نان» شروع کن.") + more,
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  }, messageId);
}

export async function addShopping(c: LifeContext, id: number, chat: number, raw: string) {
  const items = raw.split(/[،,\n]/u).map((x) => x.trim()).filter((x) => x.length && x.length <= 120).slice(0, 20);
  if (!items.length) return c.send(chat, "کالاهای خرید رو با ویرگول جدا کن.");
  const owner = await shoppingOwner(c, id);
  const { data: added, error } = await c.db.from("saeed_ai_shopping")
    .upsert(items.map((item) => ({ telegram_user_id: owner, item })), { onConflict: "telegram_user_id,item", ignoreDuplicates: true }).select("id");
  if (error) throw Error("SHOP_SAVE");
  const newCount = added?.length ?? 0;
  await c.send(chat, newCount
    ? `🛒 ${newCount.toLocaleString("fa-IR")} قلم به لیست خرید اضافه شد. برای دیدنش «لیست خرید» رو بفرست.`
    : "ℹ️ همه این‌ها قبلاً توی لیست خرید بودن؛ چیزی اضافه نکردم.");
  if (newCount) await notify(c, owner, id, `🛒 ${c.actorName || "یکی از اعضا"} به لیست خرید اضافه کرد: ${items.join("، ")}`);
}

export async function listShopping(c: LifeContext, id: number, chat: number) {
  const owner = await shoppingOwner(c, id);
  const shared = owner !== id || (await members(c, owner)).length > 0;
  await renderShopping(c, owner, chat, undefined, shared);
}

export async function removeShopping(c: LifeContext, id: number, chat: number, name: string) {
  const owner = await shoppingOwner(c, id);
  const { data, error } = await c.db.from("saeed_ai_shopping").delete().eq("telegram_user_id", owner).eq("item", name.trim()).select("id");
  if (error) throw Error("SHOP_DELETE");
  await c.send(chat, data?.length ? `🗑 «${name.trim()}» از لیست خرید حذف شد.` : `«${name.trim()}» توی لیست خرید پیدا نشد.`);
}

export async function clearDoneShopping(c: LifeContext, id: number, chat: number, messageId?: number) {
  const owner = await shoppingOwner(c, id);
  const { data, error } = await c.db.from("saeed_ai_shopping").delete().eq("telegram_user_id", owner).eq("done", true).select("id");
  if (error) throw Error("SHOP_CLEAR");
  if (messageId) return renderShopping(c, owner, chat, messageId, owner !== id);
  await c.send(chat, `🧹 ${faDigits(data?.length ?? 0)} قلم خریده‌شده پاک شد.`);
}

/** Inline buttons: tick, undo, delete and clear. Stale buttons never claim success. */
export async function shoppingCallback(c: LifeContext, id: number, chat: number, action: string, key: number, messageId?: number) {
  const owner = await shoppingOwner(c, id);
  if (action === "clear") return clearDoneShopping(c, id, chat, messageId);
  if (action === "delete") {
    const { error } = await c.db.from("saeed_ai_shopping").delete().eq("id", key).eq("telegram_user_id", owner).select("id");
    if (error) throw Error("SHOP_DELETE");
    return renderShopping(c, owner, chat, messageId, owner !== id);
  }
  const desired = action === "done";
  const { data, error } = await c.db.from("saeed_ai_shopping")
    .update({ done: desired, done_at: desired ? new Date().toISOString() : null }).eq("id", key).eq("telegram_user_id", owner)
    .eq("done", !desired).select("id,item");
  if (error) throw Error("SHOP_CALLBACK");
  if (!data?.length) {
    await c.send(chat, "ℹ️ این دکمه قبلاً استفاده شده یا کالا متعلق به تو نیست. لیست خرید رو دوباره باز کن.");
    return;
  }
  await renderShopping(c, owner, chat, messageId, owner !== id);
  if (desired && data[0]?.item) await notify(c, owner, id, `🛒 ${c.actorName || "یکی از اعضا"} «${data[0].item}» رو خرید ✅`);
}

/** Tell everyone else on a shared list; a failed notification never fails the action. */
async function notify(c: LifeContext, owner: number, actor: number, text: string) {
  let list: Array<{ member_user_id: number }> = [];
  try {
    list = await members(c, owner);
  } catch {
    return;
  }
  if (!list.length) return;
  const targets = [owner, ...list.map((m) => Number(m.member_user_id))].filter((u) => u !== actor);
  for (const target of [...new Set(targets)]) {
    try {
      await c.send(target, text);
    } catch (e) {
      console.error("SHOP_NOTIFY", String(e).slice(0, 60));
    }
  }
}

export async function shareShopping(c: LifeContext, id: number, chat: number) {
  if ((await shoppingOwner(c, id)) !== id) return c.send(chat, "تو الان عضو یه لیست مشترکی؛ برای ساختن لیست خودت اول بگو «ترک لیست خرید».");
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const { error } = await c.db.from("saeed_ai_shopping_invites").insert({
    code, owner_user_id: id, expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  if (error) throw Error("SHOP_INVITE");
  await c.send(chat, `👨‍👩‍👧 کد دعوت لیست خرید: ${faDigits(code)}\nهر کدوم از اعضای خانواده (که به ربات دسترسی دارن) بنویسه «عضو لیست خرید ${code}».\nکد تا ۲۴ ساعت معتبره. وقتی کسی چیزی رو بخره یا اضافه کنه، بقیه خبردار می‌شن.`);
}

export async function joinShopping(c: LifeContext, id: number, chat: number, code: string) {
  const { data: invite, error } = await c.db.from("saeed_ai_shopping_invites").select("owner_user_id,expires_at").eq("code", code).maybeSingle();
  if (error) throw Error("SHOP_JOIN_READ");
  if (!invite || Date.parse(invite.expires_at) < Date.now()) return c.send(chat, "⌛ این کد دعوت معتبر نیست یا منقضی شده؛ از صاحب لیست یه کد تازه بگیر.");
  const owner = Number(invite.owner_user_id);
  if (owner === id) return c.send(chat, "این کد لیست خودته 😄 به بقیه بدش.");
  const { data: own } = await c.db.from("saeed_ai_shopping_members").select("member_user_id").eq("owner_user_id", id).limit(1);
  if (own?.length) return c.send(chat, "تو خودت صاحب یه لیست مشترکی؛ اول با «ترک لیست خرید» اشتراکش رو لغو کن.");
  const { error: saveError } = await c.db.from("saeed_ai_shopping_members").upsert({
    member_user_id: id, owner_user_id: owner, member_name: (c.actorName || "").slice(0, 60) || null,
  }, { onConflict: "member_user_id" });
  if (saveError) throw Error("SHOP_JOIN");
  await c.send(chat, "✅ به لیست خرید مشترک پیوستی! از این به بعد «لیست خرید» همون لیست خانواده‌ست. (لیست قبلی خودت دست‌نخورده می‌مونه.)");
  await notify(c, owner, id, `👋 ${c.actorName || "یه عضو جدید"} به لیست خرید مشترک پیوست.`);
}

export async function leaveShopping(c: LifeContext, id: number, chat: number) {
  const { data, error } = await c.db.from("saeed_ai_shopping_members").delete().eq("member_user_id", id).select("owner_user_id");
  if (error) throw Error("SHOP_LEAVE");
  if (data?.length) return c.send(chat, "👋 از لیست مشترک خارج شدی؛ «لیست خرید» دوباره لیست خودته.");
  const { data: dropped, error: ownerError } = await c.db.from("saeed_ai_shopping_members").delete().eq("owner_user_id", id).select("member_user_id");
  if (ownerError) throw Error("SHOP_UNSHARE");
  await c.send(chat, dropped?.length ? "🔒 اشتراک لیست خریدت لغو شد و اعضا جدا شدند." : "لیست خریدت با کسی مشترک نبود.");
}
