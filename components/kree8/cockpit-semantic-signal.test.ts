/* @Codex */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cockpitSourceUrl = new URL('./cockpit-shared.tsx', import.meta.url);
const cockpitCssUrl = new URL('./kree8-clinical-cockpit.module.css', import.meta.url);

test('la pillola condivisa non neutralizza i quattro segnali Lume', async () => {
  const source = await readFile(cockpitSourceUrl, 'utf8');

  assert.match(source, /success:\s*styles\.pillSuccess/);
  assert.match(source, /warning:\s*styles\.pillWarning/);
  assert.match(source, /critical:\s*styles\.pillCritical/);
  assert.match(source, /plum:\s*styles\.pillPlum/);
});

test('le pillole di segnale usano la ricetta 60 testo, 11 fondo, 30 bordo', async () => {
  const css = await readFile(cockpitCssUrl, 'utf8');

  for (const [className, signal] of [
    ['pillSuccess', 'success'],
    ['pillWarning', 'warning'],
    ['pillCritical', 'critical'],
    ['pillPlum', 'plum'],
  ]) {
    const rule = new RegExp(
      `\\.${className}\\s*\\{[^}]*${signal}\\) 11%[^}]*${signal}\\) 60%[^}]*${signal}\\) 30%`,
      's',
    );
    assert.match(css, rule);
  }
});
