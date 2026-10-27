import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { conditionalChildEnvironment, conditionalGroupPlan, conditionalLocalGroups, collectConditionalLocalSelections, copyTrackedWorkspace } from './conditional-local-groups.mjs';
import { localTestCommands, localInvocationArguments } from './local-test-selection.mjs';
import { cargoTestCommand } from './native-tool-test-selection.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const owned = path.join(os.tmpdir(), 'synthetic-conditional-plan');

function trackedWorkspaceFixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'conditional-sparse-copy-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'), target = path.join(directory, 'copy');
  fs.mkdirSync(source); fs.mkdirSync(target);
  const included = process.platform === 'win32' ? 'source with spaces.ts' : 'source with spaces\nand newline.ts';
  const omitted = 'sparse-sentinel.sqlite';
  fs.writeFileSync(path.join(source, included), 'Synthetic source retained.');
  fs.writeFileSync(path.join(source, omitted), 'Invented sparse sentinel only.');
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main'); git('add', '.');
  git('-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-m', 'synthetic materialization');
  fs.mkdirSync(path.join(source, 'node_modules'));
  return { directory, source, target, included, omitted, git };
}

test('tracked workspace respects actual sparse skip-worktree entries before metadata or content access', t => {
  const fixture = trackedWorkspaceFixture(t);
  const { source, target, included, omitted, git } = fixture;
  const identity = git('rev-parse', 'HEAD', 'HEAD^{tree}');
  execFileSync('git', ['sparse-checkout', 'set', '--no-cone', '--stdin'], { cwd: source, input: `/*\n!/${omitted}\n` });
  assert.equal(git('ls-files', '-t', '-z', '--', omitted), `S ${omitted}\0`);
  assert.equal(fs.existsSync(path.join(source, omitted)), false);
  const access = { lstatSync: 0, readFileSync: 0, copyFileSync: 0 };
  for (const method of Object.keys(access)) {
    const original = fs[method];
    t.mock.method(fs, method, function (file, ...args) {
      if (typeof file === 'string' && path.resolve(file) === path.join(source, omitted)) access[method]++;
      return Reflect.apply(original, fs, [file, ...args]);
    });
  }
  copyTrackedWorkspace(source, target);
  assert.deepEqual(access, { lstatSync: 0, readFileSync: 0, copyFileSync: 0 });
  assert.equal(fs.existsSync(path.join(target, omitted)), false);
  assert.equal(fs.readFileSync(path.join(target, included), 'utf8'), 'Synthetic source retained.');
  assert.equal(git('rev-parse', 'HEAD', 'HEAD^{tree}'), identity);
  assert.equal(git('status', '--porcelain'), '');
});

test('tracked workspace still refuses an ordinary missing file, including assume-unchanged', t => {
  const { source, target, included, git } = trackedWorkspaceFixture(t);
  git('update-index', '--assume-unchanged', '--', included);
  fs.rmSync(path.join(source, included));
  assert.equal(git('ls-files', '-t', '-z', '--', included), `H ${included}\0`);
  assert.throws(() => copyTrackedWorkspace(source, target), { code: 'ENOENT' });
});

test('tracked workspace still refuses a materialized tracked symlink before copying it', t => {
  const { directory, source, target, included } = trackedWorkspaceFixture(t);
  const outside = path.join(directory, 'outside');
  if (process.platform === 'win32') fs.mkdirSync(outside);
  else fs.writeFileSync(outside, 'Synthetic target must not be copied.');
  fs.rmSync(path.join(source, included));
  fs.symlinkSync(outside, path.join(source, included), process.platform === 'win32' ? 'junction' : 'file');
  assert.equal(fs.lstatSync(path.join(source, included)).isSymbolicLink(), true);
  assert.throws(() => copyTrackedWorkspace(source, target), /requires a regular tracked file/u);
  assert.equal(fs.existsSync(path.join(target, included)), false);
});

test('browser plans retain canonical recipes and owned positional outputs without launching browsers', () => {
  const plan = conditionalGroupPlan(root, 'headless-browser', owned);
  const registry = localTestCommands(root);
  assert.equal(plan.commands.length, 5);
  assert.ok(plan.commands.some(command => command.label === 'scripts/ink-layout-browser.test.mjs'));
  for (const command of plan.commands) {
    const recipe = registry.find(item => item.id === command.label);
    assert.equal(command.executable, recipe.executable);
    const base = localInvocationArguments(recipe, []);
    assert.deepEqual(command.args.slice(0, base.length), base);
    assert.equal(command.env.MEDIFLOW_DATA_DIR, path.join(owned, 'data'));
    if (conditionalLocalGroups.groups['headless-browser'].outputArguments.includes(command.label)) {
      assert.equal(command.args.length, base.length + 1);
      assert.ok(command.args.at(-1).startsWith(path.join(owned, 'outputs') + path.sep));
    } else assert.deepEqual(command.args, base);
  }
});

test('research uses canonical Cargo tests with doctests, then release build and parameterized comparator', () => {
  const plan = conditionalGroupPlan(root, 'research-toolchain', owned);
  assert.deepEqual(plan.commands[0].args, cargoTestCommand(root).args);
  assert.equal(plan.commands[0].executable, 'cargo');
  assert.equal(plan.commands[0].args.includes('--lib'), false);
  assert.equal(plan.commands[0].args.includes('--bins'), false);
  assert.deepEqual(plan.commands[1].args, ['build', '--release', '--locked', '--manifest-path',
    'experiments/rust-boundary/Cargo.toml', '--target-dir', path.join(owned, 'cargo-target')]);
  const recipe = localTestCommands(root).find(item => item.id === 'experiments/rust-boundary/compare.mjs');
  assert.deepEqual(plan.commands[2].args, localInvocationArguments(recipe, [
    path.join(owned, 'cargo-target', 'release', `mediflow-rust-boundary-experiment${process.platform === 'win32' ? '.exe' : ''}`),
    path.join(owned, 'outputs', 'codec-results.json'),
  ]));
});

test('Apple default entrypoint is lane-backed and other platforms fail explicitly', () => {
  const plan = conditionalGroupPlan(root, 'apple-native', owned, 'darwin');
  assert.deepEqual(plan.commands[0].args, ['scripts/native-test.sh']);
  assert.equal(plan.commands[0].env.MEDIFLOW_NATIVE_TEST_RUNNER, 'swift');
  assert.throws(() => conditionalGroupPlan(root, 'apple-native', owned, 'linux'), /requires darwin; not executed/);
  assert.throws(() => conditionalGroupPlan(root, 'missing', owned), /Unknown conditional group/);
});

test('selection exposes generator artifacts, Cargo targets and eight individually proposed external conditions', () => {
  const selection = collectConditionalLocalSelections(root);
  assert.equal(selection['conditional:headless-browser'].files.length, 5);
  assert.ok(selection['conditional:headless-browser'].files.includes('scripts/ink-layout-browser.test.mjs'));
  assert.equal(selection['conditional:fixture-generators'].files.length, 2);
  assert.equal(selection['conditional:research-toolchain'].files.length, 3);
  assert.equal(conditionalGroupPlan(root, 'fixture-generators', owned).artifacts.length, 3);
  const conditions = conditionalLocalGroups.externalConditions;
  assert.equal(conditions.length, 8);
  assert.equal(new Set(conditions.map(item => item.file)).size, 8);
  assert.ok(conditions.every(item => item.owner === '@Wulfgardr' && item.status === 'proposed-condition-not-approved-exclusion' && item.reason && item.condition));
});

test('nested bash and node children retain the selected Node runtime before inherited PATH', () => {
  const env = conditionalChildEnvironment({ SYNTHETIC: '1' }, { PATH: '/other-node/bin', HOME: '/synthetic' });
  assert.equal(env.PATH, `${path.dirname(process.execPath)}${path.delimiter}/other-node/bin`);
  assert.equal(env.SYNTHETIC, '1');
  assert.equal(env.HOME, '/synthetic');
});
