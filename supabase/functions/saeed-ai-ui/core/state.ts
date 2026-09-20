/** Saeed AI saeed-ai-ui state module. Source moved without behavioral rewrites. */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { selectToolIntent } from "../../_shared/intent-model.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

export const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  GK = Deno.env.get("GEMINI_API_KEY") || "",
  RK = Deno.env.get("OPENROUTER_API_KEY") || "",
  BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
  LEGACY = (Deno.env.get("TELEGRAM_ALLOWED_USER_ID") || "")
    .split(",")
    .map((x) => x.trim()),
  ADMIN = Deno.env.get("TELEGRAM_ADMIN_USER_ID") || LEGACY[0] || "";

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
  ready = () => !!(db && TOKEN && GK && ADMIN),
  admin = (id) => String(id) === ADMIN,
  out = (x, s = 200) =>
    Response.json(x, { status: s, headers: { "Cache-Control": "no-store" } });
