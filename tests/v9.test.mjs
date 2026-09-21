import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExact } from '../supabase/functions/_shared/calculator.ts';
import { parseExpense, handleLifeCallback, renderTasks } from '../supabase/functions/_shared/life.ts';
import { nextOccurrence } from '../supabase/functions/_shared/repeat.ts';

test('exact Persian percentage, decimal and division by zero', () => {
  assert.match(calculateExact('۱۲٪ از ۲ میلیون'), /۲۴۰/);
  assert.match(calculateExact('۱.۲ + ۳.۴'), /۴.۶/);
  assert.match(calculateExact('3 / 0'), /صفر/);
  assert.equal(calculateExact('eval(1+1)'), null);
});
test('expenses never guess currency or confuse prices with spending', () => {
  assert.equal(parseExpense('ناهار ۴۸۰'), 'currency_missing');
  assert.equal(parseExpense('ناهار ۴۸۰ هزار تومان').amount, 480000n);
  assert.equal(parseExpense('خرج تاکسی ۲۰۰۰۰۰ ریال').amount, 20000n);
  assert.equal(parseExpense('قیمت ناهار ۴۸۰ هزار تومان'), null);
});
test('recurrence catches up, retains monthly anchor and validates interval', () => {
  assert.equal(nextOccurrence('2026-09-20T04:00:00Z', 'daily', null, null, new Date('2026-09-21T04:01:00Z')), '2026-09-22T04:00:00.000Z');
  assert.equal(nextOccurrence('2026-01-30T20:30:00Z', 'monthly', null, 31, new Date('2026-03-01T00:00:00Z')), '2026-03-30T20:30:00.000Z');
  assert.equal(nextOccurrence('2026-09-20T04:00:00Z', 'hours', 8, null, new Date('2026-09-20T13:00:00Z')), '2026-09-20T20:00:00.000Z');
  assert.throws(() => nextOccurrence('2026-09-20T04:00:00Z', 'hours', 0, null));
});

function mockTaskContext({ stale = false, initialDone = false, editFails = false } = {}) {
  const calls = [], filters = [], tasks = [{ id: 99, task: 'پیگیری آزمایش', done: initialDone }];
  let deleted = false;
  const c = {
    db: { from(table) {
      assert.equal(table, 'saeed_ai_tasks');
      let action = 'read', patch = null, filtersForQuery = [];
      const q = {
        update(values) { action = 'update'; patch = values; return this; },
        delete() { action = 'delete'; return this; },
        select() { return this; },
        eq(key, value) { filters.push([key, value]); filtersForQuery.push([key, value]); return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: deleted ? [] : tasks.map(x => ({ ...x })), error: null }); },
        then(resolve, reject) {
          const owns = filtersForQuery.some(([key, value]) => key === 'telegram_user_id' && value === 123);
          const matches = filtersForQuery.every(([key, value]) => key === 'telegram_user_id' ? value === 123 : key === 'id' ? value === 99 : key === 'done' ? value === tasks[0].done : true);
          const changed = !stale && !deleted && owns && matches;
          if (changed && action === 'update') Object.assign(tasks[0], patch);
          if (changed && action === 'delete') deleted = true;
          return Promise.resolve({ data: changed ? [{ id: 99 }] : [], error: null }).then(resolve, reject);
        },
      };
      return q;
    } },
    tg: async (method, payload) => {
      calls.push({ method, payload });
      if (editFails && method === 'editMessageText') throw Error('MESSAGE_EDIT_FAILED');
    },
    send: async (_, message) => { calls.push({ method: 'send', payload: { text: message } }); },
  };
  return { c, calls, filters, tasks };
}

test('task done callback edits original message, scopes owner and offers undo', async () => {
  const { c, calls, filters, tasks } = mockTaskContext();
  assert.equal(await handleLifeCallback(c, 123, 123, 'task:done:99', 456), true);
  assert.equal(tasks[0].done, true);
  assert.ok(filters.some(([key, value]) => key === 'telegram_user_id' && value === 123));
  assert.equal(calls.filter(x => x.method === 'send').length, 0, 'no redundant done bubble');
  const edit = calls.find(x => x.method === 'editMessageText');
  assert.equal(edit.payload.message_id, 456);
  assert.match(edit.payload.text, /☑️ پیگیری آزمایش/);
  assert.equal(edit.payload.reply_markup.inline_keyboard[0][0].callback_data, 'task:undo:99');
});

test('task undo reopens the item with a refreshed completion button', async () => {
  const { c, calls, tasks } = mockTaskContext({ initialDone: true });
  assert.equal(await handleLifeCallback(c, 123, 123, 'task:undo:99', 456), true);
  assert.equal(tasks[0].done, false);
  assert.equal(calls.find(x => x.method === 'editMessageText').payload.reply_markup.inline_keyboard[0][0].callback_data, 'task:done:99');
});

test('stale task callback refreshes without falsely claiming it changed', async () => {
  const { c, calls } = mockTaskContext({ stale: true, initialDone: true });
  assert.equal(await handleLifeCallback(c, 123, 123, 'task:done:99', 456), true);
  assert.ok(calls.some(x => x.method === 'editMessageText'));
  assert.equal(calls.filter(x => x.method === 'send').length, 0);
});

test('task list falls back to a new message only if Telegram cannot edit', async () => {
  const { c, calls } = mockTaskContext({ editFails: true });
  await renderTasks(c, 123, 123, 456);
  assert.deepEqual(calls.map(x => x.method), ['editMessageText', 'sendMessage']);
});
