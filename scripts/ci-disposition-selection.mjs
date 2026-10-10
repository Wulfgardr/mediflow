import fs from 'node:fs';
import { consumerTokens } from './additional-inventory-selection.mjs';
import { portableLocalTestCommands } from './portable-local-test-selection.mjs';
import path from 'node:path';
import { collectNpmScriptBinding } from './explicit-npm-test-selection.mjs';
import { collectConditionalLocalSelections } from './conditional-local-groups.mjs';
import { collectSwiftInventorySelection } from './swift-test-selection.mjs';
import { localTestCommands } from './local-test-selection.mjs';

const custodian = 'native/MediFlowMac/ExecutionCustodian/custodian.test.ts';
const hooks = [
  ['headless-browser', 'test:inventory-browser', 'e2e', 'e2e'],
  ['fixture-generators', 'test:fixture-generators', 'web-core', 'web-core'],
  ['research-toolchain', 'test:research-boundary', 'web-core', 'web-core'],
];
export function verifyDispositionConsumer(source, fragments) {
  const tokens = consumerTokens(source);
  for (const fragment of fragments) {
    const expected = consumerTokens(fragment);
    let count = 0;
    for (let i = 0; i <= tokens.length - expected.length; i++) {
      if (expected.every((token, offset) => token === tokens[i + offset])) count++;
    }
    if (count !== 1) throw new Error('Shared disposition consumer is missing or duplicated');
  }
}
export function collectCiDispositionSelections(root) {
  // Small synthetic inventory fixtures do not contain the shared registry.
  if (!fs.existsSync(path.join(root, 'scripts/conditional-local-groups.json'))) return {};
  const out = {};
  for (const [group, script, workflow, job] of hooks) {
    try {
      verifyDispositionConsumer(fs.readFileSync(path.join(root, 'scripts/conditional-local-groups.mjs'), 'utf8'), [
        'const plan = conditionalGroupPlan(root, groupId, ownedRoot);',
        'for (const command of plan.commands)',
        'spawnSync(command.executable, command.args,',
      ]);
      const selection = collectConditionalLocalSelections(root)[`conditional:${group}`];
      const binding = collectNpmScriptBinding(root, { script, workflow: `.github/workflows/${workflow}.yml`, job },
        `node scripts/conditional-local-groups.mjs --group ${group}`);
      if (binding.jobIf !== null || binding.stepIf !== null) throw new Error('Ordinary CI hook acquired a condition');
      out[`npm:${script}`] = { ...selection, mode: 'ordinary', conditional: false, binding };
    } catch (error) { out[`npm:${script}`] = { files: [], mode: 'ordinary', errors: [error.message] }; }
  }
  try {
    verifyDispositionConsumer(fs.readFileSync(path.join(root, 'scripts/run-portable-local-tests.mjs'), 'utf8'), [
      'const commands = portableLocalTestCommands(root);',
      'runPortableLocalCommands(root, requested.length ? commands.filter(command => requested.includes(command.id)) : commands)',
      'spawn(command.executable, command.args,',
    ]);
    const binding = collectNpmScriptBinding(root, { script: 'test:portable-local', workflow: '.github/workflows/web-core.yml', job: 'web-core' }, 'node scripts/run-portable-local-tests.mjs');
    if (binding.jobIf !== null || binding.stepIf !== null) throw new Error('Portable CI hook acquired a condition');
    out['npm:test:portable-local'] = { files: portableLocalTestCommands(root).flatMap(command => command.files), mode: 'ordinary', errors: [], binding };
  } catch (error) { out['npm:test:portable-local'] = { files: [], mode: 'ordinary', errors: [error.message] }; }
  const swift = collectSwiftInventorySelection(root);
  out['ci:apple-native-entrypoint'] = { ...swift, files: swift.errors.length ? [] : ['scripts/native-test.sh'], mode: 'conditional' };
  try {
    const recipe = localTestCommands(root).find(command => command.id === custodian);
    if (!recipe || recipe.files.length !== 1 || recipe.files[0] !== custodian) throw new Error('Custodian recipe changed');
    const binding = collectNpmScriptBinding(root, { script: 'test:apple-custodian', workflow: '.github/workflows/apple-native.yml', job: 'native-build-test' },
      `node scripts/local-test-selection.mjs ${custodian}`);
    if (binding.jobIf !== "${{ needs.changes.outputs.apple == 'true' }}" || binding.stepIf !== null || binding.runsOn !== 'macos-15') throw new Error('Apple qualification condition changed');
    out['npm:test:apple-custodian'] = { files: recipe.files, mode: 'conditional', conditional: true, errors: [], binding };
  } catch (error) { out['npm:test:apple-custodian'] = { files: [], mode: 'conditional', errors: [error.message] }; }
  return out;
}
