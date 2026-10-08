import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectExplicitNpmNodeTests, collectExplicitNpmSelections, collectNpmScriptBinding, collectClaimsSelfTestSelection, EXPLICIT_NPM_SUITES } from './explicit-npm-test-selection.mjs';
import { collectUnitTestFiles } from './unit-test-selection.mjs';
import { checkInventory } from './test-inventory.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const target = 'test:launcher-helpers';
const suiteId = `npm:${target}`;
const workflowPath = '.github/workflows/cross-platform.yml';
const claimsFile = 'scripts/check-claims-guard.mjs';
const claimsWorkflow = '.github/workflows/openapi-contract-guard.yml';
const claimsCall = 'npm run check:claims -- --self-test';

function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-selector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = { scripts: {} };
  const workflows = {};
  for (const [i, suite] of EXPLICIT_NPM_SUITES.entries()) {
    const file = `synthetic/test-${i}.test.mjs`;
    pkg.scripts[suite.script] = `node --test ${file}`;
    write(root, file, 'throw new Error("test must not execute");');
    const workflow = workflows[suite.workflow] ??= { jobs: {} };
    const job = workflow.jobs[suite.job] ??= { 'runs-on': 'ubuntu-latest', steps: [] };
    job.steps.push({ run: `npm run ${suite.script}`, ...(suite.stepIf ? { if: suite.stepIf } : {}) });
  }
  write(root, 'package.json', pkg);
  for (const [file, workflow] of Object.entries(workflows)) write(root, file, workflow);
  return root;
}
function change(root, file, mutate) {
  const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  mutate(value); write(root, file, value);
}
function bindingChange(root, mutate) {
  change(root, workflowPath, workflow => mutate(workflow, workflow.jobs['headless-contracts'], workflow.jobs['headless-contracts'].steps[0]));
}
function rejected(root, pattern) {
  const result = collectExplicitNpmSelections(root);
  assert.equal(Object.keys(result).length, 5);
  assert.deepEqual(result[suiteId].files, []);
  assert.equal(result[suiteId].binding, null);
  assert.match(result[suiteId].errors.join('\n'), pattern);
}

function claimsFixture(t) {
  const root = fixture(t);
  write(root, claimsFile, 'throw new Error("Claims guard must not execute");');
  change(root, 'package.json', pkg => { pkg.scripts['check:claims'] = `node ${claimsFile}`; });
  change(root, claimsWorkflow, workflow => {
    workflow.jobs['repository-guards'].steps.push({ run: `npm run check:claims\n${claimsCall}` });
  });
  return root;
}
function claimsChange(root, mutate) {
  change(root, claimsWorkflow, workflow => {
    const job = workflow.jobs['repository-guards']; mutate(job, job.steps.at(-1));
  });
}
function claimsRejected(root, pattern) {
  const selection = collectClaimsSelfTestSelection(root);
  assert.deepEqual(selection.files, []); assert.equal(selection.binding, null);
  assert.match(selection.errors.join('\n'), pattern);
}

test('Claims self-test selects the actual guard and records the argument-bearing CI call separately', () => {
  const selection = collectClaimsSelfTestSelection(sourceRoot);
  assert.deepEqual(selection.files, [claimsFile]);
  assert.deepEqual(selection.errors, []);
  assert.deepEqual(selection.binding.commands, ['check:claims', 'check:claims -- --self-test']);
  assert.equal(selection.binding.job, 'repository-guards');
  assert.equal(selection.binding.stepIf, "${{ !cancelled() && steps.install.outcome == 'success' }}");
});

test('Claims self-test requires its exact arguments once and rejects ordinary scans or shell mentions', t => {
  for (const run of [undefined, 'npm run check:claims', 'npm run check:claims --self-test',
    'npm run check:claims -- --selftest', `${claimsCall} --filter=one`, `${claimsCall} || true`,
    `# ${claimsCall}`, `echo ${claimsCall}`, `if true; then\n${claimsCall}\nfi`,
    `cat <<EOF\n${claimsCall}\nEOF`, `${claimsCall}\nexit 0`, `${claimsCall}\n${claimsCall}`,
    `${claimsCall}\nnpm run check:other -- --self-test`,
  ]) {
    const root = claimsFixture(t);
    claimsChange(root, (job, step) => { step.run = run; });
    claimsRejected(root, /exactly one literal CI call/);
  }
  const root = claimsFixture(t);
  claimsChange(root, job => { job.steps.push({ run: claimsCall }); });
  claimsRejected(root, /found 2/);
});

test('Claims self-test missing or changed npm entrypoint never promotes the guard file', t => {
  for (const command of [undefined, '', `node ${claimsFile} --filter=one`, `node ${claimsFile} || true`]) {
    const root = claimsFixture(t);
    change(root, 'package.json', pkg => { pkg.scripts['check:claims'] = command; });
    claimsRejected(root, /Required npm command changed or missing/);
  }
});

test('Claims self-test rejects missing, nonregular or out-of-root guard paths', t => {
  for (const mutate of [
    root => fs.unlinkSync(path.join(root, claimsFile)),
    root => { fs.unlinkSync(path.join(root, claimsFile)); fs.mkdirSync(path.join(root, claimsFile)); },
    root => {
      const outside = claimsFixture(t);
      fs.rmSync(path.join(root, 'scripts'), { recursive: true });
      fs.symlinkSync(path.join(outside, 'scripts'), path.join(root, 'scripts'), process.platform === 'win32' ? 'junction' : 'dir');
    },
  ]) {
    const root = claimsFixture(t); mutate(root);
    claimsRejected(root, /ENOENT|Not a regular file|Path escapes root/);
  }
});

test('Claims argument-bearing call retains CI disabled, failure and execution-context guards', t => {
  for (const level of ['job', 'step']) for (const [key, value] of [
    ['if', false], ['continue-on-error', true], ['working-directory', 'other'], ['shell', 'python {0}'],
  ]) {
    const root = claimsFixture(t);
    claimsChange(root, (job, step) => {
      if (level === 'job' && ['working-directory', 'shell'].includes(key)) job.defaults = { run: { [key]: value } };
      else (level === 'job' ? job : step)[key] = value;
    });
    claimsRejected(root, /Disabled|Unsupported|repository root/);
  }
});

test('Claims collection neither reads or imports guard code nor scans directories or launches children', t => {
  const root = claimsFixture(t);
  const source = `
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('UNEXPECTED_CLAIMS_EXECUTION_OR_SCAN'); };
const read = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  if (String(file).endsWith('check-claims-guard.mjs')) forbidden();
  return read(file, ...args);
};
fs.readdirSync = forbidden;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) childProcess[name] = forbidden;
syncBuiltinESMExports();
const { collectClaimsSelfTestSelection } = await import(${JSON.stringify(new URL('./explicit-npm-test-selection.mjs', import.meta.url).href)});
const result = collectClaimsSelfTestSelection(${JSON.stringify(root)});
if (result.errors.length) throw new Error(result.errors.join('\\n'));
console.log(JSON.stringify(result.files));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: source, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [claimsFile]);
});

test('five required npm script bodies and CI bindings select the actual independent expected paths', () => {
  const actual = collectExplicitNpmSelections(sourceRoot);
  assert.deepEqual(Object.fromEntries(Object.entries(actual).map(([id, value]) => [id, value.files])), {
    'npm:test:launcher-helpers': ['scripts/launcher-helpers.test.mjs'],
    'npm:test:native-launcher': ['scripts/launch-mediflow-mac.test.mjs'],
    'npm:test:usage-dashboard': ['scripts/build-usage-dashboard.test.mjs'],
    'npm:test:fabric-generative-runtime-crosswalk': ['scripts/check-fabric-generative-runtime-crosswalk.test.mjs'],
    'npm:test:lume-tokens': ['scripts/check-lume-tokens.test.mjs'],
  });
  for (const suite of Object.values(actual)) assert.deepEqual(suite.errors, []);
  assert.equal(actual['npm:test:native-launcher'].binding.stepIf, "runner.os == 'macOS'");
  assert.deepEqual(actual[suiteId].binding.matrix.os, ['ubuntu-22.04', 'windows-latest', 'macos-latest']);
  assert.equal(actual[suiteId].binding.shell, null);
  assert.deepEqual(actual['npm:test:usage-dashboard'].binding.commands, ['test:usage-dashboard', 'check:usage-dashboard']);
  assert.equal(collectUnitTestFiles(sourceRoot).filter(file => file === 'scripts/explicit-npm-test-selection.test.mjs').length, 1);
});

test('selection is inert, ordered, and records CI conditions without claiming execution', t => {
  const root = fixture(t);
  write(root, 'synthetic/second.test.mjs', 'throw 2;');
  change(root, 'package.json', pkg => { pkg.scripts[target] += ' synthetic/second.test.mjs'; });
  bindingChange(root, (workflow, job, step) => {
    job.if = '${{ needs.prepare.result == \'success\' }}'; job.needs = ['prepare'];
    job.strategy = { matrix: { os: ['ubuntu-latest', 'windows-latest'] } };
    step.if = '${{ !cancelled() }}';
    step.run = '# before\nnpm run check:other\n\nnpm run test:launcher-helpers\n# after';
  });
  const result = collectExplicitNpmSelections(root)[suiteId];
  assert.deepEqual(result.files, ['synthetic/test-0.test.mjs', 'synthetic/second.test.mjs']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.binding.needs, ['prepare']);
  assert.equal(result.binding.stepIf, '${{ !cancelled() }}');
  assert.equal(result.binding.jobIf, '${{ needs.prepare.result == \'success\' }}');
});

test('missing, empty and nonliteral commands fail without partial selection', t => {
  for (const command of [undefined, '', 'node --test', 'node --test ',
    'node --test synthetic/test-0.test.mjs --test-name-pattern=one',
    'node --test synthetic/test-0.test.mjs || true', 'node --test synthetic/*.mjs',
    'node --test $TEST_FILE', 'node --test "synthetic/test-0.test.mjs"',
    'node --test ../outside.test.mjs', 'node --test /outside.test.mjs',
    'node --test synthetic//test-0.test.mjs', 'node --test synthetic/./test-0.test.mjs',
    'node --test synthetic/test-0.test.mjs\nnode --test other.mjs',
    'node --test synthetic/test-0.test.mjs\u0000', 'node --test synthetic/test-0.test.mjs ',
  ]) {
    const root = fixture(t);
    change(root, 'package.json', pkg => { pkg.scripts[target] = command; });
    rejected(root, /Unsupported or missing|Unsupported literal/);
  }
});

test('missing, nonregular, duplicate and escaping files fail', t => {
  for (const mutate of [
    root => fs.unlinkSync(path.join(root, 'synthetic/test-0.test.mjs')),
    root => { fs.unlinkSync(path.join(root, 'synthetic/test-0.test.mjs')); fs.mkdirSync(path.join(root, 'synthetic/test-0.test.mjs')); },
    root => change(root, 'package.json', pkg => { pkg.scripts[target] += ' synthetic/test-0.test.mjs'; }),
    root => { fs.symlinkSync(path.join(root, 'synthetic'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); change(root, 'package.json', pkg => { pkg.scripts[target] += ' alias/test-0.test.mjs'; }); },
    root => { fs.renameSync(path.join(root, 'synthetic'), path.join(root, 'outside')); fs.symlinkSync(os.tmpdir(), path.join(root, 'synthetic'), process.platform === 'win32' ? 'junction' : 'dir'); },
  ]) {
    const root = fixture(t); mutate(root);
    rejected(root, /ENOENT|Not a regular file|Duplicate test path|Path escapes root/);
  }
});

test('removing one file from a nonempty command breaks its mapping; additions require records', t => {
  const root = fixture(t);
  write(root, 'synthetic/second.test.mjs', 'throw 2;');
  const files = ['synthetic/test-0.test.mjs', 'synthetic/second.test.mjs'];
  const manifest = { version: 1, entries: files.map(file => ({ path: file, selection: { state: 'mapped', suiteIds: [suiteId] } })) };
  const result = checkInventory(files.map(file => ({ path: file })), manifest, { [suiteId]: collectExplicitNpmSelections(root)[suiteId] });
  assert.match(result.errors.join('\n'), /MAPPED_NOT_SELECTED.*second/);
  change(root, 'package.json', pkg => { pkg.scripts[target] += ' synthetic/second.test.mjs'; });
  manifest.entries.pop();
  assert.match(checkInventory(files.map(file => ({ path: file })), manifest, { [suiteId]: collectExplicitNpmSelections(root)[suiteId] }).errors.join('\n'), /SELECTED_WITHOUT_ENTRY/);
});

test('CI requires a unique complete literal run block, never a substring', t => {
  for (const run of [undefined, '# npm run test:launcher-helpers', 'echo npm run test:launcher-helpers',
    'npm run test:launcher-helpers || true', 'npm run test:launcher-helpers -- --test-name-pattern=one',
    'if true; then\nnpm run test:launcher-helpers\nfi',
    'cat <<EOF\nnpm run test:launcher-helpers\nEOF',
    'npm run test:launcher-helpers\nexit 0', 'npm run test:launcher-helpers \\\n',
    'npm run test:launcher-helpers\nnpm run test:launcher-helpers']) {
    const root = fixture(t);
    bindingChange(root, (workflow, job, step) => { step.run = run; });
    rejected(root, /exactly one literal CI call/);
  }
});

test('disabled or failure-ignoring jobs and steps are not valid bindings', t => {
  for (const level of ['job', 'step']) for (const [key, value] of [
    ['if', false], ['if', 'false'], ['if', '${{ false }}'], ['if', {}],
    ['continue-on-error', true], ['continue-on-error', '${{ matrix.optional }}'],
  ]) {
    const root = fixture(t);
    bindingChange(root, (workflow, job, step) => { (level === 'job' ? job : step)[key] = value; });
    rejected(root, /Disabled|Unsupported/);
  }
  const root = fixture(t);
  bindingChange(root, (workflow, job) => { delete job.steps[1].if; });
  const native = collectExplicitNpmSelections(root)['npm:test:native-launcher'];
  assert.deepEqual(native.files, []);
  assert.match(native.errors.join('\n'), /platform condition changed/);
});

test('working directory and shell resolve step over job over workflow', t => {
  for (const level of ['workflow', 'job', 'step']) for (const [key, value] of [['working-directory', 'other'], ['shell', 'python {0}']]) {
    const root = fixture(t);
    bindingChange(root, (workflow, job, step) => {
      if (level === 'step') step[key] = value;
      else (level === 'job' ? job : workflow).defaults = { run: { [key]: value } };
    });
    rejected(root, /repository root|Unsupported CI binding shell/);
  }
  const root = fixture(t);
  bindingChange(root, (workflow, job, step) => {
    workflow.defaults = { run: { 'working-directory': 'other', shell: 'python {0}' } };
    job.defaults = { run: { 'working-directory': '.', shell: 'bash' } };
    step.shell = 'pwsh';
  });
  const result = collectExplicitNpmSelections(root)[suiteId];
  assert.deepEqual(result.errors, []);
  assert.equal(result.binding.shell, 'pwsh'); assert.equal(result.binding.workingDirectory, '.');
});

test('invalid YAML, duplicate keys, merges, missing job or files remain required errors', t => {
  for (const value of ['[', 'jobs: {}\njobs: {}', 'jobs: {headless-contracts: {<<: {steps: []}}}', 'a: &a {b: *a}', '{}']) {
    const root = fixture(t); write(root, workflowPath, value);
    rejected(root, /unexpected|duplicated|merge keys|Cyclic|Missing CI job/);
  }
  for (const file of ['package.json', workflowPath]) {
    const root = fixture(t); fs.unlinkSync(path.join(root, file)); rejected(root, /ENOENT/);
  }
});

test('package and workflow readers reject nonregular, escaping and invalid UTF-8 sources', t => {
  for (const file of ['package.json', workflowPath]) {
    const root = fixture(t); fs.unlinkSync(path.join(root, file)); fs.mkdirSync(path.join(root, file));
    rejected(root, /Not a regular file/);
  }
  const root = fixture(t); fs.writeFileSync(path.join(root, 'package.json'), Buffer.from([0xff]));
  rejected(root, /encoded data/);
  const outside = fixture(t);
  const escaped = fixture(t);
  fs.rmSync(path.join(escaped, '.github'), { recursive: true });
  fs.symlinkSync(path.join(outside, '.github'), path.join(escaped, '.github'), process.platform === 'win32' ? 'junction' : 'dir');
  rejected(escaped, /Path escapes root/);
});

test('module import performs no discovery, subprocess or test execution', t => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(new URL('./explicit-npm-test-selection.mjs', import.meta.url).href)})`], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.deepEqual(collectExplicitNpmNodeTests(root, target), ['synthetic/test-0.test.mjs']);
});

test('known runner binding requires the exact npm command and the same CI guards', t => {
  const root = fixture(t);
  const suite = { script: target, workflow: workflowPath, job: 'headless-contracts' };
  const expected = 'node scripts/known-runner.mjs';
  change(root, 'package.json', pkg => { pkg.scripts[target] = expected; });
  assert.deepEqual(collectNpmScriptBinding(root, suite, expected).commands, [target]);
  for (const command of [undefined, '', expected + ' --filter=one', expected + ' || true', 'node scripts/other.mjs']) {
    change(root, 'package.json', pkg => { pkg.scripts[target] = command; });
    assert.throws(() => collectNpmScriptBinding(root, suite, expected), /command changed or missing/);
  }
  change(root, 'package.json', pkg => { pkg.scripts[target] = expected; });
  bindingChange(root, (workflow, job, step) => { step.if = false; });
  assert.throws(() => collectNpmScriptBinding(root, suite, expected), /Disabled step if/);
});
