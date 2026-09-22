import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchReminders, dispatchWatchers, dispatchWeekly, dispatchBriefings, runTick } from '../supabase/functions/_shared/dispatch.ts';
import { runSweep, shouldSweep } from '../supabase/functions/_shared/sweep.ts';
import { fakeDb } from './helpers/fake-db.mjs';

/** Mimics saeed_ai_claim_due_reminders: due, unsent, not canceled → processing. */
const claimRpc = {
  saeed_ai_claim_due_reminders: (_args, { rows }) => {
    const now = new Date().toISOString();
    const due = rows('saeed_ai_reminders').filter((r) => !r.sent && !r.canceled && r.remind_at <= now && r.status !== 'processing');
    for (const r of due) { r.status = 'processing'; r.attempt_count = (r.attempt_count || 0) + 1; }
    return { data: due.map((r) => ({ id: r.id, telegram_chat_id: r.telegram_chat_id, note: r.note, attempt_count: r.attempt_count })), error: null };
  },
};

const deps = (db, extra = {}) => {
  const sent = [], html = [];
  return {
    sent, html,
    d: { db, send: async (chat, text, rid) => { sent.push({ chat, text, rid }); }, sendHtml: async (chat, h) => { html.push({ chat, h }); }, fetcher: async () => new Response('{}', { status: 503 }), ...extra },
  };
};

const past = () => new Date(Date.now() - 60000).toISOString();

test('a delivered reminder is never reset to pending when the acknowledgement fails (B6)', async () => {
  const db = fakeDb({ saeed_ai_reminders: [{ id: 1, telegram_user_id: 5, telegram_chat_id: 5, note: 'دارو', remind_at: past(), repeat_rule: 'none', repeat_every_hours: null, repeat_anchor_day: null, sent: false, canceled: false, status: 'pending', attempt_count: 0 }] }, { rpc: claimRpc });
  const realFrom = db.from;
  let updates = 0;
  db.from = (t) => {
    const q = realFrom(t);
    const update = q.update.bind(q);
    q.update = (patch) => { updates++; if (patch.sent === true) return Object.assign(update({ status: 'processing' }), { select: async () => ({ data: [], error: { code: 'X' } }) }); return update(patch); };
    return q;
  };
  const { d, sent } = deps(db);
  const r = await dispatchReminders(d);
  assert.equal(sent.length, 1);
  assert.equal(r.sent, 1);
  assert.notEqual(db.rows('saeed_ai_reminders')[0].status, 'pending', 'must not be re-queued for a second delivery');
  assert.equal(updates, 3, 'acknowledgement retried');
});

test('recurring reminders move to the next local occurrence and carry buttons', async () => {
  const db = fakeDb({
    saeed_ai_reminders: [{ id: 2, telegram_user_id: 5, telegram_chat_id: 5, note: 'ورزش', remind_at: past(), repeat_rule: 'daily', repeat_every_hours: null, repeat_anchor_day: null, sent: false, canceled: false, status: 'pending', attempt_count: 0 }],
    saeed_ai_briefing_preferences: [{ telegram_user_id: 5, timezone: 'Europe/Berlin' }],
  }, { rpc: claimRpc });
  const { d, sent } = deps(db);
  await dispatchReminders(d);
  const row = db.rows('saeed_ai_reminders')[0];
  assert.equal(sent[0].rid, 2);
  assert.equal(row.status, 'pending');
  assert.equal(row.sent, false);
  assert.ok(new Date(row.remind_at) > new Date(), 'scheduled in the future');
});

test('a reminder canceled between claim and read is released, not left processing (B11)', async () => {
  const db = fakeDb({ saeed_ai_reminders: [{ id: 3, telegram_user_id: 5, telegram_chat_id: 5, note: 'x', remind_at: past(), repeat_rule: 'none', sent: false, canceled: false, status: 'pending', attempt_count: 0 }] }, {
    rpc: { saeed_ai_claim_due_reminders: (a, ctx) => { const res = claimRpc.saeed_ai_claim_due_reminders(a, ctx); ctx.rows('saeed_ai_reminders')[0].canceled = true; return res; } },
  });
  const { d, sent } = deps(db);
  await dispatchReminders(d);
  assert.equal(sent.length, 0);
  assert.equal(db.rows('saeed_ai_reminders')[0].status, 'sent');
});

test('a failed Telegram send returns the reminder to the queue', async () => {
  const db = fakeDb({ saeed_ai_reminders: [{ id: 4, telegram_user_id: 5, telegram_chat_id: 5, note: 'x', remind_at: past(), repeat_rule: 'none', sent: false, canceled: false, status: 'pending', attempt_count: 0 }] }, { rpc: claimRpc });
  const { d } = deps(db, { send: async () => { throw Error('TELEGRAM_500'); } });
  const r = await dispatchReminders(d);
  assert.equal(r.failed, 1);
  assert.equal(db.rows('saeed_ai_reminders')[0].status, 'pending');
});

const marketFetcher = (usd, at) => async (url) => {
  const time = Math.floor(at.getTime() / 1000) - 60;
  if (String(url).includes('fiat')) return new Response(JSON.stringify({ usd: { value: usd, date: time } }));
  if (String(url).includes('gold')) return new Response(JSON.stringify({ '18ayar': { value: 23000000, date: time } }));
  return new Response('{}', { status: 404 });
};

test('market alerts fire once with a verified quote, then deactivate', async () => {
  const db = fakeDb({ saeed_ai_watchers: [
    { id: 1, telegram_user_id: 5, telegram_chat_id: 5, kind: 'usd_above', threshold: 95000, note: 'دلار از ۹۵٬۰۰۰ تومان رد شد', active: true },
    { id: 2, telegram_user_id: 5, telegram_chat_id: 5, kind: 'usd_below', threshold: 50000, note: 'زیر ۵۰ هزار', active: true },
  ] });
  const now = () => new Date('2026-09-22T10:10:00Z');
  const { d, sent } = deps(db, { fetcher: marketFetcher(96000, now()), now });
  assert.equal((await dispatchWatchers(d)).fired, 1);
  assert.match(sent[0].text, /۹۶٬۰۰۰/);
  assert.equal(db.rows('saeed_ai_watchers')[0].active, false);
  assert.equal(db.rows('saeed_ai_watchers')[1].active, true);
  assert.equal((await dispatchWatchers(d)).fired, 0, 'never fires twice');
});

test('market alerts stay silent when the feed is stale or down', async () => {
  const db = fakeDb({ saeed_ai_watchers: [{ id: 1, telegram_user_id: 5, telegram_chat_id: 5, kind: 'usd_above', threshold: 1000, note: 'x', active: true }] });
  const { d, sent } = deps(db, { now: () => new Date('2026-09-22T10:20:00Z') });
  await dispatchWatchers(d);
  assert.equal(sent.length, 0);
  assert.equal(db.rows('saeed_ai_watchers')[0].active, true);
});

const rainyFetcher = (prob) => async (url) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date('2026-09-23T03:40:00Z'));
  if (String(url).includes('api.open-meteo.com'))
    return new Response(JSON.stringify({ timezone: 'Asia/Tehran', current: { temperature_2m: 18, time: 'x' }, daily: { time: [today], temperature_2m_min: [12], temperature_2m_max: [20], precipitation_probability_max: [prob] } }));
  return new Response('{}', { status: 404 });
};

test('rain alerts check at 07:00 local, fire when likely and expire one-shot «فردا» alerts', async () => {
  const now = () => new Date('2026-09-23T03:40:00Z'); // 07:10 Tehran
  const db = fakeDb({ saeed_ai_watchers: [
    { id: 1, telegram_user_id: 5, telegram_chat_id: 5, kind: 'rain', note: 'چتر یادت نره', recurring: false, target_day: '2026-09-23', last_fired_day: null, active: true },
    { id: 2, telegram_user_id: 5, telegram_chat_id: 5, kind: 'rain', note: 'old', recurring: false, target_day: '2026-09-20', last_fired_day: null, active: true },
  ] });
  const { d, sent } = deps(db, { now, fetcher: rainyFetcher(80) });
  const realNow = Date.now; Date.now = () => now().getTime();
  try {
    await dispatchWatchers(d);
  } finally { Date.now = realNow; }
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /چتر یادت نره/);
  assert.match(sent[0].text, /Open-Meteo/);
  assert.equal(db.rows('saeed_ai_watchers')[0].active, false, 'one-shot alert is done');
  assert.equal(db.rows('saeed_ai_watchers')[1].active, false, 'past target day expires silently');
});

test('weekly card goes out Friday 20:00 local exactly once', async () => {
  const friday8pm = () => new Date('2026-09-25T16:40:00Z'); // Friday 20:10 Tehran
  const db = fakeDb({
    saeed_ai_briefing_preferences: [{ telegram_user_id: 5, telegram_chat_id: 5, timezone: 'Asia/Tehran', weekly_enabled: true, last_weekly_day: null }],
    saeed_ai_expenses: [{ telegram_user_id: 5, description: 'ناهار', amount_toman: 480000, created_at: '2026-09-24T10:00:00Z' }],
  });
  const { d, sent } = deps(db, { now: friday8pm });
  assert.equal((await dispatchWeekly(d)).sent, 1);
  assert.match(sent[0].text, /خلاصه‌ی هفته/);
  assert.match(sent[0].text, /۴۸۰٬۰۰۰/);
  assert.equal((await dispatchWeekly(d)).sent, 0);
  const { d: d2, sent: s2 } = deps(fakeDb({ saeed_ai_briefing_preferences: [{ telegram_user_id: 6, telegram_chat_id: 6, timezone: 'Asia/Tehran', weekly_enabled: true }] }), { now: () => new Date('2026-09-24T16:40:00Z') });
  await dispatchWeekly(d2);
  assert.equal(s2.length, 0, 'not on Thursday');
});

test('briefing: local-time reminders, riddle spoiler and optional voice, fetched sources shared per tick', async () => {
  let fetches = 0;
  const db = fakeDb({
    saeed_ai_briefing_preferences: [
      { telegram_user_id: 5, telegram_chat_id: 5, enabled: true, timezone: 'Asia/Tehran', voice: true },
      { telegram_user_id: 6, telegram_chat_id: 6, enabled: true, timezone: 'Asia/Tehran', voice: false },
    ],
    saeed_ai_tasks: [{ telegram_user_id: 5, task: 'تماس با بانک', done: false }],
  }, { rpc: { saeed_ai_claim_briefings: () => ({ data: [{ telegram_user_id: 5, telegram_chat_id: 5, local_day: '2026-09-23' }, { telegram_user_id: 6, telegram_chat_id: 6, local_day: '2026-09-23' }], error: null }) } });
  const spoken = [];
  const { d, sent, html } = deps(db, { speak: async (chat, text) => spoken.push({ chat, text }), fetcher: async () => { fetches++; return new Response('{}', { status: 503 }); } });
  const r = await dispatchBriefings(d);
  assert.equal(r.sent, 2);
  assert.match(sent[0].text, /تماس با بانک/);
  assert.match(html[0].h, /<tg-spoiler>/);
  assert.equal(spoken.length, 1, 'voice only for users who enabled it');
  assert.equal(fetches, 3, 'weather once + market twice (fiat, gold) for both users');
  assert.equal(db.rows('saeed_ai_briefing_preferences')[0].last_sent_day, '2026-09-23');
});

test('one failing section never starves the others, and the sweep runs on its minute', async () => {
  const db = fakeDb({}, { rpc: { saeed_ai_claim_due_reminders: () => ({ data: null, error: { code: 'BOOM' } }), saeed_ai_claim_briefings: () => ({ data: [], error: null }) } });
  const { d } = deps(db, { now: () => new Date('2026-09-22T10:07:00Z') });
  const result = await runTick(d);
  assert.equal(result.ok, false);
  assert.match(result.reminders.error, /REMINDER_CLAIM_BOOM/);
  assert.deepEqual(result.briefings, { claimed: 0, sent: 0, failed: 0 });
  assert.deepEqual(result.sweep_failed, []);
  assert.ok(shouldSweep(new Date('2026-09-22T10:22:00Z')));
  assert.ok(!shouldSweep(new Date('2026-09-22T10:23:00Z')));
});

test('sweep deletes finished tasks by completion time, not creation time (B3)', async () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const db = fakeDb({ saeed_ai_tasks: [
    { id: 1, done: true, created_at: '2026-09-10T00:00:00Z', done_at: '2026-09-22T11:00:00Z' },
    { id: 2, done: true, created_at: '2026-09-10T00:00:00Z', done_at: '2026-09-20T11:00:00Z' },
    { id: 3, done: false, created_at: '2026-09-01T00:00:00Z', done_at: null },
  ] });
  assert.deepEqual(await runSweep(db, now), []);
  assert.deepEqual(db.rows('saeed_ai_tasks').map((t) => t.id), [1, 3]);
});
