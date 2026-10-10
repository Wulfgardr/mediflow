import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectCiDispositionSelections, collectAppleInstallabilityBinding, verifyDispositionConsumer } from './ci-disposition-selection.mjs';
import { collectNpmScriptBinding } from './explicit-npm-test-selection.mjs';
const root = path.resolve(import.meta.dirname, '..');

test('shared group selections have actual ordinary or Apple conditional CI consumers', () => {
  const selections = collectCiDispositionSelections(root);
  assert.equal(Object.keys(selections).length, 9);
  for (const selection of Object.values(selections)) assert.deepEqual(selection.errors, []);
  for (const [id, count] of [['npm:test:inventory-browser', 4], ['npm:test:fixture-generators', 2], ['npm:test:research-boundary', 3], ['npm:test:portable-local', 111], ['npm:test:owned-http', 19], ['npm:test:owned-http-standalone', 1]]) {
    assert.equal(selections[id].mode, 'ordinary');
    assert.equal(selections[id].files.length, count);
    assert.equal(selections[id].binding.jobIf, null);
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
