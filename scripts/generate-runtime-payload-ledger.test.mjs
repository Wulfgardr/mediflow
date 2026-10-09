import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePayloadLedger, verifyPayloadLedger } from './generate-runtime-payload-ledger.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = '@mediflow/web-auth-lifecycle-owner';
function fixture(t, profile = 'local-package') {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-payload-synthetic-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceRoot = path.join(directory, 'source'), payloadRoot = path.join(directory, 'payload');
  fs.mkdirSync(sourceRoot); fs.mkdirSync(payloadRoot);
  function put(root, name, value) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value)}\n`);
  }
  const archivePath = 'packages/web-auth-lifecycle-owner/artifacts/synthetic.tgz';
  // Inert bytes exercise identity logic; the real npm archive is tested separately.
  const archive = Buffer.from('synthetic packed identity; never executed');
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  const metadata = { name: owner, version: '0.0.0-synthetic', private: true, main: 'index.js' };
  const reference = `file:${archivePath}`;
  put(sourceRoot, '.nvmrc', '24\n'); put(sourceRoot, 'LICENSE', 'Synthetic source license evidence\n');
  put(sourceRoot, 'package.json', { name: 'synthetic', version: '0.0.0', engines: { node: '>=24 <25' },
    dependencies: { [owner]: reference }, devDependencies: { 'synthetic-dev': '1.0.0' } });
  put(sourceRoot, 'package-lock.json', { lockfileVersion: 3, packages: {
    '': { name: 'synthetic' }, [`node_modules/${owner}`]: { version: metadata.version, resolved: reference, integrity },
    'node_modules/synthetic-dev': { version: '1.0.0', dev: true, license: 'MIT' },
  } });
  put(sourceRoot, archivePath, archive);
  const sourceFiles = { 'package.json': `${JSON.stringify(metadata)}\n`, 'index.js': 'module.exports = {};\n' };
  const inputs = Object.entries(sourceFiles).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) }));
  for (const [name, bytes] of Object.entries(sourceFiles)) {
    put(sourceRoot, `packages/web-auth-lifecycle-owner/${name}`, bytes); put(payloadRoot, name, bytes);
  }
  put(sourceRoot, archivePath.replace('.tgz', '.provenance.json'), {
    schemaVersion: 'mediflow.web-auth-lifecycle-owner.package-provenance.v1', package: metadata,
    artifact: { path: archivePath, bytes: archive.length, sha256: digest(archive), integrity }, inputs,
    roster: inputs.map(input => ({ ...input, path: `package/${input.path}`, type: 'file', mode: '0644' })),
  });
  execFileSync('git', ['init', '-q'], { cwd: sourceRoot });
  function commit() {
    execFileSync('git', ['add', '.'], { cwd: sourceRoot });
    execFileSync('git', ['-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic fixture'], { cwd: sourceRoot });
  }
  commit();
  const expectedRuntime = { nodeVersion: '24.21.0', nodeAbi: '137', platform: 'linux', arch: 'x64' };
  if (profile === 'standalone') {
    fs.rmSync(payloadRoot, { recursive: true }); fs.mkdirSync(payloadRoot);
    put(payloadRoot, 'package.json', { name: 'synthetic', version: '0.0.0' });
    put(payloadRoot, 'server.js', '// synthetic: never executed\n'); put(payloadRoot, '.next/BUILD_ID', 'synthetic-build\n');
    put(payloadRoot, 'mediflow-runtime-contract.json', { schemaVersion: 1,
      node: { major: 24, version: expectedRuntime.nodeVersion, moduleVersion: expectedRuntime.nodeAbi },
      platform: expectedRuntime.platform, arch: expectedRuntime.arch });
    put(payloadRoot, 'mediflow-build-identity.json', { schemaVersion: 1,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), buildId: 'synthetic-build' });
  }
  return { sourceRoot, payloadRoot, profile, packageName: owner, expectedRuntime, put, commit, directory };
}

test('inventory distinguishes packed closure, locked inputs, missing notices and unknown gates', t => {
  const input = fixture(t), ledger = generatePayloadLedger(input);
  assert.equal(ledger.closure.status, 'SOURCE_PROVENANCE_INSTALLED_BYTES_MATCH');
  assert.equal(ledger.sourceInputAnchoring.status, 'TRACKED_HEAD_BLOBS_MATCH');
  assert.equal(ledger.closure.archiveRosterVerification, 'NOT_CHECKED', 'inert synthetic archive cannot attest archive members');
  assert.equal(ledger.closure.archiveDigestVerification, 'MATCH_TRACKED_PROVENANCE');
  assert.equal(ledger.closure.installedObservedMembership, 'MATCH_TRACKED_PROVENANCE');
  assert.equal(ledger.closure.installedObservedModes, process.platform === 'win32'
    ? 'POSIX_MODES_NOT_QUALIFIED_ON_WINDOWS' : 'MATCH_PROVENANCE_POSIX_PERMISSIONS');
  assert.equal(ledger.payload.files, 2); assert.equal(ledger.packages.length, 1);
  assert.equal(ledger.packages[0].scope, 'direct-runtime');
  assert.equal(ledger.dependencyInputs.dependencies.find(item => item.name === 'synthetic-dev').scope, 'direct-development');
  assert.equal(ledger.absentPackageManifests[0].bundledCodePresence, 'EXCLUDED_DEPENDENCY_FREE_PACKAGE');
  assert.equal(ledger.closure.requiredNotices.declaredPackageLicense, null);
  assert.equal(ledger.checks.advisories, 'NOT_CHECKED');
  assert.equal(ledger.checks.cleanApplicationLockInstall, 'NOT_CHECKED');
  assert.deepEqual(generatePayloadLedger(input), ledger);
  assert.equal(verifyPayloadLedger({ payloadRoot: input.payloadRoot, ledger }).status, 'TRUSTED_ROSTER_BYTES_MATCH');
});

for (const mutation of ['tampered', 'missing', 'extra', 'wrong-package', 'symlink']) {
  test(`local closure rejects ${mutation} installed members without execution`, t => {
    const input = fixture(t), ledger = generatePayloadLedger(input);
    if (mutation === 'tampered') input.put(input.payloadRoot, 'index.js', 'altered\n');
    if (mutation === 'missing') fs.unlinkSync(path.join(input.payloadRoot, 'index.js'));
    if (mutation === 'extra') input.put(input.payloadRoot, 'unexpected.js', 'extra\n');
    if (mutation === 'wrong-package') input.put(input.payloadRoot, 'package.json', { name: 'wrong', version: '0.0.0-synthetic' });
    if (mutation === 'symlink') { fs.unlinkSync(path.join(input.payloadRoot, 'index.js')); fs.symlinkSync(path.join(input.sourceRoot, 'LICENSE'), path.join(input.payloadRoot, 'index.js')); }
    assert.throws(() => generatePayloadLedger(input));
    assert.throws(() => verifyPayloadLedger({ payloadRoot: input.payloadRoot, ledger }));
  });
}

test('source drift and committed source/provenance mismatch reject identity', t => {
  const input = fixture(t);
  input.put(input.sourceRoot, 'packages/web-auth-lifecycle-owner/index.js', 'changed\n');
  assert.throws(() => generatePayloadLedger(input), /pinned (?:commit|blob)/u);
  input.commit();
  assert.throws(() => generatePayloadLedger(input), /source member bytes mismatch/u);
});

test('standalone requires explicit target and preserves bundled-code uncertainty', t => {
  const input = fixture(t, 'standalone'), ledger = generatePayloadLedger(input);
  assert.equal(ledger.closure.buildIdentity, 'REVISION_AND_BUILD_ID_MATCH');
  assert.equal(ledger.closure.nativeAbiExecution, 'NOT_CHECKED');
  assert.equal(ledger.absentPackageManifests[0].bundledCodePresence, 'UNKNOWN');
  assert.throws(() => generatePayloadLedger({ ...input, expectedRuntime: undefined }), /explicit expected/u);
  input.put(input.payloadRoot, 'public/font.woff2', 'synthetic font bytes');
  const withFont = generatePayloadLedger(input);
  assert.equal(withFont.assets[0].rights, 'REVIEW_REQUIRED');
  assert.equal(withFont.assets[0].kind, 'font');
});

for (const [member, value] of [['major', 26], ['version', '24.19.0'], ['moduleVersion', '999'], ['platform', 'win32'], ['arch', 'arm64']]) {
  test(`standalone rejects wrong declared ${member}`, t => {
    const input = fixture(t, 'standalone');
    const file = path.join(input.payloadRoot, 'mediflow-runtime-contract.json');
    const runtime = JSON.parse(fs.readFileSync(file));
    if (['platform', 'arch'].includes(member)) runtime[member] = value; else runtime.node[member] = value;
    input.put(input.payloadRoot, 'mediflow-runtime-contract.json', runtime);
    assert.throws(() => generatePayloadLedger(input), /runtime target identity mismatch/u);
  });
}

test('standalone rejects missing server and stale build identity; comparison detects mode drift', t => {
  const input = fixture(t, 'standalone'), ledger = generatePayloadLedger(input);
  fs.chmodSync(path.join(input.payloadRoot, 'server.js'), 0o755);
  if (process.platform !== 'win32') assert.throws(() => verifyPayloadLedger({ payloadRoot: input.payloadRoot, ledger }), /roster identity/u);
  input.put(input.payloadRoot, 'mediflow-build-identity.json', { schemaVersion: 1, revision: 'stale', buildId: 'synthetic-build' });
  assert.throws(() => generatePayloadLedger(input), /source\/build identity/u);
  fs.unlinkSync(path.join(input.payloadRoot, 'server.js'));
  assert.throws(() => generatePayloadLedger(input), /missing standalone identity member/u);
});

test('CLI emits one external ledger and verification rejects tampered bytes', t => {
  const input = fixture(t), script = fileURLToPath(new URL('./generate-runtime-payload-ledger.mjs', import.meta.url));
  const output = path.join(input.directory, 'ledger.json');
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const args = ['--source', input.sourceRoot, '--payload', input.payloadRoot, '--profile', input.profile, '--package', owner, '--output', output];
  assert.equal(run(args).status, 0);
  assert.equal(run(args).status, 1, 'existing ledger must not be overwritten');
  assert.equal(run(['--source', input.sourceRoot, '--payload', input.payloadRoot, '--verify', output]).status, 0);
  input.put(input.payloadRoot, 'index.js', 'changed\n');
  assert.equal(run(['--source', input.sourceRoot, '--payload', input.payloadRoot, '--verify', output]).status, 1);
});

test('independent regression: ignored source inputs cannot inherit an unrelated clean Git identity', t => {
  const input = fixture(t);
  fs.rmSync(path.join(input.sourceRoot, '.git'), { recursive: true, force: true });
  input.put(input.sourceRoot, 'anchor.txt', 'unrelated committed anchor\n');
  input.put(input.sourceRoot, '.gitignore', '*\n!.gitignore\n!anchor.txt\n');
  execFileSync('git', ['init', '-q'], { cwd: input.sourceRoot });
  input.commit();
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: input.sourceRoot, encoding: 'utf8' }).trim(), '');
  assert.throws(() => generatePayloadLedger(input), /source input is not tracked in the pinned commit/u);
});

for (const name of ['packages/web-auth-lifecycle-owner/index.js', 'packages/web-auth-lifecycle-owner/artifacts/synthetic.provenance.json']) {
  test(`every consumed source input must be anchored: ${name}`, t => {
    const input = fixture(t);
    execFileSync('git', ['rm', '--cached', name], { cwd: input.sourceRoot });
    input.put(input.sourceRoot, '.gitignore', `${name}\n`);
    input.commit();
    assert.throws(() => generatePayloadLedger(input), /source input is not tracked in the pinned commit/u);
  });
}

for (const mode of [0o755, 0o4644]) {
  test(`initial local closure rejects installed mode ${mode.toString(8)} drift`, { skip: process.platform === 'win32' }, t => {
    const input = fixture(t);
    fs.chmodSync(path.join(input.payloadRoot, 'index.js'), mode);
    if ((fs.statSync(path.join(input.payloadRoot, 'index.js')).mode & 0o7777) !== mode) {
      t.skip('filesystem did not preserve the requested POSIX fixture mode');
      return;
    }
    assert.throws(() => generatePayloadLedger(input), /installed member mode mismatch/u);
  });
}
