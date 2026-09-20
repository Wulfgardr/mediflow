/* @Codex — synthetic filesystem tests; public bytes/signatures are not supplied. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { appRoot, assetParts, fixture, installedFixture, runStage, snapshot, syntheticFiles } from './fixtures/mac-packaging-test-support.mjs';
const pass = result => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const deny = result => assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
const action = (input, mode, root) => runStage(input, { args: [`--${mode}`, '--installation-root', root] });

for (const bundle of [false, true]) {
  test(`${bundle ? 'app' : 'standalone'}: explicit staging validates seven pins and is idempotent`, t => {
    const input = fixture(t), app = bundle ? appRoot(input.directory) : null;
    input.installationRoot = app?.web ?? input.installationRoot;
    pass(runStage(input));
    const before = snapshot(input.directory);
    pass(runStage(input)); pass(action(input, 'check', input.installationRoot));
    assert.deepEqual(snapshot(input.directory), before);
    const assets = path.join(input.installationRoot, ...assetParts);
    assert.equal(fs.existsSync(path.join(assets, 'codex')), !bundle);
    assert.deepEqual(fs.readdirSync(assets).sort(), bundle ? ['C1-RECEIPT.json', 'mac-owner.c', 'schema'] : ['C1-RECEIPT.json', 'codex', 'mac-owner.c', 'schema']);
    assert.deepEqual(fs.readFileSync(app?.helper ?? path.join(assets, 'codex')), syntheticFiles.codex);
  });
}
for (const name of Object.keys(syntheticFiles)) {
  test(`altered public input ${name} is rejected before any destination is written`, t => {
    const input = fixture(t), file = path.join(input.source, name), bytes = fs.readFileSync(file);
    bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes);
    const before = snapshot(input.directory);
    deny(runStage(input));
    assert.deepEqual(snapshot(input.directory), before);
    assert.equal(fs.existsSync(path.join(input.installationRoot, 'resources')), false);
  });
}
test('all explicit arguments are mandatory; duplicate/unknown/mode-crossing arguments fail', t => {
  const input = fixture(t);
  for (const args of [[], ['--installation-root', input.installationRoot], ['--check', '--check', '--installation-root', input.installationRoot],
    ['--check', '--relocate-bundle', '--installation-root', input.installationRoot], ['--check', '--installation-root', input.installationRoot, '--binary', input.binary],
    ['--unknown', 'anything'], ['--installation-root', input.installationRoot, '--installation-root', input.installationRoot]]) deny(runStage(input, { args }));
  deny(action(input, 'relocate-bundle', input.installationRoot));
});
test('leaf and ancestor source symlinks are rejected without writes', t => {
  const input = fixture(t), alias = path.join(input.directory, 'source-alias');
  fs.symlinkSync(input.source, alias);
  const before = snapshot(input.directory);
  for (const values of [{ binary: path.join(alias, 'codex') }, { nativeSource: path.join(alias, 'mac-owner.c') },
    { schemaDirectory: path.join(alias, 'schema') }, { c1Receipt: path.join(alias, 'C1-RECEIPT.json') }]) deny(runStage({ ...input, ...values }));
  const fileAlias = path.join(input.directory, 'binary-alias'); fs.symlinkSync(input.binary, fileAlias);
  deny(runStage({ ...input, binary: fileAlias })); fs.rmSync(fileAlias);
  assert.deepEqual(snapshot(input.directory), before);
});
test('destination aliases/escapes and partial prior payloads are not repaired', t => {
  const input = fixture(t), outside = path.join(input.directory, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(input.installationRoot, 'resources'));
  const before = snapshot(input.directory); deny(runStage(input)); assert.deepEqual(snapshot(input.directory), before);
  fs.rmSync(path.join(input.installationRoot, 'resources'));
  fs.mkdirSync(path.join(input.installationRoot, ...assetParts), { recursive: true });
  const partial = snapshot(input.directory); deny(runStage(input)); assert.deepEqual(snapshot(input.directory), partial);
  const alias = path.join(input.directory, 'root-alias'); fs.symlinkSync(input.installationRoot, alias);
  deny(runStage({ ...input, installationRoot: alias }));
  deny(runStage({ ...input, installationRoot: `${input.installationRoot}/../standalone` }));
});
test('altered deployed payload is rejected without overwrite', t => {
  const input = fixture(t); pass(runStage(input));
  fs.writeFileSync(path.join(input.installationRoot, ...assetParts, 'codex'), 'altered');
  const before = snapshot(input.directory); deny(runStage(input)); assert.deepEqual(snapshot(input.directory), before);
});
test('standalone-to-app relocation removes the conflict, preserves all bytes and is idempotent', t => {
  const input = fixture(t); pass(runStage(input));
  const original = snapshot(input.installationRoot), app = appRoot(input.directory);
  fs.cpSync(input.installationRoot, app.web, { recursive: true });
  deny(action(input, 'check', app.web)); // Exact reproduction of the old layout conflict.
  pass(action(input, 'relocate-bundle', app.web));
  assert.equal(fs.existsSync(path.join(app.web, ...assetParts, 'codex')), false);
  assert.deepEqual(fs.readFileSync(app.helper), syntheticFiles.codex);
  const before = snapshot(app.app);
  pass(action(input, 'relocate-bundle', app.web));
  pass(action(input, 'check', app.web));
  assert.deepEqual(snapshot(app.app), before);
  assert.deepEqual(snapshot(input.installationRoot), original);
  // Unsigned incremental copy may contain a second identical codex; reuse the helper without rewriting it.
  fs.copyFileSync(input.binary, path.join(app.web, ...assetParts, 'codex'));
  pass(action(input, 'relocate-bundle', app.web));
  assert.deepEqual(snapshot(app.app), before);
});
test('relocation rejects altered helpers and native symlinks without deleting the original', t => {
  const input = fixture(t); pass(runStage(input));
  const app = appRoot(input.directory); fs.cpSync(input.installationRoot, app.web, { recursive: true });
  const legacy = path.join(app.web, ...assetParts, 'codex');
  fs.mkdirSync(path.dirname(app.helper), { recursive: true });
  fs.writeFileSync(app.helper, 'wrong helper', { mode: 0o755 });
  let before = snapshot(app.app); deny(action(input, 'relocate-bundle', app.web)); assert.deepEqual(snapshot(app.app), before);
  fs.rmSync(app.helper); fs.symlinkSync(input.binary, app.helper);
  before = snapshot(app.app); deny(action(input, 'relocate-bundle', app.web)); assert.deepEqual(snapshot(app.app), before);
  fs.rmSync(app.helper); fs.copyFileSync(input.binary, app.helper);
  assert.deepEqual(fs.readFileSync(legacy), syntheticFiles.codex);
  // Other Helpers belong to other build owners, not this fixed asset resolver.
  const foreign = path.join(path.dirname(app.helper), 'unrelated-helper');
  fs.writeFileSync(foreign, 'untouched other helper');
  pass(action(input, 'relocate-bundle', app.web));
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'untouched other helper');
});
test('sealed bundle: read-only check passes, staging and relocation fail without writes', t => {
  const input = installedFixture(t, true);
  fs.mkdirSync(path.join(input.app.contents, '_CodeSignature'));
  fs.writeFileSync(path.join(input.app.contents, '_CodeSignature/CodeResources'), 'synthetic seal, not a signature');
  const before = snapshot(input.app.app);
  pass(action(input, 'check', input.root));
  deny(action(input, 'relocate-bundle', input.root));
  deny(runStage({ ...input, installationRoot: input.root }));
  assert.deepEqual(snapshot(input.app.app), before);
});
test('real pins cannot stage synthetic public files', t => {
  const input = fixture(t), before = snapshot(input.directory);
  deny(runStage(input, { realPins: true }));
  assert.deepEqual(snapshot(input.directory), before);
});
