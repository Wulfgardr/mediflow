import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { conditionalGroupPlan, conditionalLocalGroups, collectConditionalLocalSelections } from './conditional-local-groups.mjs';
import { localTestCommands, localInvocationArguments } from './local-test-selection.mjs';
import { cargoTestCommand } from './native-tool-test-selection.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const owned = path.join(os.tmpdir(), 'synthetic-conditional-plan');

test('browser plans retain all four canonical recipes and owned positional outputs without launching browsers', () => {
  const plan = conditionalGroupPlan(root, 'headless-browser', owned);
  const registry = localTestCommands(root);
  assert.equal(plan.commands.length, 4);
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
  assert.equal(selection['conditional:headless-browser'].files.length, 4);
  assert.equal(selection['conditional:fixture-generators'].files.length, 2);
  assert.equal(selection['conditional:research-toolchain'].files.length, 3);
  assert.equal(conditionalGroupPlan(root, 'fixture-generators', owned).artifacts.length, 3);
  const conditions = conditionalLocalGroups.externalConditions;
  assert.equal(conditions.length, 8);
  assert.equal(new Set(conditions.map(item => item.file)).size, 8);
  assert.ok(conditions.every(item => item.owner === '@Wulfgardr' && item.status === 'proposed-condition-not-approved-exclusion' && item.reason && item.condition));
});
