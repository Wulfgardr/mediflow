import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for (const [flag, reason] of [
  ['--negative-feedback', 'click feedback budget mutation'],
  ['--negative-delivery', 'warm useful view <=2s p95'],
]) {
  const result = spawnSync(process.execPath, ['scripts/run-reference.mjs', '--card', flag], {
    cwd: new URL('../', import.meta.url), env: process.env, encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.status, 1, `${flag}: the injected real delay must fail`);
  assert.ok(result.stderr.includes(reason), `${flag}: failure must be the measured budget: ${result.stderr}`);
  console.log(`PASS: ${flag} fails ${reason}.`);
}
