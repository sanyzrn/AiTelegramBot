/** Retention cleanup, run by the minute dispatcher instead of on the user's request path. */

/** Run the sweep roughly every 15 minutes of dispatcher ticks. */
export const shouldSweep = (now = new Date()) => now.getUTCMinutes() % 15 === 7;

/**
 * Chat history, retry rows and voice clips are already expired by pg_cron jobs
 * (see the base schema migration); this sweep covers the life tables.
 */
export async function runSweep(
  // deno-lint-ignore no-explicit-any
  db: any,
  now = Date.now(),
): Promise<string[]> {
  const cutoff = new Date(now - 36 * 3600000).toISOString();
  const week = new Date(now - 7 * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();
  const jobs: Array<[string, () => Promise<{ error: unknown }>]> = [
    ["reminders_sent", () => db.from("saeed_ai_reminders").delete().eq("sent", true).lt("created_at", cutoff)],
    // Reminders that exhausted their delivery attempts are never claimed again.
    ["reminders_failed", () => db.from("saeed_ai_reminders").delete().eq("status", "failed").lt("created_at", cutoff)],
    // Completion time, not creation time: a task finished today stays undo-able.
    ["tasks_done", () => db.from("saeed_ai_tasks").delete().eq("done", true).lt("done_at", cutoff)],
    ["shopping_done", () => db.from("saeed_ai_shopping").delete().eq("done", true).lt("done_at", week)],
    ["receipts", () => db.from("saeed_ai_receipt_pending").delete().lt("expires_at", nowIso)],
    ["invites", () => db.from("saeed_ai_shopping_invites").delete().lt("expires_at", nowIso)],
    ["rate", () => db.from("saeed_ai_rate").delete().lt("bucket", new Date(now - 3600000).toISOString())],
    ["watchers", () => db.from("saeed_ai_watchers").delete().eq("active", false).lt("created_at", week)],
  ];
  const failed: string[] = [];
  for (const [name, job] of jobs) {
    try {
      const { error } = await job();
      if (error) failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  if (failed.length) console.error("SWEEP", failed.join(","));
  return failed;
}
