import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MENU, TOOLS, DASHBOARD_BUTTON } from '../supabase/functions/_shared/menu.ts';
import { mustForward, forwardsPendingTool } from '../supabase/functions/_shared/gateway-route.ts';
import { resolve } from 'node:path';

const root = resolve('supabase/functions');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const gateway = read('saeed-ai-ui/index.ts');
const processor = read('saeed-ai-v7/index.ts');
const dispatcher = read('saeed-ai-reminders/index.ts');

test('every reply-keyboard button is routable by the gateway or is a slash command', () => {
  const unroutable = Object.values(MENU).flat(2).filter((label) => !mustForward({ text: label }));
  assert.deepEqual(unroutable, [], `Gateway never forwards these keyboard buttons, so they leak into AI chat: ${unroutable.join(' | ')}`);
  assert.ok(mustForward({ text: '🛡 مدیریت' }), 'admin-only settings button is routable');
  assert.ok(mustForward({ text: DASHBOARD_BUTTON }));
});

test('the gateway forwards every processor-side pending_tool (no dead keyboard buttons)', () => {
  const missing = Object.keys(TOOLS).filter((k) => !['chat', 'web'].includes(k) && !forwardsPendingTool(k));
  assert.deepEqual(missing, [], `Tools keyboard sets pending_tool but gateway never forwards it: ${missing.join(', ')}`);
  assert.equal(forwardsPendingTool('chat'), false);
  assert.equal(forwardsPendingTool('web'), false, 'online search is answered by the gateway itself');
  assert.equal(forwardsPendingTool(undefined), false);
});

test('media, slash commands, voice replies and typed life commands reach the processor', () => {
  assert.ok(mustForward({ text: '/start' }));
  assert.ok(mustForward({ photo: [{}] }));
  assert.ok(mustForward({ document: {} }));
  assert.ok(mustForward({ text: 'تایپش کن', reply_to_message: { voice: {} } }));
  for (const t of ['صبح‌نامه تست', 'یادت باشه من گیاه‌خوارم', 'حافظه‌هام', 'یادآورهام', 'هشدارهام',
    'وقتی دلار از ۹۵ هزار تومن رد شد خبرم کن', 'خلاصه هفته', 'پومودورو', 'منطقه زمانی', 'بخونش', 'خروجی کامل',
    'لیست خرید', 'اشتراک لیست خرید', 'عضو لیست خرید ۱۲۳۴۵۶', 'حذف آخرین خرج', 'صبح‌نامه ساعت ۸'])
    assert.ok(mustForward({ text: t }), `${t} must be forwarded`);
  assert.ok(mustForward({ text: 'ترجمه', reply_to_message: { text: 'hello' } }), 'reply-translate shortcut');
  assert.equal(mustForward({ text: 'ترجمه' }), false, 'a bare word without a replied text stays chat');
  for (const t of ['سلام', 'حال شما چطوره؟', 'یه شعر بگو']) assert.equal(mustForward({ text: t }), false, `${t} stays in gateway chat`);
});

test('every menu page is accepted by the keyboard_page CHECK of the latest migration', () => {
  const migrations = readdirSync(resolve('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  let allowed = null;
  for (const f of migrations) {
    const sql = readFileSync(resolve('supabase/migrations', f), 'utf8');
    for (const m of sql.matchAll(/keyboard_page_check\s+CHECK\s*\(\s*keyboard_page\s+IN\s*\(([^)]*)\)/gi))
      allowed = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  }
  assert.ok(allowed, 'keyboard_page CHECK constraint not found in migrations');
  const missing = Object.keys(MENU).filter((page) => !allowed.has(page));
  assert.deepEqual(missing, [], `show() would fail at runtime for pages: ${missing.join(', ')}`);
});

test('pending_tool CHECK accepts every tool the keyboard can select', () => {
  const migrations = readdirSync(resolve('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  let allowed = null;
  for (const f of migrations) {
    const sql = readFileSync(resolve('supabase/migrations', f), 'utf8');
    for (const m of sql.matchAll(/pending_tool_check\s+CHECK\s*\(\s*pending_tool\s+IN\s*\(([^)]*)\)/gi))
      allowed = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  }
  assert.ok(allowed, 'pending_tool CHECK constraint not found in migrations');
  const missing = Object.keys(TOOLS).filter((k) => !allowed.has(k));
  assert.deepEqual(missing, []);
});

test('webhook setup and diagnostics require the derived webhook secret', () => {
  const guard = gateway.match(/const secretOk = async \(\) =>([^\n]+)/);
  assert.ok(guard, 'secretOk guard missing');
  assert.match(guard[1], /X-Telegram-Bot-Api-Secret-Token/);
  assert.match(guard[1], /equal\(/, 'secret comparison must be constant-time');
  for (const endpoint of ['"setup"', '"selftest"']) {
    const at = gateway.indexOf(`searchParams.has(${endpoint})`);
    assert.ok(at > 0, `${endpoint} endpoint moved`);
    assert.match(gateway.slice(at, at + 200), /secretOk\(\)/, `${endpoint} must be authenticated`);
  }
  const processorSelftest = processor.indexOf('searchParams.has("selftest")');
  assert.match(processor.slice(processorSelftest, processorSelftest + 300), /equal\(/, 'processor selftest must be authenticated');
});

test('release version has a single source of truth used by all three functions', () => {
  const version = readFileSync(resolve(root, '_shared/version.ts'), 'utf8');
  const declared = version.match(/APP_VERSION = "([\d.]+)"/);
  assert.ok(declared, 'version.ts must declare APP_VERSION');
  for (const [name, source] of [['processor', processor], ['gateway', gateway], ['dispatcher', dispatcher]]) {
    assert.match(source, /APP_VERSION/, `${name} must report the shared APP_VERSION`);
    assert.doesNotMatch(
      source,
      /version: "\d+\.\d+\.\d+"/,
      `${name} hardcodes a version literal that will drift from version.ts`,
    );
  }
  const deploy = readFileSync(resolve('.github/workflows/deploy-supabase.yml'), 'utf8');
  assert.match(deploy, /APP_VERSION/, 'deploy workflow must read the shared version');
  assert.doesNotMatch(deploy, /\d+\.\d+\.\d+"/, 'deploy workflow must not hardcode a release number');
});
