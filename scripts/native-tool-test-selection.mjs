import fs from 'node:fs';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load, JSON_SCHEMA } from 'js-yaml';
import { collectLiteralCiBinding } from './explicit-npm-test-selection.mjs';

const cargoManifest = 'experiments/rust-boundary/Cargo.toml';
const appleProject = 'native/MediFlowAppleApp';
const workflow = '.github/workflows/apple-native.yml';
function relative(value) {
  return typeof value === 'string' && /^[\w./-]+$/u.test(value) && !value.startsWith('/')
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function read(root, file) {
  if (!relative(file) || !fs.lstatSync(path.join(root, file)).isFile()
    || !fs.realpathSync(path.join(root, file)).startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Invalid native selection file: ${file}`);
  return fs.readFileSync(path.join(root, file), 'utf8');
}
function yaml(root, file) {
  const value = load(read(root, file), { schema: JSON_SCHEMA });
  function check(node, ancestors = new Set()) {
    if (!node || typeof node !== 'object') return;
    if (ancestors.has(node) || Object.hasOwn(node, '<<')) throw new Error('Unsupported YAML alias/merge');
    for (const child of Object.values(node)) check(child, new Set([...ancestors, node]));
  }
  check(value); return value;
}

// Closed explicit-target contract, not a general TOML parser. Cargo consumes
// these same path/name fields. The original command retains doctests as well.
export function cargoTestCommand(root) {
  const source = read(root, cargoManifest);
  if (/"""|'''/u.test(source)) throw new Error('Unsupported multiline Cargo values');
  const sections = [...source.matchAll(/^\s*(\[\[?[^\]\r\n]+\]\]?)\s*(?:#[^\r\n]*)?$/gmu)];
  if (sections.some(match => !['[package]', '[dependencies]', '[lib]', '[[bin]]'].includes(match[1]))) throw new Error('Unsupported Cargo sections');
  function section(header) {
    const matches = sections.map((match, index) => ({ match, index })).filter(item => item.match[1] === header);
    if (matches.length !== 1) throw new Error(`Expected one Cargo ${header}`);
    const { match, index } = matches[0];
    return source.slice(match.index + match[0].length, sections[index + 1]?.index ?? source.length);
  }
  function fields(header, expected) {
    const out = {};
    for (const raw of section(header).split(/\r?\n/u)) {
      if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
      const match = /^\s*([a-z]+)\s*=\s*"([A-Za-z0-9_./-]+)"\s*(?:#.*)?$/u.exec(raw);
      if (!match || !expected.includes(match[1]) || Object.hasOwn(out, match[1])) throw new Error(`Unsupported Cargo target fields: ${header}`);
      out[match[1]] = match[2];
    }
    if (Object.keys(out).length !== expected.length) throw new Error(`Missing Cargo target fields: ${header}`);
    return out;
  }
  const names = [...section('[package]').matchAll(/^\s*name\s*=\s*"([A-Za-z0-9_-]+)"\s*(?:#.*)?$/gmu)];
  if (names.length !== 1 || /(?:^|\n)\s*(?:workspace|default-run)\s*=/u.test(section('[package]'))) throw new Error('Unsupported Cargo package');
  const library = fields('[lib]', ['path']);
  const binary = fields('[[bin]]', ['name', 'path']);
  if (binary.name !== names[0][1]) throw new Error('Cargo default binary name changed');
  const files = [library.path, binary.path].map(file => {
    if (!relative(file) || !file.endsWith('.rs')) throw new Error('Invalid Cargo source path');
    const full = path.posix.join(path.posix.dirname(cargoManifest), file); read(root, full); return full;
  });
  if (new Set(files).size !== files.length) throw new Error('Duplicate Cargo source');
  return { files, executable: 'cargo', args: ['test', '--manifest-path', cargoManifest] };
}

const uiTarget = 'MediFlowMobileAppUITests';
function swiftSources(root, folder) {
  const files = [];
  function walk(directory) {
    const disk = path.join(root, directory);
    if (!fs.lstatSync(disk).isDirectory() || !fs.realpathSync(disk).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('Invalid Xcode source directory');
    for (const entry of fs.readdirSync(disk, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Xcode source symlink unsupported');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.swift')) { read(root, file); files.push(file); }
    }
  }
  walk(folder); if (!files.length) throw new Error('Empty Xcode UI sources'); return files;
}
export function collectXcodeUiSelection(root) {
  const spec = yaml(root, `${appleProject}/project.yml`);
  if (Object.keys(spec).some(key => !['name', 'options', 'settings', 'packages', 'targets', 'schemes'].includes(key))) throw new Error('Unsupported Xcode spec overlay');
  const target = spec.targets?.[uiTarget];
  const settingsText = JSON.stringify([spec.settings, target?.settings]);
  if (/EXCLUDED_SOURCE_FILE_NAMES|INCLUDED_SOURCE_FILE_NAMES/u.test(settingsText)) throw new Error('Unsupported Xcode source build settings');
  const testAction = spec.schemes?.MediFlowMobileApp?.test;
  if (target?.type !== 'bundle.ui-testing' || target.platform !== 'iOS'
    || Object.keys(target).some(key => !['type', 'platform', 'deploymentTarget', 'sources', 'dependencies', 'settings'].includes(key))
    || !Array.isArray(target.sources) || target.sources.length !== 1
    || Object.keys(target.sources[0]).join(',') !== 'path' || !relative(target.sources[0].path)
    || !testAction || Object.keys(testAction).join(',') !== 'targets'
    || JSON.stringify(testAction.targets) !== JSON.stringify([uiTarget])) throw new Error('Unsupported Xcode UI membership/scheme');
  const files = swiftSources(root, path.posix.join(appleProject, target.sources[0].path));
  const generator = read(root, 'scripts/generate-apple-xcodeproj.sh');
  for (const line of ['set -euo pipefail', 'PROJECT_DIR="$ROOT_DIR/native/MediFlowAppleApp"', '( cd "$PROJECT_DIR" && xcodegen generate --spec project.yml )']) {
    if (generator.split('\n').filter(value => value === line).length !== 1) throw new Error('XcodeGen consumer binding changed');
  }
  const ci = yaml(root, workflow);
  const job = ci.jobs?.['ui-tests'];
  if (job?.if !== "${{ needs.changes.outputs.apple == 'true' && github.event_name != 'pull_request' }}"
    || JSON.stringify(job.strategy?.matrix) !== JSON.stringify({ idiom: ['iPhone', 'iPad'] })) throw new Error('Xcode UI condition/matrix changed');
  const generation = collectLiteralCiBinding(root, { workflow, job: 'ui-tests', ciCall: 'scripts/generate-apple-xcodeproj.sh' });
  const testSteps = job.steps.filter(step => typeof step.run === 'string' && step.run.includes('xcodebuild test'));
  if (testSteps.length !== 1) throw new Error('Expected one Xcode UI invocation');
  const run = testSteps[0].run;
  const lines = run.trim().split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const prefix = ['set -o pipefail', 'only_testing=()', 'if [[ "${{ matrix.idiom }}" == "iPad" ]]; then', 'only_testing=('];
  if (JSON.stringify(lines.slice(0, 4)) !== JSON.stringify(prefix)) throw new Error('Xcode UI filter branch changed');
  const end = lines.indexOf(')', 4);
  const filters = lines.slice(4, end);
  if (end < 5 || new Set(filters).size !== filters.length || filters.some(filter => !/^-only-testing:MediFlowMobileAppUITests\/MediFlowMobileAppUITests\/test[A-Za-z0-9_]+$/u.test(filter))) throw new Error('Unsupported Xcode iPad filters');
  const tail = ['fi', 'xcodebuild test \\', '-project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \\', '-scheme MediFlowMobileApp \\', '-destination "platform=iOS Simulator,id=${{ steps.sim.outputs.id }}" \\', '"${only_testing[@]}" \\', '-retry-tests-on-failure -test-iterations 2 \\', 'CODE_SIGNING_ALLOWED=NO \\', '2>&1 | tee "${RUNNER_TEMP}/xcuitest-${{ matrix.idiom }}.log"'];
  if (JSON.stringify(lines.slice(end + 1)) !== JSON.stringify(tail)) throw new Error('Xcode UI argv changed');
  const binding = collectLiteralCiBinding(root, { workflow, job: 'ui-tests', ciCall: run.trim() });
  if (generation.stepIndex >= binding.stepIndex) throw new Error('XcodeGen must precede UI invocation');
  return { files, errors: [], mode: 'conditional', conditional: true, binding: {
    ...binding, generation, authority: `${appleProject}/project.yml`, target: uiTarget,
    iphone: 'Whole generated scheme test target; method-level skips are not execution evidence',
    ipadOnlyTesting: filters.map(filter => filter.slice('-only-testing:'.length)),
  } };
}
export function collectNativeToolSelections(root) {
  const result = {};
  if (fs.existsSync(path.join(root, cargoManifest))) {
    try { const command = cargoTestCommand(root); result['cargo:boundary:local'] = { files: command.files, errors: [], mode: 'local', binding: { command: [command.executable, ...command.args], prerequisites: 'Rust/Cargo and dependencies; synthetic research, no CI or product qualification' } }; }
    catch (error) { result['cargo:boundary:local'] = { files: [], errors: [error.message], mode: 'local' }; }
  }
  if (fs.existsSync(path.join(root, `${appleProject}/project.yml`))) {
    try { result['xcode:mobile-ui'] = collectXcodeUiSelection(root); }
    catch (error) { result['xcode:mobile-ui'] = { files: [], errors: [error.message], mode: 'conditional', conditional: true }; }
  }
  return result;
}
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--run-cargo') throw new Error('Usage: node scripts/native-tool-test-selection.mjs --run-cargo');
    const command = cargoTestCommand(root);
    assertNodeRuntime(readNodeContract(root));
    const result = spawnSync(command.executable, command.args, { cwd: root, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.signal ? 1 : result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
