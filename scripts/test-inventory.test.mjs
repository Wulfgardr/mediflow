import { cargoTestCommand, collectNativeToolSelections, collectXcodeUiSelection } from './native-tool-test-selection.mjs';
import { localTestCommands, localInvocationArguments, collectLocalTestSelections } from './local-test-selection.mjs';
import { collectAdditionalInventorySelections } from './additional-inventory-selection.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverCandidates, collectStaticSupportImports, checkInventory, collectHeadlessInventorySelection, collectPlaywrightInventorySelection } from './test-inventory.mjs';
import { UNIT_SCRIPT_TESTS, collectUnitTestFiles } from './unit-test-selection.mjs';
import { EXPLICIT_NPM_SUITES, GUARD_SELF_TEST_SUITES, collectSyntheticPluginSelections } from './explicit-npm-test-selection.mjs';
import { collectPlaywrightTestFiles, playwrightTestSelection } from './playwright-test-selection.mjs';
import { collectHeadlessPortableTests } from './run-headless-portable-tests.mjs';
import { collectSwiftTestSources, collectSwiftInventorySelection, verifySwiftPackageDescription, SWIFT_SUITE_ID, SWIFT_PACKAGE } from './swift-test-selection.mjs';

const cli = fileURLToPath(new URL('./test-inventory.mjs', import.meta.url));
const mapped = file => ({ path: file, selection: { state: 'mapped', suiteIds: ['unit'] } });
const debt = file => ({ path: file, selection: { state: 'unresolved', reason: 'Selector not verified' } });
const candidates = files => files.map(file => ({ path: file, signals: ['synthetic'] }));
const manifest = entries => ({ version: 1, entries });
const selections = files => ({ unit: { mode: 'ordinary', files, errors: [] } });
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
  assert.match(checkInventory(candidates(['a.test.ts']), manifest([mapped('a.test.ts')]), { unit: { mode: 'ordinary', files: ['a.test.ts'], errors: ['required group missing'] } }).errors.join('\n'), /INCOMPLETE_SELECTION/);
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
  for (const suite of GUARD_SELF_TEST_SUITES.filter(suite => suite.script !== 'check:claims')) {
    fs.writeFileSync(path.join(root, suite.file), 'throw new Error("Guard --self-test must not execute during inventory");');
    entries.push({ path: suite.file, selection: { state: 'mapped', suiteIds: [suite.id] } });
    pkg.scripts[suite.script] = `node ${suite.file}`;
    workflows[suite.workflow].jobs[suite.job].steps.push({
      run: `npm run ${suite.companionCall ?? suite.script}\nnpm run ${suite.script} -- --self-test`,
    });
  }
  fs.writeFileSync(path.join(root, 'scripts/check-claims-guard.mjs'), 'throw new Error("Claims --self-test must not execute during inventory");');
  entries.push({ path: 'scripts/check-claims-guard.mjs', selection: { state: 'mapped', suiteIds: ['npm:check:claims:self-test'] } });
  pkg.scripts['check:claims'] = 'node scripts/check-claims-guard.mjs';
  workflows['.github/workflows/openapi-contract-guard.yml'].jobs['repository-guards'].steps.push({ run: 'npm run check:claims\nnpm run check:claims -- --self-test' });
  fs.mkdirSync(path.join(root, 'e2e'));
  fs.writeFileSync(path.join(root, 'e2e/a.spec.ts'), 'throw new Error("Playwright test must not execute");');
  entries.push({ path: 'e2e/a.spec.ts', selection: { state: 'mapped', suiteIds: ['npm:test:e2e'] } });
  pkg.scripts['test:e2e'] = 'playwright test --workers=1';
  workflows['.github/workflows/e2e.yml'].jobs.e2e.steps.push({ run: 'npm run test:e2e' });
  const plugin = 'plugins/mediflow-synthetic';
  for (const [file, script] of [[`${plugin}/test/plugin.test.mjs`, 'test'], [`${plugin}/scripts/browser-smoke.mjs`, 'test:browser']]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'import assert from "node:assert/strict"; throw new Error("Plugin must not execute");');
    entries.push({ path: file, selection: { state: 'mapped', suiteIds: [`npm:synthetic-plugin:${script}`] } });
  }
  fs.writeFileSync(path.join(root, plugin, 'package.json'), JSON.stringify({ scripts: {
    test: 'node --test test/*.test.mjs', 'test:browser': 'node scripts/browser-smoke.mjs',
  } }));
  const pluginWorkflow = '.github/workflows/synthetic-plugin.yml';
  const pluginPaths = [`${plugin}/**`, 'packages/mcp/src/contracts.ts', pluginWorkflow];
  workflows[pluginWorkflow] = { on: { pull_request: { paths: pluginPaths }, push: { branches: ['main'], paths: pluginPaths } },
    jobs: { 'synthetic-plugin': { defaults: { run: { 'working-directory': plugin } },
      steps: [{ run: 'npm test' }, { run: 'npm run test:browser' }] } } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  for (const [file, workflow] of Object.entries(workflows)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(workflow));
  }
  addSwiftFixture(root, entries);
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


test('new self-test bindings are required by the real CLI, independently of ordinary guard scans', t => {
  const root = fixture(t);
  assert.equal(run(root, 'complete').status, 0);
  const file = path.join(root, '.github/workflows/openapi-contract-guard.yml');
  const workflow = JSON.parse(fs.readFileSync(file));
  for (const step of workflow.jobs['repository-guards'].steps) {
    if (step.run.startsWith('npm run check:openapi:drift ')) {
      step.run = 'npm run check:openapi:drift -- --base-ref origin/main';
    }
  }
  fs.writeFileSync(file, JSON.stringify(workflow));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INCOMPLETE_SELECTION: npm:check:openapi:drift:self-test/);
  assert.match(result.stderr, /MAPPED_NOT_SELECTED: npm:check:openapi:drift:self-test: scripts\/check-openapi-drift.mjs/);
});


test('support links use only runtime imports in the closed prologue, never comments, types or strings', () => {
  const file = 'lib/entry.test.ts';
  const statement = "import { fixture as helper, type Shape } from './support.mjs';";
  assert.deepEqual(collectStaticSupportImports(`/* header */\nvoid import.meta.url; // ESM\n${statement}`, file), ['lib/support.mjs']);
  for (const source of [`// ${statement}`, `/* ${statement} */`, `const text = \`${statement}\`;`,
    `function hidden() { ${statement} }`, "import type { Shape } from './support.mjs';",
    "import { type Shape } from './support.mjs';", "await import('./support.mjs');",
    `const before = 1;\n${statement}`]) {
    assert.deepEqual(collectStaticSupportImports(source, file), [], source);
  }
});

function supportCase() {
  const sources = { 'lib/entry.test.ts': "import { helper } from './support.mjs';",
    'lib/support.mjs': "import assert from 'node:assert/strict'; export const helper = () => assert.ok(true);" };
  const entries = [mapped('lib/entry.test.ts'), { path: 'lib/support.mjs', selection: {
    state: 'support', reason: 'WUL-729: shared assertion helper, no standalone tests', owner: '@Wulfgardr', importers: ['lib/entry.test.ts'],
  } }];
  return { sources, entries };
}
const checkSupport = ({ sources, entries }, selected = selections(['lib/entry.test.ts'])) =>
  checkInventory(discoverCandidates(Object.keys(sources), file => sources[file]), manifest(entries), selected);

test('support requires explicit reason, owner and importers and reports disposition separately', () => {
  const valid = checkSupport(supportCase());
  assert.equal(valid.selectionComplete, true);
  assert.deepEqual(valid.unresolved, []);
  assert.deepEqual(valid.support, ['lib/support.mjs']);
  for (const [key, value] of [['reason', undefined], ['owner', undefined], ['owner', ' '], ['importers', undefined],
    ['importers', []], ['importers', ['../escape']], ['importers', ['lib/support.mjs']]]) {
    const input = supportCase(); input.entries[1].selection[key] = value;
    assert.match(checkSupport(input).errors.join('\n'), /INVALID_SUPPORT/);
  }
});

test('support importer must exist, be mapped and actually selected by an error-free suite with a real import', () => {
  for (const mutate of [
    input => { delete input.sources['lib/entry.test.ts']; },
    input => { input.entries[0] = debt('lib/entry.test.ts'); },
    input => { input.sources['lib/entry.test.ts'] = '// import removed'; },
  ]) {
    const input = supportCase(); mutate(input);
    assert.match(checkSupport(input).errors.join('\n'), /SUPPORT_IMPORTER_NOT_SELECTED|SUPPORT_IMPORT_MISSING/);
  }
  assert.match(checkSupport(supportCase(), selections([])).errors.join('\n'), /SUPPORT_IMPORTER_NOT_SELECTED/);
  assert.match(checkSupport(supportCase(), { unit: { mode: 'ordinary', files: ['lib/entry.test.ts'], errors: ['broken binding'] } }).errors.join('\n'), /SUPPORT_IMPORTER_NOT_SELECTED/);
  assert.match(checkSupport(supportCase(), selections(['lib/entry.test.ts', 'lib/support.mjs'])).errors.join('\n'), /SUPPORT_SELECTED_AS_TEST/);
});

test('real CLI verifies support linkage and rejects removed imports and renamed support files', t => {
  const root = fixture(t);
  const source = path.join(root, 'lib/a.test.ts');
  fs.writeFileSync(source, "import { helper } from './helper.mjs';\nthrow new Error('Do not execute');");
  fs.writeFileSync(path.join(root, 'lib/helper.mjs'), "import assert from 'node:assert/strict'; export const helper = () => assert.ok(true);");
  const file = path.join(root, 'test-inventory.v1.json');
  const inventory = JSON.parse(fs.readFileSync(file));
  inventory.entries.push({ path: 'lib/helper.mjs', selection: { state: 'support', owner: '@Wulfgardr',
    reason: 'WUL-729: synthetic shared helper', importers: ['lib/a.test.ts'] } });
  fs.writeFileSync(file, JSON.stringify(inventory));
  const valid = run(root, 'complete');
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Support entrypoint exclusions: 1/);
  fs.writeFileSync(source, 'throw new Error("Do not execute");');
  assert.match(run(root).stderr, /SUPPORT_IMPORT_MISSING/);
  fs.renameSync(path.join(root, 'lib/helper.mjs'), path.join(root, 'lib/renamed-helper.mjs'));
  const renamed = run(root);
  assert.equal(renamed.status, 1);
  assert.match(renamed.stderr, /STALE_ENTRY: lib\/helper.mjs/);
  assert.match(renamed.stderr, /UNREGISTERED_CANDIDATE: lib\/renamed-helper.mjs/);
});


test('synthetic plugin binds its real package scripts, five files and path-conditional workflow', () => {
  const selected = collectSyntheticPluginSelections(fileURLToPath(new URL('..', import.meta.url)));
  assert.deepEqual(selected['npm:synthetic-plugin:test'].files, [
    'plugins/mediflow-synthetic/test/codex-agent-contract.test.mjs',
    'plugins/mediflow-synthetic/test/package.test.mjs',
    'plugins/mediflow-synthetic/test/protocol.test.mjs',
    'plugins/mediflow-synthetic/test/review.test.mjs',
  ]);
  assert.deepEqual(selected['npm:synthetic-plugin:test:browser'].files, ['plugins/mediflow-synthetic/scripts/browser-smoke.mjs']);
  for (const value of Object.values(selected)) {
    assert.deepEqual(value.errors, []);
    assert.equal(value.conditional, true);
    assert.equal(value.binding.workingDirectory, 'plugins/mediflow-synthetic');
    assert.deepEqual(value.binding.triggers.push.branches, ['main']);
    assert.deepEqual(value.binding.triggers.pull_request.paths, value.binding.triggers.push.paths);
  }
});

test('plugin literal glob stays nonrecursive, excludes hidden files and fails missing or empty groups', t => {
  const root = fixture(t);
  const group = path.join(root, 'plugins/mediflow-synthetic/test');
  fs.mkdirSync(path.join(group, 'nested'));
  fs.writeFileSync(path.join(group, '.hidden.test.mjs'), 'throw 1;');
  fs.writeFileSync(path.join(group, 'nested/child.test.mjs'), 'throw 1;');
  assert.deepEqual(collectSyntheticPluginSelections(root)['npm:synthetic-plugin:test'].files, ['plugins/mediflow-synthetic/test/plugin.test.mjs']);
  fs.unlinkSync(path.join(group, 'plugin.test.mjs'));
  assert.match(collectSyntheticPluginSelections(root)['npm:synthetic-plugin:test'].errors.join(), /empty/);
  fs.rmSync(group, { recursive: true });
  assert.match(collectSyntheticPluginSelections(root)['npm:synthetic-plugin:test'].errors.join(), /ENOENT/);
});

test('plugin command, working directory, CI call and trigger drift fail without promoting files', t => {
  const workflowFile = '.github/workflows/synthetic-plugin.yml';
  const edit = (root, file, change) => {
    const target = path.join(root, file), value = JSON.parse(fs.readFileSync(target)); change(value); fs.writeFileSync(target, JSON.stringify(value));
  };
  for (const mutate of [
    root => edit(root, 'plugins/mediflow-synthetic/package.json', pkg => { pkg.scripts.test = 'node --test test/one.test.mjs'; }),
    root => edit(root, workflowFile, w => { w.jobs['synthetic-plugin'].defaults.run['working-directory'] = '.'; }),
    root => edit(root, workflowFile, w => { w.jobs['synthetic-plugin'].steps[0].run = 'npm test || true'; }),
    root => edit(root, workflowFile, w => { w.jobs['synthetic-plugin'].steps.push({ run: 'npm test' }); }),
    root => edit(root, workflowFile, w => { w.on.pull_request.paths = ['other/**']; }),
    root => edit(root, workflowFile, w => { w.on.push.branches = ['other']; }),
  ]) {
    const root = fixture(t); mutate(root);
    const selected = collectSyntheticPluginSelections(root)['npm:synthetic-plugin:test'];
    assert.deepEqual(selected.files, []); assert.equal(selected.binding, null); assert.equal(selected.errors.length, 1);
    assert.match(run(root).stderr, /INCOMPLETE_SELECTION: npm:synthetic-plugin:test/);
  }
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'plugins/mediflow-synthetic/scripts/browser-smoke.mjs'));
  assert.deepEqual(collectSyntheticPluginSelections(root)['npm:synthetic-plugin:test:browser'].files, []);
  assert.match(run(root).stderr, /INCOMPLETE_SELECTION: npm:synthetic-plugin:test:browser/);
});

test('plugin test rename cannot silently change the manifest and reports conditional selection separately', t => {
  const root = fixture(t);
  const good = run(root, 'complete');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Conditional suites \(workflow\/platform\): .*npm:synthetic-plugin:test/);
  fs.renameSync(path.join(root, 'plugins/mediflow-synthetic/test/plugin.test.mjs'), path.join(root, 'plugins/mediflow-synthetic/test/renamed.test.mjs'));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STALE_ENTRY: plugins\/mediflow-synthetic\/test\/plugin.test.mjs/);
  assert.match(result.stderr, /SELECTED_WITHOUT_ENTRY: npm:synthetic-plugin:test: plugins\/mediflow-synthetic\/test\/renamed.test.mjs/);
});


function addSwiftFixture(root, entries = []) {
  // Fixture infrastructure is not a synthetic test candidate. The real repository
  // still tracks this wrapper as unresolved; do not invent an execution mapping.
  fs.writeFileSync(path.join(root, '.gitignore'), 'scripts/native-test.sh\n');
  const definition = { MediFlowCoreTests: ['CoreTests.swift'], MediFlowAppleSharedTests: ['AppleTests.swift'] };
  for (const [target, sources] of Object.entries(definition)) {
    for (const source of sources) {
      const file = `${SWIFT_PACKAGE}/Tests/${target}/${source}`;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'import XCTest\nfinal class SyntheticTests: XCTestCase {}');
      entries.push({ path: file, selection: { state: 'mapped', suiteIds: [SWIFT_SUITE_ID] } });
    }
  }
  fs.writeFileSync(path.join(root, SWIFT_PACKAGE, 'test-sources.json'), JSON.stringify(definition));
  for (const file of ['scripts/native-test.sh', '.github/workflows/apple-native.yml']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), path.join(root, file));
  }
  return definition;
}

function swiftDescription(definition) {
  return { targets: Object.entries(definition).map(([name, sources]) => ({ name, type: 'test', path: `Tests/${name}`, sources })) };
}

test('Swift sources are shared, conditional and checked against official package description without running tests', t => {
  const root = fixture(t);
  const definition = collectSwiftTestSources(root);
  const selection = collectSwiftInventorySelection(root);
  assert.deepEqual(selection.errors, []);
  assert.equal(selection.conditional, true);
  assert.equal(selection.binding.job, 'native-build-test');
  assert.equal(verifySwiftPackageDescription(root, swiftDescription(definition), 'darwin'), 2);
  assert.equal(verifySwiftPackageDescription(root, swiftDescription({ MediFlowCoreTests: definition.MediFlowCoreTests }), 'linux'), 1);
  const realRoot = fileURLToPath(new URL('../', import.meta.url));
  assert.equal(collectSwiftInventorySelection(realRoot).files.length, 106);
});

test('Swift missing, renamed, new, empty, duplicate and unsafe sources fail closed', t => {
  const changes = [
    root => fs.unlinkSync(path.join(root, SWIFT_PACKAGE, 'Tests/MediFlowCoreTests/CoreTests.swift')),
    root => fs.renameSync(path.join(root, SWIFT_PACKAGE, 'Tests/MediFlowCoreTests/CoreTests.swift'), path.join(root, SWIFT_PACKAGE, 'Tests/MediFlowCoreTests/RenamedTests.swift')),
    root => fs.writeFileSync(path.join(root, SWIFT_PACKAGE, 'Tests/MediFlowCoreTests/NewTests.swift'), 'import XCTest'),
    ...[[], ['CoreTests.swift', 'CoreTests.swift'], ['../outside.swift']].map(sources => root => {
      const file = path.join(root, SWIFT_PACKAGE, 'test-sources.json');
      const definition = JSON.parse(fs.readFileSync(file)); definition.MediFlowCoreTests = sources;
      fs.writeFileSync(file, JSON.stringify(definition));
    }),
  ];
  for (const change of changes) {
    const root = fixture(t); change(root);
    const selection = collectSwiftInventorySelection(root);
    assert.deepEqual(selection.files, []); assert.equal(selection.errors.length, 1);
    assert.equal(run(root).status, 1);
  }
});

test('SwiftPM target, path and source differences cannot validate a declared roster', t => {
  const root = fixture(t), definition = collectSwiftTestSources(root);
  for (const mutate of [
    description => description.targets.pop(),
    description => description.targets.push({ ...description.targets[0] }),
    description => { description.targets[0].sources = []; },
    description => { description.targets[0].sources = ['OtherTests.swift']; },
    description => { description.targets[0].path = 'Elsewhere'; },
  ]) {
    const description = swiftDescription(definition); mutate(description);
    assert.throws(() => verifySwiftPackageDescription(root, description, 'darwin'), /SwiftPM test/);
  }
});

test('Swift CI and verified runner drift cannot retain a successful inventory binding', t => {
  for (const [file, before, after] of [
    ['.github/workflows/apple-native.yml', 'scripts/native-test.sh 2>&1', 'scripts/native-test.sh --filter Partial 2>&1'],
    ['.github/workflows/apple-native.yml', "needs.changes.outputs.apple == 'true'", 'false'],
    ['scripts/native-test.sh', 'node "$ROOT_DIR/scripts/swift-test-selection.mjs" --verify', ':'],
    ['scripts/native-test.sh', 'swift test --package-path "$PACKAGE_DIR"', 'swift test --package-path "$PACKAGE_DIR" --filter Partial'],
  ]) {
    const root = fixture(t), filename = path.join(root, file);
    fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace(before, after));
    const selection = collectSwiftInventorySelection(root);
    assert.deepEqual(selection.files, []); assert.equal(selection.errors.length, 1);
  }
});

test('closed support grammar accepts leading CommonJS only and unambiguous extensionless TS', () => {
  assert.deepEqual(collectStaticSupportImports("'use strict'; const { test } = require('node:test'); const helper = require('./fixture.cjs');", 'lib/a.test.cjs'), ['lib/fixture.cjs']);
  for (const source of ["// const helper = require('./fixture.cjs');", "/* const helper = require('./fixture.cjs'); */", "const text = \"require('./fixture.cjs')\";", "const setup = 1; const helper = require('./fixture.cjs');"]) {
    assert.deepEqual(collectStaticSupportImports(source, 'lib/a.test.cjs'), []);
  }
  const source = "import { check } from './route.acceptance'; import test from 'node:test';";
  const input = { 'e2e/a.spec.ts': source, 'e2e/route.acceptance.ts': 'import assert from "node:assert";' };
  assert.deepEqual(discoverCandidates(Object.keys(input), file => input[file])[0].staticImports, ['e2e/route.acceptance.ts']);
  input['e2e/route.acceptance.js'] = '';
  assert.deepEqual(discoverCandidates(Object.keys(input), file => input[file])[0].staticImports, ['e2e/route.acceptance']);
});

test('non-test dispositions need owner/reason and may never be selected as tests', () => {
  const entry = { path: 'tools/capture.mjs', selection: { state: 'excluded-non-test', owner: '@Wulfgardr', reason: 'WUL-729: screenshot producer, no registered tests' } };
  const run = value => checkInventory(candidates([entry.path]), manifest([value]), {});
  assert.equal(run(entry).selectionComplete, true);
  assert.deepEqual(run(entry).excludedNonTests, [entry.path]);
  for (const field of ['owner', 'reason']) {
    const bad = structuredClone(entry); delete bad.selection[field];
    assert.match(run(bad).errors.join('\n'), /INVALID_NON_TEST/);
  }
  assert.match(checkInventory(candidates([entry.path]), manifest([entry]), selections([entry.path])).errors.join('\n'), /NON_TEST_SELECTED_AS_TEST/);
});

function localFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-local-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts/example.test.mjs'), 'throw new Error("must never execute discovery");');
  const recipe = { id: 'example', mode: 'local', kind: 'node-test', files: ['scripts/example.test.mjs'], prerequisites: 'Synthetic fixture only' };
  const write = value => fs.writeFileSync(path.join(root, 'scripts/local-test-recipes.json'), JSON.stringify({ version: 1, recipes: [value] }));
  write(recipe); return { root, recipe, write };
}

test('local dispatcher and inventory use the same closed argv without executing sources', t => {
  const { root } = localFixture(t);
  const command = localTestCommands(root)[0];
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args, ['--test', 'scripts/example.test.mjs']);
  assert.deepEqual(collectLocalTestSelections(root)['local:example'].files, command.files);
  assert.equal(collectLocalTestSelections(root)['local:example'].mode, 'local');
});

test('local recipes reject missing mode/selector/prerequisite, shell input and renamed files', t => {
  const { root, recipe, write } = localFixture(t);
  for (const field of ['mode', 'kind', 'files', 'prerequisites']) {
    const bad = structuredClone(recipe); delete bad[field]; write(bad);
    assert.throws(() => localTestCommands(root), /Invalid local recipe/);
  }
  for (const patch of [{ mode: 'ordinary' }, { kind: 'sh -c' }, { files: [] }, { files: ['../escape.test.mjs'] }, { files: ['scripts/example.test.mjs;touch evil'] }]) {
    write({ ...recipe, ...patch }); assert.throws(() => localTestCommands(root));
  }
  write(recipe); fs.renameSync(path.join(root, recipe.files[0]), path.join(root, 'scripts/renamed.test.mjs'));
  assert.throws(() => localTestCommands(root), /ENOENT/);
  assert.ok(collectLocalTestSelections(root)['local:invalid'].errors.length);
});

test('wrapper recipes fail when the actual selector or invocation disappears', t => {
  const { root, write } = localFixture(t);
  const file = 'scripts/network-home-base-write.test.mjs';
  fs.writeFileSync(path.join(root, file), 'throw new Error("not executed");');
  const recipe = { id: 'network', mode: 'local', kind: 'network-write', files: [file], prerequisites: 'Owned synthetic HTTP fixture' };
  write(recipe);
  const wrapper = path.join(root, 'scripts/network-home-base-write-smoke.sh');
  const selector = 'TEST_SCRIPT="${MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT:-scripts/network-home-base-write.test.mjs}"';
  const call = 'node --test --test-concurrency=1 "$TEST_SCRIPT"';
  fs.writeFileSync(wrapper, `${selector}\n${call}\n`);
  assert.deepEqual(localTestCommands(root)[0].env, { MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT: file });
  for (const content of [selector, call, `${selector}\n${call}\n${call}`]) {
    fs.writeFileSync(wrapper, content); assert.throws(() => localTestCommands(root), /Wrapper/);
  }
});

test('shared runner bindings reject a removed consumer and keep local distinct from ordinary CI', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-consumer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts/additional-test-selection.mjs'), 'export const PROTOTYPE_TEST_FILES = [];');
  fs.writeFileSync(path.join(root, 'scripts/check-09x-prototypes.mjs'), 'const tests = [];');
  const selected = collectAdditionalInventorySelections(root)['prototype:local'];
  assert.equal(selected.mode, 'local');
  assert.match(selected.errors.join('\n'), /consumer binding/);
  assert.match(checkInventory([], manifest([]), { bad: { files: [], errors: [], mode: 'PASS' } }).errors.join('\n'), /INVALID_SUITE_MODE/);
});

 test('selection mode is mandatory and declaring a child never proves invocation', () => {
  const files = ['a.test.mjs'];
  const entries = manifest([mapped(files[0])]);
  assert.match(checkInventory(candidates(files), entries, { unit: { files, errors: [] } }).errors.join('\n'), /INVALID_SUITE_MODE/);
  assert.match(checkInventory(candidates(files), entries, { unit: { files, errors: [], mode: 'child' } }).errors.join('\n'), /UNVERIFIED_CHILD_BINDING/);
});

test('parameterized local commands preserve the entrypoint and reject missing or extra values', t => {
  const { root, recipe, write } = localFixture(t);
  write({ ...recipe, kind: 'node-parameters', parameters: ['--case', '--directory'] });
  const command = localTestCommands(root)[0];
  assert.deepEqual(localInvocationArguments(command, ['/tmp/synthetic.json', '/tmp/owned']), ['scripts/example.test.mjs', '--case', '/tmp/synthetic.json', '--directory', '/tmp/owned']);
  for (const values of [[], ['one'], ['one', 'two', 'three'], ['--eval', 'x'], ['x', 'bad\nvalue']]) assert.throws(() => localInvocationArguments(command, values));
  write({ ...recipe, kind: 'node-parameters' }); assert.throws(() => localTestCommands(root), /parameters/);
  write({ ...recipe, parameters: ['--case'] }); assert.throws(() => localTestCommands(root), /parameters/);
});

test('SOAP child binding requires shared selector, parent invocation, exit oracle and selected parent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-child-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const parent = 'lib/security/headless-soap-active-role-session-grant.test.ts';
  const children = ['attach-failure', 'rejection'].map(kind => `lib/security/headless-soap-active-role-session-grant-${kind}-fixture.ts`);
  for (const file of [parent, ...children, 'scripts/additional-test-selection.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  const selected = collectAdditionalInventorySelections(root)['soap:child'];
  assert.deepEqual(selected.errors, []); assert.deepEqual(selected.files, children);
  const entries = [mapped(parent), ...children.map(file => ({ path: file, selection: { state: 'mapped', suiteIds: ['soap:child'] } }))];
  const input = candidates([parent, ...children]);
  const all = { unit: { files: [parent], errors: [], mode: 'ordinary' }, 'soap:child': selected };
  assert.equal(checkInventory(input, manifest(entries), all).integrityPassed, true);
  assert.match(checkInventory(input, manifest(entries), { 'soap:child': selected }).errors.join('\n'), /UNVERIFIED_CHILD_BINDING/);
  const source = fs.readFileSync(path.join(root, parent), 'utf8');
  for (const changed of [source.replace("soapChildArguments('attach')", '[]'), source.replace('assert.equal(result.status, 0,', 'assert.equal(result.status, 1,')]) {
    fs.writeFileSync(path.join(root, parent), changed);
    assert.match(collectAdditionalInventorySelections(root)['soap:child'].errors.join('\n'), /consumer binding/);
  }
  fs.writeFileSync(path.join(root, parent), source);
  fs.rmSync(path.join(root, 'scripts/additional-test-selection.mjs'));
  assert.ok(collectAdditionalInventorySelections(root)['soap:child'].errors.length);
});

test('consumer token guards reject code that survives only in comments or quoted decoys', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-decoy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const parent = 'lib/security/headless-soap-active-role-session-grant.test.ts';
  const files = [parent, 'scripts/additional-test-selection.mjs', ...['attach-failure', 'rejection'].map(kind => `lib/security/headless-soap-active-role-session-grant-${kind}-fixture.ts`)];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(root, file)); }
  const original = fs.readFileSync(path.join(root, parent), 'utf8');
  const statement = "const result = spawnSync(process.execPath, soapChildArguments('attach'), { cwd: process.cwd(), encoding: 'utf8' });";
  for (const replacement of [`/* ${statement} */`, `// ${statement}`, `const decoy = ${JSON.stringify(statement)};`, 'const decoy = `' + statement + '`;']) {
    fs.writeFileSync(path.join(root, parent), original.replace(statement, replacement));
    assert.match(collectAdditionalInventorySelections(root)['soap:child'].errors.join('\n'), /consumer binding/);
  }
});

function nativeToolFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-native-tool-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const files = ['experiments/rust-boundary/Cargo.toml', 'experiments/rust-boundary/src/lib.rs', 'experiments/rust-boundary/src/main.rs',
    'native/MediFlowAppleApp/project.yml', '.github/workflows/apple-native.yml', 'scripts/generate-apple-xcodeproj.sh',
    'native/MediFlowAppleApp/Tests/MediFlowMobileAppUITests/MediFlowMobileAppUITests.swift',
    'native/MediFlowAppleApp/Tests/MediFlowMobileAppUITests/MobilePairedStatusOverrideUITests.swift'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(root, file)); }
  return root;
}

test('Cargo reads explicit real targets and retains the original command including doctests', t => {
  const root = nativeToolFixture(t);
  const selection = cargoTestCommand(root);
  assert.deepEqual(selection.files, ['experiments/rust-boundary/src/lib.rs', 'experiments/rust-boundary/src/main.rs']);
  assert.deepEqual(selection.args, ['test', '--manifest-path', 'experiments/rust-boundary/Cargo.toml']);
  assert.equal(collectNativeToolSelections(root)['cargo:boundary:local'].mode, 'local');
  const manifestPath = path.join(root, 'experiments/rust-boundary/Cargo.toml');
  const original = fs.readFileSync(manifestPath, 'utf8');
  for (const changed of [original.replace('[lib]', '[disabled]'), original.replace('path = "src/lib.rs"', 'path = "../outside.rs"'),
    original.replace('[lib]', '[lib]\ntest = false'), original + '\n[[bin]]\nname = "extra"\npath = "src/main.rs"\n',
    original.replace('path = "src/main.rs"', 'path = "src/missing.rs"')]) {
    fs.writeFileSync(manifestPath, changed); assert.throws(() => cargoTestCommand(root));
  }
});

test('Xcode UI membership comes from the generated scheme and preserves conditional idiom filters', t => {
  const root = nativeToolFixture(t);
  const selection = collectXcodeUiSelection(root);
  assert.equal(selection.mode, 'conditional'); assert.equal(selection.files.length, 2);
  assert.equal(selection.binding.ipadOnlyTesting.length, 4);
  assert.ok(selection.binding.ipadOnlyTesting.every(name => name.startsWith('MediFlowMobileAppUITests/MediFlowMobileAppUITests/')));
  assert.match(selection.binding.jobIf, /github.event_name != 'pull_request'/);
  assert.ok(selection.binding.generation.stepIndex < selection.binding.stepIndex);
  const specFile = path.join(root, 'native/MediFlowAppleApp/project.yml');
  const original = fs.readFileSync(specFile, 'utf8');
  for (const changed of [original.replace('path: Tests/MediFlowMobileAppUITests', 'path: Tests/missing'),
    original.replace('path: Tests/MediFlowMobileAppUITests', 'path: Tests/MediFlowMobileAppUITests\n        excludes: ["*.swift"]'),
    original.replace('        - MediFlowMobileAppUITests', '        - OtherTests')]) {
    fs.writeFileSync(specFile, changed); assert.throws(() => collectXcodeUiSelection(root));
  }
  fs.writeFileSync(specFile, original);
  fs.rmSync(path.join(root, selection.files[0])); fs.rmSync(path.join(root, selection.files[1]));
  assert.throws(() => collectXcodeUiSelection(root), /Empty/);
});

test('Xcode generator order, condition, invocation and filter drift fail closed', t => {
  const root = nativeToolFixture(t);
  const workflowFile = path.join(root, '.github/workflows/apple-native.yml');
  const original = fs.readFileSync(workflowFile, 'utf8');
  for (const changed of [original.replaceAll('run: scripts/generate-apple-xcodeproj.sh', 'run: echo not-generated'),
    original.replace("github.event_name != 'pull_request'", "github.event_name == 'pull_request'"),
    original.replaceAll('-only-testing:', '-skip-testing:'), original.replace('"${only_testing[@]}"', '"ignored"')]) {
    fs.writeFileSync(workflowFile, changed); assert.throws(() => collectXcodeUiSelection(root));
  }
  fs.writeFileSync(workflowFile, original);
  const generatorFile = path.join(root, 'scripts/generate-apple-xcodeproj.sh');
  const generator = fs.readFileSync(generatorFile, 'utf8');
  fs.writeFileSync(generatorFile, generator.replace('( cd "$PROJECT_DIR" && xcodegen generate --spec project.yml )', '# ( cd "$PROJECT_DIR" && xcodegen generate --spec project.yml )'));
  assert.throws(() => collectXcodeUiSelection(root), /consumer binding/);
});

test('verified lazy support edges remain subordinate to selection and fail on adapter errors', () => {
  const input = supportCase(); input.sources['lib/entry.test.ts'] = "import test from 'node:test';";
  const bound = { importer: 'lib/entry.test.ts', support: 'lib/support.mjs', errors: [] };
  const discovered = discoverCandidates(Object.keys(input.sources), file => input.sources[file]);
  assert.equal(checkInventory(discovered, manifest(input.entries), selections(['lib/entry.test.ts']), [bound]).integrityPassed, true);
  assert.match(checkInventory(discovered, manifest(input.entries), selections(['lib/entry.test.ts']), [{ ...bound, errors: ['bootstrap changed'] }]).errors.join('\n'), /INCOMPLETE_SUPPORT_BINDING/);
  assert.match(checkInventory(discovered, manifest(input.entries), {}, [bound]).errors.join('\n'), /SUPPORT_IMPORTER_NOT_SELECTED/);
});
