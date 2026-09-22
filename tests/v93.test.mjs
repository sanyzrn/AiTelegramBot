import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geocodeCity, fetchCityWeather, clothingTip, fetchTehranWeather } from '../supabase/functions/_shared/briefing-sources.ts';
import { dayQuote, fallbackIntro, fallbackMorningBody, composeMorningVoice } from '../supabase/functions/_shared/morning-voice.ts';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';
import { handleLifeMessage } from '../supabase/functions/_shared/life.ts';

const root = resolve('supabase/functions');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const now = Date.now();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const weatherJson = {
  timezone: 'Asia/Tehran',
  current: { time: `${today}T07:00`, temperature_2m: 21, weather_code: 1 },
  daily: { time: [today], temperature_2m_min: [14], temperature_2m_max: [28], precipitation_probability_max: [53] },
};
const isfahanJson = {
  results: [{ name: 'اصفهان', latitude: 32.6525, longitude: 51.6746, admin1: 'استان اصفهان', country: 'ایران', timezone: 'Asia/Tehran' }],
};
const urlFetcher = (routes) => async (input) => {
  const url = String(input);
  for (const [needle, body] of routes) if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
  return new Response('{}', { status: 404 });
};

test('geocodeCity resolves Persian queries and builds a clean label', async () => {
  const fetcher = urlFetcher([['geocoding-api.open-meteo.com', isfahanJson]]);
  const ref = await geocodeCity('اصفهان', fetcher);
  assert.ok(ref);
  assert.ok(Math.abs(ref.lat - 32.6525) < 0.001);
  assert.match(ref.label, /اصفهان/);
  assert.match(ref.label, /ایران/);
  assert.doesNotMatch(ref.label, /اصفهان، اصفهان/, 'duplicated name parts must be filtered');
});

test('geocodeCity rejects garbage input and failed lookups', async () => {
  assert.equal(await geocodeCity('', async () => new Response('{}', { status: 200 })), null);
  assert.equal(await geocodeCity('x', async () => new Response('{}', { status: 200 })), null);
  assert.equal(await geocodeCity('Isfahan<script>', async () => new Response('{}', { status: 200 })), null);
  assert.equal(await geocodeCity('ناکجاآباد', urlFetcher([['geocoding-api.open-meteo.com', { results: [] }]])), null);
  assert.equal(await geocodeCity('اصفهان', async () => new Response('boom', { status: 500 })), null);
  assert.equal(await geocodeCity('Bad', urlFetcher([['geocoding-api.open-meteo.com', { results: [{ name: 'Bad', latitude: 999, longitude: 0 }] }]])), null, 'impossible latitude must be rejected');
});

test('clothing tips track real forecast ranges', () => {
  assert.match(clothingTip(2, 10, 10), /کت ضخیم/);
  assert.match(clothingTip(9, 20, 10), /هودی/);
  assert.match(clothingTip(20, 33, 10), /نخی/);
  assert.match(clothingTip(20, 27, 60), /چتر/);
  assert.match(clothingTip(18, 25, 10), /معمولی/);
});

test('fetchCityWeather renders the chosen city and structured values', async () => {
  const w = await fetchCityWeather({ lat: 32.6525, lon: 51.6746, label: 'اصفهان، استان اصفهان، ایران' }, urlFetcher([['api.open-meteo.com', weatherJson]]), now);
  assert.ok(w);
  assert.match(w.line, /اصفهان/);
  assert.match(w.line, /چتر/);
  assert.match(w.line, /Open-Meteo/);
  assert.deepEqual(w.values, { temp: 21, low: 14, high: 28, rain: 53, clothing: clothingTip(14, 28, 53) });
  assert.equal(await fetchCityWeather({ lat: 32.65, lon: 51.67, label: 'اصفهان' }, urlFetcher([['api.open-meteo.com', { ...weatherJson, daily: { ...weatherJson.daily, time: ['2020-01-01'] } }]]), now), null);
});

test('fetchTehranWeather stays the explicit default', async () => {
  const w = await fetchTehranWeather(urlFetcher([['api.open-meteo.com', weatherJson]]), now);
  assert.ok(w);
  assert.match(w.line, /تهران/);
});

test('dayQuote is stable per day and rotates across days', () => {
  const a = dayQuote('2026-09-21');
  assert.equal(a.quote, dayQuote('2026-09-21').quote, 'cron retries must not flip the quote');
  assert.ok(a.quote.length > 15 && a.signoff.length > 5);
  const pool = new Set(Array.from({ length: 40 }, (_, i) => dayQuote('2026-01-' + String(1 + (i % 28)).padStart(2, '0') + '-d' + i).quote));
  assert.ok(pool.size >= 5, 'quotes must actually rotate');
});

const facts = {
  dayLabel: 'یکشنبه ۳۰ شهریور',
  cityLabel: 'اصفهان، ایران',
  weather: { temp: 21, low: 14, high: 28, rain: 53, clothing: 'کت یا هودی سبک؛ چتر هم یادت نره' },
  tasks: ['تماس با بانک'],
  reminders: [{ note: 'قرص', time: '۰۹:۰۰' }],
  expense: '۴۸۰,۰۰۰ تومان',
  marketKnown: true,
};

test('fallback intro is energetic, names the clothing tip, and never leaks undefined', () => {
  const intro = fallbackIntro(facts);
  assert.match(intro, /صبح بخیر/);
  assert.match(intro, /هودی|کت/);
  assert.match(intro, /اصفهان/);
  assert.doesNotMatch(intro, /undefined|NaN|null/);
  const dry = fallbackIntro({ ...facts, weather: null });
  assert.match(dry, /پنجره/, 'source-down days must still sound human');
});

test('fallback body keeps the friendly skeleton with all sections', () => {
  const body = fallbackMorningBody(facts);
  assert.match(body, /یادآورهای امروز/);
  assert.match(body, /کارهای باز/);
  assert.match(body, /تماس با بانک/);
  assert.match(body, /۴۸۰,۰۰۰ تومان/);
  const empty = fallbackMorningBody({ ...facts, tasks: [], reminders: [], expense: null });
  assert.doesNotMatch(empty, /undefined|NaN/);
  assert.match(empty, /کارهای باز/);
});

test('morning voice asks OpenRouter with the configured model and cleans the reply', async () => {
  const calls = [];
  const fetcher = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ choices: [{ message: { content: '*صبح بخیر رفیق!* حالا که آسمون #مهربونه، هودی سبک بپوش و بزن بریم؛ امروز هم یه قدم جلو، باشه؟ 🌟' } }] }), { status: 200 });
  };
  const text = await composeMorningVoice({ openrouterKey: 'k', openrouterModel: 'test-model' }, facts, fetcher);
  assert.ok(text, 'a valid reply must come back');
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].body.model, 'test-model');
  assert.doesNotMatch(text, /[*_#`]/, 'markdown must be stripped');
  assert.ok(text.length > 40);
});

test('morning voice honours prefer=gemini and falls through provider failures', async () => {
  const calls = [];
  const geminiOk = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'صبحت بخیر! امروز هوای اصفهان به آدم انرژی می‌ده؛ لباس راحت بپوش و برو سراغ لیستت. قدم اول رو همین الان بردار، قول می‌دم روزت قشنگ شه 😄' }] } }] }), { status: 200 });
  };
  const text = await composeMorningVoice({ openrouterKey: 'k', geminiKey: 'g', geminiModel: 'gm-test', prefer: 'gemini' }, facts, geminiOk);
  assert.ok(text);
  assert.match(calls[0], /models\/gm-test:generateContent/);
  const allFail = async () => new Response('nope', { status: 500 });
  assert.equal(await composeMorningVoice({ openrouterKey: 'k', geminiKey: 'g' }, facts, allFail), null);
  const boom = async () => { throw new Error('timeout'); };
  assert.equal(await composeMorningVoice({ openrouterKey: 'k', geminiKey: 'g' }, facts, boom), null);
  let hit = 0;
  const spy = async () => { hit++; throw new Error('no network in tests'); };
  assert.equal(await composeMorningVoice({}, facts, spy), null);
  assert.equal(hit, 0, 'without keys no request may be attempted');
});

test('city messages route to the briefing tool', () => {
  assert.equal(inferToolIntent('شهر من اصفهان'), 'briefing');
  assert.equal(inferToolIntent('شهرم رشت'), 'briefing');
  assert.equal(inferToolIntent('شهر: کرج'), 'briefing');
  assert.equal(inferToolIntent('/city Isfahan'), 'briefing');
  assert.equal(inferToolIntent('شهر صبح‌نامه شیراز'), 'briefing');
  assert.equal(inferToolIntent('شهر من'), 'briefing');
  assert.equal(inferToolIntent('شهر تهران بزرگه'), 'chat', 'bare «شهر ...» must stay chat');
});

/** Chainable supabase mock; every chain resolves like PostgrestBuilder. */
function mkDb(prefs) {
  const state = { prefs, updated: [], inserted: [] };
  const db = { from() {
    const b = {
      select() { return b; }, eq() { return b; }, order() { return b; },
      limit() { return Promise.resolve({ data: [], error: null }); },
      update(patch) { state.updated.push(patch); return b; },
      insert(row) { state.inserted.push(row); return b; },
      upsert() { return b; }, delete() { return b; },
      maybeSingle() { return Promise.resolve({ data: state.prefs, error: null }); },
      single() { return Promise.resolve({ data: state.prefs, error: null }); },
      then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
    };
    return b;
  } };
  return { state, db };
}
const mkCtx = (prefs) => {
  const { state, db } = mkDb(prefs);
  const sent = [];
  return { state, sent, c: { db, tg: async () => { throw Error('no telegram expected'); }, send: async (_, text) => sent.push(text) } };
};

test('setting a city for an existing subscriber updates without touching enabled', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = urlFetcher([['geocoding-api.open-meteo.com', isfahanJson], ['api.open-meteo.com', weatherJson]]);
  try {
    const { c, state, sent } = mkCtx({ telegram_user_id: 1, enabled: true });
    const handled = await handleLifeMessage(c, 1, 1, 'شهر من اصفهان', 10);
    assert.equal(handled, true, 'handled city messages must not fall through to chat');
    assert.equal(state.updated.length, 1);
    assert.equal(state.inserted.length, 0);
    assert.equal(state.updated[0].enabled, undefined, 'must never silently enable/disable');
    assert.match(state.updated[0].city_label, /اصفهان/);
    assert.match(sent[0], /ثبت شد/);
    assert.match(sent[0], /چتر/);
    assert.doesNotMatch(sent[0], /خاموشه/, 'an active subscriber keeps the subscription');
  } finally { globalThis.fetch = realFetch; }
});

test('setting a city with no prior row inserts it disabled', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = urlFetcher([['geocoding-api.open-meteo.com', isfahanJson], ['api.open-meteo.com', weatherJson]]);
  try {
    const { c, state, sent } = mkCtx(null);
    await handleLifeMessage(c, 1, 1, '/city Isfahan', 11);
    assert.equal(state.inserted.length, 1);
    assert.equal(state.inserted[0].enabled, false, 'a new row must not enable the briefing silently');
    assert.match(state.inserted[0].city_label, /اصفهان/);
    assert.match(sent[0], /خاموشه/, 'a brand-new user gets the friendly enable hint');
  } finally { globalThis.fetch = realFetch; }
});

test('question phrases and unknown cities never mutate anything', async () => {
  let hit = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { hit++; return String(input).includes('geocoding') ? new Response(JSON.stringify({ results: [] }), { status: 200 }) : new Response('{}', { status: 404 }); };
  try {
    const { c, state, sent } = mkCtx({ telegram_user_id: 1, enabled: false });
    await handleLifeMessage(c, 1, 1, 'شهر من تهران چطوره', 12);
    assert.equal(state.updated.length + state.inserted.length, 0, 'question-y phrases must not write');
    assert.match(sent[0], /واضح بنویس/);
    await handleLifeMessage(c, 1, 1, 'شهر من ناکجاآباد۱۲۳', 13);
    assert.equal(state.updated.length + state.inserted.length, 0, 'failed geocoding must not write');
    assert.match(sent[1], /پیدا نکردم/);
    assert.ok(hit >= 1, 'the unknown city should actually be looked up');
  } finally { globalThis.fetch = realFetch; }
});

test('show and clear city flows reply and write the null patch', async () => {
  const shown = mkCtx({ city_label: 'اصفهان، ایران', enabled: true });
  await handleLifeMessage(shown.c, 1, 1, 'شهر من', 14);
  assert.match(shown.sent[0], /اصفهان/);
  const none = mkCtx({ city_label: null, enabled: false });
  await handleLifeMessage(none.c, 1, 1, 'شهر من چیه؟', 15);
  assert.match(none.sent[0], /هنوز شهری انتخاب نکردی/);
  const cleared = mkCtx({ city_label: 'اصفهان، ایران', enabled: true });
  const handled = await handleLifeMessage(cleared.c, 1, 1, 'شهر من رو پاک کن', 16);
  assert.equal(handled, true);
  assert.equal(cleared.state.updated[0].city, null);
  assert.equal(cleared.state.updated[0].city_lat, null);
  assert.match(cleared.sent[0], /پاک شد/);
});

test('colloquial city phrasings clear and set without swallowing verbs', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = urlFetcher([['geocoding-api.open-meteo.com', { results: [{ name: 'رشت', latitude: 37.2808, longitude: 49.5832, admin1: 'استان گیلان', country: 'ایران' }] }], ['api.open-meteo.com', weatherJson]]);
  try {
    // «شهرم رو پاک کن» must clear, not be mistaken for a city name.
    const cleared = mkCtx({ city_label: 'رشت، ایران', enabled: true });
    const handled = await handleLifeMessage(cleared.c, 1, 1, 'شهرم رو پاک کن', 20);
    assert.equal(handled, true);
    assert.equal(cleared.state.updated[0].city, null);
    assert.match(cleared.sent[0], /پاک شد/);
    // Verb-first word order must capture the actual city name.
    const set = mkCtx(null);
    await handleLifeMessage(set.c, 1, 1, 'شهرم رو بذار رشت', 21);
    assert.equal(set.state.inserted.length, 1);
    assert.equal(set.state.inserted[0].city, 'رشت');
    await handleLifeMessage(set.c, 1, 1, 'شهر من رو بذار رشت', 22);
    assert.equal(set.state.inserted[1].city, 'رشت');
    await handleLifeMessage(set.c, 1, 1, 'شهرم رو رشت بذار', 23);
    assert.equal(set.state.inserted[2].city, 'رشت');
    // A genuine city starting with «را» must not be corrupted by the رو/را strip.
    const raw = mkCtx(null);
    await handleLifeMessage(raw.c, 1, 1, 'شهر من راور', 24);
    assert.equal(raw.state.inserted[0].city, 'راور');
  } finally { globalThis.fetch = realFetch; }
});

test('the cron briefing is city-aware, friendly and lease-safe', () => {
  const t = read('_shared/dispatch.ts');
  assert.match(t, /p_limit: 6/, 'batch of six preserves headroom for both AI and Telegram timeouts');
  assert.match(t, /morningVoiceConfig/);
  assert.match(t, /telegram_bot_config/, 'voice must follow the chat model config');
  assert.match(read('saeed-ai-reminders/index.ts'), /v93_city_voice: true/);
  assert.match(t, /«صبح‌نامه خاموش»/);
  assert.match(t, /fallbackIntro/, 'deterministic warmth must exist without AI');
  assert.match(t, /fetchCityWeather\(city/);
  assert.match(t, /city_lat,city_lon,city_label/);
  const mv = read('_shared/morning-voice.ts');
  assert.match(mv, /هیچ عدد یا واقعیت جدیدی/, 'the voice must be forbidden from inventing facts');
  assert.match(mv, /const signal = AbortSignal\.timeout\(7000\)/, 'all provider attempts must share a single 7-second budget');
});

test('migration and workflows carry the v9.3 city feature', () => {
  const sql = readFileSync(resolve('supabase/migrations/20260921120000_saeed_ai_v93_briefing_city.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS city_lat DOUBLE PRECISION/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS city_lon DOUBLE PRECISION/);
  assert.match(sql, /saeed_ai_briefing_city_pair_chk/);
  assert.match(readFileSync(resolve('supabase/functions/_shared/version.ts'), 'utf8'), /APP_VERSION = "\d+\.\d+\.\d+"/);
  assert.match(readFileSync(resolve('.github/workflows/shared-typecheck.yml'), 'utf8'), /_shared\/\*\.ts/, 'every shared module is type-checked');
});

// Additional release guards: prevent made-up numerals and cron lease overruns.
test('voice rejects unverified generated numerals so factual figures come only from source sections', async () => {
  const bad = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'صبح بخیر رفیق! امروز دمای شهرت ۹۹ درجه است و همه‌چی عالی می‌شه؛ بزن بریم، امروز یه قدم پیش برو!' } }] }), { status: 200 });
  assert.equal(await composeMorningVoice({ openrouterKey: 'k' }, facts, bad), null);
});

test('cron limits briefing claim count and one shared AI request deadline', () => {
  const cron = read('_shared/dispatch.ts');
  const voice = read('_shared/morning-voice.ts');
  assert.match(cron, /saeed_ai_claim_briefings.{0,60}p_limit: 6/);
  assert.match(voice, /const signal = AbortSignal\.timeout\(7000\)/);
  assert.doesNotMatch(voice, /AbortSignal\.timeout\(8000\)/);
});
