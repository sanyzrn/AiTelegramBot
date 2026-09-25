/** Shared runtime configuration for the Saeed AI processor. */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";
import { isAdmin, readAccessEnv } from "../../_shared/access.ts";
import { createTg } from "../../_shared/telegram.ts";
import { escapeHtml } from "../../_shared/format.ts";

export const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  GK = Deno.env.get("GEMINI_API_KEY") || "",
  RK = Deno.env.get("OPENROUTER_API_KEY") || "",
  GH = Deno.env.get("GITHUB_TOKEN") || "",
  WEBAPP_URL = /^https:\/\//.test(Deno.env.get("WEBAPP_URL") || "") ? Deno.env.get("WEBAPP_URL")! : "",
  TTS_MODEL = Deno.env.get("GEMINI_TTS_MODEL") || "",
  BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
  ACCESS = readAccessEnv(Deno.env),
  LEGACY = ACCESS.legacy,
  ADMIN = ACCESS.adminId;

let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

try {
  KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY;
} catch {}

const client =
  BASE && KEY
    ? createClient(BASE, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** Only used after ready() confirmed the client exists. */
export const db = client as SupabaseClient;

export const tg = createTg(TOKEN);

/** At least one AI provider key must exist; the ACTIVE provider (from
 *  telegram_bot_config) is the only one that is ever called. OpenRouter-only
 *  deployments no longer require a Gemini key to boot. */
export const ready = () => !!(client && TOKEN && (GK || RK) && ADMIN),
  admin = (id: unknown) => isAdmin(ACCESS, id),
  reply = (x: unknown, status = 200) => Response.json(x, { status, headers: { "Cache-Control": "no-store" } }),
  esc = escapeHtml,
  keys = { gemini: GK, openrouter: RK };
