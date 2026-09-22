import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToTelegramHtml, stripMarkdown, speechText, TTS_MAX_CHARS, faDigits } from '../supabase/functions/_shared/format.ts';
import { createTg, sendRich, splitText, TelegramError, safeEqual, webhookSecret } from '../supabase/functions/_shared/telegram.ts';
import { mergeTurns, appendUserTurn } from '../supabase/functions/_shared/history.ts';
import { parseBotConfig, readBotConfig, clearBotConfigCache } from '../supabase/functions/_shared/bot-config.ts';
import { systemPrompt } from '../supabase/functions/_shared/tone.ts';
import { isValidTimeZone, offsetMinutes, zonedToUtc, localDay, startOfLocalDay, offsetLabel } from '../supabase/functions/_shared/timezone.ts';
import { nextOccurrence } from '../supabase/functions/_shared/repeat.ts';
import { isAllowed } from '../supabase/functions/_shared/access.ts';
import { dayRiddle, RIDDLE_COUNT } from '../supabase/functions/_shared/riddles.ts';
import { rows, keyboard, allButtons, DASHBOARD_BUTTON, MENU } from '../supabase/functions/_shared/menu.ts';
import { selectToolIntent, needsClassifier, CLASSIFY_DEADLINE_MS } from '../supabase/functions/_shared/intent-model.ts';
import { fakeDb } from './helpers/fake-db.mjs';

test('Markdown renders to safe Telegram HTML instead of raw ** and ###', () => {
  const html = markdownToTelegramHtml('### عنوان\n**پررنگ** و *کج* و `x<y`\n- مورد\n[لینک](https://a.com/?q=1&b="2")\n<script>alert(1)</script>');
  assert.match(html, /<b>عنوان<\/b>/);
  assert.match(html, /<b>پررنگ<\/b>/);
  assert.match(html, /<i>کج<\/i>/);
  assert.match(html, /<code>x&lt;y<\/code>/);
  assert.match(html, /^• مورد$/m);
  assert.match(html, /<a href="https:\/\/a\.com\/\?q=1&amp;b=&quot;2&quot;">لینک<\/a>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'raw HTML is always escaped');
  assert.doesNotMatch(markdownToTelegramHtml('snake_case_name و 2*3*4'), /<i>/, 'underscores and arithmetic are not italics');
  assert.doesNotMatch(markdownToTelegramHtml('[x](javascript:alert(1))'), /<a /, 'only http(s) links become anchors');
  assert.equal(stripMarkdown('## تیتر\n**a** [b](https://c.d)'), 'تیتر\na b (https://c.d)');
});

test('rich sending falls back to plain text when Telegram rejects the HTML', async () => {
  const calls = [];
  const tg = async (method, payload) => {
    calls.push(payload);
    if (payload.parse_mode) throw new TelegramError(400, "Bad Request: can't parse entities");
  };
  await sendRich(tg, 1, '**سلام**', { reply_markup: { x: 1 } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text, 'سلام');
  assert.deepEqual(calls[1].reply_markup, { x: 1 });
});

test('long answers split on line boundaries and never inside a code point', () => {
  const text = Array.from({ length: 300 }, (_, i) => `خط ${i} 😀`).join('\n');
  const parts = splitText(text, 500);
  assert.ok(parts.every((p) => Array.from(p).length <= 500));
  assert.equal(parts.join('\n').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
});

test('Telegram client honours 429 retry_after, retries 5xx once and survives HTML errors', async () => {
  const waits = [];
  const seq = [
    new Response(JSON.stringify({ ok: false, parameters: { retry_after: 1 } }), { status: 429 }),
    new Response('<html>bad gateway</html>', { status: 502 }),
    new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 }),
  ];
  const tg = createTg('T', async () => seq.shift(), async (ms) => waits.push(ms));
  assert.deepEqual(await tg('sendMessage', {}), { message_id: 5 });
  assert.deepEqual(waits, [1100, 700]);
  const failing = createTg('T', async () => new Response('<html/>', { status: 400 }), async () => {});
  await assert.rejects(failing('x', {}), (e) => e instanceof TelegramError && e.status === 400);
});

test('webhook secret is deterministic and compared in constant time', async () => {
  assert.equal(await webhookSecret('abc'), await webhookSecret('abc'));
  assert.match(await webhookSecret('abc'), /^[a-f0-9]{64}$/);
  assert.ok(safeEqual('a', 'a'));
  assert.ok(!safeEqual('a', 'ab'));
});

test('history merges repeated roles and never starts with an assistant turn (B4)', () => {
  const turns = mergeTurns([{ role: 'model', body: 'orphan' }, { role: 'user', body: 'a' }, { role: 'user', body: 'b' }, { role: 'model', body: 'c' }]);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'model']);
  assert.equal(turns[0].parts[0].text, 'a\nb');
  const contents = appendUserTurn([{ role: 'user', parts: [{ text: 'x' }] }], [{ text: 'y' }]);
  assert.equal(contents.length, 1, 'a failed answer leaves two user turns; they are merged');
  assert.equal(appendUserTurn(turns, [{ text: 'z' }]).at(-1).role, 'user');
});

test('bot config defaults, admin search switch and 30-second cache', async () => {
  const c = parseBotConfig([{ setting_key: 'chat_search', setting_value: 'off' }, { setting_key: 'model', setting_value: 'gemini-3.5-flash-lite' }]);
  assert.equal(c.chatSearch, false);
  assert.equal(c.search, 'gemini-3.5-flash', 'lite chat models never ground search');
  assert.equal(parseBotConfig([]).chatSearch, true);
  clearBotConfigCache();
  let reads = 0;
  const db = { from() { return { select: async () => { reads++; return { data: [], error: null }; } }; } };
  await readBotConfig(db, 1000);
  await readBotConfig(db, 20000);
  await readBotConfig(db, 40000);
  assert.equal(reads, 2);
  clearBotConfigCache();
});

test('one system prompt carries tone, language and only explicit memories', () => {
  const p = systemPrompt({ tone: 'witty', language: 'en', answer_length: 'short' }, ['گیاه‌خوارم']);
  assert.match(p, /in English/);
  assert.match(p, /حاجی/);
  assert.match(p, /گیاه‌خوارم/);
  assert.doesNotMatch(systemPrompt({}), /remember/);
});

test('time zones: offsets, DST-safe conversion and local days', () => {
  assert.ok(isValidTimeZone('Europe/Berlin'));
  assert.ok(!isValidTimeZone('Mars/Olympus'));
  assert.ok(!isValidTimeZone('../../etc'));
  assert.equal(offsetMinutes('Asia/Tehran', new Date('2026-09-22T12:00:00Z')), 210);
  assert.equal(offsetMinutes('Europe/Berlin', new Date('2026-07-01T12:00:00Z')), 120);
  assert.equal(offsetMinutes('Europe/Berlin', new Date('2026-01-01T12:00:00Z')), 60);
  assert.equal(zonedToUtc(2026, 9, 22, 8, 0, 0, 'Asia/Tehran').toISOString(), '2026-09-22T04:30:00.000Z');
  assert.equal(localDay(new Date('2026-09-22T21:00:00Z'), 'Asia/Tehran'), '2026-09-23');
  assert.equal(startOfLocalDay('2026-09-23', 'Asia/Tehran').toISOString(), '2026-09-22T20:30:00.000Z');
  assert.equal(offsetLabel('Asia/Tehran'), '+03:30');
});

test('daily reminders keep their wall-clock time across a DST change', () => {
  // 08:00 Berlin on 28 March (CET, UTC+1) → next day is CEST (UTC+2): still 08:00 local.
  assert.equal(nextOccurrence('2026-03-28T07:00:00Z', 'daily', null, null, new Date('2026-03-28T08:00:00Z'), 'Europe/Berlin'), '2026-03-29T06:00:00.000Z');
  // Tehran has no DST: unchanged behaviour.
  assert.equal(nextOccurrence('2026-09-20T04:00:00Z', 'daily', null, null, new Date('2026-09-21T04:01:00Z')), '2026-09-22T04:00:00.000Z');
});

test('access: private chat only, env admin, DB row overrides the legacy list', async () => {
  const env = { adminId: '1', legacy: ['2', '3'] };
  const db = fakeDb({ telegram_bot_user_access: [{ telegram_user_id: 3, enabled: false }, { telegram_user_id: 4, enabled: true }] });
  assert.equal(await isAllowed(db, env, 1, { type: 'private', id: 1 }), true);
  assert.equal(await isAllowed(db, env, 2, { type: 'private', id: 2 }), true);
  assert.equal(await isAllowed(db, env, 3, { type: 'private', id: 3 }), false, 'disabled row wins over legacy env');
  assert.equal(await isAllowed(db, env, 4, { type: 'private', id: 4 }), true);
  assert.equal(await isAllowed(db, env, 4, { type: 'group', id: 4 }), false);
  assert.equal(await isAllowed(db, env, 4, { type: 'private', id: 5 }), false);
});

test('daily riddle is deterministic per day and spoiler-safe text', () => {
  assert.deepEqual(dayRiddle('2026-09-22'), dayRiddle('2026-09-22'));
  assert.ok(RIDDLE_COUNT >= 30);
  const seen = new Set(Array.from({ length: 60 }, (_, i) => dayRiddle(`2026-10-${i}`).question));
  assert.ok(seen.size > 10, 'riddles rotate');
});

test('menus: life page, dashboard button only with a URL, every button unique text', () => {
  assert.ok(rows('home', false).flat().includes('🗂 روزمره'));
  assert.ok(!rows('home', false).flat().includes(DASHBOARD_BUTTON));
  const kb = keyboard('home', false, 'https://example.com/app');
  assert.deepEqual(kb.keyboard.flat().find((b) => b.text === DASHBOARD_BUTTON).web_app, { url: 'https://example.com/app' });
  assert.ok(rows('settings', true).flat().includes('🛡 مدیریت'));
  assert.ok(allButtons().includes('🔎 جست‌وجوی چت'));
  assert.ok(Object.keys(MENU).includes('life'));
});

test('speech text drops Markdown, code, URLs and sources and is bounded', () => {
  const s = speechText('**سلام** ```js\ncode\n``` https://x.y\n\n📚 منابع:\nhttps://a');
  assert.equal(s, 'سلام');
  assert.ok(Array.from(speechText('آ'.repeat(5000))).length <= TTS_MAX_CHARS + 2);
  assert.equal(faDigits('12'), '۱۲');
});

test('the intent classifier has one short shared deadline and fails closed', async () => {
  assert.ok(CLASSIFY_DEADLINE_MS <= 5000);
  assert.equal(needsClassifier('یه شعر درباره آب بگو'), false, 'a bare «آب» no longer triggers an extra model call');
  assert.equal(needsClassifier('آب و هوای فردا'), true);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 500 }); };
  try {
    assert.equal(await selectToolIntent('فردا ساعت ۵ چی داریم', 'k', 'm'), 'chat');
    assert.equal(calls, 2, 'native then JSON attempt, then fail closed');
  } finally { globalThis.fetch = realFetch; }
});
