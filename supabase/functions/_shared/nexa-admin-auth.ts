/** Nexa Admin: Telegram Login Widget verification and short-lived signed sessions.
 * No service-role key or Telegram token ever reaches the browser.
 * Pure WebCrypto: works in Deno Edge Functions and Node tests.
 */
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const from64 = (str: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(str) || str.length > 1800) return null;
  try {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s + "=".repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch { return null; }
};
const sha = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const hmac = async (secret: Uint8Array, value: string) => {
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
};
const constantTime = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

export async function verifyTelegramLogin(
  data: unknown, botToken: string, adminId: string, nowMs = Date.now(),
): Promise<boolean> {
  if (!botToken || !adminId || !data || typeof data !== "object" || Array.isArray(data)) return false;
  const fields = data as Record<string, unknown>;
  const id = fields.id;
  const stamp = Number(fields.auth_date);
  if (!Number.isSafeInteger(Number(id)) || String(id) !== adminId ||
      !Number.isSafeInteger(stamp) || Math.abs(nowMs / 1000 - stamp) > 180 ||
      !/^[a-f0-9]{64}$/.test(String(fields.hash || ""))) return false;
  const entries: string[] = [];
  for (const [k,v] of Object.entries(fields)) {
    if (k === "hash") continue;
    if (!/^[a-z_]{1,40}$/.test(k) || (typeof v !== "string" && typeof v !== "number") ||
        String(v).length > 600) return false;
    entries.push(k + "=" + String(v));
  }
  if (entries.length > 12) return false;
  entries.sort();
  const digest = await hmac(await sha(botToken), entries.join("\n"));
  return constantTime(digest, Uint8Array.from(String(fields.hash).match(/../g)!.map(x => parseInt(x,16))));
}

const sessionSecret = (botToken: string) => sha("nexa-admin-session-v1:" + botToken);

export async function createAdminSession(id: string, botToken: string, nowMs = Date.now()): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = b64url(encoder.encode(JSON.stringify({
    v: 1, id, exp: Math.floor(nowMs / 1000) + 900, nonce,
  })));
  const signature = b64url(await hmac(await sessionSecret(botToken), payload));
  return payload + "." + signature;
}

export async function verifyAdminSession(
  token: string, botToken: string, adminId: string, nowMs = Date.now(),
): Promise<boolean> {
  if (!botToken || !adminId || token.length > 1600) return false;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra) return false;
  const bytes = from64(payload), provided = from64(mac);
  if (!bytes || !provided || provided.length !== 32) return false;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { return false; }
  const exp = Number(parsed.exp);
  if (parsed.v !== 1 || String(parsed.id) !== adminId || typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 12 || !Number.isSafeInteger(exp) ||
      exp <= Math.floor(nowMs / 1000) || exp > Math.floor(nowMs / 1000) + 900) return false;
  return constantTime(await hmac(await sessionSecret(botToken), payload), provided);
}
