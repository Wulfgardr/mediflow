import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const result = spawnSync(process.execPath, ['scripts/run-reference.mjs', '--card', '--negative-feedback'], {
  cwd: new URL('../', import.meta.url), env: process.env, encoding: 'utf8', timeout: 60_000 });
assert.equal(result.status, 1, 'the injected real UI delay must fail');
assert.ok(result.stderr.includes('click feedback budget mutation'), 'failure must be the measured budget');
console.log('PASS: injected 150ms UI blockage fails the actual click-to-feedback budget.');
