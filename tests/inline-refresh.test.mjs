import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLifeCallback } from '../supabase/functions/_shared/life.ts';

test('ticking a shopping item edits original message with refreshed text and undo button', async () => {
  const filters = [], telegram = [];
  let queried = 0;
  const db = {
    from(table) {
      assert.equal(table, 'saeed_ai_shopping');
      queried++;
      if (queried === 1) {
        return {
          update(values) { assert.deepEqual(values, { done: true }); return this; },
          eq(k, v) { filters.push([k, v]); return this; },
          select() { return Promise.resolve({ data: [{ id: 7 }], error: null }); },
        };
      }
      return {
        select() { return this; },
        eq(k, v) { filters.push([k, v]); return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: [{ id: 7, item: 'شیر', done: true }, { id: 8, item: 'نان', done: false }], error: null }); },
      };
    },
  };
  const c = {
    db,
    tg: async (method, payload) => { telegram.push({ method, payload }); },
    send: async () => { throw Error('No redundant acknowledgment should be sent'); },
  };
  assert.equal(await handleLifeCallback(c, 123, 123, 'shop:done:7', 456), true);
  assert.deepEqual(filters.filter(([k]) => k === 'telegram_user_id'), [['telegram_user_id', 123], ['telegram_user_id', 123]]);
  assert.deepEqual(filters.filter(([k]) => k === 'done'), [['done', false]]);
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0].method, 'editMessageText');
  assert.equal(telegram[0].payload.message_id, 456);
  assert.match(telegram[0].payload.text, /✅ شیر/);
  assert.match(telegram[0].payload.text, /▫️ نان/);
  assert.equal(telegram[0].payload.reply_markup.inline_keyboard[0][0].callback_data, 'shop:undo:7');
});

test('stale shopping button must not falsely claim an item changed', async () => {
  const messages = [], telegram = [];
  const c = {
    db: { from() { return { update() { return this; }, eq() { return this; }, select() { return Promise.resolve({ data: [], error: null }); } }; } },
    tg: async (...args) => { telegram.push(args); },
    send: async (_, text) => { messages.push(text); },
  };
  assert.equal(await handleLifeCallback(c, 123, 123, 'shop:done:7', 456), true);
  assert.equal(telegram.length, 0);
  assert.match(messages[0], /قبلاً|متعلق/);
});
