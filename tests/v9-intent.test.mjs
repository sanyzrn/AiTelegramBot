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

test('online search phrases and live-fact questions route to web', () => {
  for (const [utterance, expected] of [
    ['جستجو کن قیمت دلار چنده', 'web'],
    ['جستجوی آنلاین قیمت طلا', 'web'],
    ['سرچ کن آخرین خبرها چیه', 'web'],
    ['آنلاین بگرد قیمت بیت‌کوین', 'web'],
    ['search the web for latest news', 'web'],
    ['قیمت دلار امروز چنده؟', 'web'],
    ['نرخ یورو الان چقدره؟', 'web'],
    ['خبرهای امروز چی بود؟', 'web'],
    ['آب و هوای امروز تهران چطوره؟', 'web'],
    ['چه کسی برنده بازی دیشب شد؟', 'web'],
    ['who won the latest match?', 'web'],
    // How-to stays chat even if someone asks to search for a tutorial.
    ['چطور یادآور بسازم؟', 'chat'],
  ]) assert.equal(inferToolIntent(utterance), expected, utterance);
});
