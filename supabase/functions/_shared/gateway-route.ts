/** Pure gateway routing: which Telegram messages must reach the processor. */
import { TOOLS, allButtons } from "./menu.ts";
import { isLifeCommand, REPLY_TRANSLATE } from "./life-commands.ts";

/** Every reply-keyboard button is processor-owned. */
export const MENUS = new Set(allButtons());

/** Every processor-side pending_tool (all tools except plain chat and online search). */
export const FORWARD_TOOLS = new Set(Object.keys(TOOLS).filter((k) => k !== "chat" && k !== "web"));

type Msg = {
  text?: string;
  document?: unknown;
  photo?: unknown;
  voice?: unknown;
  audio?: unknown;
  reply_to_message?: { voice?: unknown; audio?: unknown; text?: string; caption?: string };
};

/** Decisions that need no database: media, commands, buttons and typed life commands. */
export function mustForward(m: Msg): boolean {
  const text = (m.text || "").trim();
  // Reply transformations must reach the processor with original voice metadata.
  if (m.reply_to_message?.voice || m.reply_to_message?.audio) return true;
  if (MENUS.has(text) || text.startsWith("/")) return true;
  if (m.document || m.photo || m.voice || m.audio) return true;
  if (isLifeCommand(text)) return true;
  if (REPLY_TRANSLATE.test(text) && (m.reply_to_message?.text || m.reply_to_message?.caption)) return true;
  return false;
}

export const forwardsPendingTool = (tool: unknown) => typeof tool === "string" && FORWARD_TOOLS.has(tool);
