import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localTestCommands, localInvocationArguments } from './local-test-selection.mjs';
import { cargoTestCommand } from './native-tool-test-selection.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const conditionalLocalGroups = JSON.parse(fs.readFileSync(new URL('./conditional-local-groups.json', import.meta.url), 'utf8'));

// Local and CI consume the same registry command; only owned paths/provisioning differ.
export function conditionalGroupPlan(root, groupId, ownedRoot, platform = process.platform) {
  const group = conditionalLocalGroups.groups[groupId];
  if (!group) throw new Error(`Unknown conditional group: ${groupId}`);
  if (!path.isAbsolute(ownedRoot)) throw new Error('Owned workspace root must be absolute');
  if (group.platform && group.platform !== platform) throw new Error(`${groupId} requires ${group.platform}; not executed on ${platform}`);
  if (group.existingLane && !fs.readFileSync(path.join(root, group.existingLane), 'utf8').includes(group.existingInvocation)) {
    throw new Error('Existing Apple lane no longer consumes the declared native entrypoint');
  }
  const registry = localTestCommands(root);
  const commands = [];
  const outputs = path.join(ownedRoot, 'outputs');
  const env = { MEDIFLOW_DATA_DIR: path.join(ownedRoot, 'data'), MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' };
  if (groupId === 'research-toolchain') {
    const test = cargoTestCommand(root);
    commands.push({ ...test, label: 'cargo-tests', env: { ...env, CARGO_TARGET_DIR: path.join(ownedRoot, 'cargo-target') } });
    commands.push({ label: 'cargo-release-comparator', executable: 'cargo', args: [
      'build', '--release', '--locked', '--manifest-path', 'experiments/rust-boundary/Cargo.toml',
      '--target-dir', path.join(ownedRoot, 'cargo-target'),
    ], env });
  }
  for (const recipeId of group.recipes) {
    const recipe = registry.find(command => command.id === recipeId);
    if (!recipe || recipe.files.length !== 1 || recipe.files[0] !== recipeId) throw new Error(`Recipe drift: ${recipeId}`);
    const values = groupId === 'research-toolchain' ? [
      path.join(ownedRoot, 'cargo-target', 'release', `mediflow-rust-boundary-experiment${platform === 'win32' ? '.exe' : ''}`),
      path.join(outputs, 'codec-results.json'),
    ] : [];
    const args = localInvocationArguments(recipe, values);
    // These two existing component scripts accept a positional output root, although
    // their local registry recipe needs no arguments. Never use their fixed defaults.
    if (group.outputArguments?.includes(recipeId)) args.push(path.join(outputs, path.basename(path.dirname(recipeId))));
    commands.push({ label: recipeId, executable: recipe.executable, args, env: {
      ...env, ...recipe.env, ...(groupId === 'apple-native' ? { MEDIFLOW_NATIVE_TEST_RUNNER: 'swift' } : {}),
    } });
  }
  return { groupId, commands, artifacts: group.artifacts ?? [], prerequisites: group.prerequisites };
}

export function collectConditionalLocalSelections(root) {
  return Object.fromEntries(Object.keys(conditionalLocalGroups.groups).map(groupId => {
    const plan = conditionalGroupPlan(root, groupId, path.join(os.tmpdir(), 'mediflow-conditional-selection'),
      conditionalLocalGroups.groups[groupId].platform ?? process.platform);
    const files = [...conditionalLocalGroups.groups[groupId].recipes,
      ...(groupId === 'research-toolchain' ? cargoTestCommand(root).files : [])];
    return [`conditional:${groupId}`, { files, errors: [], mode: 'conditional', conditional: true,
      binding: { command: ['node', 'scripts/conditional-local-groups.mjs', '--group', groupId],
        prerequisites: plan.prerequisites.join(' '), platform: conditionalLocalGroups.groups[groupId].platform ?? null } }];
  }));
}

function copyTrackedWorkspace(root, target) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of tracked) {
    const source = path.join(root, file), destination = path.join(target, file);
    if (!fs.lstatSync(source).isFile()) throw new Error(`Disposable workspace requires a regular tracked file: ${file}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  const modules = path.join(root, 'node_modules');
  if (!fs.statSync(modules).isDirectory()) throw new Error('Installed node_modules required; the group runner never installs dependencies');
  fs.symlinkSync(fs.realpathSync(modules), path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}

export function runConditionalGroup(root, groupId, { keepOutput = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node 24 is required');
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-conditional-local-'));
  try {
    // Validate selection and platform before copying or launching any command.
    const plan = conditionalGroupPlan(root, groupId, ownedRoot);
    const workspace = path.join(ownedRoot, 'workspace');
    fs.mkdirSync(workspace);
    fs.mkdirSync(path.join(ownedRoot, 'outputs'));
    fs.mkdirSync(path.join(ownedRoot, 'data'));
    copyTrackedWorkspace(root, workspace);
    for (const command of plan.commands) {
      console.log(`[${groupId}] ${command.label}`);
      const result = spawnSync(command.executable, command.args, {
        cwd: workspace, env: { ...process.env, ...command.env }, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${command.label} failed: ${result.signal ?? result.status}`);
    }
    for (const artifact of plan.artifacts) {
      const generated = path.join(workspace, artifact);
      if (!fs.statSync(generated).isFile()) throw new Error(`Missing generated artifact: ${artifact}`);
      JSON.parse(fs.readFileSync(generated, 'utf8'));
      console.log(`[${groupId}] generated JSON verified: ${artifact}`);
    }
    console.log(JSON.stringify({ groupId, status: 'passed', commands: plan.commands.map(command => command.label),
      ...(keepOutput ? { ownedRoot } : { outputs: 'temporary outputs removed after run' }) }));
  } finally {
    if (keepOutput) console.log(`Owned synthetic workspace retained: ${ownedRoot}`);
    else fs.rmSync(ownedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--list') console.log(JSON.stringify(conditionalLocalGroups, null, 2));
    else if (args[0] === '--group' && args[1] && (args.length === 2 || (args.length === 3 && args[2] === '--keep-output'))) {
      runConditionalGroup(ROOT, args[1], { keepOutput: args[2] === '--keep-output' });
    } else throw new Error('Usage: node scripts/conditional-local-groups.mjs --list | --group <group> [--keep-output]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
