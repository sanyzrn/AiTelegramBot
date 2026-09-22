import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLifeMessage, handleLifeCallback } from '../supabase/functions/_shared/life.ts';
import { parseWatcher, marketTriggered } from '../supabase/functions/_shared/life-watchers.ts';
import { parseReceiptJson, proposeReceipt } from '../supabase/functions/_shared/receipt.ts';
import { pomodoroPlan } from '../supabase/functions/_shared/life-reminders.ts';
import { looksTimed } from '../supabase/functions/_shared/life-memories.ts';
import { renderWeekly, sparkline } from '../supabase/functions/_shared/life-weekly.ts';
import { isLifeCommand } from '../supabase/functions/_shared/life-commands.ts';
import { fakeDb, fakeCtx } from './helpers/fake-db.mjs';

test('memories: only explicit «یادت باشه», deduplicated, listed with delete buttons and clearable', async () => {
  const db = fakeDb();
  const { c, sent, telegram } = fakeCtx(db);
  assert.equal(await handleLifeMessage(c, 1, 1, 'یادت باشه من گیاه‌خوارم', 1), true);
  await handleLifeMessage(c, 1, 1, 'یادت باشه من گیاه‌خوارم', 2);
  assert.equal(db.rows('saeed_ai_memories').length, 1);
  assert.match(sent[1].text, /از قبل می‌دونستم/);
  await handleLifeMessage(c, 1, 1, 'حافظه‌هام', 3);
  const buttons = telegram.at(-1).payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(buttons.includes('mem:delete:1') && buttons.includes('mem:clear:0'));
  await handleLifeCallback(c, 1, 1, 'mem:delete:1', 77);
  assert.equal(db.rows('saeed_ai_memories').length, 0);
  assert.equal(await handleLifeMessage(c, 1, 1, 'یادت باشه فردا ساعت ۸ جلسه دارم', 4), false, 'timed phrases stay reminders');
  assert.ok(looksTimed('فردا ساعت ۸'));
});

test('memories are capped per user', async () => {
  const db = fakeDb({ saeed_ai_memories: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, telegram_user_id: 1, fact: `f${i}` })) });
  const { c, sent } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'یادت باشه قهوه تلخ دوست دارم', 5);
  assert.match(sent[0].text, /حافظه‌ت پره/);
  assert.equal(db.rows('saeed_ai_memories').length, 30);
});

test('watcher parsing: thresholds, karat, rial, direction and rain', () => {
  assert.deepEqual(parseWatcher('وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن')?.threshold, 95000);
  assert.equal(parseWatcher('وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن')?.kind, 'usd_above');
  assert.equal(parseWatcher('اگه دلار زیر ۸۰ هزار اومد بهم بگو')?.kind, 'usd_below');
  assert.equal(parseWatcher('وقتی طلای ۱۸ عیار از ۵ میلیون تومان بالاتر رفت خبرم کن')?.threshold, 5000000, '«۱۸ عیار» is not the threshold');
  assert.equal(parseWatcher('وقتی دلار از ۹۵۰ هزار ریال رد شد خبرم کن')?.threshold, 95000);
  const rain = parseWatcher('اگه فردا بارون اومد یادم بنداز چتر ببرم');
  assert.equal(rain.kind, 'rain');
  assert.equal(rain.tomorrow, true);
  assert.match(rain.note, /چتر ببرم/);
  assert.equal(parseWatcher('هر وقت بارون اومد خبرم کن').recurring, true);
  assert.equal(parseWatcher('وقتی رسیدم خونه یادم بنداز'), null, 'unverifiable conditions are not watchers');
  assert.equal(parseWatcher('وقتی دلار از ۹ تومن رد شد خبرم کن'), null, 'absurd thresholds rejected');
  assert.ok(marketTriggered('usd_above', 95000, { usd: 95000 }));
  assert.ok(!marketTriggered('usd_below', 95000, { usd: 96000 }));
  assert.ok(!marketTriggered('gold_above', 1, {}));
});

test('watchers are stored for the user and cancellable from the list', async () => {
  const db = fakeDb();
  const { c, sent, telegram } = fakeCtx(db);
  assert.equal(await handleLifeMessage(c, 1, 1, 'وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن', 1), true);
  assert.match(sent[0].text, /Navasan/);
  await handleLifeMessage(c, 1, 1, 'هشدارهام', 2);
  assert.equal(telegram[0].payload.reply_markup.inline_keyboard[0][0].callback_data, 'watch:cancel:1');
  await handleLifeCallback(c, 2, 2, 'watch:cancel:1');
  assert.equal(db.rows('saeed_ai_watchers')[0].active, true, 'another user cannot cancel it');
  await handleLifeCallback(c, 1, 1, 'watch:cancel:1');
  assert.equal(db.rows('saeed_ai_watchers')[0].active, false);
  assert.equal(await handleLifeMessage(c, 1, 1, 'وقتی رسیدم خونه یادم بنداز', 3), false, 'falls through to the reminder parser');
});

test('receipt JSON is validated and rial totals convert exactly', () => {
  assert.deepEqual(parseReceiptJson({ is_receipt: true, merchant: 'افق کوروش', category: 'سوپرمارکت', total: 3400000, currency: 'rial' }), { description: 'سوپرمارکت افق کوروش', amount: 340000n });
  assert.equal(parseReceiptJson({ is_receipt: true, total: 3400005, currency: 'rial' }), null, 'fractional toman is rejected');
  assert.equal(parseReceiptJson({ is_receipt: false, total: 10, currency: 'toman' }), null);
  assert.equal(parseReceiptJson({ is_receipt: true, total: null, currency: 'toman' }), null, 'no guessed totals');
  assert.equal(parseReceiptJson({ is_receipt: true, total: 5000, currency: null }), null, 'no guessed currency');
});

test('receipt drafts are saved only after ✅, once, and only by their owner', async () => {
  const db = fakeDb();
  const { c, telegram, sent } = fakeCtx(db);
  await proposeReceipt(c, 1, 1, { description: 'سوپرمارکت', amount: 340000n });
  assert.equal(db.rows('saeed_ai_expenses').length, 0);
  const [ok, no] = telegram[0].payload.reply_markup.inline_keyboard[0].map((b) => b.callback_data);
  assert.equal(no, 'rcpt:no:1');
  await handleLifeCallback(c, 2, 2, ok, 9);
  assert.equal(db.rows('saeed_ai_expenses').length, 0, 'a foreign user cannot confirm');
  await handleLifeCallback(c, 1, 1, ok, 9);
  await handleLifeCallback(c, 1, 1, ok, 9);
  assert.equal(db.rows('saeed_ai_expenses').length, 1);
  assert.equal(db.rows('saeed_ai_expenses')[0].amount_toman, '340000');
  assert.match(sent.at(-1).text, /منقضی|تصمیمش/);
});

test('expenses: report has delete buttons, «حذف آخرین خرج» removes only the newest own row', async () => {
  const db = fakeDb({ saeed_ai_expenses: [
    { id: 1, telegram_user_id: 1, description: 'ناهار', amount_toman: 480000, created_at: new Date().toISOString() },
    { id: 2, telegram_user_id: 1, description: 'تاکسی', amount_toman: 90000, created_at: new Date().toISOString() },
    { id: 3, telegram_user_id: 2, description: 'قهوه', amount_toman: 50000, created_at: new Date().toISOString() },
  ] });
  const { c, telegram, sent } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'خرج‌هام', 1);
  assert.match(telegram[0].payload.text, /۵۷۰٬۰۰۰ تومان/);
  assert.ok(telegram[0].payload.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'exp:delete:1'));
  await handleLifeMessage(c, 1, 1, 'حذف آخرین خرج', 2);
  assert.match(sent[0].text, /تاکسی/);
  assert.deepEqual(db.rows('saeed_ai_expenses').map((x) => x.id), [1, 3]);
  await handleLifeCallback(c, 1, 1, 'exp:delete:3', 5);
  assert.deepEqual(db.rows('saeed_ai_expenses').map((x) => x.id), [1, 3], 'foreign expense untouched');
  await handleLifeMessage(c, 1, 1, 'ناهار ۴۸۰ هزار تومان', 99);
  assert.match(sent.at(-1).text, /حذف آخرین خرج/, 'every new expense tells how to undo it');
});

test('reminders list shows local times with cancel buttons; done removes the buttons', async () => {
  const at = new Date(Date.now() + 3600000).toISOString();
  const db = fakeDb({
    saeed_ai_reminders: [{ id: 7, telegram_user_id: 1, telegram_chat_id: 1, note: 'جلسه', remind_at: at, repeat_rule: 'weekly', sent: false, canceled: false, sent_at: null }],
    saeed_ai_briefing_preferences: [{ telegram_user_id: 1, timezone: 'Europe/Berlin' }],
  });
  const { c, telegram, sent } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'یادآورهام', 1);
  assert.match(telegram[0].payload.text, /جلسه/);
  assert.match(telegram[0].payload.text, /هفتگی/);
  assert.equal(telegram[0].payload.reply_markup.inline_keyboard[0][0].callback_data, 'reminder:cancel:7');
  await handleLifeCallback(c, 1, 1, 'reminder:done:7', 44);
  assert.equal(telegram[1].method, 'editMessageReplyMarkup', 'handled delivery loses its buttons');
  assert.match(sent[0].text, /نوبت بعدی/);
  await handleLifeCallback(c, 1, 1, 'reminder:cancel:7', 44);
  assert.equal(db.rows('saeed_ai_reminders')[0].canceled, true);
  assert.match(sent.at(-1).text, /تکرارهای بعدی/);
});

test('pomodoro plans 25/5 cycles, caps at four and books real reminders once', async () => {
  const plan = pomodoroPlan(2, 0);
  assert.deepEqual(plan.map((p) => p.at.getTime() / 60000), [25, 30, 55]);
  assert.equal(pomodoroPlan(9, 0).length, 7);
  const db = fakeDb();
  const { c, sent } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'پومودورو ۲', 500);
  await handleLifeMessage(c, 1, 1, 'پومودورو ۲', 500);
  assert.equal(db.rows('saeed_ai_reminders').length, 3, 'a re-delivered update does not double-book');
  assert.match(sent[1].text, /قبلاً ثبت/);
});

test('time zone, briefing hour and voice commands update life preferences', async () => {
  const db = fakeDb();
  const { c, sent } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'منطقه زمانی Europe/Berlin', 1);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].timezone, 'Europe/Berlin');
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].enabled, false, 'never enables the briefing silently');
  await handleLifeMessage(c, 1, 1, 'منطقه زمانی', 2);
  assert.match(sent[1].text, /برلین/);
  await handleLifeMessage(c, 1, 1, 'صبح‌نامه ساعت ۸', 3);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].send_hour, 8);
  await handleLifeMessage(c, 1, 1, 'صبح‌نامه ساعت ۳', 4);
  assert.match(sent.at(-1).text, /۵ تا ۱۱/);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].send_hour, 8);
  await handleLifeMessage(c, 1, 1, 'صبح‌نامه صوتی روشن', 5);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].voice, true);
  await handleLifeMessage(c, 1, 1, 'خلاصه هفته روشن', 6);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].weekly_enabled, true);
});

test('enabling the briefing no longer writes a user-access row (B9)', async () => {
  const db = fakeDb();
  const { c } = fakeCtx(db);
  await handleLifeMessage(c, 1, 1, 'صبح‌نامه روشن', 1);
  assert.equal(db.rows('telegram_bot_user_access').length, 0);
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].enabled, true);
});

test('weekly card: totals, categories and a flat sparkline for an empty week', () => {
  const text = renderWeekly({ now: new Date('2026-09-25T17:00:00Z'), tz: 'Asia/Tehran', tasksDone: 4, tasksOpen: 2, bought: 3, activeReminders: 1, expenses: [
    { description: 'ناهار با بچه‌ها', amount_toman: 480000, created_at: '2026-09-24T10:00:00Z' },
    { description: 'ناهار', amount_toman: 20000, created_at: '2026-09-23T10:00:00Z' },
    { description: 'تاکسی', amount_toman: 100000, created_at: '2026-09-25T10:00:00Z' },
  ] });
  assert.match(text, /کارهای انجام‌شده: ۴/);
  assert.match(text, /ناهار: ۵۰۰٬۰۰۰ تومان/);
  assert.match(text, /۶۰۰٬۰۰۰ تومان/);
  assert.equal(sparkline([0, 0, 0]), '▁▁▁');
  assert.equal(sparkline([0, 5, 10]).at(-1), '█');
});

test('life commands are recognised for gateway routing without false positives', () => {
  for (const t of ['یادآورهام', '/reminders', 'پومودورو', 'خلاصه هفته', 'حافظه‌هام', 'هشدارهام', 'منطقه زمانی تهران', 'صبح‌نامه صوتی روشن'])
    assert.ok(isLifeCommand(t), t);
  for (const t of ['سلام', 'یه جوک بگو', 'حافظه چیست؟']) assert.ok(!isLifeCommand(t), t);
});

test('forged callback pairs are ignored', async () => {
  const db = fakeDb({ saeed_ai_tasks: [{ id: 1, telegram_user_id: 1, task: 'x', done: true }] });
  const { c, telegram, sent } = fakeCtx(db);
  assert.equal(await handleLifeCallback(c, 1, 1, 'task:clear:1', 5), true);
  assert.equal(await handleLifeCallback(c, 1, 1, 'exp:undo:1', 5), true);
  assert.equal(db.rows('saeed_ai_tasks')[0].done, true);
  assert.equal(telegram.length + sent.length, 0);
});
