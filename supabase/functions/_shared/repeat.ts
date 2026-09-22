import { DEFAULT_TZ, localParts, zonedToUtc } from "./timezone.ts";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "hours";
/**
 * Calendar-safe next occurrence after now in the user's zone: daily/weekly keep
 * the wall-clock time across DST changes and monthly dates keep their original day.
 */
export function nextOccurrence(due: string, rule: RepeatRule, intervalHours: number | null, anchorDay: number | null, now = new Date(), tz = DEFAULT_TZ): string | null {
  if (rule === "none") return null;
  if (!["daily", "weekly", "monthly", "hours"].includes(rule)) throw Error("REPEAT_RULE");
  if (rule === "hours" && (!Number.isInteger(intervalHours) || intervalHours! < 1 || intervalHours! > 168)) throw Error("REPEAT_HOURS");
  let date = new Date(due);
  if (!Number.isFinite(+date)) throw Error("REPEAT_DATE");
  const initial = localParts(date, tz);
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : initial.day;
  for (let i = 0; i < 10000 && date.getTime() <= now.getTime(); i++) {
    if (rule === "hours") {
      date = new Date(date.getTime() + intervalHours! * 3600000);
      continue;
    }
    const local = localParts(date, tz);
    if (rule === "daily" || rule === "weekly") {
      const next = new Date(Date.UTC(local.year, local.month - 1, local.day + (rule === "daily" ? 1 : 7)));
      date = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), initial.hour, initial.minute, initial.second, tz);
    } else {
      const year = local.month === 12 ? local.year + 1 : local.year;
      const month = local.month === 12 ? 1 : local.month + 1;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      date = zonedToUtc(year, month, Math.min(day, lastDay), initial.hour, initial.minute, initial.second, tz);
    }
  }
  if (date.getTime() <= now.getTime()) throw Error("REPEAT_LIMIT");
  return date.toISOString();
}
