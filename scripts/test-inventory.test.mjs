import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverCandidates, checkInventory, collectHeadlessInventorySelection, collectPlaywrightInventorySelection } from './test-inventory.mjs';
import { UNIT_SCRIPT_TESTS, collectUnitTestFiles } from './unit-test-selection.mjs';
import { EXPLICIT_NPM_SUITES } from './explicit-npm-test-selection.mjs';
import { collectPlaywrightTestFiles, playwrightTestSelection } from './playwright-test-selection.mjs';
import { collectHeadlessPortableTests } from './run-headless-portable-tests.mjs';

const cli = fileURLToPath(new URL('./test-inventory.mjs', import.meta.url));
const mapped = file => ({ path: file, selection: { state: 'mapped', suiteIds: ['unit'] } });
const debt = file => ({ path: file, selection: { state: 'unresolved', reason: 'Selector not verified' } });
const candidates = files => files.map(file => ({ path: file, signals: ['synthetic'] }));
const manifest = entries => ({ version: 1, entries });
const selections = files => ({ unit: { files, errors: [] } });
const check = (files, entries, selected = files) => checkInventory(candidates(files), manifest(entries), selections(selected));
const headlessId = 'npm:test:headless-portable';
const headlessFixtureFiles = [
  'packages/aip/src/a.test.ts', 'packages/mini/src/m.test.mjs', 'packages/mcp/src/c.test.mts',
  'scripts/check-headless-portable-imports.test.mjs', 'scripts/intelligent-host-mcp-stdio.test.mjs',
  'scripts/mediflow-headless-supervisor-athena.test.mjs', 'scripts/run-headless-portable-tests.test.mjs',
].sort();

test('discovery sees new roots, plugins, unusual names and language signals without evaluating source', () => {
  const sources = {
    'plugins/new/guard.test.mjs': 'throw new Error("must not execute");',
    'new-root/custom.mjs': 'import test from "node:test";',
    'fixtures/browser.js': 'import { test } from "@playwright/test";',
    'native/Checks.swift': '@Test func contract() {}',
    'tools/check.py': 'import unittest',
    'crates/contracts.rs': '#[test]\nfn checks() {}',
    'scripts/validate.sh': 'if [ "$1" = --self-test ]; then :; fi',
    'scripts/contracts.bats': '@test "contract" { true; }',
    'tools/unusual': '#!/usr/bin/env node\nimport assert from "node:assert/strict";',
    'lib/plain.ts': 'export const value = 1;',
    'docs/example.md': 'import test from "node:test";',
  };
  const found = discoverCandidates(Object.keys(sources), file => sources[file]);
  assert.deepEqual(found.map(entry => entry.path).sort(), Object.keys(sources).filter(file => !['lib/plain.ts', 'docs/example.md'].includes(file)).sort());
});

test('discovery rejects duplicate, unsafe, unreadable and non-UTF8 source paths', () => {
  for (const file of ['../escape.test.ts', '/absolute.test.ts', 'a//b.test.ts', 'a\\b.test.ts', 'x\0.test.ts', 'C:/x.test.ts']) {
    assert.throws(() => discoverCandidates([file], () => ''), /Invalid inventory path/);
  }
  assert.throws(() => discoverCandidates(['a.test.ts', 'a.test.ts'], () => ''), /Duplicate discovery/);
  assert.throws(() => discoverCandidates(['a.test.ts'], () => { throw new Error('unreadable-source'); }), /unreadable-source/);
  assert.throws(() => discoverCandidates(['a.test.ts'], () => Buffer.from([0xff])), /Invalid UTF-8/);
});

test('new candidate, rename and delete cannot silently shrink the roster', () => {
  assert.match(check(['old.test.ts', 'new/plugin.test.mjs'], [mapped('old.test.ts')], ['old.test.ts']).errors.join('\n'), /UNREGISTERED_CANDIDATE: new\/plugin/);
  const renamed = check(['new.test.ts'], [mapped('old.test.ts')], ['new.test.ts']);
  assert.match(renamed.errors.join('\n'), /STALE_ENTRY: old.test.ts/);
  assert.match(renamed.errors.join('\n'), /UNREGISTERED_CANDIDATE: new.test.ts/);
  assert.match(check([], [mapped('old.test.ts')], []).errors.join('\n'), /STALE_ENTRY/);
});

test('mapping removed from nonempty selection fails; source citation is not selection', () => {
  const result = check(['a.test.ts', 'b.test.ts'], [mapped('a.test.ts'), mapped('b.test.ts')], ['a.test.ts']);
  assert.equal(result.integrityPassed, false);
  assert.match(result.errors.join('\n'), /MAPPED_NOT_SELECTED: unit: b.test.ts/);
  assert.match(checkInventory(candidates(['a.test.ts']), manifest([{ path: 'a.test.ts', selection: { state: 'mapped', suiteIds: ['README-command'] } }]), selections(['a.test.ts'])).errors.join('\n'), /UNKNOWN_SUITE/);
});

test('invalid schema, duplicate entries and incomplete selectors fail closed without waiver fields', () => {
  assert.match(check(['a.test.ts'], [mapped('a.test.ts'), mapped('a.test.ts')]).errors.join('\n'), /DUPLICATE_ENTRY/);
  assert.match(check(['a.test.ts'], [{ ...mapped('a.test.ts'), optional: true }]).errors.join('\n'), /INVALID_ENTRY_FIELDS/);
  assert.match(check(['a.test.ts'], [{ path: 'a.test.ts', selection: { state: 'deferred', reason: 'old debt' } }]).errors.join('\n'), /INVALID_SELECTION_STATE/);
  assert.match(checkInventory(candidates(['a.test.ts']), manifest([mapped('a.test.ts')]), { unit: { files: ['a.test.ts'], errors: ['required group missing'] } }).errors.join('\n'), /INCOMPLETE_SELECTION/);
  assert.match(check(['a.test.ts'], [mapped('a.test.ts')], ['a.test.ts', 'a.test.ts']).errors.join('\n'), /DUPLICATE_SELECTED_PATH/);
  assert.match(check(['a.test.ts'], [], ['a.test.ts']).errors.join('\n'), /SELECTED_WITHOUT_ENTRY/);
});

function fixture(t, withDebt = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  const files = ['lib/a.test.ts', 'components/b.test.ts', ...UNIT_SCRIPT_TESTS];
  if (withDebt) files.push('plugins/new/debt.test.mjs');
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'throw new Error("Discovery must never run this test");\n');
  }
  const entries = files.map(file => file.startsWith('plugins/') ? debt(file) : mapped(file));
  const pkg = { scripts: {} };
  const workflows = {};
  for (const [i, suite] of EXPLICIT_NPM_SUITES.entries()) {
    const file = `scripts/npm-fixture-${i}.test.mjs`;
    fs.writeFileSync(path.join(root, file), 'throw new Error("Npm tests must not execute");');
    pkg.scripts[suite.script] = `node --test ${file}`;
    entries.push({ path: file, selection: { state: 'mapped', suiteIds: [suite.id] } });
    const workflow = workflows[suite.workflow] ??= { jobs: {} };
    const job = workflow.jobs[suite.job] ??= { steps: [] };
    job.steps.push({ run: `npm run ${suite.script}`, ...(suite.stepIf ? { if: suite.stepIf } : {}) });
  }
  for (const file of headlessFixtureFiles) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'throw new Error("Headless test must not execute");');
    entries.push({ path: file, selection: { state: 'mapped', suiteIds: [headlessId] } });
  }
  pkg.scripts['test:headless-portable'] = 'node scripts/run-headless-portable-tests.mjs';
  workflows['.github/workflows/cross-platform.yml'].jobs['headless-contracts'].steps.push({ run: 'npm run test:headless-portable' });
  fs.writeFileSync(path.join(root, 'scripts/check-claims-guard.mjs'), 'throw new Error("Claims --self-test must not execute during inventory");');
  entries.push({ path: 'scripts/check-claims-guard.mjs', selection: { state: 'mapped', suiteIds: ['npm:check:claims:self-test'] } });
  pkg.scripts['check:claims'] = 'node scripts/check-claims-guard.mjs';
  workflows['.github/workflows/openapi-contract-guard.yml'].jobs['repository-guards'].steps.push({ run: 'npm run check:claims\nnpm run check:claims -- --self-test' });
  fs.mkdirSync(path.join(root, 'e2e'));
  fs.writeFileSync(path.join(root, 'e2e/a.spec.ts'), 'throw new Error("Playwright test must not execute");');
  entries.push({ path: 'e2e/a.spec.ts', selection: { state: 'mapped', suiteIds: ['npm:test:e2e'] } });
  pkg.scripts['test:e2e'] = 'playwright test --workers=1';
  workflows['.github/workflows/e2e.yml'] = { jobs: { e2e: { steps: [{ run: 'npm run test:e2e' }] } } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  for (const [file, workflow] of Object.entries(workflows)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(workflow));
  }
  fs.writeFileSync(path.join(root, 'test-inventory.v1.json'), JSON.stringify(manifest(entries)));
  return root;
}
function run(root, mode = 'integrity', extra = []) {
  return spawnSync(process.execPath, [cli, mode, '--root', root, ...extra], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000 });
}

test('Headless inventory uses the real sorted selector and ignores unrelated files without executing sources', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'packages/aip/src/not-a-test.ts'), 'throw new Error("must not execute");');
  const result = await collectHeadlessInventorySelection(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.files, headlessFixtureFiles);
  assert.deepEqual(result.files, await collectHeadlessPortableTests(root));
  assert.deepEqual(result.binding.commands, ['test:headless-portable']);
  assert.equal(run(root, 'complete').status, 0);
});

test('Headless missing, empty and nonregular requirements fail the inventory without promoting survivors', async t => {
  const mutations = [
    ...['packages/aip', 'packages/mini', 'packages/mcp', ...headlessFixtureFiles.filter(file => file.startsWith('scripts/'))]
      .map(file => root => fs.rmSync(path.join(root, file), { recursive: true })),
    ...headlessFixtureFiles.filter(file => file.startsWith('packages/'))
      .map(file => root => fs.unlinkSync(path.join(root, file))),
    ...['packages/aip', 'packages/mini', 'packages/mcp']
      .map(file => root => { fs.rmSync(path.join(root, file), { recursive: true }); fs.writeFileSync(path.join(root, file), 'synthetic non-directory'); }),
    ...headlessFixtureFiles.filter(file => file.startsWith('scripts/'))
      .map(file => root => { fs.unlinkSync(path.join(root, file)); fs.mkdirSync(path.join(root, file)); }),
  ];
  for (const mutate of mutations) {
    const root = fixture(t); mutate(root);
    const selection = await collectHeadlessInventorySelection(root);
    assert.deepEqual(selection.files, []); assert.equal(selection.binding, null);
    assert.match(selection.errors.join('\n'), /Headless/);
    const result = checkInventory([], manifest([]), { [headlessId]: selection });
    assert.equal(result.integrityPassed, false);
    assert.match(result.errors.join('\n'), /INCOMPLETE_SELECTION: npm:test:headless-portable/);
  }
});

test('Headless command and CI call drift fail the asynchronous CLI even with all selected files present', t => {
  for (const mutate of [
    root => { const p = path.join(root, 'package.json'); const pkg = JSON.parse(fs.readFileSync(p)); pkg.scripts['test:headless-portable'] += ' --filter=one'; fs.writeFileSync(p, JSON.stringify(pkg)); },
    root => { const p = path.join(root, '.github/workflows/cross-platform.yml'); const w = JSON.parse(fs.readFileSync(p)); w.jobs['headless-contracts'].steps = w.jobs['headless-contracts'].steps.filter(s => s.run !== 'npm run test:headless-portable'); fs.writeFileSync(p, JSON.stringify(w)); },
    root => fs.rmSync(path.join(root, 'packages/mcp'), { recursive: true }),
  ]) {
    const root = fixture(t); mutate(root);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:test:headless-portable/);
    assert.match(result.stdout, /C14 acceptance: NOT_ASSESSED/);
  }
});

test('Headless selected additions and omissions cannot silently change the manifest coverage', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'packages/aip/src/new.test.ts'), 'throw 1;');
  assert.match(run(root).stderr, /SELECTED_WITHOUT_ENTRY: npm:test:headless-portable: packages\/aip\/src\/new.test.ts/);
  fs.renameSync(path.join(root, 'packages/aip/src/a.test.ts'), path.join(root, 'packages/aip/src/a.ts'));
  assert.match(run(root).stderr, /MAPPED_NOT_SELECTED: npm:test:headless-portable: packages\/aip\/src\/a.test.ts/);
});

test('Headless import and inventory selection never launch children or acquire/clean data directories', t => {
  const root = fixture(t);
  const source = `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('UNEXPECTED_PROCESS_OR_DATA_MUTATION'); };
childProcess.spawnSync = forbidden; childProcess.spawn = forbidden; childProcess.execFileSync = forbidden;
for (const name of ['mkdtempSync', 'mkdirSync', 'rmSync']) fs[name] = forbidden;
for (const name of ['mkdtemp', 'mkdir', 'rm']) fsPromises[name] = forbidden;
syncBuiltinESMExports();
const { collectHeadlessInventorySelection } = await import(${JSON.stringify(new URL('./test-inventory.mjs', import.meta.url).href)});
const result = await collectHeadlessInventorySelection(${JSON.stringify(root)});
if (result.errors.length) throw new Error(result.errors.join('\\n'));
console.log(JSON.stringify(result.files));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: source, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MEDIFLOW_DATA_DIR: path.join(root, 'forbidden-data') }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), headlessFixtureFiles);
  assert.equal(fs.existsSync(path.join(root, 'forbidden-data')), false);
});

test('CLI discovers untracked sources, never executes them, and separates debt from static completeness', t => {
  const root = fixture(t, true);
  const integrity = run(root);
  assert.equal(integrity.status, 0, integrity.stderr);
  assert.match(integrity.stdout, /Inventory integrity: PASS/);
  assert.match(integrity.stdout, /Selection completeness: INCOMPLETE/);
  assert.match(integrity.stdout, /Unresolved selection: 1/);
  assert.match(integrity.stdout, /Execution evidence: NOT_ASSESSED/);
  assert.match(integrity.stdout, /C14 acceptance: NOT_ASSESSED/);
  const complete = run(root, 'complete');
  assert.equal(complete.status, 1, complete.stderr);
  assert.doesNotMatch(complete.stderr, /Discovery must never run/);
  fs.writeFileSync(path.join(root, 'plugins/new/added.test.mjs'), 'throw 1;');
  const added = run(root);
  assert.equal(added.status, 1);
  assert.match(added.stderr, /UNREGISTERED_CANDIDATE: plugins\/new\/added.test.mjs/);
});

test('CLI static-complete result retains execution and C14 unknown; supports manifest override', t => {
  const root = fixture(t);
  fs.renameSync(path.join(root, 'test-inventory.v1.json'), path.join(root, 'roster.json'));
  const result = run(root, 'complete', ['--manifest', 'roster.json']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Selection completeness: COMPLETE/);
  assert.match(result.stdout, /C14 acceptance: NOT_ASSESSED/);
});

test('Git NUL discovery preserves spaces and Unicode paths', t => {
  const root = fixture(t);
  const filename = "new root/é space 'quote'.test.mjs";
  fs.mkdirSync(path.join(root, 'new root'));
  fs.writeFileSync(path.join(root, filename), 'throw 1;');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`UNREGISTERED_CANDIDATE: ${filename}`));
});

test('actual selector missing or empty groups and missing literal propagate through CLI', t => {
  for (const mutate of [
    root => fs.rmSync(path.join(root, 'lib'), { recursive: true }),
    root => fs.unlinkSync(path.join(root, 'components/b.test.ts')),
    root => fs.unlinkSync(path.join(root, UNIT_SCRIPT_TESTS[0])),
  ]) {
    const root = fixture(t);
    mutate(root);
    assert.throws(() => collectUnitTestFiles(root), /required unit test|Required unit test/);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INCOMPLETE_SELECTION/);
  }
});

test('required npm binding errors propagate through CLI without disappearing from the report', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, '.github/workflows/cross-platform.yml'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:test:launcher-helpers/);
  assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:test:native-launcher/);
  assert.match(result.stdout, /Inventory integrity: FAIL/);
  assert.match(result.stdout, /C14 acceptance: NOT_ASSESSED/);
});

test('Claims self-test binding is required by the real inventory CLI independently of the ordinary scan', t => {
  const root = fixture(t);
  assert.equal(run(root, 'complete').status, 0);
  const file = path.join(root, '.github/workflows/openapi-contract-guard.yml');
  const workflow = JSON.parse(fs.readFileSync(file));
  workflow.jobs['repository-guards'].steps.at(-1).run = 'npm run check:claims';
  fs.writeFileSync(file, JSON.stringify(workflow));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:check:claims:self-test/);
  assert.match(result.stderr, /MAPPED_NOT_SELECTED: npm:check:claims:self-test: scripts\/check-claims-guard.mjs/);
  assert.match(result.stdout, /C14 acceptance: NOT_ASSESSED/);
});

test('import is inert and CLI read/Git/argument errors remain failures', t => {
  const root = fixture(t);
  const imported = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(new URL('./test-inventory.mjs', import.meta.url).href)});`], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  assert.equal(run(root, 'unknown').status, 1);
  fs.writeFileSync(path.join(root, 'test-inventory.v1.json'), '{');
  assert.match(run(root).stderr, /INVENTORY_ERROR/);
  fs.rmSync(path.join(root, '.git'), { recursive: true });
  assert.equal(run(root).status, 1);
});

test('CLI invoked through a directory alias still reports unresolved debt and fails complete', t => {
  const root = fixture(t, true);
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-alias-'));
  t.after(() => fs.rmSync(aliasRoot, { recursive: true, force: true }));
  const alias = path.join(aliasRoot, 'scripts');
  fs.symlinkSync(path.dirname(cli), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [path.join(alias, 'test-inventory.mjs'), 'complete', '--root', root], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Inventory integrity: PASS/);
  assert.match(result.stdout, /Selection completeness: INCOMPLETE/);
  assert.match(result.stdout, /Unresolved selection: 1/);
});

test('import tolerates stdin, missing and non-directory argv without running CLI', t => {
  const root = fixture(t);
  for (const argv of ['-', path.join(root, 'missing-entry.mjs'), path.join(root, 'test-inventory.v1.json', 'child')]) {
    const source = `process.argv[1] = ${JSON.stringify(argv)}; await import(${JSON.stringify(new URL('./test-inventory.mjs', import.meta.url).href)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  }
});

test('entrypoint canonicalization propagates filesystem errors other than missing path', () => {
  const source = `
import fs from 'node:fs';
process.argv[1] = 'synthetic-denied-entry';
const original = fs.realpathSync;
fs.realpathSync = (...args) => {
  if (args[0] === process.argv[1]) throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' });
  return original(...args);
};
await import(${JSON.stringify(new URL('./test-inventory.mjs', import.meta.url).href)});
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /synthetic access denied/);
  assert.match(result.stderr, /EACCES/);
  assert.equal(result.stdout, '');
});

test('Playwright shares exact config matches, default extensions, nested order and harness ignore without importing tests', t => {
  const root = fixture(t);
  const expected = ['e2e/a.spec.ts'];
  const ignored = ['e2e/helper.ts', 'e2e/wrong.spec.TS', 'e2e/nested/chatgpt-synthesis-product.spec.ts',
    'e2e/CHATGPT-SYNTHESIS-PRODUCT.spec.ts', 'e2e/node_modules/dependency.spec.ts'];
  for (const kind of ['spec', 'TEST']) for (const prefix of ['', 'c', 'm']) for (const language of ['js', 'ts']) for (const jsx of ['', 'x']) {
    expected.push(`e2e/nested/a.${kind}.${prefix}${language}${jsx}`);
  }
  expected.push('e2e/.hidden/[literal]+.spec.ts', 'e2e/z.spec.ts');
  for (const file of [...expected, ...ignored]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'throw new Error("Must not import this test");');
  }
  const selected = collectPlaywrightTestFiles(root);
  assert.deepEqual([...selected].sort(), [...expected].sort());
  assert.equal(selected[0], 'e2e/.hidden/[literal]+.spec.ts');
  assert.equal(selected.at(-1), 'e2e/z.spec.ts');
  const config = playwrightTestSelection(root);
  assert.equal(config.testDir, path.join(root, 'e2e'));
  assert.equal(config.testMatch.length, selected.length);
  selected.forEach((file, index) => assert.ok(config.testMatch[index].test(path.join(root, file))));
  for (const file of [...ignored, 'e2e/.hidden/literallll.spec.ts', 'e2e/a.spec.ts.extra']) {
    assert.equal(config.testMatch.some(pattern => pattern.test(path.join(root, file))), false, file);
  }
  const inventory = collectPlaywrightInventorySelection(root);
  assert.deepEqual(inventory.files, selected);
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(inventory.binding.commands, ['test:e2e']);
});

test('Playwright missing or empty group fails both config and inventory; rename and addition fail manifest integrity', t => {
  for (const remove of ['e2e', 'e2e/a.spec.ts']) {
    const root = fixture(t);
    fs.rmSync(path.join(root, remove), { recursive: true });
    assert.throws(() => playwrightTestSelection(root), /[Pp]laywright test group/);
    const selection = collectPlaywrightInventorySelection(root);
    assert.deepEqual(selection.files, []);
    assert.match(selection.errors.join('\n'), /[Pp]laywright test group/);
    assert.match(run(root).stderr, /INCOMPLETE_SELECTION: npm:test:e2e/);
  }
  const root = fixture(t);
  fs.renameSync(path.join(root, 'e2e/a.spec.ts'), path.join(root, 'e2e/renamed.test.mjs'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STALE_ENTRY: e2e\/a.spec.ts/);
  assert.match(result.stderr, /SELECTED_WITHOUT_ENTRY: npm:test:e2e: e2e\/renamed.test.mjs/);
  assert.match(result.stderr, /MAPPED_NOT_SELECTED: npm:test:e2e: e2e\/a.spec.ts/);
});

test('Playwright rejects command filters and nonbinding or masked CI calls without promoting files', t => {
  const mutations = [
    root => { const file = path.join(root, 'package.json'); const pkg = JSON.parse(fs.readFileSync(file)); pkg.scripts['test:e2e'] += ' e2e/a.spec.ts'; fs.writeFileSync(file, JSON.stringify(pkg)); },
    ...[{ run: 'npx playwright test --workers=1' }, { run: 'npm run test:e2e || true' },
      { run: 'npm run test:e2e', 'continue-on-error': true }, { run: 'npm run test:e2e', if: false },
      { run: 'npm run test:e2e\nnpm run test:e2e' }].map(step => root => {
        fs.writeFileSync(path.join(root, '.github/workflows/e2e.yml'), JSON.stringify({ jobs: { e2e: { steps: [step] } } }));
      }),
  ];
  for (const mutate of mutations) {
    const root = fixture(t); mutate(root);
    const selection = collectPlaywrightInventorySelection(root);
    assert.deepEqual(selection.files, []);
    assert.equal(selection.binding, null);
    assert.equal(selection.errors.length, 1);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:test:e2e/);
  }
});
