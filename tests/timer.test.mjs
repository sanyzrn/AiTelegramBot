import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimerRequest } from '../supabase/functions/_shared/timer.ts';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';

test('Persian spoken seven-minute timer is parsed, not answered as chat', () => {
  const phrase = 'حاجی یه تایمر برای هفت دقیقه بذار';
  assert.deepEqual(parseTimerRequest(phrase), { minutes: 7, note: 'پایان تایمر 7 دقیقه‌ای' });
  assert.equal(inferToolIntent(phrase), 'remind');
});
test('Persian and Arabic digits plus compound cardinal numbers', () => {
  assert.equal(parseTimerRequest('تایمر ۷ دقیقه بزن')?.minutes, 7);
  assert.equal(parseTimerRequest('برای ٧ دقیقه تایمر تنظیم کن')?.minutes, 7);
  assert.equal(parseTimerRequest('تایمر بیست و پنج دقیقه تنظیم کن')?.minutes, 25);
  assert.equal(parseTimerRequest('یه تایمر نیم ساعت بگذار')?.minutes, 30);
});
test('Timer parser rejects questions, past-tense acknowledgements and invalid durations', () => {
  assert.equal(parseTimerRequest('چرا تایمر هفت دقیقه کار نمیکنه؟'), null);
  assert.equal(parseTimerRequest('تایمر برای ۷ دقیقه تنظیم شد!'), null);
  assert.equal(parseTimerRequest('تایمر صد ساعت بگذار'), null);
  assert.equal(parseTimerRequest('تایمر برای چند دقیقه تنظیم کن'), null);
  assert.equal(parseTimerRequest('هفت دقیقه دیگه چی کار کنم؟'), null);
});
test('Timer intent is not inferred for a question about a timer', () => {
  assert.equal(inferToolIntent('تایمر چرا کار نمیکنه؟'), 'chat');
});
