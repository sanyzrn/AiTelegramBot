/** Private-chat allowlist shared by the gateway and the processor. */
export type AccessEnv = { adminId: string; legacy: string[] };

export function readAccessEnv(env: { get(k: string): string | undefined }): AccessEnv {
  const legacy = (env.get("TELEGRAM_ALLOWED_USER_ID") || "").split(",").map((x) => x.trim()).filter(Boolean);
  return { adminId: env.get("TELEGRAM_ADMIN_USER_ID") || legacy[0] || "", legacy };
}

export const isAdmin = (env: AccessEnv, id: unknown) => !!env.adminId && String(id) === env.adminId;

/** Only a private chat with the user themself; an explicit DB row overrides the legacy env list. */
export async function isAllowed(
  // deno-lint-ignore no-explicit-any
  db: any,
  env: AccessEnv,
  id: unknown,
  chat: { type?: string; id?: unknown } | undefined,
): Promise<boolean> {
  if (!Number.isSafeInteger(id) || chat?.type !== "private" || chat.id !== id) return false;
  if (isAdmin(env, id)) return true;
  const { data, error } = await db
    .from("telegram_bot_user_access")
    .select("enabled")
    .eq("telegram_user_id", id)
    .maybeSingle();
  if (error) return false;
  // An explicit disabled row is a hard block, even when a personal API key exists.
  if (data) return data.enabled === true;
  if (env.legacy.includes(String(id))) return true;

  // Users outside the allowlist may bring their own API key. The secret itself
  // stays in Vault; this table only exposes whether a usable credential exists.
  const { data: personal, error: personalError } = await db
    .from("telegram_bot_user_api")
    .select("enabled")
    .eq("telegram_user_id", id)
    .maybeSingle();
  return !personalError && personal?.enabled === true;
}
