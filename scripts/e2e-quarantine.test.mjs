import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { errorMessages, loadQuarantine, quarantineFor, root, sourcePath } from './e2e-quarantine.mjs';
import { runNodeWithQuarantine } from './e2e-quarantine-node.mjs';

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST')));
const options = { cwd: root, encoding: 'utf8', env };
const future = '2099-01-01T00:00:00Z';
const past = '2000-01-01T00:00:00Z';
function entry(runner, file) {
  return { id: 'synthetic-instability', owner: 'synthetic test', diagnosis: 'https://example.invalid/diagnosis', expiresAt: future,
    tests: [{ runner, file: sourcePath(file), title: 'known failure', signature: '^known browser failure$', errors: ['^known browser failure$'] }] };
}
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mediflow-quarantine-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a real Playwright failure executes and stays visible; expiry restores its failing exit code', t => {
  const dir = fixture(t), file = join(dir, 'fixture.spec.mjs'), manifest = join(dir, 'quarantine.json');
  const marker = join(dir, 'executed');
  writeFileSync(file, `import { test } from ${JSON.stringify(pathToFileURL(join(root, 'node_modules/@playwright/test/index.mjs')).href)};
import { appendFileSync } from 'node:fs';
test('known failure', () => { appendFileSync(${JSON.stringify(marker)}, 'ran\\n'); throw new Error('known browser failure'); });`);
  const record = entry('playwright', file);
  const config = join(dir, 'playwright.config.mjs');
  writeFileSync(config, `export default ${JSON.stringify({ testDir: dir, testMatch: 'fixture.spec.mjs', retries: 0,
    reporter: [[join(root, 'scripts/e2e-quarantine-playwright.mjs'), { manifestPath: manifest, outputDir: dir }], ['list']] })};`);
  for (const [expiresAt, exitCode] of [[future, 0], [past, 1]]) {
    writeFileSync(manifest, JSON.stringify([{ ...record, expiresAt }]));
    const result = spawnSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config], options);
    assert.equal(result.status, exitCode, result.stdout + result.stderr);
    assert.match(result.stdout, /1 failed/);
    const report = JSON.parse(readFileSync(join(dir, 'quarantine-playwright.json'), 'utf8'));
    assert.equal(report.originalStatus, 'failed');
    assert.equal(report.tests[0].quarantined, exitCode === 0);
  }
  assert.equal(readFileSync(marker, 'utf8'), 'ran\nran\n');
});

test('real node:test nested failures remain visible, expire, and never absorb another failure', t => {
  const dir = fixture(t), file = join(dir, 'fixture.test.mjs');
  writeFileSync(file, `import test from 'node:test';
test('parent', async t => {
 await t.test('known failure', () => { throw new Error('known browser failure'); });
 if (process.env.EXTRA_FAILURE) await t.test('unrelated failure', () => { throw new Error('data integrity regression'); });
});`);
  const record = entry('node', file);
  for (const [expiresAt, extra, exitCode] of [[future, '', 0], [past, '', 1], [future, '1', 1]]) {
    const result = runNodeWithQuarantine(['--test', file], { ...options, env: { ...env, EXTRA_FAILURE: extra } },
      { entries: [{ ...record, expiresAt }], directory: dir });
    assert.equal(result.status, exitCode, result.stdout + result.stderr + readFileSync(join(dir, 'quarantine-node-events.jsonl'), 'utf8'));
    assert.match(result.stdout, /known browser failure/);
  }
  writeFileSync(file, "process.exit(1);\n");
  assert.equal(runNodeWithQuarantine(['--test', file], options, { entries: [record], directory: dir }).status, 1);
});

test('known signatures reject generic timeouts, cleanup errors, other tests and exact expiry', () => {
  const entries = loadQuarantine();
  const registered = entries[0].tests[0];
  const result = { ...registered, errors: ['Test timeout of 45000ms exceeded.',
    'page.waitForEvent: Test timeout of 45000ms exceeded.\n=========================== logs ===========================\nwaiting for event "filechooser"\n============================================================'] };
  const beforeExpiry = Date.parse(entries[0].expiresAt) - 1;
  assert.equal(quarantineFor(result, entries, beforeExpiry)?.id, entries[0].id);
  assert.equal(quarantineFor(result, entries, beforeExpiry + 1), null);
  assert.equal(quarantineFor({ ...result, errors: result.errors.slice(0, 1) }, entries, beforeExpiry), null);
  assert.equal(quarantineFor({ ...result, title: 'another test' }, entries, beforeExpiry), null);
  assert.equal(quarantineFor({ ...result, errors: [...result.errors, 'cleanup failed'] }, entries, beforeExpiry), null);
  assert.deepEqual(errorMessages({ code: 'ERR_TEST_FAILURE', cause: new AggregateError([new Error('known browser failure'), new Error('cleanup failed')]) }),
    ['known browser failure', 'cleanup failed']);
});

test('invalid metadata cannot silently disable the gate', t => {
  const dir = fixture(t), file = join(dir, 'quarantine.json');
  const record = entry('node', 'synthetic.test.mjs');
  for (const change of [{ owner: '' }, { expiresAt: '2099-02-30T00:00:00Z' }, { diagnosis: '' }]) {
    writeFileSync(file, JSON.stringify([{ ...record, ...change }]));
    assert.throws(() => loadQuarantine(file), /E2E_QUARANTINE_INVALID/);
  }
});
