export type RepeatRule = "none" | "daily" | "weekly" | "monthly" | "hours";
/** Calendar-safe next occurrence after now; monthly dates keep their original day. */
export function nextOccurrence(due: string, rule: RepeatRule, intervalHours: number | null, anchorDay: number | null, now = new Date()): string | null {
  if (rule === "none") return null;
  if (!["daily", "weekly", "monthly", "hours"].includes(rule)) throw Error("REPEAT_RULE");
  if (rule === "hours" && (!Number.isInteger(intervalHours) || intervalHours! < 1 || intervalHours! > 168)) throw Error("REPEAT_HOURS");
  let date = new Date(due);
  if (!Number.isFinite(+date)) throw Error("REPEAT_DATE");
  const offset = 210 * 60000; // Tehran UTC+03:30
  const initial = new Date(date.getTime() + offset);
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : initial.getUTCDate();
  for (let i = 0; i < 10000 && date.getTime() <= now.getTime(); i++) {
    if (rule === "hours") date = new Date(date.getTime() + intervalHours! * 3600000);
    else if (rule === "daily" || rule === "weekly") date = new Date(date.getTime() + (rule === "daily" ? 1 : 7) * 86400000);
    else {
      const local = new Date(date.getTime() + offset);
      const year = local.getUTCFullYear(), month = local.getUTCMonth() + 1;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      date = new Date(Date.UTC(year, month, Math.min(day, lastDay), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()) - offset);
    }
  }
  if (date.getTime() <= now.getTime()) throw Error("REPEAT_LIMIT");
  return date.toISOString();
}
