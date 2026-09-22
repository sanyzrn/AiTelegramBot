/* Pure parser: never creates a timer or claims one was created. */
import { faDigits } from "./format.ts";

export type TimerRequest = { minutes: number; seconds: number; note: string };
const numbers: Record<string, number> = {
  یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7,
  هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13,
  چهارده: 14, پانزده: 15, پونزده: 15, شانزده: 16, شونزده: 16, هفده: 17, هیفده: 17,
  هجده: 18, هیجده: 18, نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50,
  شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90, صد: 100,
  نیم: 0.5,
};
const UNIT_SECONDS: Array<[RegExp, number]> = [
  [/^(?:ساعت|hours?|hrs?)$/iu, 3600],
  [/^(?:ربع)$/iu, 900],
  [/^(?:دقیقه|minutes?|mins?)$/iu, 60],
  [/^(?:ثانیه|seconds?|secs?)$/iu, 1],
];
/** Arabic-script letters (Persian ی/ک/گ/پ/چ/ژ included), not only the Arabic block. */
const WORD = "[\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF]+";
const SEGMENT = new RegExp(
  `([0-9]{1,4}(?:[.٫][0-9]{1,2})?|${WORD}(?:\\s+و\\s+${WORD})?)\\s*(ساعت|ربع|دقیقه|ثانیه|hours?|hrs?|minutes?|mins?|seconds?|secs?)(\\s+و\\s+نیم)?`,
  "giu",
);

export function normalizeTimerDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => String(
    "۰۱۲۳۴۵۶۷۸۹".includes(d) ? "۰۱۲۳۴۵۶۷۸۹".indexOf(d) : "٠١٢٣٤٥٦٧٨٩".indexOf(d),
  ));
}
function count(raw: string): number | null {
  if (/^\d{1,4}(?:[.٫]\d{1,2})?$/.test(raw)) return Number(raw.replace("٫", "."));
  const words = raw.trim().split(/\s+و\s+/u);
  if (words.length === 1) return numbers[words[0]] ?? null;
  if (words.length === 2 && (numbers[words[0]] ?? 0) >= 20 &&
      (numbers[words[0]] ?? 0) % 10 === 0 &&
      (numbers[words[1]] ?? 0) > 0 && (numbers[words[1]] ?? 0) < 10) {
    return numbers[words[0]] + numbers[words[1]];
  }
  return null;
}
/** «۱ ساعت و ۳۰ دقیقه» style label with Persian digits. */
export function durationLabel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = Math.round(totalSeconds % 60);
  return [h ? `${h} ساعت` : "", m ? `${m} دقیقه` : "", s ? `${s} ثانیه` : ""]
    .filter(Boolean).map(faDigits).join(" و ") || "۰ ثانیه";
}
/**
 * Only explicit timer-setting instructions with an unambiguous duration are accepted.
 * Every duration segment is summed: «یک ساعت و نیم» is 90 minutes, not 60.
 */
export function parseTimerRequest(input: string): TimerRequest | null {
  const text = normalizeTimerDigits(input.normalize("NFKC")).trim();
  if (!/(?:تایمر|زمان[‌\s-]*سنج|timer)/iu.test(text)) return null;
  if (/(?:چطور|چگونه|چرا|آموزش|کار\s*نمی[‌\s]*کن|تنظیم\s*شد|how\s+to|doesn.t\s+work|\?|؟)/iu.test(text)) return null;
  if (!/(?:بذار|بگذار|بزن|بگیر|تنظیم\s*کن|ست\s*کن|شروع\s*کن|راه\s*بنداز|set|start)/iu.test(text) &&
      !/^(?:یه\s+|یک\s+)?(?:تایمر|timer)(?:\s|$)/iu.test(text)) return null;
  let seconds = 0, found = 0;
  for (const match of text.matchAll(SEGMENT)) {
    const qty = count(match[1]);
    if (qty === null) return null;
    const unit = UNIT_SECONDS.find(([rx]) => rx.test(match[2]))![1];
    seconds += qty * unit + (match[3] ? unit / 2 : 0);
    found++;
  }
  if (!found) return null;
  seconds = Math.round(seconds);
  if (seconds < 30 || seconds > 86400) return null;
  return { minutes: seconds / 60, seconds, note: `پایان تایمر ${durationLabel(seconds)}` };
}
