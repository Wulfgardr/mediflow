import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { collectLiteralCiBinding } from './explicit-npm-test-selection.mjs';

export const SWIFT_SUITE_ID = 'swiftpm:apple-native';
export const SWIFT_PACKAGE = 'native/MediFlowMac';
const targets = ['MediFlowCoreTests', 'MediFlowAppleSharedTests'];
const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const runnerFunction = `run_swift_tests() {
  echo "Running SwiftPM tests..."
  node "$ROOT_DIR/scripts/swift-test-selection.mjs" --verify
  swift test --package-path "$PACKAGE_DIR"
}`;

function regularFile(root, relative) {
  const filename = path.join(root, relative);
  if (!fs.lstatSync(filename).isFile() || !fs.realpathSync(filename).startsWith(fs.realpathSync(root) + path.sep)) {
    throw new Error(`Invalid Swift source file: ${relative}`);
  }
  return filename;
}

export function collectSwiftTestSources(root) {
  const definition = JSON.parse(fs.readFileSync(regularFile(root, `${SWIFT_PACKAGE}/test-sources.json`), 'utf8'));
  if (!definition || Array.isArray(definition) || Object.keys(definition).sort().join(',') !== [...targets].sort().join(',')) {
    throw new Error('Unexpected Swift test source targets');
  }
  for (const target of targets) {
    const sources = definition[target];
    if (!Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length) {
      throw new Error(`Empty or duplicate Swift test sources: ${target}`);
    }
    for (const source of sources) {
      if (typeof source !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.swift$/u.test(source) || (target === 'MediFlowCoreTests' && source.startsWith('Fixtures/'))) {
        throw new Error(`Invalid Swift test source path: ${target}`);
      }
      regularFile(root, `${SWIFT_PACKAGE}/Tests/${target}/${source}`);
    }
    // SwiftPM formerly discovered these recursively. An added source must never
    // disappear merely because the now-explicit definition was not updated.
    function checkUnregistered(directory, prefix = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        if (target === 'MediFlowCoreTests' && relative === 'Fixtures') continue;
        if (entry.isDirectory()) checkUnregistered(path.join(directory, entry.name), `${relative}/`);
        else if (entry.name.endsWith('.swift') && !sources.includes(relative)) throw new Error(`Unregistered Swift test source: ${target}/${relative}`);
      }
    }
    checkUnregistered(path.join(root, SWIFT_PACKAGE, 'Tests', target));
  }
  return definition;
}

/** Compare official SwiftPM output, never parse Package.swift or import test code. */
export function verifySwiftPackageDescription(root, description, platform = process.platform) {
  const expected = collectSwiftTestSources(root);
  const names = platform === 'darwin' ? targets : ['MediFlowCoreTests'];
  const actual = description?.targets?.filter(target => target.type === 'test');
  if (!Array.isArray(actual) || actual.length !== names.length || new Set(actual.map(target => target.name)).size !== names.length
      || actual.some(target => !names.includes(target.name))) throw new Error('SwiftPM test targets differ from the source definition');
  for (const target of actual) {
    if (target.path !== `Tests/${target.name}` || !Array.isArray(target.sources)
        || target.sources.some(source => typeof source !== 'string')
        || JSON.stringify([...target.sources].sort()) !== JSON.stringify([...expected[target.name]].sort())) {
      throw new Error(`SwiftPM test sources differ: ${target.name}`);
    }
  }
  return actual.reduce((count, target) => count + target.sources.length, 0);
}

export function collectSwiftInventorySelection(root) {
  try {
    const definition = collectSwiftTestSources(root);
    const binding = collectLiteralCiBinding(root, {
      script: SWIFT_SUITE_ID, workflow: '.github/workflows/apple-native.yml', job: 'native-build-test',
      ciCall: 'set -o pipefail\nscripts/native-test.sh 2>&1 | tee "${RUNNER_TEMP}/swiftpm-tests.log"',
    });
    if (binding.runsOn !== 'macos-15' || binding.needs !== 'changes'
        || binding.jobIf !== "${{ needs.changes.outputs.apple == 'true' }}" || binding.stepIf !== null) {
      throw new Error('Conditional Apple SwiftPM CI binding changed');
    }
    const runner = fs.readFileSync(regularFile(root, 'scripts/native-test.sh'), 'utf8');
    if (runner.split(runnerFunction).length !== 2) throw new Error('SwiftPM verified runner function changed');
    return { files: targets.flatMap(target => definition[target].map(source => `${SWIFT_PACKAGE}/Tests/${target}/${source}`)),
      errors: [], binding, conditional: true };
  } catch (error) {
    return { files: [], errors: [error.message], binding: null, conditional: true };
  }
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

if (isCliEntrypoint()) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--verify') throw new Error('Usage: node scripts/swift-test-selection.mjs --verify');
    const output = execFileSync('swift', ['package', '--package-path', path.join(rootDirectory, SWIFT_PACKAGE),
      '--disable-automatic-resolution', 'describe', '--type', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const count = verifySwiftPackageDescription(rootDirectory, JSON.parse(output));
    console.log(`SwiftPM source selection verified: ${count} files (${process.platform}); test execution NOT_ASSESSED`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
