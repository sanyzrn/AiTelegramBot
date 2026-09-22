import test from 'node:test';
import assert from 'node:assert/strict';
import { groundedSearch, pickSearchModel, extractSources } from '../supabase/functions/_shared/web-search.ts';

const groundedReply = {
  candidates: [{
    content: { parts: [{ text: 'خبر تأییدشده از جست‌وجو' }] },
    groundingMetadata: {
      webSearchQueries: ['اخبار امروز'],
      groundingChunks: [{ web: { uri: 'https://example.com/news', title: 'خبرگزاری نمونه' } }],
    },
  }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
};

async function withMockFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test('online search sends google_search, uses configured key, and returns genuine citation and model', async () => {
  const calls = [];
  await withMockFetch(async (url, init) => {
    calls.push({ url: String(url), key: init.headers['x-goog-api-key'], body: JSON.parse(init.body) });
    return new Response(JSON.stringify(groundedReply), { status: 200 });
  }, async () => {
    const r = await groundedSearch('اخبار امروز', 'answer in Persian', 'gemini-3.5-flash', 'example-key');
    assert.equal(r.model, 'gemini-3.5-flash');
    assert.deepEqual(r.usage, { input: 10, output: 20 });
    assert.match(r.text, /https:\/\/example\.com\/news/);
    assert.match(r.text, /خبر تأییدشده/);
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-3\.5-flash:generateContent/);
  assert.equal(calls[0].key, 'example-key');
  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.equal(calls[0].body.contents[0].parts[0].text, 'اخبار امروز');
});

test('search never labels an unsourced model answer as grounded', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'پاسخ بدون منبع' }] } }] }), { status: 200 });
  }, async () => {
    await assert.rejects(groundedSearch('قیمت امروز', 'answer', 'gemini-3.5-flash', 'key'), /SEARCH_NO_SOURCES/);
  });
  assert.ok(calls > 0);
  assert.deepEqual(extractSources({ groundingChunks: [{ web: { uri: 'javascript:alert(1)' } }] }), []);
});

test('unsupported minimal thinking falls back to search without thinking config', async () => {
  const bodies = [];
  await withMockFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return bodies.length === 1
      ? new Response('{}', { status: 400 })
      : new Response(JSON.stringify(groundedReply), { status: 200 });
  }, async () => {
    const r = await groundedSearch('آخرین نتیجه', 'answer', 'gemini-3.5-flash', 'key');
    assert.match(r.text, /https:\/\/example\.com\/news/);
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  assert.deepEqual(bodies[1].tools, [{ google_search: {} }]);
});

test('lite search selection is explicit, not a silent return to an offline chat model', () => {
  assert.equal(pickSearchModel('gemini-3.5-flash-lite'), 'gemini-3.5-flash');
  assert.equal(pickSearchModel('gemini-3.5-flash'), 'gemini-3.5-flash');
});
