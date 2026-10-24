/** Nexa Admin REST API. The browser receives neither service-role nor AI secrets.
 * Auth = short-lived Telegram Login Widget assertion bound to TELEGRAM_ADMIN_USER_ID.
 */
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { APP_VERSION } from "../_shared/version.ts";
import { readAccessEnv } from "../_shared/access.ts";
import { createAdminSession, verifyAdminSession, verifyTelegramLogin } from "../_shared/nexa-admin-auth.ts";
import { isProvider } from "../_shared/bot-config.ts";
import { normalizeBaseUrl, isValidCustomModel } from "../_shared/openai-compat.ts";
import { validatePersonalApiKey } from "../_shared/user-ai.ts";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const ACCESS = readAccessEnv(Deno.env);
const ORIGIN = Deno.env.get("NEXA_ADMIN_ORIGIN") || "https://bamagram.ir";
const BASE = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
let KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try { KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || KEY; } catch {}
const db = BASE && KEY
  ? createClient(BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

let publicBot: { username: string; at: number } | null = null;
async function botUsername(): Promise<string> {
  if (publicBot && Date.now() - publicBot.at < 3600000) return publicBot.username;
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/getMe", {
    signal: AbortSignal.timeout(6500),
  });
  if (!r.ok) throw Error("BOT_PROFILE");
  const b = await r.json();
  const username = String(b?.result?.username || "");
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) throw Error("BOT_PROFILE");
  publicBot = { username, at: Date.now() };
  return username;
}

const positiveId = (v: unknown) => {
  const id = Number(v);
  return Number.isSafeInteger(id) && id > 0 && String(id) === String(v).trim() ? id : null;
};
const dbCheck = (result: { error?: unknown; data?: unknown }) => {
  if (result.error) throw Error("DATABASE");
  return result.data;
};

async function overview() {
  if (!db) throw Error("DATABASE");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const since = new Date(Date.now() - 86400000).toISOString();
  const [access, personal, usage, metrics, config, preferences, pool] = await Promise.all([
    db.from("telegram_bot_user_access").select("telegram_user_id,enabled,daily_limit,updated_at").order("updated_at",{ascending:false}).limit(1000),
    db.from("telegram_bot_user_api").select("telegram_user_id,provider,base_url,model,enabled,updated_at").order("updated_at",{ascending:false}).limit(1000),
    db.from("telegram_bot_daily_usage").select("telegram_user_id,used").eq("usage_day",day).limit(1000),
    db.from("saeed_ai_metrics").select("telegram_user_id,status,input_tokens,output_tokens,provider").gte("created_at",since).limit(5000),
    db.from("telegram_bot_config").select("setting_key,setting_value").limit(50),
    db.from("telegram_bot_preferences").select("telegram_user_id").limit(1000),
    db.from("nexa_admin_api_keys").select("id,provider,label,model,base_url,enabled,is_active,created_at,updated_at").order("created_at",{ascending:true}).limit(500),
  ]);
  for(const r of [access,personal,usage,metrics,config,preferences,pool]) dbCheck(r);

  const settings: Record<string,string> = {};
  for (const r of config.data || []) settings[r.setting_key] = r.setting_value;
  const users = new Map<string, {
    id: string; enabled: boolean | null; limit: number | null;
    provider: string | null; model: string | null; base_url: string | null;
    key_enabled: boolean; used: number; requests: number;
    tokens: number; last_change: string | null; admin: boolean; legacy: boolean;
  }>();
  function get(idRaw: unknown) {
    const id = String(idRaw);
    if (!users.has(id)) users.set(id, {
      id, enabled: null, limit: null, provider: null, model: null, base_url: null,
      key_enabled: false, used: 0, requests: 0, tokens: 0, last_change: null,
      admin: id === ACCESS.adminId, legacy: ACCESS.legacy.includes(id),
    });
    return users.get(id)!;
  }
  if(ACCESS.adminId) get(ACCESS.adminId);
  for(const id of ACCESS.legacy) get(id);
  for(const r of preferences.data || []) get(r.telegram_user_id);
  for(const r of access.data || []) {
    const u = get(r.telegram_user_id);
    u.enabled=r.enabled; u.limit=r.daily_limit; u.last_change=r.updated_at;
  }
  for(const r of personal.data || []) {
    const u=get(r.telegram_user_id);
    u.provider=r.provider; u.model=r.model; u.base_url=r.base_url;
    u.key_enabled=r.enabled; u.last_change=r.updated_at;
  }
  for(const r of usage.data || []) get(r.telegram_user_id).used=r.used;
  let success=0, failed=0, tokens=0;
  for(const r of metrics.data || []) {
    const u=get(r.telegram_user_id);
    u.requests++;
    const n=Number(r.input_tokens||0)+Number(r.output_tokens||0);
    u.tokens+=n; tokens+=n;
    if(r.status==="success") success++;
    if(r.status==="failed") failed++;
  }
  return {
    users:[...users.values()].sort((a,b)=>b.used-a.used || a.id.localeCompare(b.id)),
    settings: {
      provider: settings.provider || (Deno.env.get("GEMINI_API_KEY") ? "gemini" : "openrouter"),
      model: settings.model || "gemini-3.5-flash-lite",
      openrouter_model: settings.openrouter_model || "google/gemma-4-26b-a4b-it:free",
      custom_model: settings.custom_model || "",
      custom_base_url: settings.custom_base_url || "",
      daily_limit: Number(settings.daily_limit || 40),
      chat_search: settings.chat_search !== "off",
    },
    providers: {
      gemini: !!Deno.env.get("GEMINI_API_KEY"),
      openrouter: !!Deno.env.get("OPENROUTER_API_KEY"),
      custom: !!Deno.env.get("CUSTOM_API_KEY"),
    },
    credentials: pool.data || [],
    totals:{users:users.size,requests:(metrics.data||[]).length,success,failed,tokens},
    day,
    truncated: users.size >= 1000 || (metrics.data || []).length >= 5000,
  };
}

async function mutate(action: string, b: Record<string, unknown>) {
  if(!db) throw Error("DATABASE");
  if(action === "save_user") {
    const id=positiveId(b.id);
    if(!id || String(id) === ACCESS.adminId || typeof b.enabled !== "boolean") return json({error:"Invalid user"},400);
    const limit=b.limit === null || b.limit === "" || b.limit === undefined ? null : Number(b.limit);
    if(limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 1000)) return json({error:"Invalid daily limit"},400);
    dbCheck(await db.from("telegram_bot_user_access").upsert({
      telegram_user_id:id,enabled:b.enabled,daily_limit:limit,updated_at:new Date().toISOString(),
    },{onConflict:"telegram_user_id"}));
    return json({ok:true});
  }
  if(action==="clear_user_access") {
    const id=positiveId(b.id);
    if(!id || String(id)===ACCESS.adminId) return json({error:"Invalid user"},400);
    dbCheck(await db.from("telegram_bot_user_access").delete().eq("telegram_user_id",id));
    return json({ok:true});
  }
  if(action==="set_personal_key") {
    const id=positiveId(b.id);
    if(!id || String(id)===ACCESS.adminId || typeof b.enabled!=="boolean") return json({error:"Invalid user"},400);
    const result=await db.from("telegram_bot_user_api").update({enabled:b.enabled,updated_at:new Date().toISOString()}).eq("telegram_user_id",id).select("telegram_user_id");
    dbCheck(result);
    return json({ok:true,changed:(result.data||[]).length});
  }
  if(action==="revoke_personal_key") {
    const id=positiveId(b.id);
    if(!id || String(id)===ACCESS.adminId || b.confirm!=="REVOKE") return json({error:"Confirmation required"},400);
    const r=await db.rpc("nexa_user_api_remove",{p_user_id:id});
    dbCheck(r);
    return json({ok:r.data===true});
  }
  // Multiple bot-owned keys: API values never leave Vault in a response.
  if(action === "credential_save") {
    const provider=String(b.provider || "");
    if(!isProvider(provider)) return json({error:"Invalid provider"},400);
    const id=b.id == null ? null : String(b.id);
    if(id!==null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return json({error:"Invalid credential ID"},400);
    const label=String(b.label||"").trim(), model=String(b.model||"").trim();
    const baseUrl=provider==="custom" ? normalizeBaseUrl(String(b.base_url||"")) : null;
    const key=String(b.api_key||"").trim();
    if(label.length<1||label.length>60||!isValidCustomModel(model)||
       (provider==="custom"&&!baseUrl)||key.length>512)
      return json({error:"Invalid details"},400);
    if(!id && key.length<12) return json({error:"API key required"},400);
    let checkKey=key;
    if(id&&!checkKey) {
      const existing=await db.rpc("nexa_admin_api_get",{p_id:id});
      dbCheck(existing);
      const row=Array.isArray(existing.data)?existing.data[0]:existing.data;
      if(!row||row.provider!==provider||!row.api_key) return json({error:"Credential not found"},404);
      checkKey=String(row.api_key);
    }
    const connected=await validatePersonalApiKey(provider,checkKey,fetch,
      provider==="custom"?{baseUrl:baseUrl!,model}:undefined);
    if(!connected) return json({error:"Key / model connection test failed"},422);
    const saved=await db.rpc("nexa_admin_api_save",{
      p_id:id,p_provider:provider,p_label:label,p_model:model,p_base_url:baseUrl,p_key:key||null,
    });
    dbCheck(saved);
    return json({ok:true,id:saved.data});
  }
  if(action==="credential_test" || action==="credential_activate" || action==="credential_delete") {
    const id=String(b.id||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return json({error:"Invalid credential ID"},400);
    if(action==="credential_delete") {
      if(b.confirm!=="DELETE") return json({error:"Confirmation required"},400);
      const r=await db.rpc("nexa_admin_api_delete",{p_id:id});
      dbCheck(r);return json({ok:r.data===true});
    }
    // Every activation is connection-tested; an invalid key never becomes default.
    const res=await db.rpc("nexa_admin_api_get",{p_id:id});
    dbCheck(res);
    const row=Array.isArray(res.data)?res.data[0]:res.data;
    if(!row||!isProvider(row.provider)||typeof row.api_key!=="string") return json({error:"Credential missing"},404);
    const ok=await validatePersonalApiKey(row.provider,row.api_key,fetch,row.provider==="custom"
      ?{baseUrl:String(row.base_url||""),model:String(row.model||"")}:undefined);
    if(!ok)return json({ok:false,error:"Connection test failed"},422);
    if(action==="credential_test") return json({ok:true});
    const saved=await db.rpc("nexa_admin_api_activate",{p_id:id});
    dbCheck(saved);return json({ok:saved.data===true});
  }
  if(action==="credential_use_legacy") {
    const provider=String(b.provider||"");
    if(!isProvider(provider)) return json({error:"Invalid provider"},400);
    const envName=provider==="gemini"?"GEMINI_API_KEY":provider==="openrouter"?"OPENROUTER_API_KEY":"CUSTOM_API_KEY";
    if(!Deno.env.get(envName)) return json({error:"No server Secret configured"},422);
    const r=await db.rpc("nexa_admin_api_use_legacy",{p_provider:provider});
    dbCheck(r);return json({ok:r.data===true});
  }
  if(action==="save_setting") {
    const key=String(b.key||"");
    if(!["provider","model","openrouter_model","custom_model","custom_base_url","daily_limit","chat_search"].includes(key))
      return json({error:"Unsupported setting"},400);
    let value=String(b.value??"").trim();
    if(key==="provider") {
      return json({error:"Activate a saved key or an existing server Secret"},400);
    } else if(key==="daily_limit") {
      const n=Number(value);
      if(!Number.isInteger(n)||n<0||n>1000) return json({error:"Invalid limit"},400);
    } else if(key==="chat_search") {
      if(!["on","off"].includes(value)) return json({error:"Invalid toggle"},400);
    } else if(key==="custom_base_url") {
      const normalized=normalizeBaseUrl(value);
      if(!normalized) return json({error:"Invalid HTTPS endpoint"},400);
      value=normalized;
    } else if(!isValidCustomModel(value)) {
      return json({error:"Invalid model"},400);
    }
    dbCheck(await db.from("telegram_bot_config").upsert({
      setting_key:key, setting_value:value,updated_at:new Date().toISOString(),
    },{onConflict:"setting_key"}));
    return json({ok:true});
  }
  return json({error:"Unknown action"},400);
}

Deno.serve(async (req) => {
  const url=new URL(req.url);
  if(req.method==="GET"&&url.searchParams.has("health"))
    return json({version:APP_VERSION,configured:!!(db&&TOKEN&&ACCESS.adminId),admin_dashboard:true});
  if(req.method==="OPTIONS") {
    if(req.headers.get("Origin")!==ORIGIN) return new Response(null,{status:403});
    return new Response(null,{status:204,headers});
  }
  if(req.method!=="POST") return json({error:"Not found"},404);
  // Explicit origin restriction and bearer tokens; no cookies or CSRF path.
  if(req.headers.get("Origin")!==ORIGIN) return json({error:"Forbidden origin"},403);
  if(!db||!TOKEN||!ACCESS.adminId) return json({error:"Service unavailable"},503);
  let body:Record<string,unknown>;
  try {
    if(!req.headers.get("Content-Type")?.toLowerCase().includes("application/json")) throw Error();
    const raw=await req.text();
    if(raw.length>8000) throw Error();
    body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body)) throw Error();
  } catch { return json({error:"Bad request"},400); }
  const action=String(body.action||"");
  try {
    if(action==="public") return json({bot_username:await botUsername(),product:"Nexa"});
    if(action==="login") {
      if(!(await verifyTelegramLogin(body.data,TOKEN,ACCESS.adminId))) return json({error:"Only the Nexa administrator can sign in"},403);
      return json({token:await createAdminSession(ACCESS.adminId,TOKEN),expires_in:900});
    }
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
    if(!(await verifyAdminSession(token,TOKEN,ACCESS.adminId))) return json({error:"Session expired"},401);
    if(action==="overview") return json(await overview());
    return await mutate(action,body);
  } catch (e) {
    console.error("NEXA_ADMIN",e instanceof Error?e.message.slice(0,50):"UNKNOWN");
    return json({error:"Operation failed"},500);
  }
});
