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
const pilotFiles = ['client/tests/flow.rs', 'app/src/chat_access/owner.rs', 'app/src/clinical_text.rs', 'app/src/components.rs', 'app/src/demo.rs', 'app/src/documents.rs', 'app/src/editing.rs', 'app/src/main.rs', 'app/src/native_lock.rs', 'app/src/navigation.rs', 'app/src/patient_forms.rs', 'app/src/references.rs', 'app/src/shell.rs', 'app/src/shell/account_profile.rs', 'app/src/shell/agenda_flow.rs', 'app/src/shell/ambulatories.rs', 'app/src/shell/ai_preferences.rs', 'app/src/shell/ai_status.rs', 'app/src/shell/analytics.rs', 'app/src/shell/chat_access.rs', 'app/src/shell/document_details.rs', 'app/src/shell/local_preferences.rs', 'app/src/shell/local_settings.rs', 'app/src/shell/notes_recovery_tests.rs', 'app/src/shell/rendered_command.rs', 'app/src/shell/scales.rs', 'app/src/shell/therapy_picker.rs', 'app/src/shell/view_state.rs', 'app/src/shell/who_lookup.rs', 'app/src/text_input.rs', 'app/src/theme.rs',
  'transport/src/account_profile.rs', 'transport/src/ambulatories.rs', 'transport/src/ambulatory_command_recovery.rs', 'transport/src/ambulatory_command_transport.rs', 'transport/src/ambulatory_commands.rs', 'transport/src/ai_preferences.rs', 'transport/src/analytics.rs', 'transport/src/catalogs.rs', 'transport/src/context.rs', 'transport/src/crypto.rs', 'transport/src/http.rs', 'transport/src/ports.rs', 'transport/src/profile_query.rs', 'transport/src/scales.rs', 'transport/src/session.rs', 'transport/src/who.rs', 'transport/src/bin/mediflow-runtime-probe.rs'].map(file => `${pilot}/${file}`);
const pilotTestCall = `cargo test --manifest-path ${pilot}/Cargo.toml --workspace --all-targets --locked`;
function pilotFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'mediflow-cargo-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  for (const file of [pilotWorkflow, ...['Cargo.toml', 'rust-toolchain.toml', 'client/Cargo.toml', 'transport/Cargo.toml', 'app/Cargo.toml'].map(file => `${pilot}/${file}`)]) {
    write(file, readFileSync(path.join(sourceRoot, file)));
  }
  for (const file of [...pilotFiles, `${pilot}/app/src/shell/threshold_actions.rs`, `${pilot}/app/src/shell/ambulatory_commands.rs`, `${pilot}/client/src/lib.rs`, `${pilot}/transport/src/bin/mediflow-runtime-probe.rs`, `${pilot}/Cargo.lock`]) write(file, 'must not execute');
  write(`${pilot}/app/src/main.rs`, '// synthetic binding fixture\nmod appointments;\n#[cfg(unix)]\nmod chat_access;\nmod clinical_text;\nmod components;\nmod demo;\nmod demo_app;\nmod documents;\nmod editing;\nmod icons;\nmod native_lock;\nmod navigation;\nmod patient_forms;\nmod references;\nmod shell;\nmod text_input;\nmod theme;\nfn main() {}');
  write(`${pilot}/app/src/shell.rs`, '//! Synthetic shell binding fixture\nmod account_profile;\nmod agenda_flow;\nmod ai_preferences;\nmod ai_status;\nmod ambulatories;\nmod ambulatory_commands;\nmod analytics;\n#[cfg(unix)]\nmod chat_access;\nmod document_details;\npub(crate) mod local_preferences;\nmod local_settings;\n#[cfg(test)]\nmod notes_recovery_tests;\n#[cfg(test)]\npub(crate) mod rendered_command;\nmod scales;\nmod therapy_picker;\nmod threshold_actions;\nmod view_state;\nmod who_lookup;');
  write(`${pilot}/transport/src/lib.rs`, '//! Synthetic library binding fixture\n#![forbid(unsafe_code)]\nmod account_profile;\nmod ai_preferences;\nmod ambulatories;\nmod ambulatory_command_recovery;\nmod ambulatory_command_transport;\nmod ambulatory_commands;\nmod analytics;\nmod catalogs;\nmod context;\nmod crypto;\nmod dto;\nmod error;\nmod http;\nmod ports;\nmod profile_query;\nmod scales;\nmod session;\nmod tls;\nmod who;');
  for (const file of ['run.mjs', 'prepare-runtime.mjs', 'js-client.mjs', 'compare.mjs', 'verify-vectors.mjs']) {
    write(`${pilot}/comparison/${file}`, readFileSync(path.join(sourceRoot, pilot, 'comparison', file)));
  }
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

test('GPUI bundle tests bind to CI and reject a removed, masked or conditional invocation', t => {
  const key = 'python:gpui-bundle';
  const call = `python3 -m unittest discover -s ${pilot}/scripts -p 'test_bundle_macos.py'`;
  const selected = collectNativeToolSelections(sourceRoot)[key];
  assert.deepEqual(selected.errors, []);
  assert.deepEqual(selected.files, [`${pilot}/scripts/test_bundle_macos.py`]);
  for (const [before, replacement] of [[call, 'echo skipped'], [call, `${call} || true`], [`if: runner.os == 'Linux'\n        run: ${call}`, `if: false\n        run: ${call}`]]) {
    const root = pilotFixture(t);
    const file = `${pilot}/scripts/test_bundle_macos.py`;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), 'import unittest');
    assert.deepEqual(collectNativeToolSelections(root)[key].errors, []);
    changePilot(root, pilotWorkflow, before, replacement);
    const selection = collectNativeToolSelections(root)[key];
    assert.ok(selection.errors.length);
    assert.deepEqual(selection.files, []);
  }
});

test('GPUI runtime comparison binds all adapters and preparer to the actual CI command', t => {
  const selection = collectNativeToolSelections(sourceRoot)['http:gpui-comparison'];
  assert.deepEqual(selection.errors, []);
  assert.deepEqual(selection.files, ['prepare-runtime.mjs', 'js-client.mjs', 'compare.mjs', 'verify-vectors.mjs'].map(file => `${pilot}/comparison/${file}`));
  for (const [file, before, after] of [
    [pilotWorkflow, '--output-dir comparison-results --samples 5', '--output-dir comparison-results --samples 5 || true'],
    [`${pilot}/comparison/run.mjs`, "[path.join(directory, 'prepare-runtime.mjs'), 'candidate', privatePath, workspace]", "['not-the-preparer.mjs']"],
    [`${pilot}/comparison/run.mjs`, 'compareReports(mutationReports.javascript, mutationReports.rust)', 'compareReports({}, {})'],
    [ `${pilot}/comparison/run.mjs`, 'compareResourceWritesReports(resourceReports.javascript, resourceReports.rust)', 'compareResourceWritesReports({}, {})'],
    [ `${pilot}/comparison/run.mjs`, 'comparePatientProfileWritesReports(profileReports.javascript, profileReports.rust)', 'comparePatientProfileWritesReports({}, {})'],
  ]) {
    const root = pilotFixture(t);
    assert.deepEqual(collectNativeToolSelections(root)['http:gpui-comparison'].errors, []);
    changePilot(root, file, before, after);
    assert.ok(collectNativeToolSelections(root)['http:gpui-comparison'].errors.length);
  }
});

test('GPUI coverage fails closed when Cargo membership, modules or actual CI invocation diverge', t => {
  for (const [file, before, after] of [
    [`${pilot}/Cargo.toml`, 'members = ["client", "transport", "app"]', 'members = ["client", "app"]'],
    [`${pilot}/client/Cargo.toml`, 'path = "tests/flow.rs"', 'path = "tests/flow.rs"\nharness = false'],
    [`${pilot}/app/Cargo.toml`, 'path = "src/main.rs"', 'path = "src/main.rs"\ntest = false'],
    [`${pilot}/app/src/main.rs`, 'mod demo;', '#[cfg(feature = "optional")]\nmod demo;'],
    [`${pilot}/app/src/main.rs`, 'mod demo;', '// mod demo;'],
    [`${pilot}/app/src/shell.rs`, 'mod scales;', 'mod unbound_probe;\nmod scales;'],
    [`${pilot}/app/src/shell.rs`, '#[cfg(test)]\npub(crate) mod rendered_command;', 'mod rendered_command;'],
    [`${pilot}/app/src/shell.rs`, 'mod threshold_actions;', '// mod threshold_actions;'],
    [`${pilot}/app/src/shell.rs`, 'mod therapy_picker;', '// mod therapy_picker;'],
    [`${pilot}/app/src/shell.rs`, 'mod therapy_picker;', '#[cfg(feature = "optional")]\nmod therapy_picker;'],
    ...['app/src/shell.rs', 'transport/src/lib.rs'].flatMap(file => [
      [`${pilot}/${file}`, 'mod ambulatories;', '// mod ambulatories;'],
      [`${pilot}/${file}`, 'mod ambulatories;', '#[cfg(feature = "optional")]\nmod ambulatories;'],
    ]),
    [`${pilot}/app/src/shell.rs`, 'mod ai_preferences;', '// mod ai_preferences;'],
    [`${pilot}/app/src/shell.rs`, 'mod ai_preferences;', '#[cfg(feature = "optional")]\nmod ai_preferences;'],
    [`${pilot}/transport/src/lib.rs`, 'mod ai_preferences;', '// mod ai_preferences;'],
    [`${pilot}/transport/src/lib.rs`, 'mod ai_preferences;', '#[cfg(feature = "optional")]\nmod ai_preferences;'],
    [`${pilot}/app/src/shell.rs`, 'mod ai_status;', '// mod ai_status;'],
    [`${pilot}/app/src/shell.rs`, 'mod ai_status;', '#[cfg(feature = "optional")]\nmod ai_status;'],
    [`${pilot}/app/src/shell.rs`, 'mod analytics;', '// mod analytics;'],
    [`${pilot}/app/src/shell.rs`, 'mod analytics;', '#[cfg(feature = "optional")]\nmod analytics;'],
    [`${pilot}/app/src/shell.rs`, 'mod document_details;', '// mod document_details;'],
    [`${pilot}/app/src/shell.rs`, 'pub(crate) mod local_preferences;', '// pub(crate) mod local_preferences;'],
    [`${pilot}/app/src/shell.rs`, 'pub(crate) mod local_preferences;', '#[cfg(feature = "optional")]\npub(crate) mod local_preferences;'],
    [`${pilot}/app/src/shell.rs`, 'mod local_settings;', '// mod local_settings;'],
    [`${pilot}/app/src/shell.rs`, 'mod local_settings;', '#[cfg(feature = "optional")]\nmod local_settings;'],
    [`${pilot}/app/src/shell.rs`, 'mod scales;', '// mod scales;'],
    [`${pilot}/app/src/shell.rs`, 'mod scales;', '#[cfg(feature = "optional")]\nmod scales;'],
    [`${pilot}/app/src/shell.rs`, 'mod document_details;', '#[cfg(feature = "optional")]\nmod document_details;'],
    [`${pilot}/app/src/shell.rs`, 'mod view_state;', '// mod view_state;'],
    [`${pilot}/app/src/shell.rs`, 'mod view_state;', '#[cfg(feature = "optional")]\nmod view_state;'],
    [`${pilot}/app/src/shell.rs`, 'mod who_lookup;', '// mod who_lookup;'],
    [`${pilot}/app/src/shell.rs`, 'mod who_lookup;', '#[cfg(feature = "optional")]\nmod who_lookup;'],
    [`${pilot}/transport/src/lib.rs`, 'mod session;', '#[cfg(feature = "optional")]\nmod session;'],
    [`${pilot}/transport/src/lib.rs`, 'mod profile_query;', '// mod profile_query;'],
    [`${pilot}/transport/src/lib.rs`, 'mod analytics;', '// mod analytics;'],
    [`${pilot}/transport/src/lib.rs`, 'mod analytics;', '#[cfg(feature = "optional")]\nmod analytics;'],
    [`${pilot}/transport/src/lib.rs`, 'mod scales;', '// mod scales;'],
    [`${pilot}/transport/src/lib.rs`, 'mod scales;', '#[cfg(feature = "optional")]\nmod scales;'],
    [`${pilot}/transport/src/lib.rs`, 'mod profile_query;', '#[cfg(feature = "optional")]\nmod profile_query;'],
    [`${pilot}/transport/src/lib.rs`, 'mod who;', '// mod who;'],
    [`${pilot}/transport/src/lib.rs`, 'mod who;', '#[cfg(feature = "optional")]\nmod who;'],
    [`${pilot}/transport/Cargo.toml`, 'path = "src/lib.rs"', 'path = "src/lib.rs"\ntest = false'],
    ...[['app/src/main.rs', 'native_lock'], ['app/src/shell.rs', 'ambulatory_commands'],
      ...['ambulatory_command_recovery', 'ambulatory_command_transport', 'ambulatory_commands'].map(name => ['transport/src/lib.rs', name])]
      .flatMap(([file, name]) => [
        [`${pilot}/${file}`, `mod ${name};`, `// mod ${name};`],
        [`${pilot}/${file}`, `mod ${name};`, `#[cfg(feature = "optional")]\nmod ${name};`],
      ]),
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

test('GPUI test-support binding rejects missing, conditional, duplicate or disabled support', async t => {
  const manifest = `${pilot}/app/Cargo.toml`;
  const main = `${pilot}/app/src/main.rs`;
  const support = 'gpui = { workspace = true, features = ["test-support"] }';
  for (const [name, file, before, after] of [
    ['missing dev table', manifest, '[dev-dependencies]', '# [dev-dependencies]'],
    ['missing GPUI test support', manifest, support, 'gpui.workspace = true'],
    ['empty feature set', manifest, support, 'gpui = { workspace = true, features = [] }'],
    ['optional test support', manifest, support, 'gpui = { workspace = true, features = ["test-support"], optional = true }'],
    ['different dependency source', manifest, support, 'gpui = { path = "../unbound", features = ["test-support"] }'],
    ['different timezone support', manifest, 'chrono-tz = "0.10"', 'chrono-tz = "0.9"'],
    ['duplicate dev table', manifest, '[dev-dependencies]', '[dev-dependencies]\n[dev-dependencies]'],
    ['duplicate support field', manifest, support, `${support}\n${support}`],
    ['conditional dependency table', manifest, '[dev-dependencies]', '[target.\'cfg(unix)\'.dev-dependencies]'],
    ['unsupported feature overlay', manifest, support, `${support}\n[features]\noptional-tests = []`],
    ['disabled binary harness', manifest, 'path = "src/main.rs"', 'path = "src/main.rs"\nharness = false'],
    ['feature-gated binary target', manifest, 'path = "src/main.rs"', 'path = "src/main.rs"\nrequired-features = ["optional-tests"]'],
    ['missing appointment module', main, 'mod appointments;', '// mod appointments;'],
    ['conditional appointment module', main, 'mod appointments;', '#[cfg(feature = "optional")]\nmod appointments;'],
    ['conditional clinical test module', main, 'mod clinical_text;', '#[cfg(feature = "optional")]\nmod clinical_text;'],
  ]) {
    await t.test(name, child => {
      const root = pilotFixture(child);
      assert.deepEqual(collectNativeToolSelections(root)['cargo:gpui-pilot'].errors, []);
      changePilot(root, file, before, after);
      const selection = collectNativeToolSelections(root)['cargo:gpui-pilot'];
      assert.deepEqual(selection.files, [], name);
      assert.ok(selection.errors.length, name);
    });
  }
});
