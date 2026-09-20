import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceFollowupMode, isSpokenRequest } from '../supabase/functions/_shared/voice-intent.ts';

test('a plain voice is a request, not a menu command', () => {
  assert.equal(isSpokenRequest('تایمر هفت دقیقه بذار'), true);
  assert.equal(isSpokenRequest('یه جوک بگو'), true);
  assert.equal(isSpokenRequest('امروز رفتم مغازه و یه چیزی دیدم'), false);
  assert.equal(isSpokenRequest('سلام حاجی'), false);
  assert.equal(isSpokenRequest('چرا این مشکل پیش اومده؟'), true);
});

test('only explicit reply transformation language selects a voice operation', () => {
  assert.equal(voiceFollowupMode('این ویس رو تایپ کن'), 'transcribe');
  assert.equal(voiceFollowupMode('تایپش کن'), 'transcribe');
  assert.equal(voiceFollowupMode('خلاصه اش کن'), 'summarize');
  assert.equal(voiceFollowupMode('خلاصه‌ش کن'), 'summarize');
  assert.equal(voiceFollowupMode('ترجمه اش کن'), 'translate');
  assert.equal(voiceFollowupMode('translate please'), 'translate');
  assert.equal(voiceFollowupMode('تایپ نکن'), null);
  assert.equal(voiceFollowupMode('من امروز یک ویس فرستادم'), null);
});
