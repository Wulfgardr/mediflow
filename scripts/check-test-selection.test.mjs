import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTestSelection, discoverTestFiles, existingListedPaths, readCheckoutSource } from './check-test-selection.mjs';
import { collectNativeToolSelections } from './native-tool-test-selection.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exclusion = (path) => ({ path, reason: 'synthetic helper', owner: '@synthetic' });

test('pending source deletions do not crash discovery and deleted selected tests still fail', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'mediflow-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'retired.command'), 'echo example');
  rmSync(path.join(root, 'retired.command'));
  const discovered = discoverTestFiles(['retired.command', 'removed.test.mjs'], file => readCheckoutSource(root, file));
  assert.deepEqual(discovered, ['removed.test.mjs']);
  assert.ok(checkTestSelection(discovered, {}, []).errors.includes('TEST_NOT_SELECTED: removed.test.mjs'));
});

test('a test is found by its name or by the framework it loads, nothing else is', () => {
  const sources = {
    'lib/a.test.ts': '', 'e2e/b.spec.ts': '', 'native/CoreTests.swift': '',
    'scripts/harness.mjs': "import test from 'node:test';",
    'scripts/build.mjs': "import fs from 'node:fs';",
    'docs/guide.test.md': '', 'public/logo.svg': "from 'node:test'",
  };
  assert.deepEqual(discoverTestFiles(Object.keys(sources), (file) => sources[file]),
    ['docs/guide.test.md', 'e2e/b.spec.ts', 'lib/a.test.ts', 'native/CoreTests.swift', 'scripts/harness.mjs']);
});

test('a new or renamed test that no suite takes fails, and so does a stale or contradicted exclusion', () => {
  const suites = { unit: { files: ['lib/a.test.ts'], errors: [] } };
  const errors = (files, selections = suites, exclusions = []) => checkTestSelection(files, selections, exclusions).errors;
  assert.deepEqual(errors(['lib/a.test.ts']), []);
  assert.deepEqual(errors(['lib/a.test.ts', 'lib/new.test.ts']), ['TEST_NOT_SELECTED: lib/new.test.ts']);
  // Renamed: the suite still names the old path, and nothing takes the new one.
  assert.deepEqual(errors(['lib/renamed.test.ts']), ['TEST_NOT_SELECTED: lib/renamed.test.ts', 'SELECTED_NOT_A_TEST: lib/a.test.ts']);
  assert.deepEqual(errors(['lib/a.test.ts', 'lib/support.ts'], suites, [exclusion('lib/support.ts')]), []);
  assert.deepEqual(errors(['lib/a.test.ts'], suites, [exclusion('lib/gone.ts')]), ['STALE_EXCLUSION: lib/gone.ts']);
  assert.deepEqual(errors(['lib/a.test.ts'], suites, [exclusion('lib/a.test.ts')]), ['EXCLUDED_BUT_SELECTED: lib/a.test.ts']);
  assert.deepEqual(errors(['lib/a.test.ts', 'lib/support.ts'], suites, [{ path: 'lib/support.ts', reason: ' ', owner: '@synthetic' }]),
    ['INVALID_EXCLUSION: "lib/support.ts"', 'TEST_NOT_SELECTED: lib/support.ts']);
});

test('an empty or failing selector fails instead of silently selecting nothing', () => {
  const errors = checkTestSelection([], { empty: { files: [], errors: [] }, broken: { files: [], errors: ['unreadable'] } }, []).errors;
  assert.deepEqual(errors, ['EMPTY_SELECTION: empty', 'INCOMPLETE_SELECTION: broken: unreadable', 'EMPTY_SELECTION: broken']);
});

test('a deleted file still listed by git is not read as a test', () => {
  const present = new Set(['lib/kept.test.ts']);
  assert.deepEqual(existingListedPaths('lib/kept.test.ts\0lib/deleted.test.ts\0', (file) => present.has(file)), ['lib/kept.test.ts']);
});

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const pilot = 'experiments/gpui-patient-pilot';
const pilotWorkflow = '.github/workflows/rust-gpui-pilot.yml';
const pilotFiles = [`${pilot}/client/tests/flow.rs`, `${pilot}/app/src/demo.rs`, `${pilot}/app/src/text_input.rs`];
const pilotTestCall = `cargo test --manifest-path ${pilot}/Cargo.toml --workspace --all-targets --locked`;
function pilotFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'mediflow-cargo-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  for (const file of [pilotWorkflow, ...['Cargo.toml', 'rust-toolchain.toml', 'client/Cargo.toml', 'app/Cargo.toml'].map(file => `${pilot}/${file}`)]) {
    write(file, readFileSync(path.join(sourceRoot, file)));
  }
  for (const file of [...pilotFiles, `${pilot}/client/src/lib.rs`, `${pilot}/Cargo.lock`]) write(file, 'must not execute');
  write(`${pilot}/app/src/main.rs`, '// synthetic binding fixture\nmod demo;\nmod text_input;\nmod theme;\nfn main() {}');
  return root;
}
function changePilot(root, file, before, after) {
  const source = readFileSync(path.join(root, file), 'utf8');
  assert.ok(source.includes(before), `fixture must contain ${before}`);
  writeFileSync(path.join(root, file), source.replace(before, after));
}

test('GPUI test selection binds the explicit Cargo targets to every native CI platform', () => {
  const selection = collectNativeToolSelections(sourceRoot)['cargo:gpui-pilot'];
  assert.deepEqual(selection.errors, []);
  assert.deepEqual(selection.files, pilotFiles);
  assert.equal(selection.conditional, true);
  assert.deepEqual(selection.binding.command, ['cargo', 'test', '--manifest-path', `${pilot}/Cargo.toml`, '--workspace', '--all-targets', '--locked']);
  assert.deepEqual(selection.binding.matrix.os, ['ubuntu-24.04', 'macos-latest', 'windows-latest']);
});

test('GPUI coverage fails closed when Cargo membership, modules or actual CI invocation diverge', t => {
  for (const [file, before, after] of [
    [`${pilot}/Cargo.toml`, 'members = ["client", "app"]', 'members = ["client"]'],
    [`${pilot}/client/Cargo.toml`, 'path = "tests/flow.rs"', 'path = "tests/flow.rs"\nharness = false'],
    [`${pilot}/app/Cargo.toml`, 'path = "src/main.rs"', 'path = "src/main.rs"\ntest = false'],
    [`${pilot}/app/src/main.rs`, 'mod demo;', '#[cfg(feature = "optional")]\nmod demo;'],
    [`${pilot}/app/src/main.rs`, 'mod demo;', '// mod demo;'],
    [pilotWorkflow, pilotTestCall, pilotTestCall.replace('--workspace ', '')],
    [pilotWorkflow, pilotTestCall, pilotTestCall.replace('--all-targets', '--lib')],
    [pilotWorkflow, pilotTestCall, `${pilotTestCall} || true`],
    [pilotWorkflow, "RUSTUP_TOOLCHAIN: '1.98.1'", "RUSTUP_TOOLCHAIN: '1.98.0'"],
    [pilotWorkflow, 'ubuntu-24.04, macos-latest, windows-latest', 'ubuntu-24.04, macos-latest'],
  ]) {
    const root = pilotFixture(t);
    assert.deepEqual(collectNativeToolSelections(root)['cargo:gpui-pilot'].errors, []);
    changePilot(root, file, before, after);
    const selection = collectNativeToolSelections(root)['cargo:gpui-pilot'];
    assert.deepEqual(selection.files, [], `${file}: ${after}`);
    assert.ok(selection.errors.length, `${file}: ${after}`);
  }
});
