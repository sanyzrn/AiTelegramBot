/**
 * Expense logging: a smart Persian parser (digits, spelled-out amounts such as
 * «دو میلیون و هشتصد هزار تومان», several expenses in one message), a
 * seven-day report with inline delete buttons, undo and batch saving with
 * Telegram-update idempotency.
 */
import { type LifeContext, showView } from "./life-context.ts";
import { faDigits } from "./format.ts";

const digits = (value: string) => value.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".includes(d) ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const money = (n: bigint) => n.toLocaleString("fa-IR") + " تومان";
export const CATEGORY_WORDS = ["ناهار", "شام", "صبحانه", "بنزین", "تاکسی", "اسنپ", "قهوه", "خوراک", "خرید", "قبض", "کرایه", "اجاره", "دارو", "نان", "سوخت", "پارکینگ", "سوپرمارکت", "میوه", "سبزی", "رستوران", "کافه", "فروشگاه", "درمان", "دکتر", "آموزش", "شارژ", "مترو", "اتوبوس", "خدمات", "خودرو", "لباس", "پوشاک", "لوازم", "مصرف", "تلفن", "اینترنت", "بیمه", "حساب", "شارژ ساختمان", "تخلیه", "عوارض", "جریمه", "بلیط", "هتل", "سفر", "هدیه", "کادو", "خیریه", "مسکن", "قسط"];
const isCategoryStart = (description: string) =>
  new RegExp(`^(?:${CATEGORY_WORDS.join("|")})(?:\\s|$)`, "u").test(description + " ");

/* ---------------------------------------------------------------------------
 * Persian number words: «دو میلیون و هشتصد هزار» → 2,800,000
 * ------------------------------------------------------------------------- */
const NUMBER_WORDS: Record<string, number> = {
  صفر: 0, یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9,
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, پونزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
  نیم: 0.5,
};
const SCALES: Record<string, bigint> = { هزار: 1000n, میلیون: 1000000n, میلیارد: 1000000000n };
const CURRENCIES = new Set(["تومان", "تومن", "ریال"]);
// Only leading/trailing punctuation is dropped, so the decimal point inside
// «۲.۸» or the thousands separators inside «1,000,000» survive.
const cleanWord = (w: string) =>
  String(w || "").replace(/[\u200c\u200f\u200e]/g, "").replace(/^[.،؛,!:؟?«»"'\-–]+|[.،؛,!:؟?«»"'\-–]+$/g, "");

/** Evaluate a munched run of Persian number words («دو میلیون و هشتصد هزار») into one number. */
function evaluateNumberWords(run: string[]): number | null {
  let total = 0, current = 0, sawNumber = false, sawAnything = false;
  for (let k = 0; k < run.length; k++) {
    const w = cleanWord(run[k]);
    if (!w || w === "و") continue;
    if (w in SCALES) {
      // «دو میلیون و نیم» / «دو و نیم میلیون» → the extra half-scale
      const next = cleanWord(run[k + 1] || "");
      const next2 = cleanWord(run[k + 2] || "");
      const halfNext = next === "نیم" || (next === "و" && next2 === "نیم");
      total += (current || 1) * Number(SCALES[w]);
      if (halfNext) {
        total += 0.5 * Number(SCALES[w]);
        k += next === "و" ? 2 : 1;
      }
      current = 0;
      sawAnything = true;
    } else if (w in NUMBER_WORDS) {
      current += NUMBER_WORDS[w];
      sawNumber = true;
      sawAnything = true;
    } else return null; // not an amount word: munch should have stopped earlier
  }
  if (!sawAnything || (!sawNumber && total === 0)) return null;
  return total + current;
}

/** Digits with optional decimal («۱٫۵», «2.8») → number, or null. */
function parseDigits(raw: string): number | null {
  const t = digits(raw).replace(/[,٬،\s]/g, "");
  if (!/^\d{1,12}(?:[.٫]\d{1,3})?$/.test(t)) return null;
  const n = Number(t.replace("٫", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type AmountMatch = { value: number; currency: string; consumed: number };

/** Match an amount (digits or spelled words, optional scale) + required currency at word position i. */
function matchAmountAt(words: string[], i: number): AmountMatch | null {
  const at = (k: number) => cleanWord(words[k] || "");
  const word = at(i);
  if (!word) return null;
  // Digit path: «۹۰۰», «۲.۸» + optional scale + required currency (Persian and ASCII digits).
  if (/^[\d۰-۹٠-٩]/.test(word)) {
    const digit = parseDigits(word);
    if (digit === null) return null;
    let consumed = 1, value = digit;
    const scaleNext = at(i + 1);
    if (scaleNext in SCALES) {
      value = digit * Number(SCALES[scaleNext]);
      consumed = 2;
    }
    const currency = at(i + consumed);
    if (CURRENCIES.has(currency)) return { value, currency, consumed: consumed + 1 };
    return null;
  }
  // Word path: munch the longest run of number words, «و» and scales, then a currency.
  if (!(word in NUMBER_WORDS) && !(word in SCALES)) return null;
  const run: string[] = [];
  let j = i;
  while (j < words.length) {
    const w = at(j);
    if (w === "و") {
      // «و» continues the amount only when a number word follows; otherwise it
      // connects two items («میوه ۹۰۰ هزار تومان و نان ۵۰ هزار تومان»).
      const next = at(j + 1);
      if (next in NUMBER_WORDS || next in SCALES) {
        run.push(words[j]);
        j++;
        continue;
      }
      break;
    }
    if (w in NUMBER_WORDS || w in SCALES) {
      run.push(words[j]);
      j++;
    } else break;
  }
  const currency = at(j);
  if (!CURRENCIES.has(currency)) return null;
  const value = evaluateNumberWords(run);
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return { value, currency, consumed: j - i + 1 };
}

/* ---------------------------------------------------------------------------
 * Command headers: «چند تا هزینه ثبت کن حاجی», «هزینه‌ها رو ثبت کن» …
 * ------------------------------------------------------------------------- */
const FILLERS = "(?:حاجی|داداش|داداشی|برادر|آقا|رفیق|مهندس|دکتر|لطفا|لطفاً|ممنون|مرسی|خب|بیا|بفرما|فقط|راستش|الان|هم)";
const EXPENSE_NOUN = "(?:هزینه|خرج)(?:[\\u200c\\s-]*(?:ها|هام|هایم|هایم))?";
/** Header = a registration command at the start of the message (first line). */
const HEADER_PREFIX = new RegExp(
  "^(?:سلام[،,]?\\s*)?" +
    "(?:" +
    "(?:چند|یه|یک)\\s*(?:تا|سری)?\\s*" + EXPENSE_NOUN + "\\s*(?:(?:رو|را)\\s*)?" +
    "|" + EXPENSE_NOUN + "\\s*(?:(?:رو|را)\\s*)?(?:جدید\\s*)?" +
    "|اینارو|این\\s*ها\\s*رو|هم(?:شو|شون|ه)?\\s*رو?" +
    ")" +
    "\\s*(?:ثبت|ذخیره|ضبط|بنویس|بساز|ایجاد|بزن|زدی|بزنیم)\\s*(?:کن|کنم|بفرست|بده|کردم|کنید|بکن)?\\s*" +
    "(?::|：|–\\s*)?" +
    "(?:" + FILLERS + "\\s*)*" +
    "[!،؛,.\\s]*",
  "iu",
);
/** A bare «ثبت کن:» / «ذخیره کن:» data preamble (the colon keeps it unambiguous). */
const BARE_COMMAND = /^(?:ثبت|ذخیره|ضبط|بنویس|بفرست)\s*(?:کن|کنم|بفرست|بده)?\s*[:：]\s*/iu;
/** Questions are never expense registrations (unless an explicit header leads them). */
const QUESTIONY = /[?؟]/u;
const PRICE_QUESTION = /^(?:قیمت|چقدر|هزینه\s*چقدر|چند\s*تومن|چند\s*تومان|آموزش)/iu;

export type ParsedExpense = { description: string; amount: bigint };
export type ExpenseParse = { items: ParsedExpense[]; header: boolean; missingUnit: string[] } | null;

/** Normalize glued digits: «۹۰۰هزارتومان» → « ۹۰۰ هزار تومان ». */
function unglue(text: string): string {
  return text
    .replace(/([\d۰-۹٠-٩][\d۰-۹٠-۹.,٬،٫]*)/gu, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The smart parser.
 * - digits («۹۰۰ هزار تومان») and spelled-out amounts («دو میلیون و هشتصد هزار تومان»)
 * - one expense per line, or several in one line («میوه ۹۰۰ هزار تومان، برنج ۲ میلیون تومان»)
 * - command headers («چند تا هزینه ثبت کن حاجی») and polite filler words
 * - amount-first lines («۹۰۰ هزار تومان خرید میوه»)
 *
 * `permissive` (pending «💸 ثبت خرج» mode, or an explicit command header) accepts
 * any description. Without it every item must start with a known category word,
 * price questions stay questions, and bare number words never mislead.
 */
export function parseExpenses(input: string, opts: { permissive?: boolean } = {}): ExpenseParse {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 4000) return null;
  const hadSlashCommand = /^\/(?:expense|spend)s?\s+/i.test(raw) || /^(?:خرج|هزینه)\s+/iu.test(raw);
  const stripped = raw
    .replace(/^\/(?:expense|spend)s?\s+/i, "")
    .replace(/^(?:خرج|هزینه)\s+/iu, "")
    .trim();
  if (!stripped) return null;
  const lines = stripped.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let header = hadSlashCommand;
  let body = lines.slice();
  const first = lines[0];
  const restOfFirst = first.replace(HEADER_PREFIX, "");
  if (restOfFirst !== first) {
    header = true;
    body = [BARE_COMMAND.test(restOfFirst) ? restOfFirst.replace(BARE_COMMAND, "") : restOfFirst, ...lines.slice(1)];
  } else if (BARE_COMMAND.test(first)) {
    header = true;
    body = [first.replace(BARE_COMMAND, ""), ...lines.slice(1)];
  } else if (lines.length > 1 && HEADER_PREFIX.test(first) && !matchAmountAt(unglue(first).split(" "), 0)) {
    header = true;
    body = lines.slice(1);
  }
  const permissive = opts.permissive === true || header;
  if (!permissive && QUESTIONY.test(raw)) return null;
  if (!permissive && PRICE_QUESTION.test(raw)) return null;

  const items: ParsedExpense[] = [];
  const missingUnit: string[] = [];
  for (const line of body) {
    for (const piece of splitByComma(line)) scanPiece(piece, { permissive, items, missingUnit });
  }
  if (!items.length && !missingUnit.length && !header) return null;
  return { items, header, missingUnit };
}

/** «میوه ۹۰۰ هزار تومان، برنج ۲ میلیون» → two pieces; a lone comma never splits words. */
function splitByComma(line: string): string[] {
  if (!/[،؛,;]/.test(line)) return [line];
  const parts = line.split(/[،؛,;]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [line];
  return parts.every((p) => /[\d۰-۹٠-٩]/u.test(p) || /(?:هزار|میلیون|میلیارد)/u.test(p)) ? parts : [line];
}

function scanPiece(piece: string, out: { permissive: boolean; items: ParsedExpense[]; missingUnit: string[] }) {
  const words = unglue(piece).split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const hasCurrency = words.some((w) => CURRENCIES.has(cleanWord(w)));
  const hasDigits = words.some((w) => /^[\d۰-۹٠-٩]/.test(cleanWord(w)));
  const hasScale = words.some((w) => cleanWord(w) in SCALES);
  const desc: string[] = [];
  let i = 0;
  while (i < words.length) {
    const m = matchAmountAt(words, i);
    if (m) {
      let description = desc.join(" ");
      let consumed = m.consumed;
      if (!description) {
        // Amount-first line: «۹۰۰ هزار تومان خرید میوه».
        const rest: string[] = [];
        let j = i + m.consumed;
        while (j < words.length) {
          if (matchAmountAt(words, j)) break;
          rest.push(words[j]);
          j++;
        }
        description = rest.join(" ");
        consumed = j - i;
      }
      description = description
        .replace(/^(?:و|با|هم|این|اون)\s+/u, "")
        .replace(/\s+/g, " ")
        .replace(/^[«"'\-–]+|[»"'\-–.,!؛]+$/g, "")
        .trim();
      let amount = BigInt(Math.round(m.value));
      if (m.currency === "ریال") {
        if (amount % 10n) return; // rial must convert to a whole toman amount
        amount /= 10n;
      }
      if (amount > 0n && amount < 1000000000000n && description.length >= 2) {
        if (out.permissive || isCategoryStart(description)) out.items.push({ description: description.slice(0, 200), amount });
      }
      desc.length = 0;
      i += consumed;
    } else {
      desc.push(words[i]);
      i++;
    }
  }
  // «ناهار ۴۸۰» — an amount without a unit deserves a hint, not silence.
  // Without a command header the piece must still look like an expense line
  // (category word first), so «یادت باشه فردا ساعت ۸ …» stays a reminder.
  const categoryStart = isCategoryStart(words[0] || "");
  if (!hasCurrency && !out.items.length && !QUESTIONY.test(piece) && !PRICE_QUESTION.test(piece) &&
      ((out.permissive && (hasDigits || hasScale)) || (hasDigits && categoryStart))) {
    out.missingUnit.push(piece.slice(0, 80));
  }
}

/**
 * Backward-compatible single-expense entry point: the old callers and tests keep
 * their exact contract ({description, amount} | "currency_missing" | null).
 */
export function parseExpense(message: string): ParsedExpense | "currency_missing" | null {
  const parse = parseExpenses(message);
  if (!parse) return null;
  if (parse.items.length) return parse.items[0];
  return "currency_missing";
}

/** First word of the description is the category («ناهار با بچه‌ها» → ناهار). */
export const expenseCategory = (description: string) => String(description).trim().split(/\s+/u)[0] || "سایر";

/** True when the text registers (or asks to register) one or more expenses. */
export function isExpenseCommand(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length > 4000) return false;
  if (BARE_COMMAND.test(t)) return true;
  if (HEADER_PREFIX.test(t.split("\n")[0]) && !matchAmountAt(unglue(t.split("\n")[0]).split(" "), 0)) return true;
  const parse = parseExpenses(t);
  return !!parse && parse.items.length > 0;
}

export async function saveExpense(c: LifeContext, id: number, chat: number, expense: ParsedExpense, update: number | null) {
  const { data, error } = await c.db.from("saeed_ai_expenses").upsert({
    telegram_user_id: id, telegram_chat_id: chat, description: expense.description,
    amount_toman: expense.amount.toString(), telegram_update_id: update,
  }, { onConflict: "telegram_update_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw Error("EXPENSE_SAVE");
  return data;
}

/**
 * Batch save. Only the first row carries the Telegram update id (the column is
 * UNIQUE, so synthetic per-item ids could collide with another chat's real
 * update); redelivery is detected by checking whether the update id exists.
 * Returns the inserted count, or null when this update was already saved.
 */
export async function saveExpenses(c: LifeContext, id: number, chat: number, items: ParsedExpense[], update: number | null): Promise<number | null> {
  if (!items.length) return 0;
  if (update !== null && Number.isSafeInteger(update) && update > 0) {
    const { data: seen, error: seenError } = await c.db.from("saeed_ai_expenses").select("id").eq("telegram_update_id", update).limit(1);
    if (seenError) throw Error("EXPENSE_READ");
    if (seen?.length) return null;
  }
  const rows = items.slice(0, 30).map((x, i) => ({
    telegram_user_id: id, telegram_chat_id: chat, description: x.description.slice(0, 200),
    amount_toman: x.amount.toString(), telegram_update_id: i === 0 ? update : null,
  }));
  const { data, error } = await c.db.from("saeed_ai_expenses").insert(rows).select("id");
  if (error) throw Error("EXPENSE_SAVE");
  return data?.length ?? 0;
}

export async function renderExpenses(c: LifeContext, id: number, chat: number, messageId?: number) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await c.db.from("saeed_ai_expenses").select("id,description,amount_toman,created_at")
    .eq("telegram_user_id", id).gte("created_at", from).order("created_at", { ascending: false }).limit(200);
  if (error) throw Error("EXPENSE_READ");
  const all = data || [];
  const total = all.reduce((sum: bigint, x: { amount_toman: string | number }) => sum + BigInt(x.amount_toman), 0n);
  const lines = all.slice(0, 15).map((x: { description: string; amount_toman: string | number }) => `• ${x.description}: ${money(BigInt(x.amount_toman))}`);
  const rows = all.slice(0, 10).map((x: { id: number; description: string }) => [{
    text: `🗑 ${x.description}`.slice(0, 40), callback_data: `exp:delete:${x.id}`,
  }]);
  await showView(c, {
    chat_id: chat,
    text: `💰 هزینه‌های ثبت‌شده ۷ روز گذشته (${all.length}${all.length === 200 ? "+" : ""} مورد)\n${lines.join("\n") || "موردی ثبت نشده."}\nجمع${all.length === 200 ? " ۲۰۰ مورد اخیر" : ""}: ${money(total)}` +
      (rows.length ? "\n\nثبت اشتباهی داشتی؟ از دکمه‌های 🗑 پاکش کن." : ""),
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  }, messageId);
}

export async function deleteLastExpense(c: LifeContext, id: number, chat: number) {
  const { data: last, error } = await c.db.from("saeed_ai_expenses").select("id,description,amount_toman")
    .eq("telegram_user_id", id).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw Error("EXPENSE_READ");
  if (!last) return c.send(chat, "هزینه‌ای برای حذف پیدا نشد.");
  const { error: deleteError } = await c.db.from("saeed_ai_expenses").delete().eq("id", last.id).eq("telegram_user_id", id);
  if (deleteError) throw Error("EXPENSE_DELETE");
  await c.send(chat, `🗑 حذف شد: ${last.description}، ${money(BigInt(last.amount_toman))}.`);
}

export async function expenseCallback(c: LifeContext, id: number, chat: number, key: number, messageId?: number) {
  const { error } = await c.db.from("saeed_ai_expenses").delete().eq("id", key).eq("telegram_user_id", id).select("id");
  if (error) throw Error("EXPENSE_DELETE");
  await renderExpenses(c, id, chat, messageId);
}

/**
 * Record every expense found in a message, with per-item delete buttons and a
 * batch total. A bare «چند خط ثبت کن» header arms the pending «ثبت خرج» mode so
 * the next message is parsed permissively (no category word needed).
 * Returns true when the message was fully handled.
 */
export async function recordExpenses(c: LifeContext, id: number, chat: number, text: string, update: number | null, opts: { permissive?: boolean } = {}): Promise<boolean> {
  const parse = parseExpenses(text, opts);
  if (!parse) return false;
  if (!parse.items.length) {
    if (parse.missingUnit.length) {
      await c.send(chat, "💰 مبلغ رو با واحد مشخص کن؛ مثلاً «ناهار ۴۸۰ هزار تومان».");
      return true;
    }
    if (parse.header) {
      await setPendingExpenses(c, id, true);
      await c.send(
        chat,
        "بفرست حاجی! 💸 هر خط یکی، یا با ویرگول جدا کن؛ مثلاً:\nخرید میوه ۹۰۰ هزار تومان\nخرید برنج دو میلیون و هشتصد هزار تومان\nماهانه اکانت Claude ۶ میلیون تومان\n✍️ همه رو با هم ثبت می‌کنم و جمعش رو می‌گم.",
      );
      return true;
    }
    return false;
  }
  const saved = await saveExpenses(c, id, chat, parse.items, update);
  if (saved === null) {
    await c.send(chat, "ℹ️ این هزینه‌ها قبلاً از همین پیام ثبت شده بودن؛ دوباره اضافه نکردم.");
    return true;
  }
  const total = parse.items.reduce((sum: bigint, x) => sum + x.amount, 0n);
  const single = parse.items.length === 1;
  const body = single
    ? `✅ ثبت شد: ${parse.items[0].description}، ${money(parse.items[0].amount)}.\nاشتباه بود؟ بنویس «حذف آخرین خرج».`
    : `✅ ${faDigits(saved || parse.items.length)} هزینه ثبت شد:\n` +
      parse.items.map((x) => `• ${x.description}: ${money(x.amount)}`).join("\n") +
      `\nجمع: ${money(total)}\nاشتباهی بود؟ با دکمه‌های 🗑 پاکش کن.`;
  // Per-item delete buttons need the fresh row ids.
  let keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (parse.items.length > 1 && saved && saved > 0) {
    try {
      const { data: fresh, error: freshError } = await c.db.from("saeed_ai_expenses").select("id,description")
        .eq("telegram_user_id", id).order("id", { ascending: false }).limit(saved);
      if (!freshError && fresh?.length) {
        keyboard = fresh.map((x: { id: number; description: string }) => [
          { text: `🗑 ${x.description}`.slice(0, 40), callback_data: `exp:delete:${x.id}` },
        ]);
      }
    } catch { /* buttons are optional decoration */ }
  }
  if (parse.missingUnit.length) {
    await c.send(chat, `💰 ${faDigits(parse.missingUnit.length)} خط واحد پول نداشتن و ثبت نشدن؛ مثلاً «ناهار ۴۸۰ هزار تومان».`);
  }
  await setPendingExpenses(c, id, false);
  if (single) {
    await c.send(chat, body);
    return true;
  }
  await showView(c, {
    chat_id: chat,
    text: body,
    ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard.slice(0, 15) } } : {}),
  });
  return true;
}

/** Arm/disarm the pending «💸 ثبت خرج» mode through the context db (best effort). */
export async function setPendingExpenses(c: LifeContext, id: number, on: boolean) {
  try {
    const { error } = await c.db.from("telegram_bot_preferences").upsert(
      { telegram_user_id: id, pending_tool: on ? "expenses" : "chat" },
      { onConflict: "telegram_user_id" },
    );
    if (error) console.error("EXPENSE_PENDING", String(error).slice(0, 60));
  } catch (e) {
    console.error("EXPENSE_PENDING", String(e).slice(0, 60));
  }
}
