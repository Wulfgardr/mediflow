import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function sourceFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-build-input-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
  for (const name of ['source-runtime.mjs', 'node-runtime-contract.mjs', 'generate-runtime-payload-ledger.mjs',
    'launch-bundled-headless-supervisor.mjs', 'build-input-metadata.mjs']) {
    const source = path.join(repository, 'scripts', name);
    if (fs.existsSync(source)) put(`scripts/${name}`, fs.readFileSync(source));
  }
  put('package.json', '{"name":"synthetic-build-input","engines":{"node":">=24 <25"}}\n');
  put('.nvmrc', '24\n'); put('.gitignore', 'node_modules/\n.next/\nnested/\n');
  const marker = path.join(root, 'compiler-started');
  put('node_modules/next/dist/bin/next', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'compiler started');\n`);
  for (const args of [['init', '--initial-branch=main'], ['add', '.'], ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'synthetic build fixture']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  }
  return { root, put, marker, run: () => spawnSync(process.execPath, [path.join(root, 'scripts/source-runtime.mjs'), 'build', '--webpack'], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }) };
}
for (const [profile, name] of [['source', 'nested/archive.sqlite3-wal'], ['dependencies', 'node_modules/synthetic/archive.DB-SHM'], ['payload', '.next/standalone/nested/archive.db-journal']]) {
  test(`${profile} protected input prevents the real source build entry from spawning its compiler`, t => {
    const f = sourceFixture(t); f.put(name, 'SYNTHETIC PRIVATE SENTINEL\n');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(f.marker), false, result.stderr);
    assert.match(result.stderr, /Build input metadata:/u);
  });
}

const { assertBuildInputMetadata } = await import('./build-input-metadata.mjs');
function metadataFixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-metadata-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceRoot = path.join(directory, 'source'), dependencyRoot = path.join(sourceRoot, 'node_modules'), payloadRoot = path.join(sourceRoot, '.next/standalone');
  for (const p of [sourceRoot, dependencyRoot, payloadRoot]) fs.mkdirSync(p, { recursive: true });
  const put = (file, value = 'SYNTHETIC SENTINEL\n') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
  put(path.join(sourceRoot, 'entry.js'), 'module.exports = 42;\n');
  return { directory, sourceRoot, dependencyRoot, payloadRoot, put, inspect: () => assertBuildInputMetadata({ sourceRoot, dependencyRoot, payloadRoot }) };
}
function withoutContentAccess(f, action) {
  const calls = [], restores = [];
  for (const [owner, methods] of [[fs, ['readFile', 'readFileSync', 'open', 'openSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']], [fs.promises, ['readFile', 'open', 'copyFile', 'cp']]]) {
    for (const method of methods) {
      const original = owner[method];
      owner[method] = function (...args) {
        if (args.some(value => typeof value === 'string' && value.startsWith(f.directory + path.sep))) {
          calls.push(method); throw new Error('Unexpected synthetic content access');
        }
        return original.apply(this, args);
      };
      restores.push(() => { owner[method] = original; });
    }
  }
  try { action(); } finally { for (const restore of restores.reverse()) restore(); }
  assert.deepEqual(calls, [], 'metadata admission must not read, hash or copy any fixture content');
}
for (const profile of ['sourceRoot', 'dependencyRoot', 'payloadRoot']) {
  for (const name of ['nested/archive.DB', 'nested/archive.SQLITE3-WAL', 'nested/archive.db-shm', 'nested/archive.db-journal', 'nested/archive.db-mj1234ABCD', 'patient-data', 'data']) {
    test(`${profile} metadata rejects ${name} without content access`, t => {
      const f = metadataFixture(t), file = path.join(f[profile], name);
      if (['data', 'patient-data'].includes(name)) fs.mkdirSync(file); else f.put(file);
      withoutContentAccess(f, () => assert.throws(f.inspect, /Build input metadata:/u));
    });
  }
  for (const kind of ['symlink', 'ancestor-symlink', 'hardlink', 'special']) {
    test(`${profile} metadata rejects ${kind} before reading an innocent-name alias`, t => {
      if (process.platform === 'win32' && kind !== 'hardlink') { t.skip('POSIX alias/special-file fixture'); return; }
      const f = metadataFixture(t), protectedFile = f.put(path.join(f.directory, 'protected.db'));
      const alias = path.join(f[profile], 'innocent.js');
      if (kind === 'symlink') fs.symlinkSync(protectedFile, alias);
      else if (kind === 'hardlink') fs.linkSync(protectedFile, alias);
      else if (kind === 'ancestor-symlink') fs.symlinkSync(f.directory, path.join(f[profile], 'alias'));
      else assert.equal(spawnSync('mkfifo', [alias]).status, 0);
      withoutContentAccess(f, () => assert.throws(f.inspect, /Build input metadata:/u));
    });
  }
}
test('metadata admits regular source, dependency and payload files and contained explicit npm bin targets', { skip: process.platform === 'win32' && 'POSIX npm bin symlinks; Windows uses regular shims' }, t => {
  const f = metadataFixture(t), bin = path.join(f.dependencyRoot, '.bin');
  f.put(path.join(f.dependencyRoot, 'synthetic/cli.js'), 'module.exports = 1;\n');
  fs.mkdirSync(bin); fs.symlinkSync('../synthetic/cli.js', path.join(bin, 'synthetic'));
  f.put(path.join(f.payloadRoot, 'server.js'), 'module.exports = 2;\n');
  withoutContentAccess(f, () => assert.equal(f.inspect().aliases.length, 1));
});
test('npm bin alias cannot escape or conceal a protected target', { skip: process.platform === 'win32' && 'POSIX npm bin symlinks; Windows uses regular shims' }, t => {
  for (const protectedTarget of [false, true]) {
    const f = metadataFixture(t), bin = path.join(f.dependencyRoot, '.bin'); fs.mkdirSync(bin);
    const target = protectedTarget ? f.put(path.join(f.dependencyRoot, 'synthetic/archive.db')) : f.put(path.join(f.directory, 'outside.js'));
    fs.symlinkSync(target, path.join(bin, 'synthetic'));
    withoutContentAccess(f, () => assert.throws(f.inspect, /Build input metadata:/u));
  }
});
test('payload package alias admits only the explicit physical dependency package root', t => {
  const f = metadataFixture(t);
  f.put(path.join(f.dependencyRoot, 'synthetic/index.js'), 'module.exports = 1;\n');
  fs.mkdirSync(path.join(f.payloadRoot, 'node_modules'));
  fs.symlinkSync(path.join(f.dependencyRoot, 'synthetic'), path.join(f.payloadRoot, 'node_modules/synthetic'), process.platform === 'win32' ? 'junction' : 'dir');
  withoutContentAccess(f, () => assert.equal(f.inspect().aliases.length, 1));
});
test('explicit owned data root is denied even with a name outside the directory conventions', t => {
  const f = metadataFixture(t), data = path.join(f.sourceRoot, 'innocent'); fs.mkdirSync(data);
  withoutContentAccess(f, () => assert.throws(() => assertBuildInputMetadata({ sourceRoot: f.sourceRoot, protectedRoots: [data] }), /data directory/u));
});

test('admitted regular inputs compile twice with real Webpack and trace with real NFT', async t => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
  const f = metadataFixture(t);
  f.put(path.join(f.sourceRoot, 'entry.js'), 'module.exports = require("./regular.js") + 1;\n');
  f.put(path.join(f.sourceRoot, 'regular.js'), 'module.exports = 41;\n');
  withoutContentAccess(f, f.inspect);
  for (const iteration of [1, 2]) {
    const compiler = webpack({ mode: 'production', context: f.sourceRoot, target: 'node', entry: './entry.js',
      optimization: { minimize: false }, output: { path: path.join(f.sourceRoot, `output-${iteration}`), filename: 'bundle.js', library: { type: 'commonjs2' } } });
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    assert.equal(stats.hasErrors(), false, stats.toString());
    const entry = path.join(f.sourceRoot, `output-${iteration}/bundle.js`);
    assert.equal(require(entry), 42);
    f.inspect();
    const trace = await nodeFileTrace([entry], { base: f.sourceRoot, processCwd: f.sourceRoot, mixedModules: true });
    assert.equal(trace.warnings.size, 0);
    assert.ok([...trace.fileList].some(name => name.split(path.sep).join('/') === `output-${iteration}/bundle.js`));
    const copied = path.join(f.directory, `admitted-copy-${iteration}`); fs.mkdirSync(copied);
    for (const name of trace.fileList) {
      const target = path.join(copied, name); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(f.sourceRoot, name), target);
    }
    assert.equal(require(path.join(copied, `output-${iteration}/bundle.js`)), 42);
  }
});

test('dependency hardlink groups must be completely closed, deduplicating npm bin aliases', t => {
  const f = metadataFixture(t), a = f.put(path.join(f.dependencyRoot, 'synthetic/a.js'), 'module.exports = 1;\n');
  fs.linkSync(a, path.join(f.dependencyRoot, 'synthetic/b.js'));
  fs.mkdirSync(path.join(f.dependencyRoot, '.bin'));
  if (process.platform !== 'win32') fs.symlinkSync('../synthetic/a.js', path.join(f.dependencyRoot, '.bin/synthetic'));
  withoutContentAccess(f, () => assert.equal(f.inspect().dependencyHardlinkGroups[0].length, 2));
  fs.linkSync(a, path.join(f.directory, 'unknown-peer.js'));
  withoutContentAccess(f, () => assert.throws(f.inspect, /hardlink group is not closed/u));
});
test('a private peer inside a dependency hardlink group is denied', t => {
  const f = metadataFixture(t), a = f.put(path.join(f.dependencyRoot, 'synthetic/innocent.js'));
  fs.linkSync(a, path.join(f.dependencyRoot, 'synthetic/archive.db'));
  withoutContentAccess(f, () => assert.throws(f.inspect, /private file/u));
});
test('DerivedData default and override are external and an aliased or internal override is rejected', async t => {
  const { macDerivedDataDirectory } = await import('./build-input-metadata.mjs');
  const f = metadataFixture(t), defaultPath = macDerivedDataDirectory(f.sourceRoot, {});
  assert.ok(!defaultPath.startsWith(f.sourceRoot + path.sep));
  assert.equal(defaultPath, macDerivedDataDirectory(f.sourceRoot, {}));
  const external = path.join(f.directory, 'derived');
  assert.equal(macDerivedDataDirectory(f.sourceRoot, { MEDIFLOW_MAC_DERIVED_DATA: external }), external);
  assert.throws(() => macDerivedDataDirectory(f.sourceRoot, { MEDIFLOW_MAC_DERIVED_DATA: path.join(f.sourceRoot, 'derived') }), /outside/u);
  fs.symlinkSync(f.sourceRoot, external, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => macDerivedDataDirectory(f.sourceRoot, { MEDIFLOW_MAC_DERIVED_DATA: external }), /aliased ancestor/u);
});
test('declared sparse production checkout preserves Git identity without materializing the tracked test database', t => {
  const f = metadataFixture(t), fixturePath = 'native/MediFlowMac/Tests/MediFlowCoreTests/Fixtures/medical_fixture.db';
  f.put(path.join(f.sourceRoot, fixturePath));
  const git = (root, args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(f.sourceRoot, ['init', '--initial-branch=main']); git(f.sourceRoot, ['add', '.']);
  git(f.sourceRoot, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'synthetic sparse fixture']);
  const revision = git(f.sourceRoot, ['rev-parse', 'HEAD']);
  assert.throws(f.inspect, /private file/u);
  const clean = path.join(f.directory, 'clean');
  git(f.directory, ['clone', '--no-hardlinks', '--sparse', '--branch', 'main', f.sourceRoot, clean]);
  git(clean, ['sparse-checkout', 'set', '--no-cone', '/*', '!/' + fixturePath]);
  assert.equal(fs.existsSync(path.join(clean, fixturePath)), false);
  assert.equal(git(clean, ['rev-parse', 'HEAD']), revision);
  assert.equal(git(clean, ['branch', '--show-current']), 'main');
  assert.equal(git(clean, ['status', '--porcelain']), '');
  assert.deepEqual(git(clean, ['sparse-checkout', 'list']).split('\n'), ['/*', '!/' + fixturePath]);
  withoutContentAccess(f, () => assertBuildInputMetadata({ sourceRoot: clean }));
});

test('preparation admits contained physical payload targets and materialization makes the final payload strict', { skip: process.platform === 'win32' && 'File symlink creation requires separate Windows privilege' }, async t => {
  const { materializeSourceRuntime } = await import('./source-runtime.mjs');
  const f = metadataFixture(t);
  const file = f.put(path.join(f.payloadRoot, 'regular.js'), 'module.exports = 1;\n');
  const directory = path.join(f.payloadRoot, 'members'); f.put(path.join(directory, 'regular.js'), 'module.exports = 2;\n');
  fs.symlinkSync(file, path.join(f.payloadRoot, 'file-alias.js'));
  fs.symlinkSync(directory, path.join(f.payloadRoot, 'directory-alias'));
  withoutContentAccess(f, () => assert.equal(f.inspect().aliases.length, 2));
  assert.throws(() => assertBuildInputMetadata({ sourceRoot: f.sourceRoot, payloadRoot: f.payloadRoot, allowPayloadAliases: false }), /materialized payload contains an alias/u);
  materializeSourceRuntime(f.payloadRoot, f.sourceRoot);
  withoutContentAccess(f, () => assert.equal(assertBuildInputMetadata({ sourceRoot: f.sourceRoot, payloadRoot: f.payloadRoot, allowPayloadAliases: false }).aliases.length, 0));
});
test('a contained payload directory cycle is rejected before materialization or content access', t => {
  const f = metadataFixture(t); fs.symlinkSync(f.payloadRoot, path.join(f.payloadRoot, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  withoutContentAccess(f, () => assert.throws(f.inspect, /cyclic payload alias/u));
});

test('contained directory aliases pass preparation and become physical on every supported platform', async t => {
  const { materializeSourceRuntime } = await import('./source-runtime.mjs');
  const f = metadataFixture(t), target = path.join(f.payloadRoot, 'members');
  f.put(path.join(target, 'regular.js'), 'module.exports = 1;\n');
  fs.symlinkSync(target, path.join(f.payloadRoot, 'directory-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  withoutContentAccess(f, () => assert.equal(f.inspect().aliases.length, 1));
  materializeSourceRuntime(f.payloadRoot, f.sourceRoot);
  withoutContentAccess(f, () => assert.equal(assertBuildInputMetadata({ sourceRoot: f.sourceRoot, payloadRoot: f.payloadRoot, allowPayloadAliases: false }).aliases.length, 0));
});
