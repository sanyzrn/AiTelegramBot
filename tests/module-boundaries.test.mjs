import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve('supabase/functions');
const modules = ['saeed-ai-v7', 'saeed-ai-ui'].flatMap((name) => {
  const dir = join(root, name, 'core');
  return readdirSync(dir).filter((name) => name.endsWith('.ts')).map((name) => join(dir, name));
});
const all = new Set(modules);
const named = /^import\s*\{([^{}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm;

function imports(path) {
  const source = readFileSync(path, 'utf8');
  const body = source.replace(named, '');
  const edges = new Set();
  for (const match of source.matchAll(named)) {
    const specifier = match[2];
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(path), specifier);
      if (all.has(target)) edges.add(target);
    }
    for (const item of match[1].split(',')) {
      const symbol = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1);
      assert.match(body, new RegExp(`\\b${symbol}\\b`), `Unused import ${symbol} in ${path}`);
    }
  }
  assert.doesNotMatch(source, /@ts-(?:nocheck|ignore|expect-error)/, `Type checking disabled: ${path}`);
  return edges;
}

test('core modules have no unused named imports or circular dependencies', () => {
  assert.ok(modules.length >= 16, 'Do not silently drop core modules');
  const dependencies = new Map(modules.map((path) => [path, imports(path)]));
  const visiting = new Set(), visited = new Set();
  function visit(path) {
    assert.ok(!visiting.has(path), `Circular dependency involving ${path}`);
    if (visited.has(path)) return;
    visiting.add(path);
    for (const child of dependencies.get(path)) visit(child);
    visiting.delete(path);
    visited.add(path);
  }
  for (const path of modules) visit(path);
});

test('presentation menu is pure and transport/life never depend on UI controller', () => {
  const dir = join(root, 'saeed-ai-v7', 'core');
  const menu = readFileSync(join(dir, 'menu.ts'), 'utf8');
  assert.doesNotMatch(menu, /^import\b/m);
  assert.match(menu, /export const keyboard/);
  for (const name of ['transport.ts', 'life.ts']) {
    const source = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(source, /from\s*['"]\.\/ui\.ts['"]/, `${name} must not depend on UI controller`);
    assert.match(source, /from\s*['"]\.\/menu\.ts['"]/, `${name} must depend on pure menu`);
  }
});
