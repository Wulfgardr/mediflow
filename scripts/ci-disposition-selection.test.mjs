import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { collectCiDispositionSelections, collectAppleInstallabilityBinding, verifyDispositionConsumer } from './ci-disposition-selection.mjs';
import { collectNpmScriptBinding } from './explicit-npm-test-selection.mjs';
const root = path.resolve(import.meta.dirname, '..');

test('production sparse checkouts omit one exact file while retaining committed identity and other test sources', t => {
  const checkouts = ['web-core.yml', 'e2e.yml'].map(file => {
    const workflow = loadYaml(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
    const checkout = steps.filter(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.length, 1);
    assert.equal(checkout[0].with['sparse-checkout-cone-mode'], false);
    return checkout[0].with['sparse-checkout'].trim().split('\n');
  });
  assert.deepEqual(checkouts[0], checkouts[1]);
  const patterns = checkouts[0];
  assert.equal(patterns.length, 2); assert.equal(patterns[0], '/*');
  assert.ok(patterns[1].startsWith('!/')); assert.doesNotMatch(patterns[1].slice(2), /[*!?\[\]{}\\]/u);
  const omitted = patterns[1].slice(2);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'production-sparse-source-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const neighboringTest = path.posix.join(path.posix.dirname(omitted), 'synthetic-contract.swift');
  for (const file of [omitted, neighboringTest, 'app/synthetic-source.ts']) {
    fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
    fs.writeFileSync(path.join(temp, file), 'Synthetic sparse checkout fixture only.');
  }
  const git = (...args) => execFileSync('git', args, { cwd: temp, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main'); git('add', '.');
  git('-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic source');
  const identity = git('rev-parse', 'HEAD', 'HEAD^{tree}');
  const tracked = git('ls-files', '--stage');
  execFileSync('git', ['sparse-checkout', 'set', '--no-cone', '--stdin'], { cwd: temp, input: patterns.join('\n') + '\n' });
  assert.equal(fs.existsSync(path.join(temp, omitted)), false);
  assert.equal(fs.existsSync(path.join(temp, neighboringTest)), true);
  assert.equal(fs.existsSync(path.join(temp, 'app/synthetic-source.ts')), true);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  assert.equal(git('rev-parse', 'HEAD', 'HEAD^{tree}'), identity);
  assert.equal(git('ls-files', '--stage'), tracked);
  assert.ok(git('ls-files', '-t', '--', omitted).startsWith('S '));
});

test('shared group selections have actual ordinary or Apple conditional CI consumers', () => {
  const selections = collectCiDispositionSelections(root);
  assert.equal(Object.keys(selections).length, 9);
  for (const selection of Object.values(selections)) assert.deepEqual(selection.errors, []);
  for (const [id, count] of [['npm:test:inventory-browser', 4], ['npm:test:fixture-generators', 2], ['npm:test:research-boundary', 3], ['npm:test:portable-local', 110], ['npm:test:owned-http', 20], ['npm:test:owned-http-standalone', 1]]) {
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
