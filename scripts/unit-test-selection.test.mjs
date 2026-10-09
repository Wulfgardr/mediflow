import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { collectUnitTestFiles, unitTestArguments, UNIT_TEST_GROUPS, UNIT_SCRIPT_TESTS } from './unit-test-selection.mjs';

test('registration: behavior and private-loader suites each occur once in required units', () => {
  const selection = collectUnitTestFiles(path.resolve(import.meta.dirname, '..'));
  for (const filename of ['scripts/checkup-parent-lifecycle.test.mjs', 'scripts/checkup-parent-lifecycle-harness.test.mjs']) {
    assert.equal(selection.filter(file => file === filename).length, 1, `${filename} must be selected exactly once`);
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-unit-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [...UNIT_TEST_GROUPS.map(group => `${group}/fixture.test.ts`), ...UNIT_SCRIPT_TESTS]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'throw new Error("discovery must not execute this test");\n');
  }
  return root;
}

test('expands both groups recursively with deterministic ordering and the existing literal order', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'lib', 'nested'));
  fs.writeFileSync(path.join(root, 'lib', 'nested', 'a.test.ts'), 'throw new Error("not imported");');
  fs.writeFileSync(path.join(root, 'lib', 'ignored.ts'), '');
  const files = collectUnitTestFiles(root);
  assert.deepEqual(files, ['lib/fixture.test.ts', 'lib/nested/a.test.ts', 'components/fixture.test.ts', ...UNIT_SCRIPT_TESTS]);
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(unitTestArguments(root), ['scripts/run-strip-types.mjs', '--test',
    path.join(root, 'lib/fixture.test.ts'), path.join(root, 'lib/nested/a.test.ts'),
    path.join(root, 'components/fixture.test.ts'), ...UNIT_SCRIPT_TESTS]);
});

for (const group of UNIT_TEST_GROUPS) {
  test(`rejects missing, empty and unreadable ${group} while other required tests remain`, t => {
    const root = fixture(t);
    fs.rmSync(path.join(root, group), { recursive: true });
    assert.throws(() => collectUnitTestFiles(root), new RegExp(`Cannot read required unit test group ${group}`));
    fs.mkdirSync(path.join(root, group));
    assert.throws(() => collectUnitTestFiles(root), new RegExp(`Required unit test group ${group} is empty`));
    fs.rmdirSync(path.join(root, group));
    fs.writeFileSync(path.join(root, group), 'not a directory');
    assert.throws(() => collectUnitTestFiles(root), new RegExp(`Cannot read required unit test group ${group}`));
  });
}

test('rejects each missing literal even though the rest of the suite is present', async t => {
  for (const relative of UNIT_SCRIPT_TESTS) {
    await t.test(relative, t => {
      const root = fixture(t);
      fs.unlinkSync(path.join(root, relative));
      assert.throws(() => collectUnitTestFiles(root), error => error.message === `Cannot read required unit test file ${relative}`);
    });
  }
});

test('rejects a directory at a required script path', t => {
  const root = fixture(t);
  const relative = 'scripts/check-never-regress-ocr-retirement.test.mjs';
  fs.unlinkSync(path.join(root, relative));
  fs.mkdirSync(path.join(root, relative));
  assert.throws(() => collectUnitTestFiles(root), error => error.message === `Required unit test path is not a file: ${relative}`);
});

test('the real runner rejects incomplete selection before bootstrap or suite launch', t => {
  const root = fixture(t);
  const sourceRoot = path.resolve(import.meta.dirname, '..');
  for (const file of ['run-unit-suite.mjs', 'unit-test-selection.mjs', 'test-data-dir.mjs']) {
    fs.copyFileSync(path.join(sourceRoot, 'scripts', file), path.join(root, 'scripts', file));
  }
  const marker = path.join(root, 'child-launched');
  const child = `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');\n`;
  for (const file of ['prepare-e2e-db.mjs', 'run-strip-types.mjs']) fs.writeFileSync(path.join(root, 'scripts', file), child);
  fs.unlinkSync(path.join(root, 'scripts/check-never-regress-tinetti-provenance.test.mjs'));
  const env = { ...process.env };
  delete env.MEDIFLOW_DATA_DIR;
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-unit-suite.mjs')], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Cannot read required unit test file scripts\/check-never-regress-tinetti-provenance\.test\.mjs/);
  assert.equal(fs.existsSync(marker), false);
});
