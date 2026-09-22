import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimerRequest } from '../supabase/functions/_shared/timer.ts';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';

test('Persian spoken seven-minute timer is parsed, not answered as chat', () => {
  const phrase = 'حاجی یه تایمر برای هفت دقیقه بذار';
  assert.deepEqual(parseTimerRequest(phrase), { minutes: 7, seconds: 420, note: 'پایان تایمر ۷ دقیقه' });
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

test('compound durations are summed instead of silently truncated', () => {
  assert.equal(parseTimerRequest('تایمر یک ساعت و نیم بذار')?.minutes, 90);
  assert.equal(parseTimerRequest('تایمر ۱ ساعت و ۳۰ دقیقه بذار')?.minutes, 90);
  assert.equal(parseTimerRequest('تایمر یک ساعت و بیست دقیقه بذار')?.minutes, 80);
  assert.equal(parseTimerRequest('تایمر ۲ دقیقه و ۳۰ ثانیه بذار')?.seconds, 150);
  assert.equal(parseTimerRequest('تایمر ۹۰ ثانیه بذار')?.seconds, 90);
  assert.equal(parseTimerRequest('یه تایمر یه ربع بذار')?.minutes, 15);
  assert.equal(parseTimerRequest('تایمر سه ربع بذار')?.minutes, 45);
  assert.equal(parseTimerRequest('تایمر پونزده دقیقه بذار')?.minutes, 15);
});
test('timer labels use Persian digits and reject sub-30-second or ambiguous durations', () => {
  assert.equal(parseTimerRequest('تایمر ۱ ساعت و ۳۰ دقیقه بذار')?.note, 'پایان تایمر ۱ ساعت و ۳۰ دقیقه');
  assert.equal(parseTimerRequest('تایمر ۱۰ ثانیه بذار'), null);
  assert.equal(parseTimerRequest('تایمر ۲۵ ساعت بذار'), null);
});
