import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try {
  KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY;
} catch {}
const db =
  BASE && KEY
    ? createClient(BASE, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
const configured = () => !!(db && TOKEN);

async function send(chatId: number, note: string) {
  const response = await fetch(
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `⏰ یادآور: ${note}` }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok)
    throw new Error(`TELEGRAM_${response.status}`);
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.has("health")) {
    return Response.json(
      { version: "8.0.1", configured: configured(), scheduled_reminders: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (request.method !== "POST")
    return new Response("Not found", { status: 404 });
  if (!configured()) return new Response("Unavailable", { status: 503 });
  const candidate = request.headers.get("X-Saeed-Cron-Secret") || "";
  // A dedicated random token is held only in Supabase Vault, never in Git or logs.
  if (!/^[a-f0-9]{64}$/.test(candidate))
    return new Response("Unauthorized", { status: 401 });
  const { data: authorized, error: authError } = await db!.rpc(
    "saeed_ai_authenticate_reminder_cron", { p_candidate: candidate }
  );
  if (authError || authorized !== true)
    return new Response("Unauthorized", { status: 401 });

  const { data, error } = await db!.rpc("saeed_ai_claim_due_reminders", {
    p_limit: 50,
  });
  if (error) {
    console.error("CLAIM", error.code);
    return Response.json({ ok: false, error: "claim_failed" }, { status: 500 });
  }

  let sent = 0,
    failed = 0;
  for (const reminder of data || []) {
    try {
      await send(Number(reminder.telegram_chat_id), String(reminder.note));
      const { error: updateError } = await db!
        .from("saeed_ai_reminders")
        .update({
          sent: true,
          status: "sent",
          sent_at: new Date().toISOString(),
          lease_until: null,
          last_error: null,
        })
        .eq("id", reminder.id)
        .eq("status", "processing");
      if (updateError) throw new Error(`UPDATE_${updateError.code}`);
      sent++;
    } catch (error) {
      failed++;
      const reason =
        error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN";
      await db!
        .from("saeed_ai_reminders")
        .update({
          status: Number(reminder.attempt_count) >= 5 ? "failed" : "pending",
          lease_until: null,
          last_error: reason,
        })
        .eq("id", reminder.id)
        .eq("status", "processing");
      console.error("DELIVERY", reminder.id, reason);
    }
  }
  return Response.json({
    ok: true,
    claimed: (data || []).length,
    sent,
    failed,
  });
});
