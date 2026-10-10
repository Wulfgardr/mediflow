import fs from 'node:fs';
import { load, JSON_SCHEMA } from 'js-yaml';
import { ownedHttpInvocations } from './run-owned-synthetic-http-suite.mjs';
import { consumerTokens } from './additional-inventory-selection.mjs';
import { portableLocalTestCommands } from './portable-local-test-selection.mjs';
import path from 'node:path';
import { collectNpmScriptBinding, collectLiteralCiBinding } from './explicit-npm-test-selection.mjs';
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
export function collectAppleInstallabilityBinding(root) {
  const workflow = '.github/workflows/apple-native.yml';
  const binding = collectLiteralCiBinding(root, { script: 'apple:installability-v0', workflow, job: 'native-build-test',
    ciCall: 'node scripts/local-test-selection.mjs test:installability-v0' });
  if (binding.jobIf !== "${{ needs.changes.outputs.apple == 'true' }}" || binding.stepIf !== null || binding.runsOn !== 'macos-15') throw new Error('Apple installability condition changed');
  const yaml = load(fs.readFileSync(path.join(root, workflow), 'utf8'), { schema: JSON_SCHEMA });
  const filters = yaml.jobs?.changes?.steps?.filter(step => typeof step.run === 'string' && step.run.includes('done < changed.txt'));
  if (filters?.length !== 1) throw new Error('Apple change filter missing or duplicated');
  const run = filters[0].run;
  // Match the first unconditional case before the existing event-specific branch.
  // No shell execution or general shell parser is used for inventory discovery.
  const unconditional = run.split('if [ "$EVENT" != push ]; then')[0];
  const expected = 'scripts/installability-v0-macos.test.mjs | scripts/build-installability-v0-macos.sh | scripts/installability-v0-macos-launcher.sh) apple=true; continue ;;';
  const cases = [...unconditional.matchAll(/case "\$f" in([\s\S]*?)esac/gu)];
  if (cases.length !== 1 || cases[0][1].split('\n').map(line => line.trim()).filter(line => line === expected).length !== 1) throw new Error('Installability scripts must activate Apple CI on pull requests and pushes');
  return binding;
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
  for (const standalone of [false, true]) {
    const script = standalone ? 'test:owned-http-standalone' : 'test:owned-http';
    try {
      verifyDispositionConsumer(fs.readFileSync(path.join(root, 'scripts/run-owned-synthetic-http-suite.mjs'), 'utf8'), [
        'const invocations = ownedHttpInvocations(root, standalone);',
        'for (const recipe of invocations)',
        'spawn(recipe.executable, recipe.args,',
      ]);
      const binding = collectNpmScriptBinding(root, { script, workflow: '.github/workflows/web-core.yml', job: 'web-core' },
        `node scripts/run-owned-synthetic-http-suite.mjs${standalone ? ' --standalone' : ''}`);
      if (binding.jobIf !== null || binding.stepIf !== null) throw new Error('HTTP CI hook acquired a condition');
      if (standalone) {
        const build = collectLiteralCiBinding(root, { script: 'build', workflow: binding.workflow, job: binding.job, ciCall: 'npm run build' });
        if (build.stepIndex >= binding.stepIndex || build.stepIf !== null) throw new Error('Standalone HTTP requires the preceding unconditional build');
      }
      out[`npm:${script}`] = { files: ownedHttpInvocations(root, standalone).flatMap(recipe => recipe.coveredFiles), mode: 'ordinary', errors: [], binding };
    } catch (error) { out[`npm:${script}`] = { files: [], mode: 'ordinary', errors: [error.message] }; }
  }
  try {
    const binding = collectAppleInstallabilityBinding(root);
    const recipe = localTestCommands(root).find(command => command.id === 'test:installability-v0');
    if (!recipe || recipe.kind !== 'node-test' || recipe.files.length !== 1 || recipe.files[0] !== 'scripts/installability-v0-macos.test.mjs') throw new Error('Installability recipe changed');
    out['apple:installability-v0'] = { files: recipe.files, mode: 'conditional', conditional: true, errors: [], binding };
  } catch (error) { out['apple:installability-v0'] = { files: [], mode: 'conditional', errors: [error.message] }; }
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
