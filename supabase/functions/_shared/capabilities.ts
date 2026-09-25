/**
 * Provider-first model capability resolution.
 *
 * The active provider/model pair from telegram_bot_config is the single
 * authority for every smart feature. This module answers one question:
 * «which input modalities does the CURRENT model accept?»
 *
 *  - Gemini chat models: static knowledge (all current families accept
 *    text, image, audio and PDF as inlineData).
 *  - OpenRouter: GET /api/v1/model/{slug} -> architecture.input_modalities,
 *    cached ~10 min per isolate. Router/unknown models resolve to
 *    "unknown" and are probed at runtime with graceful failure instead.
 */
import type { BotConfig } from "./bot-config.ts";
import type { Fetcher } from "./telegram.ts";

export type Modality = "text" | "image" | "audio" | "pdf";
/** true = supported, false = definitely not, "unknown" = probe at runtime. */
export type Support = boolean | "unknown";

export type ModelCapabilities = {
  provider: "gemini" | "openrouter";
  model: string;
  input: Record<Modality, Support>;
  source: "static" | "api" | "error";
};

const API_TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 30 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: ModelCapabilities }>();

export function clearCapabilityCache() {
  cache.clear();
}

/**
 * Gemini chat families (1.5 / 2.x / 3.x / 4 flash & pro) all accept text,
 * images, audio and PDF as inline data. Embedding/legacy text-only models
 * are not selectable chat models but are still excluded defensively.
 */
export function geminiInputSupport(model: string): Record<Modality, Support> {
  const m = String(model || "").toLowerCase();
  const textOnly = /^(?:text-|embedding|aqa|gemini-1\.0)/.test(m);
  return { text: true, image: !textOnly, audio: !textOnly, pdf: !textOnly };
}

/** Routing suffixes are not part of the model slug for the metadata API. */
const ROUTING_SUFFIX = /:(?:online|extended|nitro|floor)$/;

function openrouterSlug(model: string): { owner: string; slug: string } {
  const raw = String(model || "").trim().replace(ROUTING_SUFFIX, "");
  const slash = raw.indexOf("/");
  const owner = slash > 0 ? raw.slice(0, slash) : "";
  const slug = slash > 0 ? raw.slice(slash + 1) : raw;
  return { owner, slug };
}

type OpenRouterModelMeta = {
  data?: { architecture?: { input_modalities?: unknown } };
};

/** Resolves the input modalities of the given provider/model. Never throws. */
export async function resolveCapabilities(
  cfg: Pick<BotConfig, "provider" | "gemini" | "openrouter">,
  opts: { fetcher?: Fetcher; timeoutMs?: number; now?: number } = {},
): Promise<ModelCapabilities> {
  if (cfg.provider === "gemini") {
    return { provider: "gemini", model: cfg.gemini, input: geminiInputSupport(cfg.gemini), source: "static" };
  }
  const model = String(cfg.openrouter || "").trim();
  const key = "openrouter:" + model;
  const now = opts.now ?? Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const fetcher = opts.fetcher || fetch;
  const { owner, slug } = openrouterSlug(model);
  let value: ModelCapabilities;
  if (!owner || !slug) {
    value = { provider: "openrouter", model, input: { text: true, image: "unknown", audio: "unknown", pdf: "unknown" }, source: "error" };
  } else {
    try {
      const r = await fetcher(
        `https://openrouter.ai/api/v1/model/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
        { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) },
      );
      if (!r.ok) throw Error("CAP_API_" + r.status);
      const j = (await r.json()) as OpenRouterModelMeta;
      const raw = j?.data?.architecture?.input_modalities;
      const mods = Array.isArray(raw) ? raw.map((x) => String(x).toLowerCase()) : null;
      value = {
        provider: "openrouter",
        model,
        input: mods
          ? { text: true, image: mods.includes("image"), audio: mods.includes("audio"), pdf: mods.includes("pdf") }
          : { text: true, image: "unknown", audio: "unknown", pdf: "unknown" },
        source: "api",
      };
      cache.set(key, { at: now, ttl: API_TTL_MS, value });
    } catch {
      // Router/uncertain models and transient API failures fall back to
      // runtime probing with graceful, precise failure messages.
      value = { provider: "openrouter", model, input: { text: true, image: "unknown", audio: "unknown", pdf: "unknown" }, source: "error" };
      cache.set(key, { at: now, ttl: ERROR_TTL_MS, value });
    }
  }
  return value;
}

const LABELS: Record<Modality, string> = { text: "متن", image: "تصویر", audio: "صوت", pdf: "PDF" };
const ORDER: Modality[] = ["text", "image", "audio", "pdf"];

/** Persian capability summary for admin/tools pages: «متن، تصویر، صوت، PDF». */
export function capabilityLine(caps: ModelCapabilities): string {
  const parts: string[] = [];
  let unknown = false;
  for (const m of ORDER) {
    const v = caps.input[m];
    if (v === true) parts.push(LABELS[m]);
    else if (v === "unknown") unknown = true;
  }
  if (parts.length === ORDER.length) return "متن، تصویر، صوت و PDF";
  if (!parts.length) return unknown ? "نامشخص" : "هیچ‌کدوم";
  return parts.join("، ") + (unknown ? " (بقیه نامشخص)" : "");
}

/** Error codes for the supported-but-blocked and the runtime-graceful paths. */
export function modalityErrorCode(modality: Modality, runtime = false): string {
  const prefix = modality === "image" ? "AI_IMAGE" : modality === "audio" ? "AI_AUDIO" : "AI_PDF";
  return prefix + (runtime ? "_FAILED" : "_UNSUPPORTED");
}
