/**
 * The "good friend" voice of the morning briefing (صبح‌نامه).
 * Pure module: no db, no Telegram. Facts go in; honest Persian warmth comes out.
 *
 * Two layers:
 *  1. composeMorningVoice() — asks the LLM to write a short energetic intro
 *     using ONLY the verified facts it receives. Any failure → null.
 *  2. fallbackIntro() + dayQuote() — deterministic, always-available intro so
 *     the briefing never falls back to a dry list, even with no AI key at all.
 */
export type MorningWeather = { temp: number; low: number; high: number; rain: number; clothing: string };
export type MorningFacts = {
  dayLabel: string;
  cityLabel?: string | null;
  weather?: MorningWeather | null;
  tasks: string[];
  reminders: { note: string; time: string }[];
  expense?: string | null;
  marketKnown: boolean;
};
export type VoiceConfig = {
  geminiKey?: string;
  openrouterKey?: string;
  geminiModel?: string;
  openrouterModel?: string;
  prefer?: "gemini" | "openrouter";
};
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Original, friendly one-liners — a friend's push, not a framed poster. */
const QUOTES = [
  'امروز فقط کافیه یه قدم برداری؛ همین قدم، بقیه‌ی مسیر رو جلو می‌ندازه. 💪',
  'تو از دیروز قوی‌تری؛ امروز رو به خودت ثابت کن. 🔥',
  'کارهای کوچیکِ امروز، پیروزی‌های بزرگِ فردا هستن. 🌱',
  'انرژی خوبی توی آدمه وقتی یه کار رو تموم می‌کنه؛ امروز دست‌پر برگرد. ✨',
  'امروز می‌تونه شروع قشنگی باشه؛ با یه قدم کوچیک شروعش کن! 🚀',
  'هر روز یه فرصت برای شروع تازه‌ست؛ امروز از همین لحظه شروع کن. ☀️',
  'بهترین سرمایه‌گذاری، یه ساعت تمرکز روی چیزیه که واقعاً برات مهمه. 🎯',
  'سختیِ امروز، افتخارِ فرداست؛ قدم به قدم، قشنگ پیش می‌ری. ⛰️',
  'یه لیست کوتاه و یه تصمیم قاطع، کل روز رو عوض می‌کنه. 📝',
  'شادی هم مهارته؛ امروز تمرینش کن — از همین چای صبح. 😊',
  'رویای تو جای امن‌تر از منطقه‌ی راحتت نیست؛ یه کم جلوتر برو. 🌟',
  'امروز یه لحظه برای چیزای خوبی که داری وقت بذار؛ بعد برو سراغ قدم بعدی. 💚',
  'آروم ولی پیوسته برو؛ آب هم آخرش سنگ می‌بُره. 💧',
  'یه «می‌تونم» کوچیک صبحگاهی، کل روز رو رنگ عوض می‌کنه. 🌈',
  'مقایسه‌ی درست، مقایسه‌ی خودِ امروزتی با خودِ دیروزته. 👣',
];
/** Short warm sign-offs, rotated with the same day-seed as the quote. */
const SIGNOFFS = [
  'یه روز عالی داشته باشی ☀️',
  'بریم که امروز مال ماست! 😄',
  'حواست به خودت باشه، باشه؟ 💛',
  'امیدوارم امروز یه اتفاق خوب بسازی؛ حتی با یه کار کوچیک ✨',
  'هرچی از دستت برمیاد بذار پای امروز؛ من که پایتم 🤝',
  'یه لبخند بزن و برو سراغش! 😎',
];
const hash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
};
/** Stable for a given day string: cron retries must not flip the quote. */
export function dayQuote(seed: string): { quote: string; signoff: string } {
  const h = hash(String(seed || ''));
  return { quote: QUOTES[h % QUOTES.length], signoff: SIGNOFFS[h % SIGNOFFS.length] };
}
const listLines = (items: string[], empty: string): string => (items.length ? items.map((x) => '• ' + x).join('\n') : empty);
/** Deterministic energetic intro + full body, used whenever the AI voice is unavailable. */
export function fallbackIntro(facts: MorningFacts): string {
  const { quote } = dayQuote(facts.dayLabel);
  const city = facts.cityLabel || 'شهرت';
  const parts: string[] = [`صبح بخیر! 😄 امروز ${facts.dayLabel} ـه و یه روز کاملاً نو جلوته!`];
  if (facts.weather) {
    const w = facts.weather;
    const rainLine = w.rain >= 45 && !w.clothing.includes('چتر') ? ' و احتمال بارون هم هست، چتر رو بهش تکیه بده ☔' : '';
    parts.push(`هوای ${city} از ${w.low.toLocaleString('fa-IR')}° تا ${w.high.toLocaleString('fa-IR')}° در جریانه؛ به نظرم می‌رسه ${w.clothing} بهترین انتخابه${rainLine}.`);
  } else {
    parts.push('راستش منبع هوای امروز به دستم نرسید؛ خودت یه نگاه از پنجره بنداز، معمولاً آسمون حرف آخر رو می‌زنه 🌤');
  }
  parts.push(quote);
  return parts.join('\n');
}
/** Deterministic full body: intro + the factual sections, same skeleton as the AI path. */
export function fallbackMorningBody(facts: MorningFacts): string {
  const { signoff } = dayQuote(facts.dayLabel);
  const sections = [
    fallbackIntro(facts),
    '⏰ یادآورهای امروز:\n' + listLines(facts.reminders.map((r) => `${r.note} (${r.time})`), 'برای امروز یادآوری ثبت نشده — خیال راحت.'),
    '✅ کارهای باز:\n' + listLines(facts.tasks, 'لیستت خالیه؛ یا خیلی حرفه‌ای هستی یا خیلی خیال‌باف 😉'),
    facts.expense ? `💰 خرج ۲۴ ساعت گذشته: ${facts.expense}` : '',
    signoff,
  ].filter(Boolean);
  return sections.join('\n\n');
}
const factsBlock = (f: MorningFacts): string => [
  `روز: ${f.dayLabel}`,
  `شهر: ${f.cityLabel || 'نامشخص'}`,
  f.weather
    ? `هوا: الان ${f.weather.temp}°، کمینه ${f.weather.low}°، بیشینه ${f.weather.high}°، احتمال بارش ${f.weather.rain}٪، پیشنهاد لباس: ${f.weather.clothing}`
    : 'هوا: در دسترس نیست',
  `یادآورهای امروز: ${f.reminders.length ? f.reminders.map((r) => `${r.note} (${r.time})`).join(' ، ') : 'هیچ'}`,
  `کارهای باز: ${f.tasks.length ? f.tasks.join(' ، ') : 'هیچ'}`,
  f.expense ? `خرج ۲۴ ساعت گذشته: ${f.expense}` : 'خرج اخیر: ثبت نشده',
].join('\n');
const VOICE_SYSTEM = [
  'تو «سعید» هستی؛ دوست صمیمی، پرانرژی و خودمونیِ کاربر که هر روز صبح بهش پیام صبح‌نامه می‌فرستی.',
  'با کاربر مثل یه رفیق صمیمی حرف بزن: محاوره‌ای، گرم، بامزه ولی نه شلوغ. از «شما» و اداری‌نویسی استفاده نکن.',
  'پیامت فقط یه معرفی کوتاه صبح‌نامه‌ست؛ ۳ تا ۵ جمله، حداکثر ۵۵۰ کاراکتر، فقط متن ساده (بدون مارک‌داون، ستاره، تیتر یا لیست).',
  'از این داده‌های تأییدشده استفاده کن و هیچ عدد یا واقعیت جدیدی از خودت نساز؛ مخصوصاً دما، قیمت و ساعت:',
  '- لحن هوا رو به زبون رفیقانه بگو و از پیشنهاد لباسِ داده‌شده استفاده کن (مثلاً «کت گرم بپوش که سرما نخوری»؛ اسم لباس رو طبیعی بگو، شماره‌ی دما رو تکرار نکن).',
  '- یه جمله انگیزشی کوتاه بگو (خودت بساز، کلیشه‌ای نباشه).',
  '- اگه یادآور یا کاری برای امروز هست، خیلی کوتاه بهش اشاره کن که روزش organized شروع بشه؛ جزئیات رو بعداً خود پیام نشون می‌ده.',
  '- ایموجی‌ها رو بامزه ولی کم مصرف کن (حداکثر ۳ تا).',
  'فقط متن پیام رو برگردون؛ هیچ توضیح اضافه یا نقل‌قول نزن.',
].join('\n');
const clean = (text: string): string | null => {
  const t = String(text || '')
    .replace(/[*_#`]+/g, '')
    .replace(/^\s*(?:خب\s*)?(?:سلام[^\n]*|[این]+م\s*پیام[^\n]*)\n?/u, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Generated prose is not allowed to introduce numerals: numeric facts are rendered below from verified sources.
  if (t.length < 40 || /[0-9۰-۹٠-٩]/u.test(t)) return null;
  if (t.length <= 640) return t;
  const cut = t.slice(0, 640);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return (at > 300 ? cut.slice(0, at) : cut).trim() + '…';
};
async function geminiVoice(cfg: VoiceConfig, prompt: string, fetcher: Fetcher, signal: AbortSignal): Promise<string | null> {
  const r = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel || 'gemini-3.5-flash-lite')}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.geminiKey || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: VOICE_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 320, temperature: 0.9 },
      }),
      signal,
    },
  );
  if (!r.ok) return null;
  const j = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts || [])
    .filter((x: { thought?: boolean }) => !x.thought)
    .map((x: { text?: string }) => x.text || '')
    .join('\n');
  return clean(text);
}
async function openrouterVoice(cfg: VoiceConfig, prompt: string, fetcher: Fetcher, signal: AbortSignal): Promise<string | null> {
  const r = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (cfg.openrouterKey || ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.openrouterModel || 'google/gemma-4-26b-a4b-it:free',
      messages: [{ role: 'system', content: VOICE_SYSTEM }, { role: 'user', content: prompt }],
      max_tokens: 320,
      temperature: 0.9,
    }),
    signal,
  });
  if (!r.ok) return null;
  const j = await r.json();
  return clean(String(j?.choices?.[0]?.message?.content || ''));
}
/**
 * Ask the configured model for a friendly intro, honouring cfg.prefer when both
 * keys exist. Never throws; on any failure the caller falls back. Every attempt
 * shares a 7s deadline across providers to avoid exhausting the cron claim lease.
 */
export async function composeMorningVoice(cfg: VoiceConfig, facts: MorningFacts, fetcher: Fetcher = fetch): Promise<string | null> {
  const prompt = `این داده‌های تأییدشده‌ی امروز کاربره:\n\n${factsBlock(facts)}\n\nحالا یه معرفی صمیمی و پرانرژی برای صبح‌نامه بنویس.`;
  const signal = AbortSignal.timeout(7000); // One deadline for all provider attempts, not 7s each.
  const or = cfg.openrouterKey ? () => openrouterVoice(cfg, prompt, fetcher, signal) : null;
  const gm = cfg.geminiKey ? () => geminiVoice(cfg, prompt, fetcher, signal) : null;
  const attempts: Array<() => Promise<string | null>> = [];
  if (cfg.prefer === "gemini") { if (gm) attempts.push(gm); if (or) attempts.push(or); }
  else { if (or) attempts.push(or); if (gm) attempts.push(gm); }
  try {
    for (const run of attempts) {
      if (signal.aborted) break;
      try {
        const t = await run();
        if (t) return t;
      } catch { /* one provider failing must not block the fallback provider */ }
    }
    return null;
  } catch {
    return null;
  }
}
