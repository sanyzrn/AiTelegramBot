/** Dependencies injected into the private-chat life utilities (tests pass fakes). */
export type LifeContext = {
  // deno-lint-ignore no-explicit-any
  db: any;
  // deno-lint-ignore no-explicit-any
  tg: (method: string, payload: Record<string, unknown>) => Promise<any>;
  // deno-lint-ignore no-explicit-any
  send: (chat: number, text: string) => Promise<any>;
  /** Display name of the acting Telegram user, used for shared-list notifications. */
  actorName?: string;
};

export const safeId = (raw: string) => /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;

/** Edit the original inline message when possible; otherwise send a fresh one. */
export async function showView(c: LifeContext, view: Record<string, unknown>, messageId?: number) {
  if (messageId) {
    try {
      await c.tg("editMessageText", { ...view, message_id: messageId });
      return;
    } catch (e) {
      // Telegram rejects editing deleted/old messages and identical content.
      if (/message is not modified/i.test(String(e))) return;
      console.error("LIFE_EDIT", String(e).slice(0, 80));
    }
  }
  await c.tg("sendMessage", view);
}
