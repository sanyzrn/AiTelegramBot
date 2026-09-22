/** IANA time-zone helpers without external libraries. Default zone: Asia/Tehran. */
export const DEFAULT_TZ = "Asia/Tehran";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const safeTimeZone = (tz: unknown) => (isValidTimeZone(tz) ? tz : DEFAULT_TZ);

type Local = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

/** Wall-clock fields of `date` in `tz`. month is 1-12, weekday 0=Sunday. */
export function localParts(date: Date, tz: string): Local {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(tz),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => f.find((p) => p.type === t)?.value || "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** UTC offset of `tz` at `date`, in minutes (Tehran → 210). */
export function offsetMinutes(tz: string, date = new Date()): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `tz` shows the given fields (DST-safe). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = guess - offsetMinutes(tz, new Date(guess)) * 60000;
  t = guess - offsetMinutes(tz, new Date(t)) * 60000;
  return new Date(t);
}

/** YYYY-MM-DD of `date` in `tz`. */
export function localDay(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Midnight at the start of local day `day` (YYYY-MM-DD) in `tz`. */
export function startOfLocalDay(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0, 0, tz);
}

/** "+03:30"-style offset label for prompts. */
export function offsetLabel(tz: string, date = new Date()): string {
  const m = offsetMinutes(tz, date);
  const a = Math.abs(m);
  return `${m < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export const formatLocal = (date: Date, tz: string) =>
  date.toLocaleString("fa-IR", { timeZone: safeTimeZone(tz), dateStyle: "medium", timeStyle: "short" });

export const formatLocalTime = (date: Date, tz: string) =>
  date.toLocaleTimeString("fa-IR", { timeZone: safeTimeZone(tz), hour: "2-digit", minute: "2-digit" });

/** Friendly Persian labels for the zones most users pick. */
const LABELS: Record<string, string> = {
  "Asia/Tehran": "تهران",
  "Europe/Istanbul": "استانبول",
  "Asia/Dubai": "دبی",
  "Europe/London": "لندن",
  "Europe/Berlin": "برلین",
  "America/Toronto": "تورنتو",
  "America/New_York": "نیویورک",
  "America/Los_Angeles": "لس‌آنجلس",
  "Australia/Sydney": "سیدنی",
};

export const timeZoneLabel = (tz: string) => LABELS[tz] || tz;

/** The user's zone; stored with the other life preferences, Tehran until changed. */
// deno-lint-ignore no-explicit-any
export async function userTimeZone(db: any, id: number): Promise<string> {
  try {
    const { data } = await db.from("saeed_ai_briefing_preferences").select("timezone").eq("telegram_user_id", id).maybeSingle();
    return safeTimeZone(data?.timezone);
  } catch {
    return DEFAULT_TZ;
  }
}
