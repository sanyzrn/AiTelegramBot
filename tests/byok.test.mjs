import test from 'node:test';
import assert from 'node:assert/strict';

import { userAiContext, validatePersonalApiKey } from '../supabase/functions/_shared/user-ai.ts';

const base = {
  provider: 'gemini',
  gemini: 'gemini-global-model',
  openrouter: 'openrouter/global-model',
  search: 'gemini-search',
  daily: 40,
  chatSearch: true,
};

test('personal OpenRouter key overrides the global provider only for that user', async () => {
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'nexa_user_api_get');
      assert.equal(args.p_user_id, 42);
      return { data: [{ provider: 'openrouter', api_key: 'or-personal-secret-key' }], error: null };
    },
  };
  const ctx = await userAiContext(db, 42, base, { gemini: 'global-gemini', openrouter: 'global-openrouter' });
  assert.equal(ctx.personal, true);
  assert.equal(ctx.config.provider, 'openrouter');
  assert.equal(ctx.keys.openrouter, 'or-personal-secret-key');
  assert.equal(ctx.keys.gemini, '');
});

test('missing personal key preserves the bot-wide provider and keys', async () => {
  const db = { async rpc() { return { data: [], error: null }; } };
  const keys = { gemini: 'global-gemini', openrouter: 'global-openrouter' };
  const ctx = await userAiContext(db, 9, base, keys);
  assert.equal(ctx.personal, false);
  assert.equal(ctx.config.provider, 'gemini');
  assert.deepEqual(ctx.keys, keys);
});

test('personal API validation sends the key only to the selected provider', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };

  assert.equal(await validatePersonalApiKey('openrouter', 'or-personal-key-123', fetcher), true);
  assert.match(calls[0].url, /openrouter\.ai\/api\/v1\/key/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer or-personal-key-123');

  calls.length = 0;
  assert.equal(await validatePersonalApiKey('gemini', 'gemini-personal-key-123', fetcher), true);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'gemini-personal-key-123');
});

test('source guards keep personal keys in Vault and explicit bans authoritative', async () => {
  const fs = await import('node:fs');
  const access = fs.readFileSync(new URL('../supabase/functions/_shared/access.ts', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261004171500_nexa_byok.sql', import.meta.url), 'utf8');
  assert.match(access, /if \(data\) return data\.enabled === true/);
  assert.match(access, /telegram_bot_user_api/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /vault\.update_secret/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.doesNotMatch(migration, /api_key\s+TEXT\s+NOT NULL/i, 'plain API keys must not live in a public table');
});
