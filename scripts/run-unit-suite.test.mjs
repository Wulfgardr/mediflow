/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'run-unit-suite.mjs'), 'utf8');
const dataDirSource = fs.readFileSync(path.join(root, 'scripts', 'test-data-dir.mjs'), 'utf8');

function fixture(unit) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-unit-wrapper-'));
  const scripts = path.join(sandbox, 'scripts'); fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, 'prepare-e2e-db.mjs'), "process.exit(Number(process.env.TEST_BOOTSTRAP_STATUS ?? 0));\n");
  fs.writeFileSync(path.join(scripts, 'test-data-dir.mjs'), dataDirSource.replaceAll('os.tmpdir()', JSON.stringify(sandbox)));
  fs.writeFileSync(path.join(scripts, 'run-unit-suite.mjs'), source.replace(/const unitArgs = .*;\n/u, `const unitArgs = ['--eval', ${JSON.stringify(unit)}];\n`).replaceAll('os.tmpdir()', JSON.stringify(sandbox)));
  return { sandbox, runner: path.join(scripts, 'run-unit-suite.mjs') };
}
function execute(value, env = {}) { const childEnv = { ...process.env, ...env }; delete childEnv.MEDIFLOW_DATA_DIR; return spawnSync(process.execPath, [value.runner], { encoding: 'utf8', env: childEnv }); }
function implicitDirs(value) { return fs.readdirSync(value.sandbox).filter((name) => name.startsWith('mediflow-unit-suite-')); }

test('cleans the owned temporary directory before propagating a child signal', () => {
  const value = fixture("process.kill(process.pid, 'SIGTERM');");
  try { const result = execute(value); assert.equal(result.signal, 'SIGTERM'); assert.deepEqual(implicitDirs(value), []); }
  finally { fs.rmSync(value.sandbox, { recursive: true, force: true }); }
});
test('cleans the owned temporary directory and preserves bootstrap exit status', () => {
  const value = fixture('process.exit(0);');
  try { const result = execute(value, { TEST_BOOTSTRAP_STATUS: '17' }); assert.equal(result.status, 17); assert.deepEqual(implicitDirs(value), []); }
  finally { fs.rmSync(value.sandbox, { recursive: true, force: true }); }
});
test('never deletes an explicit safe synthetic override', () => {
  const value = fixture('process.exit(0);'); const explicit = path.join(value.sandbox, 'mediflow-explicit'); fs.mkdirSync(explicit);
  try { const result = spawnSync(process.execPath, [value.runner], { encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: explicit } }); assert.equal(result.status, 0); assert.equal(fs.existsSync(explicit), true); }
  finally { fs.rmSync(value.sandbox, { recursive: true, force: true }); }
});
test('preserves a non-empty explicit relative data-dir value for every child', () => {
  const markerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-unit-wrapper-value-'));
  const valueMarker = path.join(markerDirectory, 'received-data-dir');
  const value = fixture(`require('node:fs').writeFileSync(${JSON.stringify(valueMarker)}, process.env.MEDIFLOW_DATA_DIR);`);
  try {
    const result = spawnSync(process.execPath, [value.runner], {
      encoding: 'utf8',
      env: { ...process.env, MEDIFLOW_DATA_DIR: 'relative-synthetic-fixture' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(valueMarker, 'utf8'), 'relative-synthetic-fixture');
  } finally {
    fs.rmSync(markerDirectory, { recursive: true, force: true });
    fs.rmSync(value.sandbox, { recursive: true, force: true });
  }
});
