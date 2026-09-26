import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExpenses } from '../supabase/functions/_shared/life-expenses.ts';
import { rows, allButtons, MENU, TOOLS, GUIDE_BUTTON } from '../supabase/functions/_shared/menu.ts';
import { MENUS, mustForward } from '../supabase/functions/_shared/gateway-route.ts';
import { GUIDE_TEXT } from '../supabase/functions/_shared/guide.ts';
import { systemPrompt, toneGuide } from '../supabase/functions/_shared/tone.ts';

const src = (p) => readFileSync(new URL('../supabase/functions/' + p, import.meta.url), 'utf8');

test('glued digits never swallow Persian letters («۲پاکت شیر»)', () => {
  const r = parseExpenses('۲پاکت شیر ۵۰ هزار تومان', { permissive: true });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].description, '۲ پاکت شیر');
  assert.equal(r.items[0].amount, 50000n);
  assert.doesNotMatch(readFileSync(new URL('../webapp/index.html', import.meta.url), 'utf8'), /٠-۹/, 'Mini App parser has the same fix');
});

test('tools keyboard is slim: a guide instead of one button per automatic tool', () => {
  const tools = rows('tools', false).flat();
  assert.ok(tools.includes(GUIDE_BUTTON));
  assert.ok(tools.length <= 6);
  for (const auto of ['🌐 آنلاین', '📝 خلاصه', '🌍 ترجمه', '⏰ یادآور', '🧮 ماشین‌حساب']) assert.ok(!tools.includes(auto), auto);
  assert.ok(MENU.guide, 'guide page exists');
});

test('legacy tool buttons on old keyboards are still routed to the processor', () => {
  for (const label of Object.values(TOOLS)) {
    assert.ok(allButtons().includes(label), label);
    assert.ok(MENUS.has(label));
    assert.equal(mustForward({ text: label }), true);
  }
  assert.equal(mustForward({ text: GUIDE_BUTTON }), true);
});

test('guide explains every automatic tool and fits one Telegram message', () => {
  assert.ok(GUIDE_TEXT.length < 3500);
  for (const w of ['یادم بنداز', 'تومان', 'رسید', 'لیست خرید', 'ترجمه', 'خلاصه', 'ویس', 'GitHub', 'جوک', 'بخونش']) assert.match(GUIDE_TEXT, new RegExp(w));
  assert.match(src('saeed-ai-v7/index.ts'), /\\\/help[\s\S]{0,120}show\(id, chat, "guide"\)/);
});

test('system prompt: honest, Telegram-friendly, never claims actions, every tone has a guide', () => {
  const p = systemPrompt({ tone: 'friendly', language: 'fa', answer_length: 'short' });
  assert.match(p, /Never use Markdown tables/);
  assert.match(p, /Never claim something was saved/);
  assert.match(p, /1-4 sentences/);
  for (const t of ['friendly', 'formal', 'romantic', 'professional', 'creative', 'witty', 'mystic'])
    assert.doesNotMatch(toneGuide(t), /Follow the selected tone naturally/, t);
});

test('processor: calc intent computes instead of refusing; failure is one message with retry', () => {
  const index = src('saeed-ai-v7/index.ts');
  assert.match(index, /inferred === "calc"\) return startWork\(m, update, "calc"/);
  assert.doesNotMatch(index, /این فرمت محاسبه رو دقیق پشتیبانی نمی‌کنم/);
  const work = src('saeed-ai-v7/core/work.ts');
  assert.doesNotMatch(work, /show\(id, chat, "retry"\)/);
  assert.match(work, /failMessage\(reason, s\) \+ [^\n]*"retry", id\)/);
  // Quoted reply text is appended after the tool-specific prompt, so image tools keep it.
  assert.ok(work.indexOf('input += "\\n\\n[پیام ریپلای‌شده') > work.indexOf('med?.type === "image"'));
});

test('gateway: menu-button sync never blocks the first reply', () => {
  const g = src('saeed-ai-ui/index.ts');
  assert.match(g, /EdgeRuntime\.waitUntil\(syncMenuButton\(\)\)/);
  assert.doesNotMatch(g, /await syncMenuButton\(\)/);
});

test('a prompt that merely mentions «خلاصه» is not forced into a code block', () => {
  for (const p of ['saeed-ai-ui/core/output.ts', 'saeed-ai-v7/core/transport.ts'])
    assert.doesNotMatch(src(p), /\/خلاصه\|summari\[sz\]e\/i\.test\(prompt\)/, p);
});
