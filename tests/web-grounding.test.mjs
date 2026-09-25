import test from 'node:test';
import assert from 'node:assert/strict';
import { groundedSearch, pickSearchModel, extractSources, extractAnnotationSources } from '../supabase/functions/_shared/web-search.ts';

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

const GEMINI_CFG = { provider: 'gemini', gemini: 'gemini-3.5-flash-lite', openrouter: 'x/y', search: 'gemini-3.5-flash' };

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
    const r = await groundedSearch('اخبار امروز', 'answer in Persian', GEMINI_CFG, { gemini: 'example-key' });
    assert.equal(r.model, 'gemini-3.5-flash');
    assert.equal(r.provider, 'gemini');
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
    await assert.rejects(groundedSearch('قیمت امروز', 'answer', GEMINI_CFG, { gemini: 'key' }), /SEARCH_NO_SOURCES/);
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
    const r = await groundedSearch('آخرین نتیجه', 'answer', GEMINI_CFG, { gemini: 'key' });
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

test('with OpenRouter active the search uses the web plugin and NEVER calls Gemini', async () => {
  const calls = [];
  await withMockFetch(async (url, init) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'قیمت لحظه‌ای دلار امروز …',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://example.com/usd', title: 'منبع دلار' } },
            { type: 'url_citation', url_citation: { url: 'https://example.com/usd', title: 'منبع دلار (تکراری)' } },
            { type: 'url_citation', url_citation: { url: 'javascript:alert(1)' } },
          ],
        },
      }],
      usage: { prompt_tokens: 7, completion_tokens: 11 },
    }), { status: 200 });
  }, async () => {
    const r = await groundedSearch('قیمت دلار امروز', 'answer in Persian', { provider: 'openrouter', gemini: 'gemini-3.5-flash', openrouter: 'x/multi', search: 'gemini-3.5-flash' }, { gemini: 'gemini-key', openrouter: 'or-key' });
    assert.equal(r.provider, 'openrouter');
    assert.equal(r.model, 'x/multi');
    assert.deepEqual(r.usage, { input: 7, output: 11 });
    assert.match(r.text, /https:\/\/example\.com\/usd/);
    assert.doesNotMatch(r.text, /تکراری/);
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(calls[0].auth, 'Bearer or-key');
  assert.deepEqual(calls[0].body.plugins, [{ id: 'web', max_results: 5 }]);
  assert.equal(calls[0].body.model, 'x/multi');
  assert.ok(!calls[0].body.model.endsWith(':online'));
});

test('OpenRouter search without citations is refused instead of posing as grounded', async () => {
  await withMockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'پاسخ بدون منبع' } }] }), { status: 200 }), async () => {
    await assert.rejects(
      groundedSearch('قیمت امروز', 'answer', { provider: 'openrouter', gemini: 'g', openrouter: 'x/y', search: '' }, { gemini: 'gk', openrouter: 'ok' }),
      /SEARCH_NO_SOURCES/,
    );
  });
});

test('annotation source extraction keeps only unique https links', () => {
  assert.deepEqual(extractAnnotationSources({
    choices: [{ message: { annotations: [
      { url_citation: { url: 'https://a.com/1', title: 'A' } },
      { url_citation: { url: 'https://a.com/1', title: 'A2' } },
      { url_citation: { url: 'https://a.com/2' } },
    ] } }],
  }), [{ title: 'A', uri: 'https://a.com/1' }, { title: undefined, uri: 'https://a.com/2' }]);
  assert.deepEqual(extractAnnotationSources({}), []);
});
