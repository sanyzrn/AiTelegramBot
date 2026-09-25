import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpenses, parseExpense, isExpenseCommand, recordExpenses, saveExpenses, money } from '../supabase/functions/_shared/life-expenses.ts';
import { handleLifeMessage } from '../supabase/functions/_shared/life.ts';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';
import { isLifeCommand } from '../supabase/functions/_shared/life-commands.ts';
import { isSpokenRequest } from '../supabase/functions/_shared/voice-intent.ts';
import { handleWebApp, signInitData } from '../supabase/functions/_shared/webapp.ts';
import { fakeDb, fakeCtx } from './helpers/fake-db.mjs';

const USER_MESSAGE = `چند تا هزینه ثبت کن حاجی
خرید میوه ۹۰۰ هزار تومان
خرید برنج دو میلیون و هشتصد هزار تومان
خرید اکانت Claude pro ماهانه ۶ میلیون تومان`;

test('the exact user message parses into three expenses with spelled-out amounts', () => {
  const r = parseExpenses(USER_MESSAGE);
  assert.ok(r, 'must parse');
  assert.equal(r.header, true);
  assert.deepEqual(r.items.map((x) => [x.description, x.amount]), [
    ['خرید میوه', 900000n],
    ['خرید برنج', 2800000n],
    ['خرید اکانت Claude pro ماهانه', 6000000n],
  ]);
});

test('one-line comma-separated and voice-style run-on lists parse too', () => {
  const comma = parseExpenses('چند تا هزینه ثبت کن: میوه ۹۰۰ هزار تومان، برنج دو میلیون و هشتصد هزار تومان، اکانت Claude ۶ میلیون تومان');
  assert.equal(comma.items.length, 3);
  assert.equal(comma.items[1].amount, 2800000n);
  const spoken = parseExpenses('چند تا هزینه ثبت کن حاجی خرید میوه نهصد هزار تومان خرید برنج دو میلیون و هشتصد هزار تومان خرید اکانت Claude pro ماهانه شش میلیون تومان');
  assert.equal(spoken.items.length, 3, 'a single spoken sentence still splits into items');
  assert.deepEqual(spoken.items.map((x) => x.amount), [900000n, 2800000n, 6000000n]);
});

test('a bare header message arms the flow but saves nothing', () => {
  const r = parseExpenses('چند تا هزینه ثبت کن حاجی');
  assert.equal(r.header, true);
  assert.equal(r.items.length, 0);
});

test('spelled-out Persian numbers convert exactly', () => {
  const one = (t) => parseExpenses(`خرید ${t}`)?.items[0]?.amount;
  assert.equal(one('دو میلیون و هشتصد هزار تومان'), 2800000n);
  assert.equal(one('چهارصد و هشتاد هزار تومان'), 480000n);
  assert.equal(one('پنجاه و شش هزار تومان'), 56000n);
  assert.equal(one('هفتصد پنجاه هزار تومان'), 750000n);
  assert.equal(one('دوازده هزار تومان'), 12000n);
  assert.equal(one('نیم میلیون تومان'), 500000n);
  assert.equal(one('دو و نیم میلیون تومان'), 2500000n);
  assert.equal(one('دو میلیون و نیم تومان'), 2500000n);
  assert.equal(one('۲.۸ میلیون تومان'), 2800000n);
  assert.equal(one('۱٫۵ میلیون تومان'), 1500000n);
  assert.equal(one('۲۰۰۰۰۰ ریال'), 20000n);
  assert.equal(one('سه میلیارد تومان'), 3000000000n);
});

test('amount-first lines and multi-line without a header still work', () => {
  assert.deepEqual(parseExpenses('۹۰۰ هزار تومان خرید میوه')?.items[0], { description: 'خرید میوه', amount: 900000n });
  const bare = parseExpenses('ناهار ۴۸۰ هزار تومان\nتاکسی ۵۶ هزار تومان');
  assert.equal(bare.items.length, 2);
  const joined = parseExpenses('میوه ۹۰۰ هزار تومان و نان ۵۰ هزار تومان');
  assert.deepEqual(joined.items.map((x) => x.amount), [900000n, 50000n]);
});

test('questions, prices and non-expense sentences are never expenses', () => {
  assert.equal(parseExpense('قیمت ناهار ۴۸۰ هزار تومان'), null);
  assert.equal(parseExpense('یه پیتزا ۵۰۰ هزار تومان می‌خوام بخرم'), null);
  assert.equal(parseExpense('قیمت دلار الان چند تومنه؟'), null);
  assert.equal(parseExpense('یادت باشه فردا ساعت ۸ جلسه دارم'), null);
  assert.equal(parseExpense('پومودورو ۲'), null);
  assert.equal(parseExpense('به لیست خرید اضافه کن شیر، نان'), null);
});

test('the old parseExpense contract is preserved', () => {
  assert.equal(parseExpense('ناهار ۴۸۰'), 'currency_missing');
  assert.equal(parseExpense('ناهار ۴۸۰ هزار تومان').amount, 480000n);
  assert.equal(parseExpense('خرج تاکسی ۲۰۰۰۰۰ ریال').amount, 20000n);
});

test('recordExpenses saves the whole batch once, with summary and delete buttons', async () => {
  const db = fakeDb({});
  const { c, telegram, sent } = fakeCtx(db);
  const ok = await recordExpenses(c, 1, 1, USER_MESSAGE, 77);
  assert.equal(ok, true);
  const rows = db.rows('saeed_ai_expenses');
  assert.equal(rows.length, 3, 'all three expenses are saved');
  assert.deepEqual(rows.map((x) => x.amount_toman), ['900000', '2800000', '6000000']);
  assert.equal(rows[0].telegram_update_id, 77, 'the first row carries the update id for idempotency');
  assert.ok(rows.slice(1).every((x) => x.telegram_update_id === null || x.telegram_update_id === undefined));
  const saved = telegram.find((t) => /۳ هزینه ثبت شد/.test(t.payload.text)) || sent.find((t) => /۳ هزینه ثبت شد/.test(t.text));
  assert.ok(saved, 'the batch summary is sent');
  const view = telegram.at(-1);
  assert.match(view.payload.text, /جمع: ۹٬۷۰۰٬۰۰۰ تومان/);
  assert.equal(view.payload.reply_markup.inline_keyboard.length, 3, 'one delete button per expense');
  // Redelivery of the same Telegram update must not double-book.
  assert.equal(await saveExpenses(c, 1, 1, [{ description: 'تست', amount: 1000n }], 77), null);
});

test('a header-only message arms the pending «ثبت خرج» mode', async () => {
  const db = fakeDb({});
  const { c, sent } = fakeCtx(db);
  assert.equal(await recordExpenses(c, 1, 1, 'چند تا هزینه ثبت کن حاجی', 10), true);
  assert.match(sent[0].text, /بفرست حاجی/);
  const prefs = db.rows('telegram_bot_preferences');
  assert.equal(prefs[0].pending_tool, 'expenses');
  // The follow-up list is parsed permissively (no category word needed).
  assert.equal(await recordExpenses(c, 1, 1, 'گیفت کارت ۵۰۰ هزار تومان\nکتاب ۲۵۰ هزار تومان', 11, { permissive: true }), true);
  assert.equal(db.rows('saeed_ai_expenses').length, 2);
  assert.equal(db.rows('telegram_bot_preferences')[0].pending_tool, 'chat', 'the pending mode disarms after saving');
});

test('handleLifeMessage owns the user message end-to-end', async () => {
  const db = fakeDb({});
  const { c, telegram } = fakeCtx(db);
  assert.equal(await handleLifeMessage(c, 1, 1, USER_MESSAGE, 55), true);
  assert.equal(db.rows('saeed_ai_expenses').length, 3);
  assert.ok(telegram.some((t) => /خرید اکانت Claude pro ماهانه/.test(t.payload.text)));
});

test('routing: the gateway and the intent engine recognise expense commands', () => {
  assert.equal(inferToolIntent('چند تا هزینه ثبت کن حاجی'), 'expenses');
  assert.equal(inferToolIntent(USER_MESSAGE), 'expenses');
  assert.equal(inferToolIntent('هزینه‌ها رو ثبت کن'), 'expenses');
  assert.equal(inferToolIntent('یه خرج ثبت کنم: میوه ۹۰۰ هزار تومان'), 'expenses');
  assert.equal(inferToolIntent('قیمت ناهار چقدره؟'), 'chat');
  assert.ok(isLifeCommand(USER_MESSAGE), 'deterministic forwarding, no classifier needed');
  assert.ok(isLifeCommand('چند تا هزینه ثبت کن حاجی'));
  assert.ok(!isLifeCommand('یه پیتزا ۵۰۰ تومان می‌خوام بخرم'));
  assert.ok(isExpenseCommand(USER_MESSAGE));
});

test('spoken expense requests count as requests for the voice executor', () => {
  assert.equal(isSpokenRequest('هزینه ثبت کن خرید میوه نهصد هزار تومان'), true);
  assert.equal(isSpokenRequest('چند تا خرج ثبت کن'), true);
  assert.equal(isSpokenRequest('یه برنامگی خوب بود امروز'), false);
});

/* ------------------------- Mini App dashboard API ------------------------- */

const TOKEN = '123456:TEST';
const env = { adminId: '1', legacy: [] };
const initFor = (id) => signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE', user: JSON.stringify({ id, first_name: 'سعید' }) }, TOKEN);

test('dashboard: full control — expenses, tasks, shopping, memories, watchers', async () => {
  const db = fakeDb({});
  const init = await initFor(1);
  // add expenses
  await handleWebApp(db, env, TOKEN, init, { action: 'expense_add', description: 'خرید میوه', amount: 900000 });
  await handleWebApp(db, env, TOKEN, init, { action: 'expense_add', description: 'خرید برنج', amount: 2800000 });
  assert.equal(db.rows('saeed_ai_expenses').length, 2);
  // bad input is rejected
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'expense_add', description: 'x', amount: 900000 })).status, 400);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'expense_add', description: 'خرید', amount: 0 })).status, 400);
  // tasks
  await handleWebApp(db, env, TOKEN, init, { action: 'task_add', text: 'تماس با بانک' });
  await handleWebApp(db, env, TOKEN, init, { action: 'task_add', text: 'خرید هدیه' });
  const tid = db.rows('saeed_ai_tasks').at(-1).id;
  await handleWebApp(db, env, TOKEN, init, { action: 'task_toggle', id: tid });
  assert.equal(db.rows('saeed_ai_tasks').at(-1).done, true);
  await handleWebApp(db, env, TOKEN, init, { action: 'task_edit', id: tid, text: 'خرید هدیه تولد' });
  assert.equal(db.rows('saeed_ai_tasks').at(-1).task, 'خرید هدیه تولد');
  await handleWebApp(db, env, TOKEN, init, { action: 'task_clear', done_only: true });
  assert.equal(db.rows('saeed_ai_tasks').length, 1);
  // shopping: add several, toggle, delete, clear done
  await handleWebApp(db, env, TOKEN, init, { action: 'shop_add', items: 'شیر، نان، تخم‌مرغ' });
  assert.equal(db.rows('saeed_ai_shopping').length, 3);
  const sid = db.rows('saeed_ai_shopping')[0].id;
  await handleWebApp(db, env, TOKEN, init, { action: 'shop_toggle', id: sid });
  await handleWebApp(db, env, TOKEN, init, { action: 'shop_clear_done' });
  assert.equal(db.rows('saeed_ai_shopping').length, 2);
  // memories
  await handleWebApp(db, env, TOKEN, init, { action: 'memory_add', fact: 'قهوه بدون شکر دوست دارم' });
  assert.equal(db.rows('saeed_ai_memories').length, 1);
  const mid = db.rows('saeed_ai_memories')[0].id;
  await handleWebApp(db, env, TOKEN, init, { action: 'memory_delete', id: mid });
  assert.equal(db.rows('saeed_ai_memories').length, 0);
  // watchers
  await handleWebApp(db, env, TOKEN, init, { action: 'watcher_add', kind: 'usd_above', threshold: 95000 });
  await handleWebApp(db, env, TOKEN, init, { action: 'watcher_add', kind: 'rain' });
  assert.equal(db.rows('saeed_ai_watchers').length, 2);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'watcher_add', kind: 'usd_above', threshold: 3 })).status, 400, 'usd threshold bounds enforced');
  const wid = db.rows('saeed_ai_watchers')[0].id;
  await handleWebApp(db, env, TOKEN, init, { action: 'watcher_cancel', id: wid });
  assert.equal(db.rows('saeed_ai_watchers')[0].active, false);
  // reminder with validation
  const soon = new Date(Date.now() + 3600000).toISOString();
  const bad = await handleWebApp(db, env, TOKEN, init, { action: 'reminder_add', note: 'جلسه', remind_at: '2020-01-01T00:00:00Z' });
  assert.equal(bad.status, 400, 'past times are rejected');
  await handleWebApp(db, env, TOKEN, init, { action: 'reminder_add', note: 'جلسه', remind_at: soon });
  assert.equal(db.rows('saeed_ai_reminders').length, 1);
  // timezone
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'timezone_set', timezone: 'Mars/Olympus' })).status, 400);
  await handleWebApp(db, env, TOKEN, init, { action: 'timezone_set', timezone: 'Europe/Berlin' });
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].timezone, 'Europe/Berlin');
  // summary shape: today block, expenses list with ids, watchers, memories
  const r = await handleWebApp(db, env, TOKEN, init, { action: 'summary' });
  assert.equal(r.status, 200);
  assert.equal(r.body.today.tasks_open, 1);
  assert.equal(r.body.expenses.list.length, 2);
  assert.equal(r.body.expenses.list[0].amount, 2800000);
  assert.equal(r.body.watchers.length, 1);
  assert.ok(r.body.shopping.items.length >= 2);
});

test('dashboard: shared shopping — share returns a code, join scopes to the owner, leave works', async () => {
  const db = fakeDb({ telegram_bot_user_access: [{ telegram_user_id: 2, enabled: true }] });
  const owner = await initFor(1), member = await initFor(2);
  await handleWebApp(db, env, TOKEN, owner, { action: 'shop_add', items: 'شیر' });
  const share = await handleWebApp(db, env, TOKEN, owner, { action: 'shop_share' });
  assert.equal(share.status, 200);
  const code = String(share.body.code);
  assert.match(code, /^\d{6}$/);
  // join by another user
  const joined = await handleWebApp(db, env, TOKEN, member, { action: 'shop_join', code });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.shopping.shared, true, 'the joiner now sees the shared list');
  // the joiner adds an item to the owner's list
  await handleWebApp(db, env, TOKEN, member, { action: 'shop_add', items: 'نان' });
  assert.equal(db.rows('saeed_ai_shopping').length, 2);
  assert.ok(db.rows('saeed_ai_shopping').every((x) => x.telegram_user_id === 1), 'rows stay owned by the list owner');
  assert.equal((await handleWebApp(db, env, TOKEN, member, { action: 'shop_share' })).status, 400, 'a joiner cannot start their own share');
  // leave → back to a personal (empty) list
  await handleWebApp(db, env, TOKEN, member, { action: 'shop_leave' });
  const after = await handleWebApp(db, env, TOKEN, member, { action: 'summary' });
  assert.equal(after.body.shopping.shared, false);
});

test('dashboard mutations stay scoped to the verified user', async () => {
  const db = fakeDb({
    saeed_ai_expenses: [{ id: 5, telegram_user_id: 2, description: 'راز', amount_toman: 1000, created_at: new Date().toISOString() }],
    saeed_ai_tasks: [{ id: 9, telegram_user_id: 2, task: 'کار دیگری', done: false }],
  });
  const init = await initFor(1);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'expense_delete', id: 5 })).status, 200);
  assert.equal(db.rows('saeed_ai_expenses').length, 1, 'a foreign row is never deleted');
  await handleWebApp(db, env, TOKEN, init, { action: 'task_add', text: 'کار خودم' });
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'task_delete', id: 9 })).status, 200);
  assert.equal(db.rows('saeed_ai_tasks').some((x) => x.task === 'کار دیگری'), true, 'foreign task untouched');
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'unknown_action' })).status, 400);
});

test('money formatting stays Persian and exact', () => {
  assert.equal(money(9700000n), '۹٬۷۰۰٬۰۰۰ تومان');
  assert.equal(money(480000n), '۴۸۰٬۰۰۰ تومان');
});
