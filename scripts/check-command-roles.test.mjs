import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : /\.(tsx?|css)$/.test(file) ? [file] : [];
  });
}

test('ogni classe mf-button-* usata ha una definizione CSS', () => {
  const sourceFiles = ['app', 'components'].flatMap(dir => files(path.join(root, dir)));
  const defined = new Set();
  for (const file of sourceFiles.filter(file => file.endsWith('.css'))) {
    postcss.parse(readFileSync(file, 'utf8')).walkRules(rule => {
      for (const match of rule.selector.matchAll(/\.(mf-button-[\w-]+)/g)) defined.add(match[1]);
    });
  }
  const missing = sourceFiles.filter(file => !file.endsWith('.css')).flatMap(file =>
    [...readFileSync(file, 'utf8').matchAll(/\bmf-button-[a-z][\w-]*/g)]
      .filter(match => !defined.has(match[0])).map(match => `${path.relative(root, file)}: ${match[0]}`));
  assert.deepEqual(missing, []);
  for (const role of ['primary', 'secondary', 'text', 'destructive', 'icon']) {
    assert.ok(defined.has(`mf-button-${role}`), `ricetta mancante: ${role}`);
  }
});
