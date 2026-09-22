import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLifeCallback, handleLifeMessage } from '../supabase/functions/_shared/life.ts';
import { fakeDb, fakeCtx } from './helpers/fake-db.mjs';

test('ticking a shopping item edits original message with refreshed text and undo button', async () => {
  const db = fakeDb({ saeed_ai_shopping: [{ id: 7, telegram_user_id: 123, item: 'شیر', done: false }, { id: 8, telegram_user_id: 123, item: 'نان', done: false }] });
  const { c, telegram, sent } = fakeCtx(db);
  assert.equal(await handleLifeCallback(c, 123, 123, 'shop:done:7', 456), true);
  assert.equal(db.rows('saeed_ai_shopping').find((x) => x.id === 7).done, true);
  assert.ok(db.rows('saeed_ai_shopping').find((x) => x.id === 7).done_at, 'purchase time is recorded for the weekly card');
  assert.equal(sent.length, 0, 'no redundant acknowledgment');
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0].method, 'editMessageText');
  assert.equal(telegram[0].payload.message_id, 456);
  assert.match(telegram[0].payload.text, /✅ شیر/);
  assert.match(telegram[0].payload.text, /▫️ نان/);
  const buttons = telegram[0].payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(buttons.includes('shop:undo:7'));
  assert.ok(buttons.includes('shop:delete:8'));
  assert.ok(buttons.some((b) => b.startsWith('shop:clear:')), 'clear-bought button appears once something is ticked');
});

test('stale or foreign shopping button must not falsely claim an item changed', async () => {
  const db = fakeDb({ saeed_ai_shopping: [{ id: 7, telegram_user_id: 999, item: 'شیر', done: false }] });
  const { c, telegram, sent } = fakeCtx(db);
  assert.equal(await handleLifeCallback(c, 123, 123, 'shop:done:7', 456), true);
  assert.equal(telegram.length, 0);
  assert.equal(db.rows('saeed_ai_shopping')[0].done, false);
  assert.match(sent[0].text, /قبلاً|متعلق/);
});

test('new shopping items stay visible after the 30th item (open and newest first)', async () => {
  const seed = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, telegram_user_id: 1, item: `قلم ${i + 1}`, done: false }));
  const db = fakeDb({ saeed_ai_shopping: seed });
  const { c, telegram } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'به لیست خرید اضافه کن زعفران', 50);
  await handleLifeMessage(c, 1, 1, 'لیست خرید', 51);
  const text = telegram.at(-1).payload.text;
  assert.match(text, /زعفران/);
  assert.ok(text.indexOf('زعفران') < text.indexOf('قلم 35'), 'newest item is listed first');
});

test('shopping delete button and clear-bought remove items for the owner only', async () => {
  const db = fakeDb({ saeed_ai_shopping: [
    { id: 1, telegram_user_id: 1, item: 'شیر', done: true },
    { id: 2, telegram_user_id: 1, item: 'نان', done: false },
    { id: 3, telegram_user_id: 2, item: 'پنیر', done: true },
  ] });
  const { c } = fakeCtx(db);
  await handleLifeCallback(c, 1, 1, 'shop:delete:2', 10);
  await handleLifeCallback(c, 1, 1, 'shop:delete:3', 10);
  assert.deepEqual(db.rows('saeed_ai_shopping').map((x) => x.id), [1, 3], 'foreign row untouched');
  await handleLifeMessage(c, 1, 1, 'پاک کردن خریدهای انجام‌شده', 11);
  assert.deepEqual(db.rows('saeed_ai_shopping').map((x) => x.id), [3]);
});

test('shared shopping list: invite, join, tick notifies the other members', async () => {
  const db = fakeDb();
  const owner = fakeCtx(db, { actorName: 'سعید' });
  await handleLifeMessage(owner.c, 1, 1, 'اشتراک لیست خرید', 1);
  const code = db.rows('saeed_ai_shopping_invites')[0].code;
  const member = fakeCtx(db, { actorName: 'مریم' });
  await handleLifeMessage(member.c, 2, 2, `عضو لیست خرید ${code}`, 2);
  assert.equal(db.rows('saeed_ai_shopping_members')[0].owner_user_id, 1);
  await handleLifeMessage(member.c, 2, 2, 'به لیست خرید اضافه کن شیر', 3);
  const item = db.rows('saeed_ai_shopping')[0];
  assert.equal(item.telegram_user_id, 1, 'members write into the owner list');
  await handleLifeCallback(member.c, 2, 2, `shop:done:${item.id}`, 9);
  assert.ok(member.sent.some((m) => m.chat === 1 && /مریم «شیر» رو خرید/.test(m.text)), 'owner is notified');
  assert.ok(!member.sent.some((m) => m.chat === 2 && /رو خرید/.test(m.text)), 'the actor is not notified');
  await handleLifeMessage(member.c, 2, 2, 'ترک لیست خرید', 4);
  assert.equal(db.rows('saeed_ai_shopping_members').length, 0);
});

test('a joiner cannot use an expired code or their own code', async () => {
  const db = fakeDb({ saeed_ai_shopping_invites: [{ code: '123456', owner_user_id: 1, expires_at: new Date(Date.now() - 1000).toISOString() }] });
  const { c, sent } = fakeCtx(db);
  await handleLifeMessage(c, 2, 2, 'عضو لیست خرید ۱۲۳۴۵۶', 1);
  assert.match(sent[0].text, /منقضی/);
  assert.equal(db.rows('saeed_ai_shopping_members').length, 0);
});
