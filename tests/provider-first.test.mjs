/**
 * Provider-first architecture guards.
 *
 * The ACTIVE provider/model from telegram_bot_config must be the only
 * authority for every smart feature. When OpenRouter is active, NO request
 * may silently go to Gemini — not chat, not vision, not OCR, not STT, not
 * PDF, not search, not classification. These tests pin that contract from
 * both sides: behaviour (mocked fetch, host allowlists) and source-scan
 * regression guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../supabase/functions/_shared/ai.ts';
import { failMessage } from '../supabase/functions/_shared/ai-errors.ts';
import { selectToolIntent } from '../supabase/functions/_shared/intent-model.ts';
import { resolveCapabilities, geminiInputSupport, capabilityLine, clearCapabilityCache } from '../supabase/functions/_shared/capabilities.ts';
import { parseBotConfig } from '../supabase/functions/_shared/bot-config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const OR_CFG = { provider: 'openrouter', gemini: 'gemini-3.5-flash', openrouter: 'x/multi-model' };
const OR_KEYS = { gemini: 'gemini-key-that-must-not-be-used', openrouter: 'or-key' };

async function withMockFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

/** Records every outgoing request and fails the test on a Gemini host. */
function noGeminiRecorder(calls, respond) {
  return async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    assert.ok(!u.includes('generativelanguage.googleapis.com'), `hidden Gemini call leaked: ${u}`);
    return respond(u, init);
  };
}

test('generate() with OpenRouter active never touches the Gemini API (text, image, audio, pdf)', async () => {
  const calls = [];
  const ok = () => new Response(JSON.stringify({
    choices: [{ message: { content: 'پاسخ مدل' } }],
    usage: { prompt_tokens: 3, completion_tokens: 5 },
  }), { status: 200 });
  await withMockFetch(noGeminiRecorder(calls, ok), async () => {
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'سلام' }] }], 'sys');
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'این عکس رو ببین' }, { inlineData: { mimeType: 'image/jpeg', data: 'aW1n' } }] }], 'sys');
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'این ویس رو بنویس' }, { inlineData: { mimeType: 'audio/ogg', data: 'b2dn' } }] }], 'sys');
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'این PDF رو بخون' }, { inlineData: { mimeType: 'application/pdf', data: 'cGRm' } }] }], 'sys');
  });
  assert.equal(calls.length, 4);
  for (const c of calls) {
    assert.match(c.url, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/);
    assert.equal(c.init.headers.Authorization, 'Bearer or-key');
  }
});

test('OpenRouter media conversion: image_url, input_audio (ogg), and file (pdf)', async () => {
  const bodies = [];
  await withMockFetch(noGeminiRecorder(bodies, () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })), async () => {
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'بین' }, { inlineData: { mimeType: 'image/png', data: 'aQ==' } }] }], 's');
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'شنیدن' }, { inlineData: { mimeType: 'audio/ogg', data: 'bw==' } }] }], 's');
    await generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'خواندن' }, { inlineData: { mimeType: 'application/pdf', data: 'cA==' } }] }], 's');
  });
  const image = bodies[0].init ? JSON.parse(bodies[0].init.body) : null;
  const audio = JSON.parse(bodies[1].init.body);
  const pdf = JSON.parse(bodies[2].init.body);
  assert.deepEqual(image.messages[1].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,aQ==' } });
  assert.deepEqual(audio.messages[1].content[1], { type: 'input_audio', input_audio: { data: 'bw==', format: 'ogg' } });
  assert.deepEqual(pdf.messages[1].content[1], { type: 'file', file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,cA==' } });
});

test('missing key for the ACTIVE provider throws a provider-specific error, not a generic one', async () => {
  await withMockFetch(async () => { throw new Error('no fetch allowed'); }, async () => {
    await assert.rejects(generate(OR_CFG, { gemini: 'gk', openrouter: '' }, [{ role: 'user', parts: [{ text: 'x' }] }], 's'), /AI_KEY_OPENROUTER/);
    await assert.rejects(generate({ provider: 'gemini', gemini: 'g', openrouter: 'o' }, { gemini: '', openrouter: 'or' }, [{ role: 'user', parts: [{ text: 'x' }] }], 's'), /AI_KEY_GEMINI/);
  });
});

test('runtime modality failures on uncertain (router) models degrade gracefully with precise codes', async () => {
  const audio400 = new Response(JSON.stringify({ error: { message: 'This model does not support audio input modality' } }), { status: 400 });
  await withMockFetch(noGeminiRecorder([], () => audio400), async () => {
    await assert.rejects(
      generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'ویس' }, { inlineData: { mimeType: 'audio/ogg', data: 'bw==' } }] }], 's'),
      /AI_AUDIO_FAILED/,
    );
  });
  const img400 = new Response(JSON.stringify({ error: { message: 'vision modality not supported' } }), { status: 400 });
  await withMockFetch(noGeminiRecorder([], () => img400), async () => {
    await assert.rejects(
      generate(OR_CFG, OR_KEYS, [{ role: 'user', parts: [{ text: 'عکس' }, { inlineData: { mimeType: 'image/jpeg', data: 'aQ==' } }] }], 's'),
      /AI_IMAGE_FAILED/,
    );
  });
});

test('the OpenRouter classifier classifies on the active model without any Gemini detour', async () => {
  const calls = [];
  await withMockFetch(noGeminiRecorder(calls, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"tool":"web"}' } }],
  }), { status: 200 })), async () => {
    assert.equal(await selectToolIntent('فردا ساعت ۵ چی داریم', OR_CFG, OR_KEYS), 'web');
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /openrouter\.ai\/api\/v1\/chat\/completions/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'x/multi-model');
  assert.equal(body.temperature, 0);
});

test('classifier falls back to the deterministic intent on an invalid model reply', async () => {
  await withMockFetch(noGeminiRecorder([], () => new Response(JSON.stringify({
    choices: [{ message: { content: 'فکر کنم شاید web باشه؟' } }],
  }), { status: 200 })), async () => {
    assert.equal(await selectToolIntent('فردا ساعت ۵ چی داریم', OR_CFG, OR_KEYS), 'chat');
  });
});

// ---------- capability resolution ----------

test('Gemini chat models resolve statically to full multimodal input (no network)', async () => {
  clearCapabilityCache();
  const fetcher = async () => { throw new Error('the static Gemini path must not fetch'); };
  const caps = await resolveCapabilities({ provider: 'gemini', gemini: 'gemini-3.5-flash-lite', openrouter: '' }, { fetcher });
  assert.deepEqual(caps.input, { text: true, image: true, audio: true, pdf: true });
  assert.equal(geminiInputSupport('text-embedding-004').image, false, 'legacy text-only Gemini ids stay excluded');
});

test('OpenRouter modalities map to precise support flags (cached, no Gemini)', async () => {
  clearCapabilityCache();
  const calls = [];
  await withMockFetch(noGeminiRecorder(calls, () => new Response(JSON.stringify({
    data: { architecture: { input_modalities: ['text', 'image'] } },
  }), { status: 200 })), async () => {
    const caps = await resolveCapabilities(OR_CFG, { timeoutMs: 2000 });
    assert.deepEqual(caps.input, { text: true, image: true, audio: false, pdf: false });
    assert.equal(caps.source, 'api');
    const again = await resolveCapabilities(OR_CFG);
    assert.equal(again.source, 'api');
  });
  assert.equal(calls.length, 1, 'capability lookups are cached per isolate');
});

test('router/uncertain models resolve to "unknown" and runtime-probe instead of hard-blocking', async () => {
  clearCapabilityCache();
  await withMockFetch(noGeminiRecorder([], () => new Response(JSON.stringify({
    data: { id: 'openrouter/auto', architecture: { input_modalities: null } },
  }), { status: 200 })), async () => {
    const caps = await resolveCapabilities({ provider: 'openrouter', gemini: 'g', openrouter: 'openrouter/auto' }, { timeoutMs: 2000 });
    assert.deepEqual(caps.input, { text: true, image: 'unknown', audio: 'unknown', pdf: 'unknown' });
  });
  clearCapabilityCache();
  await withMockFetch(async () => new Response('{}', { status: 500 }), async () => {
    const caps = await resolveCapabilities({ provider: 'openrouter', gemini: 'g', openrouter: 'x/anything' }, { timeoutMs: 2000 });
    assert.equal(caps.source, 'error');
    assert.equal(caps.input.image, 'unknown');
  });
  clearCapabilityCache();
});

test('routing suffixes are stripped for capability lookups but kept in requests', async () => {
  clearCapabilityCache();
  const calls = [];
  await withMockFetch(noGeminiRecorder(calls, (url) => {
    calls[calls.length - 1].url = url;
    return new Response(JSON.stringify({ data: { architecture: { input_modalities: ['text'] } } }), { status: 200 });
  }), async () => {
    const caps = await resolveCapabilities({ provider: 'openrouter', gemini: 'g', openrouter: 'x/model:online' }, { timeoutMs: 2000 });
    assert.equal(caps.input.image, false);
  });
  assert.match(String(calls[0].url), /model\/x\/model$/);
  clearCapabilityCache();
});

test('capability lines are short Persian summaries', () => {
  assert.equal(capabilityLine({ provider: 'gemini', model: 'g', input: { text: true, image: true, audio: true, pdf: true }, source: 'static' }), 'متن، تصویر، صوت و PDF');
  assert.match(capabilityLine({ provider: 'openrouter', model: 'm', input: { text: true, image: false, audio: false, pdf: false }, source: 'api' }), /^متن/);
  assert.equal(capabilityLine({ provider: 'openrouter', model: 'm', input: { text: true, image: 'unknown', audio: false, pdf: false }, source: 'api' }).includes('نامشخص'), true);
});

// ---------- precise user-facing messages ----------

test('failMessage names the active model and the real reason', () => {
  const ctx = { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' };
  assert.match(failMessage(Error('AI_AUDIO_UNSUPPORTED'), ctx), /ورودی صوتی/);
  assert.match(failMessage(Error('AI_AUDIO_UNSUPPORTED'), ctx), /gemma-4-26b/);
  assert.match(failMessage(Error('AI_IMAGE_UNSUPPORTED'), ctx), /تصویر/);
  assert.match(failMessage(Error('AI_PDF_UNSUPPORTED'), ctx), /PDF/);
  assert.match(failMessage(Error('AI_AUDIO_FAILED'), ctx), /مدل فعلی/);
  assert.match(failMessage(Error('AI_KEY_OPENROUTER'), {}), /کلید OpenRouter/);
  assert.match(failMessage(Error('AI_KEY_GEMINI'), {}), /کلید Gemini/);
  assert.match(failMessage(Error('AI_402'), {}), /اعتبار/);
  assert.match(failMessage(Error('TTS_PROVIDER'), { provider: 'openrouter' }), /OpenRouter/);
});

// ---------- fresh-install provider defaulting ----------

test('config defaults pick the provider whose key exists; explicit rows still win', () => {
  assert.equal(parseBotConfig([], { preferProvider: 'gemini' }).provider, 'gemini');
  assert.equal(parseBotConfig([], { preferProvider: 'openrouter' }).provider, 'openrouter');
  assert.equal(parseBotConfig([{ setting_key: 'provider', setting_value: 'openrouter' }], { preferProvider: 'gemini' }).provider, 'openrouter', 'explicit admin selection always wins');
  assert.equal(parseBotConfig([]).provider, 'openrouter', 'no hint: historical default');
});

// ---------- source-scan regression guards ----------

test('no code path may force the provider back to Gemini', () => {
  for (const file of ['saeed-ai-v7/core/work.ts', 'saeed-ai-v7/core/life.ts', 'saeed-ai-v7/core/voice.ts', 'saeed-ai-ui/core/conversation.ts', 'saeed-ai-ui/core/search.ts']) {
    const src = read(join('supabase/functions', file));
    assert.doesNotMatch(src, /provider\s*[:=]\s*"gemini"/, `${file} must never override the active provider`);
    assert.doesNotMatch(src, /provider:\s*"gemini"\s*as\s*const/, `${file} must never force the gemini provider`);
  }
});

test('the Gemini API URL appears only in the provider transports that legitimately talk to it', () => {
  const allowed = new Set([
    'supabase/functions/_shared/ai.ts',           // gemini branch of the adapter
    'supabase/functions/_shared/web-search.ts',   // gemini grounding branch
    'supabase/functions/_shared/tts.ts',          // dedicated Gemini TTS engine
    'supabase/functions/_shared/morning-voice.ts',// gemini branch of the briefing voice
    'supabase/functions/_shared/intent-model.ts', // gemini branch of the classifier
    'supabase/functions/saeed-ai-v7/core/admin.ts', // testModel: admin explicitly tests the Gemini endpoint
  ]);
  const offenders = [];
  const scan = (dir, files = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules' || name === '.git') continue;
      if (name.endsWith('.ts')) files.push(full);
      else {
        try { scan(full, files); } catch { /* not a directory */ }
      }
    }
    return files;
  };
  for (const file of scan(join(root, 'supabase/functions'))) {
    const rel = file.slice(root.length + 1).replaceAll('\\', '/');
    if (allowed.has(rel)) continue;
    if (readFileSync(file, 'utf8').includes('generativelanguage.googleapis.com')) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `files talking to Gemini directly outside the provider transports: ${offenders.join(', ')}`);
});

test('both entrypoints boot when only an OpenRouter key exists', () => {
  const v7 = read('supabase/functions/saeed-ai-v7/core/state.ts');
  const ui = read('supabase/functions/saeed-ai-ui/core/state.ts');
  assert.match(v7, /\(GK \|\| RK\)/, 'processor ready() accepts either provider key');
  assert.match(ui, /\(GK \|\| RK\)/, 'gateway ready() accepts either provider key');
});

test('work.ts wires the capability gate and provider-aware calls', () => {
  const work = read('supabase/functions/saeed-ai-v7/core/work.ts');
  assert.match(work, /rejectUnsupported/, 'capability gate exists');
  assert.match(work, /groundedSearch\(input, system, s, \{ gemini: GK, openrouter: RK \}\)/, 'web tool passes the active config and both keys');
  assert.match(work, /s\.chatSearch && s\.provider === "gemini"/, 'chat grounding is Gemini-only by design');
  assert.match(work, /TTS_PROVIDER/, 'voice-out explains itself when the active provider cannot synthesize');
  assert.doesNotMatch(work, /pickSearchModel/, 'search model picking lives in the search module only');
});

test('reminder/task parsing no longer pins the gemini provider', () => {
  const life = read('supabase/functions/saeed-ai-v7/core/life.ts');
  assert.match(life, /const s = await cfg\(\);/, 'parsing uses the active provider config');
  assert.match(life, /failMessage\(e, \{ provider: s\.provider/, 'AI failures surface precise messages');
});

test('the reminders dispatcher gates briefing voice-out on the active provider', () => {
  const dispatch = read('supabase/functions/_shared/dispatch.ts');
  assert.match(dispatch, /voiceCfg\.prefer !== "openrouter"/, 'no hidden Gemini TTS while OpenRouter is active');
  const reminders = read('supabase/functions/saeed-ai-reminders/index.ts');
  assert.match(reminders, /voiceCfg\.prefer === "openrouter"\) return/, 'the speak dependency checks the provider before synthesizing');
});

test('tool intents reachable from the gateway use the provider-aware classifier', () => {
  for (const file of ['saeed-ai-v7/index.ts', 'saeed-ai-ui/index.ts']) {
    const src = read(join('supabase/functions', file));
    assert.match(src, /selectToolIntent\((?:requestText|text), (?:await cfg\(\)|await config\(\)), \{ gemini: GK, openrouter: RK \}\)/, `${file} classifies on the active provider`);
    assert.doesNotMatch(src, /selectToolIntent\([^,]+, GK,/, `${file} no longer hardcodes the Gemini classifier`);
  }
});
