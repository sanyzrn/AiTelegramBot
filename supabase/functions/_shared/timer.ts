/* Pure parser: never creates a timer or claims one was created. */
export type TimerRequest = { minutes: number; note: string };
const numbers: Record<string, number> = {
  یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7,
  هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13,
  چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18,
  نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50,
  شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90, صد: 100,
  نیم: 0.5,
};
export function normalizeTimerDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => String(
    "۰۱۲۳۴۵۶۷۸۹".includes(d) ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d),
  ));
}
function count(raw: string): number | null {
  if (/^\d{1,4}$/.test(raw)) return Number(raw);
  const words = raw.trim().split(/\s+و\s+/u);
  if (words.length === 1) return numbers[words[0]] ?? null;
  if (words.length === 2 && (numbers[words[0]] ?? 0) >= 20 &&
      (numbers[words[0]] ?? 0) % 10 === 0 &&
      (numbers[words[1]] ?? 0) > 0 && (numbers[words[1]] ?? 0) < 10) {
    return numbers[words[0]] + numbers[words[1]];
  }
  return null;
}
/** Only explicit timer-setting instructions with an unambiguous duration are accepted. */
export function parseTimerRequest(input: string): TimerRequest | null {
  const text = normalizeTimerDigits(input.normalize("NFKC")).trim();
  if (!/(?:تایمر|زمان[‌\s-]*سنج|timer)/iu.test(text)) return null;
  if (/(?:چطور|چگونه|چرا|آموزش|کار\s*نمی[‌\s]*کن|تنظیم\s*شد|how\s+to|doesn.t\s+work|\?|؟)/iu.test(text)) return null;
  if (!/(?:بذار|بگذار|بزن|بگیر|تنظیم\s*کن|ست\s*کن|شروع\s*کن|راه\s*بنداز|set|start)/iu.test(text) &&
      !/^(?:یه\s+|یک\s+)?(?:تایمر|timer)\b?/iu.test(text)) return null;
  const match = /([0-9]{1,4}|[آ-ی]+(?:\s+و\s+[آ-ی]+)?)\s*(دقیقه|ساعت|minutes?|hours?)/iu.exec(text);
  if (!match) return null;
  const qty = count(match[1]);
  if (qty === null) return null;
  const minutes = /^(?:ساعت|hours?)$/iu.test(match[2]) ? qty * 60 : qty;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
  return { minutes, note: `پایان تایمر ${minutes} دقیقه‌ای` };
}
