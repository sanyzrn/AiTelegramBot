/** Keep the warm morning opener separate from independently sourced weather. */
import { dayQuote, type MorningFacts } from "./morning-voice.ts";

// Don't repeat generated forecasts or clothing advice: the weather section
// already gives the complete verified information and its source.
const WEATHER = /(?:هوا|آب\s*و\s*هوا|دما|درجه|باران|بارون|بارش|آسمان|آسمون|آفتاب|بارونی|چتر|لباس|بپوش|پوشاک|نخی|هودی|کاپشن|پالتو|کت\s|سرد|گرم|مرطوب|شرجی|آفتابی|ابری|برف)/u;

export function briefingIntro(voice: string | null, facts: MorningFacts): string {
  // The date is already in the title; do not repeat it or a second weather line.
  const fallback = `صبح بخیر رفیق! 😄\n${dayQuote(facts.dayLabel).quote}`;
  if (!voice) return fallback;
  const safe = voice
    .split(/\n+|(?<=[.!؟؛])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part && !WEATHER.test(part))
    .join(" ")
    .trim();
  // Generated text can mix weather with motivation in the same sentence.
  // If filtering leaves too little, retain the deterministic warm greeting.
  return safe.length >= 18 ? safe : fallback;
}
