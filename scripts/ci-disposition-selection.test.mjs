import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { collectCiDispositionSelections, collectAppleInstallabilityBinding, verifyDispositionConsumer } from './ci-disposition-selection.mjs';
import { collectNpmScriptBinding } from './explicit-npm-test-selection.mjs';
const root = path.resolve(import.meta.dirname, '..');

test('canonical prebuild refuses metadata admission before loading dependency verification code', t => {
  const prebuild = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.prebuild;
  const allowed = ['node scripts/build-input-metadata.mjs --source .', 'node scripts/node-runtime-contract.mjs verify'];
  assert.ok(prebuild.split(' && ').every(command => allowed.includes(command)), 'fixture only executes the two fixed build admission commands');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prebuild-admission-order-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.writeFileSync(path.join(temp, 'scripts/build-input-metadata.mjs'), "console.log('SYNTHETIC_METADATA_DENIED'); process.exit(73);\n");
  fs.writeFileSync(path.join(temp, 'scripts/node-runtime-contract.mjs'), "import fs from 'node:fs'; fs.writeFileSync('dependency-code-loaded', 'loaded');\n");
  const result = spawnSync(prebuild, { cwd: temp, shell: true, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  assert.equal(result.status, 73, result.stderr);
  assert.match(result.stdout, /SYNTHETIC_METADATA_DENIED/u);
  assert.equal(fs.existsSync(path.join(temp, 'dependency-code-loaded')), false);
  fs.writeFileSync(path.join(temp, 'scripts/build-input-metadata.mjs'), "console.log('SYNTHETIC_METADATA_ADMITTED');\n");
  const admitted = spawnSync(prebuild, { cwd: temp, shell: true, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.match(admitted.stdout, /SYNTHETIC_METADATA_ADMITTED/u);
  assert.equal(fs.readFileSync(path.join(temp, 'dependency-code-loaded'), 'utf8'), 'loaded');
  assert.deepEqual(prebuild.split(' && '), allowed);
});

test('canonical prebuild reaches the real metadata CLI and denies a synthetic private input before dependency loading', t => {
  const prebuild = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.prebuild;
  assert.equal(prebuild, 'node scripts/build-input-metadata.mjs --source . && node scripts/node-runtime-contract.mjs verify');
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prebuild-real-metadata-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/build-input-metadata.mjs'), path.join(temp, 'scripts/build-input-metadata.mjs'));
  fs.writeFileSync(path.join(temp, 'scripts/node-runtime-contract.mjs'), "import fs from 'node:fs'; fs.writeFileSync('dependency-code-loaded', 'unexpected');\n");
  fs.writeFileSync(path.join(temp, 'synthetic.sqlite-wal'), 'Synthetic build input only.');
  const result = spawnSync(prebuild, { cwd: temp, shell: true, encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MEDIFLOW_DATA_DIR: '' } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Build input metadata: private file is reachable/u);
  assert.equal(fs.existsSync(path.join(temp, 'dependency-code-loaded')), false);
});

test('production builds use complete checkouts and explicitly exercise prebuild', () => {
  for (const [file, job] of [['web-core.yml', 'web-core'], ['e2e.yml', 'e2e-shard'], ['cross-platform.yml', 'build-start'], ['fhir-r4.yml', 'fhir-r4']]) {
    const workflow = loadYaml(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    const jobs = job === 'fhir-r4' ? Object.values(workflow.jobs) : [workflow.jobs[job]];
    for (const entry of jobs) {
      for (const step of entry.steps.filter(step => step.uses?.startsWith('actions/checkout@'))) {
        assert.equal(step.with?.['sparse-checkout'], undefined);
        assert.equal(step.with?.['sparse-checkout-cone-mode'], undefined);
      }
    }
  }
  const web = loadYaml(fs.readFileSync(path.join(root, '.github/workflows/web-core.yml'), 'utf8'));
  assert.ok(web.jobs['web-core'].steps.some(step => step.run === 'npm run prebuild'));
});

test('shared group selections have actual ordinary or Apple conditional CI consumers', () => {
  const selections = collectCiDispositionSelections(root);
  assert.equal(Object.keys(selections).length, 9);
  for (const selection of Object.values(selections)) assert.deepEqual(selection.errors, []);
  for (const [id, count] of [['npm:test:inventory-browser', 5], ['npm:test:fixture-generators', 2], ['npm:test:research-boundary', 3], ['npm:test:portable-local', 121], ['npm:test:owned-http', 20], ['npm:test:owned-http-standalone', 1]]) {
    assert.equal(selections[id].mode, 'ordinary');
    assert.equal(selections[id].files.length, count);
    assert.equal(selections[id].binding.jobIf, null);
  }
  for (const file of ['lib/chatgpt-product/native-fabric-contract.test.cjs', 'lib/chatgpt-product/native-fabric-http.test.cjs', 'lib/chatgpt-product/native-authority-retirement-http.test.cjs', 'lib/chatgpt-product/ordinary-settings-revocation.test.cjs']) {
    assert.ok(selections['npm:test:portable-local'].files.includes(file));
  }
  for (const file of ['lib/chatgpt-product/product-credits.test.ts', 'lib/chatgpt-execution/execution-quota.test.ts', 'lib/chatgpt-execution/quota-view.test.ts', 'lib/chatgpt-product/retained-preparation.test.ts']) {
    assert.equal(selections['npm:test:portable-local'].files.filter(selected => selected === file).length, 1, file);
  }
  assert.deepEqual(selections['ci:apple-native-entrypoint'].files, ['scripts/native-test.sh']);
  assert.equal(selections['ci:apple-native-entrypoint'].mode, 'conditional');
  assert.equal(selections['npm:test:apple-custodian'].mode, 'conditional');
  assert.deepEqual(selections['apple:installability-v0'].files, ['scripts/installability-v0-macos.test.mjs']);
  assert.equal(selections['apple:installability-v0'].mode, 'conditional');
});

test('shared npm CI boundary rejects missing command, disabled step and duplicate invocation', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c14-ci-binding-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, '.github/workflows'), { recursive: true });
  const workflow = '.github/workflows/web-core.yml';
  const script = 'test:fixture-generators';
  const command = 'node scripts/conditional-local-groups.mjs --group fixture-generators';
  const original = fs.readFileSync(path.join(root, workflow), 'utf8');
  const collect = () => collectNpmScriptBinding(temp, { script, workflow, job: 'web-core' }, command);
  const reset = () => {
    fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ scripts: { [script]: command } }));
    fs.writeFileSync(path.join(temp, workflow), original);
  };
  reset(); assert.equal(collect().job, 'web-core');
  for (const change of [
    source => source.replace(`run: npm run ${script}`, 'run: echo not-selected'),
    source => source.replace(`run: npm run ${script}`, `if: false\n        run: npm run ${script}`),
    source => source.replace(`run: npm run ${script}`, `run: npm run ${script}\n      - run: npm run ${script}`),
  ]) {
    reset(); fs.writeFileSync(path.join(temp, workflow), change(original)); assert.throws(collect);
  }
  reset(); fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ scripts: { [script]: 'node other.mjs' } })); assert.throws(collect);
});

test('consumer evidence rejects comment-only and quoted decoys without executing sources', () => {
  const fragment = 'spawn(command.executable, command.args,';
  verifyDispositionConsumer(`${fragment} {});`, [fragment]);
  for (const decoy of [`// ${fragment}`, `/* ${fragment} */`, JSON.stringify(fragment), '`' + fragment + '`']) {
    assert.throws(() => verifyDispositionConsumer(decoy, [fragment]));
  }
  assert.throws(() => verifyDispositionConsumer(`${fragment} {}); ${fragment} {});`, [fragment]));
});

test('installability requires real Apple invocation and unconditional script path activation', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c14-installability-binding-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = '.github/workflows/apple-native.yml';
  fs.mkdirSync(path.join(temp, '.github/workflows'), { recursive: true });
  const original = fs.readFileSync(path.join(root, file), 'utf8');
  const filter = 'scripts/installability-v0-macos.test.mjs | scripts/build-installability-v0-macos.sh | scripts/installability-v0-macos-launcher.sh) apple=true; continue ;;';
  fs.writeFileSync(path.join(temp, file), original);
  assert.equal(collectAppleInstallabilityBinding(temp).runsOn, 'macos-15');
  for (const mutate of [
    value => value.replace(filter, '# ' + filter),
    value => value.replace(filter, filter.replace('scripts/build-installability-v0-macos.sh | ', '')),
    value => value.replace(filter, '').replace('if [ "$EVENT" != push ]; then', 'if [ "$EVENT" != push ]; then\n              case "$f" in\n                ' + filter + '\n              esac'),
    value => value.replace('run: node scripts/local-test-selection.mjs test:installability-v0', 'run: echo not-selected'),
    value => value.replace('run: node scripts/local-test-selection.mjs test:installability-v0', 'if: false\n        run: node scripts/local-test-selection.mjs test:installability-v0'),
    value => value.replace('run: node scripts/local-test-selection.mjs test:installability-v0', 'run: node scripts/local-test-selection.mjs test:installability-v0\n      - run: node scripts/local-test-selection.mjs test:installability-v0'),
  ]) {
    const changed = mutate(original); assert.notEqual(changed, original);
    fs.writeFileSync(path.join(temp, file), changed);
    assert.throws(() => collectAppleInstallabilityBinding(temp));
  }
});
