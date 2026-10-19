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

const gpuiDirectory = 'experiments/gpui-patient-pilot';
const gpuiWorkflow = '.github/workflows/rust-gpui-pilot.yml';
const gpuiPaths = [`${gpuiDirectory}/**`, 'app/fonts/**', 'native/MediFlowMac/Sources/MediFlowAppleShared/Resources/Fonts/**',
  'docs/design/punto-inchiostro/tokens/punto-inchiostro.tokens.json', 'docs/design/lume/tokens/lume.tokens.json',
  'public/brand/mediflow/*.svg', 'native/contracts/crypto-golden-vectors.v3.json', 'app/api/**', 'lib/**', 'drizzle/**',
  'packages/web-auth-lifecycle-owner/**', 'package.json', 'package-lock.json', 'scripts/prepare-e2e-db.mjs',
  'scripts/web-auth-control-test-client.mjs', 'scripts/native-tool-test-selection.mjs', 'scripts/check-test-selection.test.mjs', gpuiWorkflow];
const gpuiTriggers = { pull_request: { paths: gpuiPaths }, push: { branches: ['main'], paths: gpuiPaths }, workflow_dispatch: null };
// Closed, single-line TOML tables for this pilot's explicit Cargo targets. A new
// target/feature/overlay needs a modeled binding before it can select tests.
function gpuiTables(root, file, allowed) {
  const tables = Object.create(null);
  let table;
  for (const raw of read(root, file).split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^(\[\[?[^\]]+\]\]?)\s*(?:#.*)?$/u.exec(line)?.[1];
    if (header) {
      if (!allowed.includes(header) || Object.hasOwn(tables, header)) throw new Error(`Unsupported pilot Cargo table: ${file}: ${header}`);
      table = tables[header] = Object.create(null);
      continue;
    }
    const field = /^([\w.-]+)\s*=\s*(.+)$/u.exec(line);
    if (!table || !field || Object.hasOwn(table, field[1]) || /"""|'''/u.test(field[2])) throw new Error(`Unsupported pilot Cargo field: ${file}`);
    table[field[1]] = field[2].replace(/\s+#.*$/u, '').trim();
  }
  return tables;
}
function exactFields(actual, expected, label) {
  if (!actual || Object.keys(actual).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw new Error(`Pilot Cargo ${label} changed`);
}
export function cargoGpuiPilotTestCommand(root) {
  const manifest = `${gpuiDirectory}/Cargo.toml`;
  const workspace = gpuiTables(root, manifest, ['[workspace]', '[workspace.package]', '[workspace.dependencies]', '[patch.crates-io]', '[profile.dev]', '[profile.release]']);
  exactFields(workspace['[workspace]'], { members: '["client", "transport", "app"]', 'default-members': '["client"]', resolver: '"3"' }, 'workspace membership');
  const toolchain = /^"(\d+\.\d+\.\d+)"$/u.exec(workspace['[workspace.package]']?.['rust-version'])?.[1];
  if (!toolchain) throw new Error('Pilot requires an exact Rust version');
  const rust = gpuiTables(root, `${gpuiDirectory}/rust-toolchain.toml`, ['[toolchain]']);
  exactFields(rust['[toolchain]'], { channel: `"${toolchain}"`, profile: '"minimal"', components: '["rustfmt", "clippy"]' }, 'toolchain');
  const client = gpuiTables(root, `${gpuiDirectory}/client/Cargo.toml`, ['[package]', '[lib]', '[dependencies]', '[dev-dependencies]', '[[test]]']);
  const transport = gpuiTables(root, `${gpuiDirectory}/transport/Cargo.toml`, ['[package]', '[lib]', '[[bin]]', '[dependencies]']);
  const app = gpuiTables(root, `${gpuiDirectory}/app/Cargo.toml`, ['[package]', '[[bin]]', '[dependencies]', '[dev-dependencies]']);
  // Model the actual test-support feature and timezone fixture dependency;
  // accepting this table must not silently accept an optional/disabled harness.
  exactFields(app['[dev-dependencies]'], {
    gpui: '{ workspace = true, features = ["test-support"] }', 'chrono-tz': '"0.10"',
  }, 'app test-support dependencies');
  for (const [tables, name] of [[client, 'mediflow-patient-client'], [transport, 'mediflow-runtime-client'], [app, 'mediflow-gpui-patient-pilot']]) {
    exactFields(tables['[package]'], { name: `"${name}"`, 'version.workspace': 'true', 'edition.workspace': 'true',
      'rust-version.workspace': 'true', 'license.workspace': 'true', 'publish.workspace': 'true' }, 'package');
  }
  exactFields(client['[lib]'], { path: '"src/lib.rs"' }, 'library target');
  exactFields(client['[[test]]'], { name: '"flow"', path: '"tests/flow.rs"' }, 'integration test target');
  exactFields(transport['[lib]'], { path: '"src/lib.rs"' }, 'transport library target');
  exactFields(transport['[[bin]]'], { name: '"mediflow-runtime-probe"', path: '"src/bin/mediflow-runtime-probe.rs"' }, 'transport probe target');
  exactFields(app['[[bin]]'], { name: '"mediflow-gpui-patient-pilot"', path: '"src/main.rs"' }, 'binary test target');
  const main = read(root, `${gpuiDirectory}/app/src/main.rs`).replace(/^(?:\s|\/\/[^\n]*(?:\n|$))*/u, '');
  // These first items cannot be hidden inside a comment, string, cfg or function.
  if (!/^mod appointments;\s*mod clinical_text;\s*mod components;\s*mod demo;\s*mod demo_app;\s*mod documents;\s*mod editing;\s*mod icons;\s*mod navigation;\s*mod patient_forms;\s*mod references;\s*mod shell;\s*mod text_input;\s*mod theme;/u.test(main)) throw new Error('Pilot binary module binding changed');
  const shell = read(root, `${gpuiDirectory}/app/src/shell.rs`).replace(/^(?:\s|\/\/[^\n]*(?:\n|$))*/u, '');
  if (!/^mod ai_preferences;\s*mod ai_status;\s*mod document_details;\s*mod therapy_picker;\s*mod who_lookup;/u.test(shell)) throw new Error('Pilot shell module binding changed');
  const library = read(root, `${gpuiDirectory}/transport/src/lib.rs`).replace(/^(?:\s|\/\/[^\n]*(?:\n|$))*/u, '');
  if (!/^#!\[forbid\(unsafe_code\)\]\s*mod ai_preferences;\s*mod catalogs;\s*mod crypto;\s*mod dto;\s*mod error;\s*mod http;\s*mod profile_query;\s*mod session;\s*mod tls;\s*mod who;/u.test(library)) throw new Error('Pilot transport module binding changed');
  const files = ['client/tests/flow.rs', 'app/src/clinical_text.rs', 'app/src/components.rs', 'app/src/demo.rs', 'app/src/documents.rs', 'app/src/editing.rs', 'app/src/main.rs', 'app/src/navigation.rs', 'app/src/patient_forms.rs', 'app/src/references.rs', 'app/src/shell.rs', 'app/src/shell/ai_preferences.rs', 'app/src/shell/ai_status.rs', 'app/src/shell/document_details.rs', 'app/src/shell/therapy_picker.rs', 'app/src/shell/who_lookup.rs', 'app/src/text_input.rs',
    'transport/src/ai_preferences.rs', 'transport/src/catalogs.rs', 'transport/src/crypto.rs', 'transport/src/http.rs', 'transport/src/profile_query.rs', 'transport/src/session.rs', 'transport/src/who.rs', 'transport/src/bin/mediflow-runtime-probe.rs'].map(file => `${gpuiDirectory}/${file}`);
  for (const file of [...files, `${gpuiDirectory}/client/src/lib.rs`, `${gpuiDirectory}/transport/src/bin/mediflow-runtime-probe.rs`, `${gpuiDirectory}/Cargo.lock`]) read(root, file);
  return { files, executable: 'cargo', args: ['test', '--manifest-path', manifest, '--workspace', '--all-targets', '--locked'], toolchain };
}
export function collectGpuiPilotSelection(root) {
  const command = cargoGpuiPilotTestCommand(root);
  const suite = { workflow: gpuiWorkflow, job: 'native-tests',
    triggers: gpuiTriggers };
  const binding = collectLiteralCiBinding(root, { ...suite, ciCall: [command.executable, ...command.args].join(' ') });
  const install = collectLiteralCiBinding(root, { ...suite, ciCall: `rustup toolchain install ${command.toolchain} --profile minimal --component rustfmt --component clippy` });
  const ci = yaml(root, gpuiWorkflow), job = ci.jobs['native-tests'];
  const env = { ...ci.env, ...job.env, ...job.steps[binding.stepIndex].env };
  if (env.RUSTUP_TOOLCHAIN !== command.toolchain || install.stepIndex >= binding.stepIndex
    || binding.jobIf !== null || binding.stepIf !== null || install.stepIf !== null
    || binding.runsOn !== '${{ matrix.os }}'
    || JSON.stringify(binding.matrix) !== JSON.stringify({ os: ['ubuntu-24.04', 'macos-latest', 'windows-latest'] })) throw new Error('Pilot CI toolchain or platform binding changed');
  return { files: command.files, errors: [], mode: 'conditional', conditional: true,
    binding: { ...binding, command: [command.executable, ...command.args], toolchain: command.toolchain,
      scope: 'Synthetic tests and native target compilation; no UI execution or product qualification' } };
}

export function collectGpuiComparisonSelection(root) {
  const command = `node ${gpuiDirectory}/comparison/run.mjs --rust-probe ${gpuiDirectory}/target/release/mediflow-runtime-probe --output-dir comparison-results --samples 5`;
  const suite = { workflow: gpuiWorkflow, job: 'runtime-comparison', triggers: gpuiTriggers };
  const binding = collectLiteralCiBinding(root, { ...suite, ciCall: command });
  const build = collectLiteralCiBinding(root, { ...suite, ciCall: `cargo build --manifest-path ${gpuiDirectory}/Cargo.toml -p mediflow-runtime-client --bin mediflow-runtime-probe --locked --release` });
  if (binding.jobIf !== null || binding.stepIf !== null || build.stepIf !== null
    || binding.runsOn !== 'ubuntu-24.04' || build.stepIndex >= binding.stepIndex) throw new Error('Runtime comparison CI binding changed');
  const source = read(root, `${gpuiDirectory}/comparison/run.mjs`);
  // These exact children are executed/imported by the versioned orchestrator.
  // An additional test file still fails the repository's discovery inventory.
  const files = ['prepare-runtime.mjs', 'js-client.mjs', 'compare.mjs', 'verify-vectors.mjs'].map(file => `${gpuiDirectory}/comparison/${file}`);
  for (const file of files) read(root, file);
  for (const required of [
    "import { compareReports, compareResourceWritesReports, comparePatientProfileWritesReports } from './compare.mjs';",
    "[path.join(directory, 'verify-vectors.mjs')]",
    "[path.join(directory, 'prepare-runtime.mjs'), 'candidate', privatePath, workspace]",
    "[path.join(directory, 'js-client.mjs'), '--config', configPath]",
    'compareReports(mutationReports.javascript, mutationReports.rust)',
    'compareResourceWritesReports(resourceReports.javascript, resourceReports.rust)',
    'comparePatientProfileWritesReports(profileReports.javascript, profileReports.rust)',
  ]) {
    if (source.split(required).length !== 2) throw new Error('Runtime comparison child binding changed');
  }
  return { files, errors: [], mode: 'conditional', conditional: true, binding: {
    ...binding, build, command, scope: 'Golden vectors and real paired HTTP comparison on an owned synthetic Linux runtime; no GUI qualification',
  } };
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
  if (fs.existsSync(path.join(root, `${gpuiDirectory}/Cargo.toml`))) {
    try { result['cargo:gpui-pilot'] = collectGpuiPilotSelection(root); }
    catch (error) { result['cargo:gpui-pilot'] = { files: [], errors: [error.message], mode: 'conditional', conditional: true }; }
    try { result['http:gpui-comparison'] = collectGpuiComparisonSelection(root); }
    catch (error) { result['http:gpui-comparison'] = { files: [], errors: [error.message], mode: 'conditional', conditional: true }; }
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
