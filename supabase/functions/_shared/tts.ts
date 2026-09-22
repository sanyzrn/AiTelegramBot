/** Voice-out: Gemini text-to-speech (24 kHz PCM) → MP3 → Telegram sendVoice. */
import { Mp3Encoder } from "npm:@breezystack/lamejs@1.2.7";
import { speechText } from "./format.ts";
import type { Fetcher } from "./telegram.ts";

export const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";
export { speechText };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Little-endian signed 16-bit PCM → MP3 (mono). */
export function pcmToMp3(pcm: Uint8Array, sampleRate = 24000): Uint8Array<ArrayBuffer> {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const encoder = new Mp3Encoder(1, sampleRate, 48);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < samples.length; i += 1152 * 16) chunks.push(new Uint8Array(encoder.encodeBuffer(samples.subarray(i, i + 1152 * 16))));
  chunks.push(new Uint8Array(encoder.flush()));
  const out = new Uint8Array(new ArrayBuffer(chunks.reduce((s, c) => s + c.length, 0)));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Gemini TTS → MP3 bytes plus approximate duration in seconds. */
export async function synthesize(
  text: string,
  key: string,
  opts: { model?: string; voice?: string; style?: string; fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<{ mp3: Uint8Array<ArrayBuffer>; seconds: number }> {
  const spoken = speechText(text);
  if (!spoken) throw Error("TTS_EMPTY");
  const r = await (opts.fetcher || fetch)(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model || DEFAULT_TTS_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${opts.style || "Say in a warm, friendly, natural Persian voice"}: ${spoken}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || "Kore" } } },
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs || 60000),
    },
  );
  if (!r.ok) throw Error("TTS_" + r.status);
  const j = await r.json();
  const part = (j.candidates?.[0]?.content?.parts || []).find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
  if (!part) throw Error("TTS_EMPTY");
  const rate = Number(/rate=(\d+)/.exec(String(part.inlineData.mimeType || ""))?.[1] || 24000);
  const pcm = base64ToBytes(part.inlineData.data);
  return { mp3: pcmToMp3(pcm, rate), seconds: Math.max(1, Math.round(pcm.byteLength / 2 / rate)) };
}

/** multipart sendVoice; MP3 is an accepted voice format. */
export async function sendVoice(token: string, chat: number, mp3: Uint8Array<ArrayBuffer>, seconds: number, caption = "", fetcher: Fetcher = fetch) {
  const form = new FormData();
  form.append("chat_id", String(chat));
  form.append("duration", String(seconds));
  if (caption) form.append("caption", caption.slice(0, 900));
  form.append("voice", new Blob([mp3], { type: "audio/mpeg" }), "saeed-ai.mp3");
  const r = await fetcher(`https://api.telegram.org/bot${token}/sendVoice`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  let ok = false;
  try {
    ok = (await r.json()).ok === true;
  } catch { /* non-JSON */ }
  if (!r.ok || !ok) throw Error("VOICE_SEND_" + r.status);
}
