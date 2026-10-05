/** Helpers for the «Custom (OpenAI-compatible)» provider: any server that speaks
 *  POST {base}/chat/completions (OpenAI, Groq, Together, DeepSeek, LM Studio, vLLM…).
 *  The base URL is user supplied, so it is validated before any request leaves the bot. */

export type CustomEndpoint = { baseUrl: string; model: string };

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;

/**
 * Normalises a user typed API address to `https://host[:port]/path` without a
 * trailing slash or a trailing `/chat/completions`. Returns null when it is not
 * a public https URL: the bot must not be usable as a proxy into internal networks.
 */
export function normalizeBaseUrl(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") && !host.includes(":")) return null; // localhost, intranet names
  if (host.startsWith("[") || host.includes(":")) return null; // IPv6 literals
  if (/^[\d.]+$/.test(host) && PRIVATE_V4.test(host)) return null;
  if (/\.(?:local|localhost|internal|lan|home|corp|intranet)$/.test(host)) return null;
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "");
  return u.origin + path;
}

export function isValidCustomModel(model: string): boolean {
  return /^[\w.~:@/+-]{1,120}$/.test(String(model || "").trim());
}

export const chatCompletionsUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "") + "/chat/completions";
