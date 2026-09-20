import test from 'node:test';
import assert from 'node:assert/strict';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';
test('natural Persian requests route to the correct tools without a menu', () => {
  for (const [utterance, expected] of [
    ['یادم بنداز فردا ساعت ۹ جلسه دارم', 'remind'],
    ['تسک بساز برای خرید نان', 'tasks'],
    ['ناهار ۴۸۰ هزار تومان', 'expenses'],
    ['لیست خرید', 'shopping'],
    ['به لیست خرید اضافه کن شیر، نان', 'shopping'],
    ['صبح‌نامه روشن', 'briefing'],
    ['۱۲٪ از ۲ میلیون', 'calc'],
    ['۱.۲ + ۳.۴', 'calc'],
    ['سلام', 'chat'],
    ['چطور یادآور بسازم؟', 'chat'],
  ]) assert.equal(inferToolIntent(utterance), expected, utterance);
});
