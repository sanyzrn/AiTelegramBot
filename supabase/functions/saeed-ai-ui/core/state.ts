/** Saeed AI saeed-ai-ui state module: environment, database and Telegram client. */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { isAdmin, readAccessEnv } from "../../_shared/access.ts";
import { createTg } from "../../_shared/telegram.ts";

export const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  GK = Deno.env.get("GEMINI_API_KEY") || "",
  RK = Deno.env.get("OPENROUTER_API_KEY") || "",
  BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
  WEBAPP_URL = /^https:\/\//.test(Deno.env.get("WEBAPP_URL") || "") ? Deno.env.get("WEBAPP_URL")! : "",
  ACCESS = readAccessEnv(Deno.env),
  /** Messages per minute per user before the gateway asks them to slow down. */
  RATE_LIMIT = Math.max(5, Number(Deno.env.get("RATE_LIMIT_PER_MINUTE") || 20) || 20);

let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

try {
  KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY;
} catch {}

export const db =
    BASE && KEY
      ? createClient(BASE, KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null,
  tg = createTg(TOKEN),
  ready = () => !!(db && TOKEN && GK && ACCESS.adminId),
  admin = (id) => isAdmin(ACCESS, id),
  out = (x, s = 200) =>
    Response.json(x, { status: s, headers: { "Cache-Control": "no-store" } });
