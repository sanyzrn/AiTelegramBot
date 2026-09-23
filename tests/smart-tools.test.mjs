import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaTool } from '../supabase/functions/_shared/media-intent.ts';
import { inferToolIntent } from '../supabase/functions/_shared/tool-intent.ts';
import { mustForward } from '../supabase/functions/_shared/gateway-route.ts';

test('a photo picks its tool from the caption, no menu needed', () => {
  assert.equal(mediaTool('photo', 'این هزینه رو ثبت کن'), 'receipt', 'the reported bug: expense caption on a receipt photo');
  assert.equal(mediaTool('photo', 'رسید خریدم'), 'receipt');
  assert.equal(mediaTool('photo', 'فاکتور'), 'receipt');
  assert.equal(mediaTool('photo', 'متنش رو بنویس'), 'ocr');
  assert.equal(mediaTool('photo', 'تایپش کن'), 'ocr');
  assert.equal(mediaTool('photo', 'ترجمه کن'), 'translate');
  assert.equal(mediaTool('photo', 'خلاصه‌ش کن'), 'summarize');
  assert.equal(mediaTool('photo', 'این گل چیه؟'), 'image');
  assert.equal(mediaTool('photo', ''), 'image', 'uncaptioned photos are analysed (and checked for receipts)');
});

test('files: PDF receipts, documents for everything else, explicit compatible choice wins', () => {
  assert.equal(mediaTool('pdf', 'این فاکتور رو ثبت کن'), 'receipt');
  assert.equal(mediaTool('pdf', 'خلاصه کن'), 'documents');
  assert.equal(mediaTool('office', 'هزینه‌ها رو ثبت کن'), 'documents', 'spreadsheets are read, not treated as a receipt');
  assert.equal(mediaTool('photo', 'این هزینه رو ثبت کن', 'ocr'), 'ocr', 'an explicitly chosen tool wins');
  assert.equal(mediaTool('photo', '', 'receipt'), 'receipt');
  assert.equal(mediaTool('photo', 'متنش', 'remind'), 'ocr', 'an incompatible pending tool is ignored');
});

test('every tool also works from plain text', () => {
  assert.equal(inferToolIntent('رسید رو ثبت کن'), 'receipt');
  assert.equal(inferToolIntent('فاکتورم رو ثبت کن'), 'receipt');
  assert.equal(inferToolIntent('یه جوک بگو'), 'joke');
  assert.equal(inferToolIntent('یه داستان کوتاه بنویس'), 'story');
  assert.equal(inferToolIntent('فال امروزم رو بگو'), 'horoscope');
  assert.equal(inferToolIntent('فال حافظ بگیر'), 'chat', 'Hafez divination is a conversation, not the horoscope tool');
  assert.equal(inferToolIntent('یه معما بپرس'), 'trivia');
  assert.equal(inferToolIntent('روستم کن'), 'roast');
  assert.equal(inferToolIntent('داستان فیلم تایتانیک چیه؟'), 'chat');
  assert.equal(inferToolIntent('این متن رو خلاصه کن'), 'summarize');
  assert.equal(inferToolIntent('ترجمه کن hello'), 'translate');
});

test('a text reply to a photo or file reaches the processor', () => {
  assert.ok(mustForward({ text: 'ثبتش کن', reply_to_message: { photo: [{}] } }));
  assert.ok(mustForward({ text: 'خلاصه کن', reply_to_message: { document: {} } }));
  assert.equal(mustForward({ text: 'سلام', reply_to_message: { text: 'x' } }), false);
});
