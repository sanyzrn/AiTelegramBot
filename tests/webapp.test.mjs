import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData, signInitData, handleWebApp } from '../supabase/functions/_shared/webapp.ts';
import { fakeDb } from './helpers/fake-db.mjs';

const TOKEN = '123456:TEST';
const env = { adminId: '1', legacy: [] };
const initFor = (id, authDate = Math.floor(Date.now() / 1000)) =>
  signInitData({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify({ id, first_name: 'سعید' }) }, TOKEN);

test('initData: valid signature accepted; tampered, stale or foreign-token data rejected', async () => {
  const good = await initFor(1);
  assert.equal(await verifyInitData(good, TOKEN), 1);
  assert.equal(await verifyInitData(good.replace('%22id%22%3A1', '%22id%22%3A2'), TOKEN), null, 'tampered user id');
  assert.equal(await verifyInitData(good, '999:OTHER'), null, 'signed for another bot');
  assert.equal(await verifyInitData(await initFor(1, Math.floor(Date.now() / 1000) - 2 * 86400), TOKEN), null, 'older than 24h');
  assert.equal(await verifyInitData('', TOKEN), null);
});

test('dashboard API: unauthorized, forbidden and scoped summary', async () => {
  const db = fakeDb({
    telegram_bot_user_access: [{ telegram_user_id: 3, enabled: false }],
    saeed_ai_tasks: [{ id: 1, telegram_user_id: 1, task: 'نان', done: false }, { id: 2, telegram_user_id: 2, task: 'راز', done: false }],
    saeed_ai_expenses: [{ telegram_user_id: 1, description: 'ناهار', amount_toman: 480000, created_at: new Date().toISOString() }],
  });
  assert.equal((await handleWebApp(db, env, TOKEN, 'bad', {})).status, 401);
  assert.equal((await handleWebApp(db, env, TOKEN, await initFor(3), {})).status, 403, 'disabled users are refused');
  const r = await handleWebApp(db, env, TOKEN, await initFor(1), { action: 'summary' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tasks.map((t) => t.task), ['نان'], 'only the verified user rows');
  assert.equal(r.body.expenses.total, 480000);
  assert.equal(r.body.expenses.days.length, 30);
  assert.equal(r.body.expenses.categories[0].name, 'ناهار');
});

test('dashboard actions mutate only the verified user and validate input', async () => {
  const db = fakeDb({
    saeed_ai_tasks: [{ id: 1, telegram_user_id: 1, task: 'نان', done: false }, { id: 2, telegram_user_id: 2, task: 'راز', done: false }],
    saeed_ai_reminders: [{ id: 9, telegram_user_id: 1, telegram_chat_id: 1, note: 'x', remind_at: new Date(Date.now() + 1e6).toISOString(), sent: false, canceled: false }],
  });
  const init = await initFor(1);
  await handleWebApp(db, env, TOKEN, init, { action: 'task_toggle', id: 1 });
  assert.equal(db.rows('saeed_ai_tasks')[0].done, true);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'task_toggle', id: 2 })).status, 404);
  assert.equal(db.rows('saeed_ai_tasks')[1].done, false);
  await handleWebApp(db, env, TOKEN, init, { action: 'reminder_cancel', id: 9 });
  assert.equal(db.rows('saeed_ai_reminders')[0].canceled, true);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'briefing_update', send_hour: 3 })).status, 400);
  const ok = await handleWebApp(db, env, TOKEN, init, { action: 'briefing_update', send_hour: 9, weekly: true, voice: true });
  assert.equal(ok.body.briefing.send_hour, 9);
  assert.equal(ok.body.briefing.weekly, true);
  assert.equal(ok.body.briefing.enabled, false, 'settings never silently enable the briefing');
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'drop_tables' })).status, 400);
  assert.equal((await handleWebApp(db, env, TOKEN, init, { action: 'task_delete', id: 'x' })).status, 400);
});
