/** Saeed AI Mini App dashboard API: Telegram-signed initData is the only credential. */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { APP_VERSION } from "../_shared/version.ts";
import { readAccessEnv } from "../_shared/access.ts";
import { handleWebApp } from "../_shared/webapp.ts";

const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const ACCESS = readAccessEnv(Deno.env);
let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try { KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY; } catch {}
const db = BASE && KEY ? createClient(BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** The page is static and may be hosted anywhere; no cookies are used, so any origin is safe. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET" && url.searchParams.has("health"))
    return json({ version: APP_VERSION, configured: !!(db && TOKEN), v10_webapp: true });
  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  if (!db || !TOKEN) return json({ error: "Not configured" }, 503);
  let payload: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.length > 4096) throw Error();
    payload = raw ? JSON.parse(raw) : {};
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw Error();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  try {
    const result = await handleWebApp(db, ACCESS, TOKEN, req.headers.get("X-Telegram-Init-Data") || "", payload);
    return json(result.body, result.status);
  } catch (e) {
    console.error("WEBAPP", e instanceof Error ? e.message.slice(0, 80) : "UNKNOWN");
    return json({ error: "Server error" }, 500);
  }
});
