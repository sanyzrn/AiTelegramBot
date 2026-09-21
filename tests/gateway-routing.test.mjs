import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('supabase/functions');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const menuSource = read('saeed-ai-v7/core/menu.ts');
const gatewayMenus = read('saeed-ai-ui/core/config.ts');
const gateway = read('saeed-ai-ui/index.ts');
const processor = read('saeed-ai-v7/index.ts');
const dispatcher = read('saeed-ai-reminders/index.ts');

function menuButtons(source) {
  const start = source.indexOf('export const MENU = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start > 0 && end > start, 'MENU block not found in menu.ts');
  const body = source.slice(start, end);
  const buttons = [];
  for (const m of body.matchAll(/\["([^"]+)"(?:,\s*"([^"]+)")?\]/g)) {
    buttons.push(m[1]);
    if (m[2]) buttons.push(m[2]);
  }
  assert.ok(buttons.length >= 40, 'MENU buttons unexpectedly shrank');
  return buttons;
}

function gatewayMenuSet(source) {
  const start = source.indexOf('export const MENUS = new Set([');
  const end = source.indexOf(']);', start);
  assert.ok(start > 0 && end > start, 'MENUS set not found in gateway config');
  return new Set([...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function toolsKeys(source) {
  const start = source.indexOf('TOOLS = {');
  const end = source.indexOf('};', start);
  assert.ok(start > 0 && end > start, 'TOOLS block not found in menu.ts');
  return [...source.slice(start, end).matchAll(/(\w+):\s*"/g)].map((m) => m[1]);
}

test('every reply-keyboard button is routable by the gateway or is a slash command', () => {
  const menus = gatewayMenuSet(gatewayMenus);
  const unroutable = menuButtons(menuSource).filter(
    (label) => !menus.has(label) && !label.startsWith('/'),
  );
  assert.deepEqual(
    unroutable,
    [],
    `Gateway MENUS never forwards these keyboard buttons, so they leak into AI chat: ${unroutable.join(' | ')}`,
  );
});

test('the gateway forwards every processor-side pending_tool (no dead keyboard buttons)', () => {
  const forwardBlock = gateway.match(/\[([^\]]*?)\]\.includes\(p\?\.pending_tool\)/s);
  assert.ok(forwardBlock, 'gateway pending_tool forward list not found');
  const forwarded = new Set(
    [...forwardBlock[1].matchAll(/"(\w+)"/g)].map((m) => m[1]),
  );
  // "chat" is the default and "web" is handled by the gateway search path itself.
  const mustForward = toolsKeys(menuSource).filter((k) => !['chat', 'web'].includes(k));
  const missing = mustForward.filter((k) => !forwarded.has(k));
  assert.deepEqual(
    missing,
    [],
    `Tools keyboard sets pending_tool but gateway never forwards it to the processor: ${missing.join(', ')}`,
  );
});

test('keyboard_page CHECK constraint accepts the tasks delete confirmation page', () => {
  const ui = read('saeed-ai-v7/core/ui.ts');
  assert.match(ui, /tasks_delete_confirm/, 'ui.ts must route the confirmation page');
  const migration = readFileSync(
    resolve('supabase/migrations/20260921040749_saeed_ai_v91_keyboard_page_states.sql'),
    'utf8',
  );
  assert.match(
    migration,
    /'tasks_delete_confirm'/,
    'keyboard_page CHECK constraint must accept tasks_delete_confirm or show() fails at runtime',
  );
});

test('webhook setup endpoint requires the derived webhook secret', () => {
  const setupAt = gateway.indexOf('searchParams.has("setup")');
  const setWebhookAt = gateway.indexOf('setWebhook');
  assert.ok(setupAt > 0 && setWebhookAt > setupAt, 'setup endpoint moved');
  const guardZone = gateway.slice(setupAt, setWebhookAt);
  assert.match(
    guardZone,
    /X-Telegram-Bot-Api-Secret-Token/,
    'unauthenticated callers must not be able to re-register the webhook',
  );
  assert.match(guardZone, /equal\(/, 'secret comparison must be constant-time');
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
  assert.match(deploy, new RegExp(declared[1].replace(/\./g, '\\.')));
  assert.match(deploy, /APP_VERSION/, 'deploy workflow must check the shared version import');
});
