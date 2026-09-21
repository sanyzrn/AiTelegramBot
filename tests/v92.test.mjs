import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTasks, handleLifeMessage } from '../supabase/functions/_shared/life.ts';

const root = resolve('supabase/functions');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('renderTasks with zero tasks sends a message without an empty inline_keyboard', async () => {
  const calls = [];
  const c = {
    db: { from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); } }; } },
    tg: async (method, payload) => calls.push({ method, payload }),
    send: async () => { throw Error('renderTasks must use tg, not send'); },
  };
  await renderTasks(c, 123, 123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.match(calls[0].payload.text, /فعلاً خالیه/);
  assert.equal(calls[0].payload.reply_markup, undefined, 'empty inline_keyboard is a Telegram 400');
});

test('deleting the last task via inline button refreshes cleanly instead of erroring', async () => {
  const calls = [];
  let deleted = false;
  const c = {
    db: { from() {
      return {
        update() { return this; }, delete() { deleted = true; return this; },
        eq() { return this; }, select() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: deleted ? [] : [{ id: 5, task: 'خرید نان', done: false }], error: null }); },
      };
    } },
    tg: async (method, payload) => calls.push({ method, payload }),
    send: async (_, text) => calls.push({ method: 'send', payload: { text } }),
  };
  assert.equal(await handleLifeCallbackSafe(c, 123, 123, 'task:delete:5', 456), true);
  const edit = calls.find((x) => x.method === 'editMessageText');
  assert.ok(edit, 'original list message must be edited');
  assert.match(edit.payload.text, /فعلاً خالیه/);
  assert.equal(edit.payload.reply_markup, undefined);
});

async function handleLifeCallbackSafe(c, id, chat, cb, messageId) {
  const { handleLifeCallback } = await import('../supabase/functions/_shared/life.ts');
  return handleLifeCallback(c, id, chat, cb, messageId);
}

test('shopping add reports only genuinely new items', async () => {
  const messages = [];
  const mk = (added) => ({
    db: { from() { return { upsert() { return this; }, select() { return Promise.resolve({ data: added, error: null }); } }; } },
    tg: async () => { throw Error('no telegram calls expected'); },
    send: async (_, text) => messages.push(text),
  });
  const fresh = mk([{ id: 1 }, { id: 2 }]);
  await handleLifeMessage(fresh, 123, 123, 'به لیست خرید اضافه کن شیر، نان', 10);
  assert.match(messages[0], /۲ قلم/);
  const dupes = mk([]);
  await handleLifeMessage(dupes, 123, 123, 'به لیست خرید اضافه کن شیر، نان', 11);
  assert.match(messages[1], /قبلاً توی لیست خرید بودن/);
});

test('voice submission honors a voice-capable tool chosen from the keyboard', () => {
  const voice = read('saeed-ai-v7/core/voice.ts');
  const region = voice.slice(voice.indexOf('export async function chooseVoice'));
  assert.match(region, /pending_tool/, 'chooseVoice must consult pending_tool');
  assert.match(region, /transcribe.*summarize.*translate/s, 'voice-capable tools must map through');
});

test('unknown admin flow actions fail closed instead of writing a model id', () => {
  const admin = read('saeed-ai-v7/core/admin.ts');
  const guardAt = admin.indexOf('a !== "add_model" && a !== "add_openrouter_model"');
  const providerAt = admin.indexOf('const provider = a === "add_model"');
  assert.ok(guardAt > 0 && providerAt > guardAt, 'guard must precede the provider fallthrough');
});

test('processor web tool uses the shared grounded search with sources', () => {
  const work = read('saeed-ai-v7/core/work.ts');
  assert.match(work, /from "\.\.\/\.\.\/_shared\/web-search\.ts"/);
  assert.match(work, /tool === "web"\s*\n\s*\? await groundedSearch/);
  const shared = read('_shared/web-search.ts');
  assert.match(shared, /google_search/);
  assert.match(shared, /SEARCH_NO_SOURCES/);
  const wrapper = read('saeed-ai-ui/core/search.ts');
  assert.match(wrapper, /_shared\/web-search\.ts/, 'gateway must delegate to the shared module');
});

test('numeric task completion accepts Persian digits', () => {
  const index = read('saeed-ai-v7/index.ts');
  assert.match(index, /\[۰-۹\\d\]\{1,2\}/, '«انجام شد ۳» must match');
  assert.match(index, /normalizeTimerDigits\(doneM\[1\]\)/);
});
