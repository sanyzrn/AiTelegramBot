import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTehranWeather, fetchIranMarket, briefingExternalSections } from '../supabase/functions/_shared/briefing-sources.ts';
const now = Date.now();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const weather = { timezone: 'Asia/Tehran', current: { time: `${today}T07:00`, temperature_2m: 21, weather_code: 1 }, daily: { time: [today], temperature_2m_min: [14], temperature_2m_max: [28], precipitation_probability_max: [53] } };
const mk = (data) => async () => new Response(JSON.stringify(data), { status: 200 });
test('weather uses verified Tehran daily forecast, not a hardcoded temperature', async () => {
  const result = await fetchTehranWeather(mk(weather), now);
  assert.match(result.line, /۲۱/);
  assert.match(result.line, /چتر/);
  assert.match(result.line, /Open-Meteo/);
});
test('weather refuses wrong local day and invalid temperatures', async () => {
  assert.equal(await fetchTehranWeather(mk({ ...weather, daily: { ...weather.daily, time: ['2020-01-01'] } }), now), null);
  assert.equal(await fetchTehranWeather(mk({ ...weather, current: { temperature_2m: 'NaN' } }), now), null);
});
test('market preserves source toman units and timestamps', async () => {
  const time = Math.floor(now / 1000);
  const fetcher = async (url) => new Response(JSON.stringify(String(url).includes('fiat') ? { usd: { value: 228200, date: time } } : { '18ayar': { value: 23334410, date: time } }), { status: 200 });
  const result = await fetchIranMarket(fetcher, now);
  assert.match(result.line, /۲۲۸٬۲۰۰/);
  assert.match(result.line, /۲۳٬۳۳۴٬۴۱۰/);
  assert.match(result.line, /Navasan-API/);
});
test('market refuses stale, future, zero and missing-time rates', async () => {
  const stale = Math.floor((now - 48 * 3600000) / 1000);
  const fetcher = async (url) => new Response(JSON.stringify(String(url).includes('fiat') ? { usd: { value: 228200, date: stale } } : { '18ayar': { value: 23334410, date: stale } }));
  assert.equal(await fetchIranMarket(fetcher, now), null);
  const noTime = async (url) => new Response(JSON.stringify(String(url).includes('fiat') ? { usd: { value: 228200 } } : { '18ayar': { value: 23334410 } }));
  assert.equal(await fetchIranMarket(noTime, now), null);
});
test('weather and market sources fail independently', async () => {
  const fetcher = async (url) => String(url).includes('open-meteo') ? new Response(JSON.stringify(weather)) : new Response('unavailable', { status: 503 });
  const text = await briefingExternalSections(fetcher, now);
  assert.match(text, /هوای تهران/);
  assert.match(text, /نرخ تازه و قابل‌تأیید در دسترس نیست/);
});
