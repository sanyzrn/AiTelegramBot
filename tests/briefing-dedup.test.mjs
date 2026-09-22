import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { briefingIntro } from '../supabase/functions/_shared/briefing-intro.ts';
import { dayQuote } from '../supabase/functions/_shared/morning-voice.ts';

const facts = {
  dayLabel: 'سه‌شنبه ۳۱ شهریور',
  cityLabel: 'تهران',
  weather: { temp: 20.2, low: 18.8, high: 34.5, rain: 0, clothing: 'لباس خنک و نخی' },
  tasks: [], reminders: [], expense: null, marketKnown: true,
};

test('fallback greeting does not repeat the date, forecast, or clothing', () => {
  const intro = briefingIntro(null, facts);
  assert.match(intro, /صبح بخیر/);
  assert.ok(intro.includes(dayQuote(facts.dayLabel).quote));
  assert.doesNotMatch(intro, /تهران|۳۱ شهریور|۱۸|۳۴|نخی|هوا/);
});

test('AI weather and clothing sentences are removed but friendly prose remains', () => {
  const spoken = 'صبح بخیر رفیق! 😄\nهوای تهران از ۱۸٫۸° تا ۳۴٫۵° در جریانه؛ لباس خنک و نخی بپوش.\nامروز یه فرصت خوبه که یه کار مهم رو جلو ببری. ✨';
  const intro = briefingIntro(spoken, facts);
  assert.match(intro, /صبح بخیر رفیق/);
  assert.match(intro, /کار مهم/);
  assert.doesNotMatch(intro, /هوای تهران|نخی|۱۸|۳۴/);
});

test('a mixed single-sentence forecast falls back instead of repeating weather', () => {
  const intro = briefingIntro('صبح بخیر! هوای امروز گرمه و لباس نخی بهترین انتخابه.', facts);
  assert.match(intro, /صبح بخیر/);
  assert.ok(intro.includes(dayQuote(facts.dayLabel).quote));
  assert.doesNotMatch(intro, /گرمه|نخی/);
});

test('cron keeps verified sourced forecast and only changes the introduction', () => {
  const cron = readFileSync('supabase/functions/_shared/dispatch.ts', 'utf8');
  assert.match(cron, /briefingIntro\(voice, facts\)/);
  assert.match(cron, /weather\?\.line/);
  assert.match(cron, /cache\.weather\(city\)/);
  assert.match(cron, /last_sent_day/);
});
