/** Saeed AI saeed-ai-v7 state module. Source moved without behavioral rewrites. */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { selectToolIntent } from "../../_shared/intent-model.ts";
import { handleLifeMessage, handleLifeCallback } from "../../_shared/life.ts";
import { calculateExact } from "../../_shared/calculator.ts";
import { parseTimerRequest, type TimerRequest } from "../../_shared/timer.ts";
import { voiceFollowupMode, isSpokenRequest } from "../../_shared/voice-intent.ts";
import { unzipSync } from "npm:fflate@0.8.2";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

export const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  GK = Deno.env.get("GEMINI_API_KEY") || "",
  RK = Deno.env.get("OPENROUTER_API_KEY") || "",
  BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
  LEGACY = (Deno.env.get("TELEGRAM_ALLOWED_USER_ID") || "")
    .split(",")
    .map((s) => s.trim()),
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
    : null;

export const ready = () => !!(db && TOKEN && GK && ADMIN),
  admin = (id) => String(id) === ADMIN,
  reply = (x) => Response.json(x, { headers: { "Cache-Control": "no-store" } }),
  esc = (x) =>
    String(x)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
