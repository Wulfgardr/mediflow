import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { runProof, validateEnvironment, reservedPorts, writeReport } from './prove-a-mano.mjs';
test('tre stati osservabili e skip non dichiarato verde', async () => {
 const output = mkdtempSync(path.join(tmpdir(), 'proof-test-'));
 try {
  const run = (id, code) => runProof({ id, command: [process.execPath, '-e', code] }, {}, output);
  const results = [await run('pass', 'process.exit(0)'), await run('fail', 'process.exit(7)'), await runProof({ id: 'missing', command: ['/missing/proof'] }, {}, output)];
  writeReport(output, results);
  assert.deepEqual(JSON.parse(readFileSync(path.join(output, 'esito.json'))).results.map(r => r.status), ['provato', 'fallito', 'non provato']);
  for (const status of ['provato', 'fallito', 'non provato']) assert.ok(readFileSync(path.join(output, 'esito.md'), 'utf8').includes(status));
  assert.ok(results.every(r => r.durationMs >= 0 && r.reason));
  assert.equal((await run('fail', 'process.exit(7)')).status, 'fallito');
  assert.equal((await runProof({ id: 'missing', command: ['/missing/proof'] }, {}, output)).status, 'non provato');
  assert.equal((await run('zero-skips', 'console.log("ℹ skipped 0")')).status, 'provato');
  assert.equal((await run('skip', 'console.log("# skipped 1")')).status, 'non provato');
 } finally { rmSync(output, { recursive: true }); }
});
test('rifiuta archivio reale, qualsiasi archivio esterno e porte riservate', () => {
 for (const data of [path.join(homedir(), 'Library/Application Support/MediFlow'), '/tmp/alias']) assert.throws(() => validateEnvironment({ MEDIFLOW_DATA_DIR: data }));
 for (const port of reservedPorts) {
  assert.throws(() => validateEnvironment({ PORT: String(port) }));
  assert.throws(() => validateEnvironment({ E2E_BASE_URL: `http://127.0.0.1:${port}` }));
 }
 assert.doesNotThrow(() => validateEnvironment({}));
});

test('CLI rifiuta configurazioni riservate prima di lanciare prove', () => {
 for (const extra of [{ MEDIFLOW_DATA_DIR: path.join(homedir(), 'Library/Application Support/MediFlow') }, ...reservedPorts.map(port => ({ PORT: String(port) }))]) {
  const result = spawnSync(process.execPath, ['scripts/prove-a-mano.mjs'], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non ammesso|porta riservata/u);
  assert.equal(result.stdout, '');
 }
});
