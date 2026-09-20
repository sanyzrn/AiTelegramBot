import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExact } from '../supabase/functions/_shared/calculator.ts';
import { parseExpense, handleLifeCallback } from '../supabase/functions/_shared/life.ts';
import { nextOccurrence } from '../supabase/functions/_shared/repeat.ts';
test('exact Persian percentage, decimal and division by zero', () => {
  assert.match(calculateExact('۱۲٪ از ۲ میلیون'), /۲۴۰/);
  assert.match(calculateExact('۱.۲ + ۳.۴'), /۴.۶/);
  assert.match(calculateExact('3 / 0'), /صفر/);
  assert.equal(calculateExact('eval(1+1)'), null);
});
test('expenses never guess currency or confuse prices with spending', () => {
  assert.equal(parseExpense('ناهار ۴۸۰'), 'currency_missing');
  assert.equal(parseExpense('ناهار ۴۸۰ هزار تومان').amount, 480000n);
  assert.equal(parseExpense('خرج تاکسی ۲۰۰۰۰۰ ریال').amount, 20000n);
  assert.equal(parseExpense('قیمت ناهار ۴۸۰ هزار تومان'), null);
});
test('recurrence catches up, retains monthly anchor and validates interval', () => {
  assert.equal(nextOccurrence('2026-09-20T04:00:00Z', 'daily', null, null, new Date('2026-09-21T04:01:00Z')), '2026-09-22T04:00:00.000Z');
  assert.equal(nextOccurrence('2026-01-30T20:30:00Z', 'monthly', null, 31, new Date('2026-03-01T00:00:00Z')), '2026-03-30T20:30:00.000Z');
  assert.equal(nextOccurrence('2026-09-20T04:00:00Z', 'hours', 8, null, new Date('2026-09-20T13:00:00Z')), '2026-09-20T20:00:00.000Z');
  assert.throws(() => nextOccurrence('2026-09-20T04:00:00Z', 'hours', 0, null));
});
test('callback mutations always constrain row ownership', async () => {
  const filters=[]; let replied='';
  const query={ update(){return this;},eq(a,b){ filters.push([a,b]); return this;},select(){return Promise.resolve({data:[],error:null});} };
  const c={ db:{from(){return query;}},tg:async()=>{},send:async(_,message)=>{replied=message;} };
  assert.equal(await handleLifeCallback(c,123,123,'task:done:99'), true);
  assert.deepEqual(filters.filter(([k])=>k==='telegram_user_id'),[['telegram_user_id',123]]);
  assert.match(replied,/دسترسی|قبلاً/);
});
