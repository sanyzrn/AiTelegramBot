import test from 'node:test';
import assert from 'node:assert/strict';

import { generate } from '../supabase/functions/_shared/ai.ts';
import { normalizeBaseUrl, isValidCustomModel } from '../supabase/functions/_shared/openai-compat.ts';
import { parseBotConfig } from '../supabase/functions/_shared/bot-config.ts';
import { userAiContext, validatePersonalApiKey } from '../supabase/functions/_shared/user-ai.ts';
import { selectToolIntent } from '../supabase/functions/_shared/intent-model.ts';
import { groundedSearch } from '../supabase/functions/_shared/web-search.ts';
import { resolveCapabilities } from '../supabase/functions/_shared/capabilities.ts';
import { failMessage } from '../supabase/functions/_shared/ai-errors.ts';
import { morningVoiceConfig } from '../supabase/functions/_shared/dispatch.ts';

const CFG = { provider: 'custom', gemini: 'g', openrouter: 'o/m', custom: 'my-model', customBaseUrl: 'https://llm.example.com/v1' };
const KEYS = { gemini: 'gemini-must-not-be-used', openrouter: 'or-must-not-be-used', custom: 'custom-secret-key' };

test('normalizeBaseUrl accepts public https endpoints and strips noise', () => {
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl(' https://api.groq.com/openai/v1/chat/completions '), 'https://api.groq.com/openai/v1');
  assert.equal(normalizeBaseUrl('https://llm.example.com:8443/v1'), 'https://llm.example.com:8443/v1');
});

test('normalizeBaseUrl rejects insecure, internal and credentialed addresses', () => {
  for (const bad of [
    'http://api.openai.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/v1',
    'https://192.168.1.2/v1', 'https://172.16.0.1/v1', 'https://169.254.169.254/latest', 'https://[::1]/v1',
    'https://printer.local/v1', 'https://intranet/v1', 'https://user:pw@api.example.com/v1',
    'https://api.example.com/v1?key=1', 'not a url', '', 'ftp://api.example.com',
  ]) assert.equal(normalizeBaseUrl(bad), null, bad);
  assert.equal(isValidCustomModel('gpt-4o-mini'), true);
  assert.equal(isValidCustomModel('meta-llama/Llama-3.3-70B-Instruct:free'), true);
  assert.equal(isValidCustomModel('bad model'), false);
  assert.equal(isValidCustomModel(''), false);
});

test('custom provider sends chat to the configured URL with the custom key and model only', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: ' hi ' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
  };
  const r = await generate(CFG, KEYS, [{ role: 'user', parts: [{ text: 'سلام' }] }], 'sys', { fetcher });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer custom-secret-key');
  assert.equal(calls[0].body.model, 'my-model');
  assert.equal(r.provider, 'custom');
  assert.equal(r.text, 'hi');
});

test('custom provider fails closed on a missing key or unsafe URL', async () => {
  const fetcher = async () => { throw Error('must not be called'); };
  await assert.rejects(generate(CFG, { ...KEYS, custom: '' }, [{ role: 'user', parts: [{ text: 'x' }] }], 's', { fetcher }), /AI_KEY_CUSTOM/);
  await assert.rejects(generate({ ...CFG, customBaseUrl: 'http://10.0.0.1/v1' }, KEYS, [{ role: 'user', parts: [{ text: 'x' }] }], 's', { fetcher }), /AI_CUSTOM_CONFIG/);
  await assert.rejects(generate({ ...CFG, custom: '' }, KEYS, [{ role: 'user', parts: [{ text: 'x' }] }], 's', { fetcher }), /AI_CUSTOM_CONFIG/);
  assert.match(failMessage(Error('AI_KEY_CUSTOM')), /CUSTOM_API_KEY/);
  assert.match(failMessage(Error('AI_CUSTOM_CONFIG')), /آدرس/);
});

test('bot config reads the custom provider and model settings', () => {
  const cfg = parseBotConfig([
    { setting_key: 'provider', setting_value: 'custom' },
    { setting_key: 'custom_model', setting_value: 'm1' },
    { setting_key: 'custom_base_url', setting_value: 'https://x.example.com/v1' },
  ]);
  assert.equal(cfg.provider, 'custom');
  assert.equal(cfg.custom, 'm1');
  assert.equal(cfg.customBaseUrl, 'https://x.example.com/v1');
});

test('personal custom credentials carry their own URL and model and never reuse bot-wide ones', async () => {
  const base = { ...CFG, provider: 'gemini', custom: 'global-model', customBaseUrl: 'https://global.example.com/v1', search: 's', daily: 40, chatSearch: true };
  const db = { async rpc() { return { data: [{ provider: 'custom', api_key: 'personal-secret-key', base_url: 'https://mine.example.com/v1', model: 'mine' }], error: null }; } };
  const ctx = await userAiContext(db, 5, base, KEYS);
  assert.equal(ctx.personal, true);
  assert.equal(ctx.config.provider, 'custom');
  assert.equal(ctx.config.custom, 'mine');
  assert.equal(ctx.config.customBaseUrl, 'https://mine.example.com/v1');
  assert.deepEqual(ctx.keys, { gemini: '', openrouter: '', custom: 'personal-secret-key' });

  const broken = { async rpc() { return { data: [{ provider: 'custom', api_key: 'personal-secret-key', base_url: 'http://127.0.0.1', model: 'mine' }], error: null }; } };
  const fallback = await userAiContext(broken, 5, base, KEYS);
  assert.equal(fallback.personal, false, 'an unsafe stored URL is never called');
});

test('validatePersonalApiKey probes a custom endpoint with a tiny completion', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{}', { status: 200 }); };
  assert.equal(await validatePersonalApiKey('custom', 'sk-personal-key-123', fetcher, { baseUrl: 'https://mine.example.com/v1', model: 'mine' }), true);
  assert.equal(calls[0].url, 'https://mine.example.com/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].init.body).model, 'mine');
  assert.equal(await validatePersonalApiKey('custom', 'sk-personal-key-123', fetcher, { baseUrl: 'http://127.0.0.1/v1', model: 'mine' }), false);
  assert.equal(await validatePersonalApiKey('custom', 'sk-personal-key-123', fetcher), false);
  assert.equal(calls.length, 1, 'rejected input never leaves the bot');
});

test('classifier, search and capabilities respect the custom provider', async () => {
  const urls = [];
  const fetcher = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"tool":"ideas"}' } }] }), { status: 200 }); };
  assert.equal(await selectToolIntent('امروز یه کتاب خوب معرفی کن', CFG, KEYS, fetcher), 'ideas');
  assert.deepEqual(urls, ['https://llm.example.com/v1/chat/completions']);
  await assert.rejects(groundedSearch('q', 's', CFG, KEYS, fetcher), /SEARCH_UNSUPPORTED/);
  const caps = await resolveCapabilities(CFG);
  assert.equal(caps.provider, 'custom');
  assert.equal(caps.input.text, true);
  assert.equal(caps.input.image, 'unknown');
});

test('morning voice for a personal custom user never falls back to bot-owned keys', async () => {
  const rows = [{ setting_key: 'provider', setting_value: 'gemini' }];
  const db = {
    from() { return { select: async () => ({ data: rows, error: null }) }; },
    async rpc() { return { data: [{ provider: 'custom', api_key: 'personal-secret-key', base_url: 'https://mine.example.com/v1', model: 'mine' }], error: null }; },
  };
  const cfg = await morningVoiceConfig({ db, keys: KEYS }, 5);
  assert.equal(cfg.prefer, 'custom');
  assert.equal(cfg.customKey, 'personal-secret-key');
  assert.equal(cfg.customBaseUrl, 'https://mine.example.com/v1');
  assert.equal(cfg.geminiKey, undefined);
  assert.equal(cfg.openrouterKey, undefined);
});
