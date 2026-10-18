/* real integrity/argument guard over a synthetic app layout. These are
 * NOT positive Supervisor/MCP smoke tests. The real smoke is the existing
 * mediflow-headless-supervisor-standalone-smoke.mjs --app <extracted.app>. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { physicalRecord, physicalFiles, sha256 } from './launch-bundled-headless-supervisor.mjs';
import { appLayout, checkHeadlessRuntime, headlessTraceReadPath, privateDatabaseDependency, sharedRuntimeDependency, traceSourceText } from './stage-headless-runtime.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const template = fs.readFileSync(new URL('./launch-bundled-headless-supervisor.mjs', import.meta.url), 'utf8');
const nodeRecord = physicalRecord(process.execPath);
const base = '62fc9a4e9170405c724b916993a39858ccabce35';
function write(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { mode }); return file;
}
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-headless-guard-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'Extracted app', 'MediFlow.app');
  const contents = path.join(app, 'Contents'), resources = path.join(contents, 'Resources');
  const web = path.join(resources, 'WebRuntime'), runtime = path.join(web, 'HeadlessRuntime');
  const launcher = path.join(resources, 'mediflow-headless-supervisor.mjs');
  const rosterFile = path.join(runtime, 'headless-roster.json');
  const identity = { schemaVersion: 1, revision: base.slice(0, 12), branch: 'main', worktreeHash: 'synthetic',
    sourceFingerprint: `main@${base.slice(0, 12)}:synthetic`, buildId: 'synthetic-headless-guard-only' };
  const node = { major: 24, version: process.versions.node, moduleVersion: process.versions.modules,
    platform: process.platform, arch: process.arch, ...nodeRecord };
  const contract = { schemaVersion: 1, node: { major: node.major, version: node.version, moduleVersion: node.moduleVersion },
    platform: node.platform, arch: node.arch, betterSqlite3Version: 'guard-only-no-binding' };
  write(path.join(web, 'mediflow-build-identity.json'), JSON.stringify(identity));
  write(path.join(web, 'mediflow-runtime-contract.json'), JSON.stringify(contract));
  write(path.join(web, '.next/BUILD_ID'), identity.buildId);
  write(path.join(web, '.next/required-server-files.json'), '{"config":{}}');
  write(path.join(web, 'server.js'), '// Layout only, not a server and never executed.\n');
  write(path.join(web, 'package.json'), '{}\n');
  write(path.join(runtime, '.nvmrc'), '24\n');
  for (const name of ['package.json', 'scripts/mediflow-headless-supervisor.mjs', 'scripts/intelligent-host-mcp-stdio.mjs',
    'scripts/node-runtime-contract.mjs', 'scripts/register-strip-types-loader.mjs', 'scripts/headless-web-server.mjs', 'lib/security/portable-supervisor-production.ts']) {
    write(path.join(runtime, name), fs.readFileSync(path.join(ROOT, name)));
  }
  write(path.join(runtime, 'scripts/headless-source-loader.mjs'), fs.readFileSync(path.join(ROOT, 'scripts/register-strip-types-loader.mjs')));
  const roster = { schemaVersion: 1, mode: 'mcp', node, identity, files: physicalFiles(contents)
    .map(name => ({ path: name, ...physicalRecord(path.join(contents, name)) })) };
  const commit = () => {
    const bytes = JSON.stringify(roster) + '\n'; write(rosterFile, bytes);
    write(launcher, template.replace('__MEDIFLOW_HEADLESS_ROSTER_SHA256__', sha256(bytes)));
  };
  commit();
  const repinFile = name => {
    const entry = roster.files.find(item => item.path === name);
    Object.assign(entry, physicalRecord(path.join(contents, name))); commit();
  };
  const run = (args = [], extra = {}) => spawnSync(process.execPath, [launcher, ...args], {
    cwd: directory, encoding: 'utf8', env: {}, timeout: 10_000, ...extra,
  });
  const verify = () => checkHeadlessRuntime(app);
  return { app, contents, web, runtime, launcher, rosterFile, roster, directory, run, verify, commit, repinFile };
}
function denied(result) {
  assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'MediFlow bundled Headless launcher failed closed.\n');
}
test('physical extracted layout passes the real guard (not runtime smoke)', async t => {
  const f = fixture(t), before = physicalFiles(f.contents).map(name => [name, physicalRecord(path.join(f.contents, name))]);
  await f.verify();
  assert.deepEqual(physicalFiles(f.contents).map(name => [name, physicalRecord(path.join(f.contents, name))]), before);
});
test('launcher supplies the verified bundle identity to Supervisor composition despite forged caller identity', t => {
  const f = fixture(t), dataDir = path.join(f.directory, 'synthetic-data');
  fs.mkdirSync(dataDir);
  const supervisor = 'Resources/WebRuntime/HeadlessRuntime/scripts/mediflow-headless-supervisor.mjs';
  write(path.join(f.contents, supervisor), `export async function runHeadlessSupervisorV1(options) {
    process.stdout.write(JSON.stringify({ options, revision: process.env.MEDIFLOW_APP_REVISION,
      sourceFingerprint: process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT }));
  }\n`);
  f.repinFile(supervisor);
  const loader = 'Resources/WebRuntime/HeadlessRuntime/scripts/headless-source-loader.mjs';
  write(path.join(f.contents, loader), 'export {};\n'); f.repinFile(loader);
  const result = f.run([], { env: { MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_APP_REVISION: 'forged-revision',
    MEDIFLOW_APP_BRANCH: 'forged-branch', MEDIFLOW_APP_WORKTREE_HASH: 'forged-worktree',
    MEDIFLOW_APP_SOURCE_FINGERPRINT: 'forged-fingerprint', MEDIFLOW_APP_FINGERPRINT: 'forged-fingerprint' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    options: { webDirectory: f.web, webTargetPath: path.join(f.web, 'server.js'), webBuildIdentity: f.roster.identity },
    revision: f.roster.identity.revision, sourceFingerprint: f.roster.identity.sourceFingerprint,
  });
});
for (const args of [['--mini'], ['--mcp', 'extra'], ['--app', '/tmp/elsewhere'], ['--check'], ['--mcp', '--mini']]) {
  test(`MCP-only CLI rejects ${args.join(' ')}`, t => { denied(fixture(t).run(args)); });
}
for (const [label, mutate] of [
  ['roster bytes without new commitment', f => fs.appendFileSync(f.rosterFile, ' ')],
  ['source digest', f => fs.appendFileSync(path.join(f.runtime, 'lib/security/portable-supervisor-production.ts'), '\n')],
  ['extra file', f => write(path.join(f.runtime, 'node_modules/rogue/index.js'), '// injection\n')],
  ['empty extra directory', f => fs.mkdirSync(path.join(f.runtime, 'rogue'))],
  ['missing file', f => fs.unlinkSync(path.join(f.runtime, 'scripts/intelligent-host-mcp-stdio.mjs'))],
  ['mode substitution', f => fs.chmodSync(path.join(f.runtime, 'package.json'), 0o755)],
  ['roster mode', f => fs.chmodSync(f.rosterFile, 0o755)],
  ['launcher mode', f => fs.chmodSync(f.launcher, 0o755)],
  ['shared Web config digest', f => fs.appendFileSync(path.join(f.web, '.next/required-server-files.json'), '\n')],
  ['headless Web bootstrap digest', f => fs.appendFileSync(path.join(f.runtime, 'scripts/headless-web-server.mjs'), '\n')],
  ['shared Web digest', f => fs.appendFileSync(path.join(f.web, 'server.js'), '\n')],
  ['wrong revision with valid digest', f => {
    const name = 'Resources/WebRuntime/mediflow-build-identity.json';
    const file = path.join(f.contents, name), identity = JSON.parse(fs.readFileSync(file));
    identity.revision = 'a'.repeat(40); fs.writeFileSync(file, JSON.stringify(identity)); f.repinFile(name);
  }],
  ['duplicate roster entry', f => { f.roster.files.push(f.roster.files[0]); f.commit(); }],
  ['roster traversal', f => { f.roster.files[0].path = '../outside'; f.commit(); }],
  ['roster alias', f => { f.roster.files[0].path = 'Resources//WebRuntime/server.js'; f.commit(); }],
  ['absolute roster path', f => { f.roster.files[0].path = '/tmp/outside'; f.commit(); }],
  ['Mini roster', f => { f.roster.mode = 'mini'; f.commit(); }],
  ['Node major mismatch', f => { f.roster.node.major = 25; f.commit(); }],
  ['Node ABI mismatch', f => { f.roster.node.moduleVersion = '0'; f.commit(); }],
  ['Node executable digest mismatch', f => { f.roster.node.sha256 = '0'.repeat(64); f.commit(); }],
  ['Node platform mismatch', f => { f.roster.node.platform = 'foreign'; f.commit(); }],
]) test(`guard rejects ${label}`, async t => { const f = fixture(t); mutate(f); await assert.rejects(f.verify()); });

test('guard rejects a symlinked payload and a symlinked ancestor', async t => {
  const f = fixture(t), target = path.join(f.runtime, 'scripts/intelligent-host-mcp-stdio.mjs');
  const held = path.join(f.directory, 'held.mjs'); fs.renameSync(target, held); fs.symlinkSync(held, target);
  await assert.rejects(f.verify());
  fs.unlinkSync(target); fs.renameSync(held, target);
  const scripts = path.join(f.runtime, 'scripts'), outside = path.join(f.directory, 'scripts');
  fs.renameSync(scripts, outside); fs.symlinkSync(outside, scripts); await assert.rejects(f.verify());
});
test('CLI recognizes an aliased invocation and denies, rather than silently exiting zero', t => {
  const f = fixture(t), alias = path.join(f.directory, 'alias.app'); fs.symlinkSync(f.app, alias);
  denied(spawnSync(process.execPath, [path.join(alias, 'Contents/Resources/mediflow-headless-supervisor.mjs')],
    { encoding: 'utf8', env: {}, timeout: 10_000 }));
});
test('hardlinked payload is not a physical owned file', async t => {
  const f = fixture(t); fs.linkSync(path.join(f.runtime, 'package.json'), path.join(f.directory, 'alias.json'));
  await assert.rejects(f.verify());
});
test('source-side check rejects a replaced launcher before importing it', async t => {
  const f = fixture(t); fs.writeFileSync(f.launcher, 'throw new Error("must_not_be_imported");\n');
  await assert.rejects(f.verify(), /Bundled launcher differs/u);
});
test('cwd and PATH cannot substitute the guard or Node executable', t => {
  const f = fixture(t), hostile = path.join(f.directory, 'foreign cwd'); fs.mkdirSync(hostile);
  const marker = path.join(hostile, 'executed');
  write(path.join(hostile, 'node'), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, 0o755);
  write(path.join(hostile, 'mediflow-headless-supervisor.mjs'), 'throw new Error("wrong cwd");\n');
  const code = `const {verifyHeadlessBundle} = await import(${JSON.stringify(pathToFileURL(f.launcher).href)}); verifyHeadlessBundle();`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: hostile, encoding: 'utf8', env: { PATH: hostile }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(fs.existsSync(marker), false);
});
test('caller-supplied Node options and authority environment are not launch options', t => {
  const f = fixture(t);
  denied(f.run([], { env: { NODE_OPTIONS: '' } }));
  denied(f.run([], { env: { NODE_PATH: f.directory } }));
});
test('data-directory symlinks and app-local writes fail before loading runtime', t => {
  const f = fixture(t), real = path.join(f.directory, 'data'), alias = path.join(f.directory, 'data-link');
  fs.mkdirSync(real); fs.symlinkSync(real, alias);
  denied(f.run([], { env: { MEDIFLOW_DATA_DIR: alias } }));
  denied(f.run(['--mcp'], { env: { MEDIFLOW_DATA_DIR: f.runtime } }));
  assert.deepEqual(fs.readdirSync(real), []);
});
test('staging refuses a sealed app; read-only acceptance preserves it', async t => {
  const f = fixture(t); write(path.join(f.contents, '_CodeSignature/CodeResources'), 'SYNTHETIC SEAL, NOT CODESIGN\n');
  const before = physicalFiles(f.contents).map(name => [name, physicalRecord(path.join(f.contents, name))]);
  assert.throws(() => appLayout(f.app, true), /sealed/u); await f.verify();
  assert.deepEqual(physicalFiles(f.contents).map(name => [name, physicalRecord(path.join(f.contents, name))]), before);
});
test('actual incompatible Node is rejected', t => {
  const otherNode = process.env.MEDIFLOW_HEADLESS_TEST_OTHER_NODE;
  if (!otherNode) { t.skip('Set MEDIFLOW_HEADLESS_TEST_OTHER_NODE to an actual non-24 Node for this negative test.'); return; }
  const f = fixture(t);
  denied(spawnSync(otherNode, [f.launcher], { encoding: 'utf8', env: {}, timeout: 10_000 }));
});
test('trace keeps shared delivery lanes separate on both path styles, without hiding missing source edges', async t => {
  const { nodeFileTrace } = createRequire(path.join(ROOT, 'package.json'))('next/dist/compiled/@vercel/nft');
  const root = path.join(fixture(t).directory, 'trace');
  const lanes = ['.next/server.js', 'packages/mini/index.js', 'node_modules/better-sqlite3/index.js'];
  const entry = write(path.join(root, 'entry.cjs'), [...lanes, 'lib/required.js'].map(name => `require('./${name}');`).join('\n'));
  for (const name of lanes) write(path.join(root, name), "require('unavailable-in-this-delivery-lane');");
  write(path.join(root, 'lib/required.js'), 'module.exports = {};');
  for (const separator of ['/', '\\']) {
    const trace = () => nodeFileTrace([entry], { base: root, processCwd: root,
      ignore: file => sharedRuntimeDependency(file.split(path.sep).join(separator)) });
    const closed = await trace();
    assert.equal(closed.warnings.size, 0);
    assert.ok([...closed.fileList].some(name => name.split(path.sep).join('/') === 'lib/required.js'));
    assert.ok([...closed.fileList].every(name => !sharedRuntimeDependency(name)));
    fs.unlinkSync(path.join(root, 'lib/required.js'));
    assert.ok([...(await trace()).warnings].some(warning => warning.message.includes('required')));
    write(path.join(root, 'lib/required.js'), 'module.exports = {};');
  }
});
test('trace removes type-only edges and resolves only exact local files', t => {
  let ts;
  try {
    const require = createRequire(path.join(ROOT, 'package.json'));
    ts = process.env.MEDIFLOW_HEADLESS_TEST_TYPESCRIPT ? require(process.env.MEDIFLOW_HEADLESS_TEST_TYPESCRIPT) : require('typescript');
  } catch { t.skip('Installed TypeScript is required; no download is performed.'); return; }
  const f = fixture(t), root = path.join(f.directory, "trace root's files");
  write(path.join(root, 'lib/live.ts'), 'export const value = 1;\n');
  const output = traceSourceText(ts, path.join(root, 'entry.ts'),
    "import type { Missing } from './not-shipped'; import 'server-only'; import {value} from '@/lib/live'; console.log(value);", root);
  assert.doesNotMatch(output, /not-shipped|server-only/u); assert.ok(output.includes(path.join(root, 'lib/live.ts')));
  assert.throws(() => traceSourceText(ts, path.join(root, 'entry.ts'), "import './missing';", root), /Missing source dependency/u);
});

// execute the actual source TS loader + actual portable contract, not a
// substitute Supervisor. This tests module confinement only, never MCP readiness.
test('guarded loader executes the unchanged IPC contract and rejects a foreign module', t => {
  const require = createRequire(path.join(ROOT, 'package.json'));
  let typescript;
  try { typescript = process.env.MEDIFLOW_HEADLESS_TEST_TYPESCRIPT || require.resolve('typescript'); }
  catch { t.skip('An installed TypeScript is required; no download.'); return; }
  const f = fixture(t), contractName = 'packages/aip/src/portable-supervisor-web-ipc-contract.ts';
  write(path.join(f.runtime, contractName), fs.readFileSync(path.join(ROOT, contractName)));
  write(path.join(f.runtime, 'node_modules/typescript/lib/typescript.js'), fs.readFileSync(typescript));
  write(path.join(f.runtime, 'node_modules/typescript/package.json'),
    fs.readFileSync(path.join(path.dirname(typescript), '../package.json')));
  f.roster.files = physicalFiles(f.contents).filter(name => ![
    'Resources/mediflow-headless-supervisor.mjs', 'Resources/WebRuntime/HeadlessRuntime/headless-roster.json',
  ].includes(name)).map(name => ({ path: name, ...physicalRecord(path.join(f.contents, name)) }));
  f.commit();
  const foreign = write(path.join(f.directory, 'foreign.mjs'), 'throw new Error("foreign module executed");');
  const code = `
    const {installHeadlessLoader} = await import(${JSON.stringify(pathToFileURL(f.launcher).href)});
    await installHeadlessLoader();
    const contract = await import(${JSON.stringify(pathToFileURL(path.join(f.runtime, contractName)).href)});
    if (typeof contract.decodePortableSupervisorWebIpcFrameV1 !== 'function') throw new Error('Missing real export');
    let denied = false;
    try { await import(${JSON.stringify(pathToFileURL(foreign).href)}); }
    catch (error) { denied = error.message === 'headless_bundle_invalid'; }
    if (!denied) throw new Error('Foreign module not denied by guard');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: f.directory, encoding: 'utf8', env: {}, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});
test('Headless read admission accepts NFT Windows package-export separators while retaining root and dot-segment checks', () => {
  const root = String.raw`D:\synthetic\project`;
  const native = String.raw`D:\synthetic\project\node_modules\example\dist\esm\index.js`;
  assert.equal(path.win32.normalize(root), root);
  assert.equal(path.win32.normalize(native), native);
  for (const candidate of [native, String.raw`D:\synthetic\project\node_modules\example/dist/esm/index.js`,
    'D:/synthetic/project/node_modules/example/dist/esm/index.js']) {
    assert.equal(headlessTraceReadPath(candidate, root, path.win32), native);
  }
  for (const candidate of [String.raw`D:\synthetic\project-other\index.js`, String.raw`D:\synthetic\project\..\outside.js`,
    String.raw`D:\synthetic\project\node_modules\example/../outside.js`, String.raw`C:\synthetic\project\index.js`,
    String.raw`D:\synthetic\project\.\index.js`]) {
    assert.throws(() => headlessTraceReadPath(candidate, root, path.win32), /Headless trace escaped its root/u);
  }
});
test('database exclusions cover case-insensitive SQLite names and sidecars on both path styles, not migration inputs', () => {
  for (const root of ['', '/synthetic/root/', 'C:\\synthetic\\root\\']) {
    for (const suffix of ['.db', '.SQLITE', '.sqlite3', '.DB-WAL', '.db-shm', '.sqlite3-journal', '.db-mj1234ABCD']) {
      assert.equal(privateDatabaseDependency(root + 'archive' + suffix), true);
    }
    for (const name of ['drizzle/0000_migration.sql', 'drizzle/meta/_journal.json', 'node_modules/better-sqlite3/index.js', 'schema.db.js']) {
      assert.equal(privateDatabaseDependency(root + name), false);
    }
  }
});
const DATABASE_SENTINELS = ['medical.db', 'nested/archive.SQLITE', 'nested/cache.sqlite3-wal',
  'nested/archive.db-shm', 'nested/archive.db-journal'];
function stagingFixture(t, lane) {
  const f = fixture(t), source = path.join(f.directory, 'synthetic-source');
  fs.rmSync(f.runtime, { recursive: true }); fs.unlinkSync(f.launcher);
  const require = createRequire(path.join(ROOT, 'package.json'));
  const key = `headless-stage-${source}`;
  const trace = { forced: null, probes: [], results: [] };
  globalThis[Symbol.for(key)] = trace;
  t.after(() => { delete globalThis[Symbol.for(key)]; });
  for (const name of ['scripts/stage-headless-runtime.mjs', 'scripts/build-input-metadata.mjs', 'scripts/launch-bundled-headless-supervisor.mjs',
    'scripts/node-runtime-contract.mjs']) write(path.join(source, name), fs.readFileSync(path.join(ROOT, name)));
  write(path.join(source, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
  write(path.join(source, '.nvmrc'), '24\n');
  write(path.join(source, 'LICENSE'), 'Synthetic license fixture\n');
  write(path.join(source, 'CREDITS.md'), 'Synthetic credits fixture\n');
  write(path.join(source, 'drizzle/0000_synthetic.sql'), 'SELECT 1;\n');
  write(path.join(source, 'drizzle/meta/_journal.json'), '{"entries":[]}\n');
  write(path.join(source, 'lib/security/portable-supervisor-production.ts'), 'export const synthetic = true;\n');
  for (const name of ['scripts/intelligent-host-mcp-stdio.mjs', 'scripts/register-strip-types-loader.mjs',
    'scripts/run-strip-types.mjs', 'scripts/headless-web-server.mjs']) write(path.join(source, name), 'export {};\n');
  write(path.join(source, 'scripts/mediflow-headless-supervisor.mjs'),
    "import fs from 'node:fs'; import path from 'node:path'; import '../lib/security/portable-supervisor-production.ts';\n"
    + DATABASE_SENTINELS.map(name => `fs.readFileSync(path.join(process.cwd(), ${JSON.stringify(name)}));`).join('\n'));
  for (const name of DATABASE_SENTINELS) write(path.join(source, name), 'SYNTHETIC DATABASE SENTINEL\n');
  write(path.join(source, 'node_modules/typescript/index.js'), `module.exports = require(${JSON.stringify(require.resolve('typescript'))});`);
  write(path.join(source, 'node_modules/next/dist/compiled/@vercel/nft/index.js'), `
    const real = require(${JSON.stringify(require.resolve('next/dist/compiled/@vercel/nft'))});
    exports.nodeFileTrace = async (seeds, options) => {
      const state = globalThis[Symbol.for(${JSON.stringify(key)})];
      for (const file of state.probes) state.results.push(await options.readFile(file));
      if (state.forced) return { fileList: new Set(state.forced), warnings: new Set() };
      return real.nodeFileTrace(seeds, options);
    };
  `);
  write(path.join(f.web, 'node_modules/better-sqlite3/package.json'), '{"main":"index.js"}');
  write(path.join(f.web, 'node_modules/better-sqlite3/index.js'), 'module.exports = {};\n');
  write(path.join(f.contents, 'Frameworks/mediflow-web-better-sqlite3.node'), 'SYNTHETIC NATIVE FILE, NEVER LOADED\n');
  const output = lane === 'app' ? f.runtime : path.join(f.directory, 'source-output');
  if (lane === 'source') fs.mkdirSync(output);
  const stage = async () => {
    const stager = await import(pathToFileURL(path.join(source, 'scripts/stage-headless-runtime.mjs')).href);
    if (lane === 'app') await stager.stageHeadlessRuntime(f.app);
    else await stager.stageSourceHeadlessRuntime(output);
  };
  return { ...f, source, output, trace, stage };
}
function observePrivateAccess(t, targets) {
  const paths = new Set(targets.map(file => path.resolve(file))), accesses = [];
  for (const [owner, method] of [[fs.promises, 'readFile'], [fs, 'readFileSync'], [fs, 'openSync'], [fs, 'copyFileSync']]) {
    const original = owner[method];
    t.mock.method(owner, method, function (file, ...args) {
      const value = file instanceof URL ? fileURLToPath(file) : file;
      if (typeof value === 'string' && paths.has(path.resolve(value))) accesses.push(method);
      return original.call(this, file, ...args);
    });
  }
  return accesses;
}
for (const lane of ['source', 'app']) {
  test(`${lane} staging excludes computed database references before any read, hash or copy`, async t => {
    const f = stagingFixture(t, lane);
    const accesses = observePrivateAccess(t, DATABASE_SENTINELS.map(name => path.join(f.source, name)));
    await f.stage();
    assert.deepEqual(accesses, []);
    assert.ok(physicalFiles(f.output).every(name => !/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/iu.test(name)));
    assert.equal(fs.readFileSync(path.join(f.output, 'drizzle/0000_synthetic.sql'), 'utf8'), 'SELECT 1;\n');
    assert.equal(fs.readFileSync(path.join(f.output, 'drizzle/meta/_journal.json'), 'utf8'), '{"entries":[]}\n');
  });
  test(`${lane} staging preserves a real NFT package-exports dependency without admitting data`, async t => {
    const f = stagingFixture(t, lane);
    fs.appendFileSync(path.join(f.source, 'scripts/mediflow-headless-supervisor.mjs'), "\nimport 'synthetic-exports';\n");
    write(path.join(f.source, 'node_modules/synthetic-exports/package.json'), '{"name":"synthetic-exports","exports":"./dist/esm/index.js"}\n');
    write(path.join(f.source, 'node_modules/synthetic-exports/dist/esm/index.js'), 'export const synthetic = true;\n');
    const accesses = observePrivateAccess(t, DATABASE_SENTINELS.map(name => path.join(f.source, name)));
    await f.stage();
    assert.equal(fs.readFileSync(path.join(f.output, 'node_modules/synthetic-exports/dist/esm/index.js'), 'utf8'),
      'export const synthetic = true;\n');
    assert.deepEqual(accesses, []);
  });
  test(`${lane} trace read hook excludes private files even when the tracer bypasses ignore`, async t => {
    const f = stagingFixture(t, lane);
    f.trace.probes = DATABASE_SENTINELS.map(name => path.join(f.source, name));
    f.trace.probes.push(path.join(f.source, 'missing.js'), path.join(f.source, 'drizzle'));
    const accesses = observePrivateAccess(t, DATABASE_SENTINELS.map(name => path.join(f.source, name)));
    await f.stage();
    assert.deepEqual(f.trace.results, f.trace.probes.map(() => null));
    assert.deepEqual(accesses, []);
  });
  test(`${lane} unexpected database closure is denied before magic, hashing and staging writes`, async t => {
    const f = stagingFixture(t, lane);
    const accesses = observePrivateAccess(t, DATABASE_SENTINELS.map(name => path.join(f.source, name)));
    for (const name of [...DATABASE_SENTINELS, String.raw`nested\ARCHIVE.SQLITE3-WAL`]) {
      f.trace.forced = [name];
      await assert.rejects(f.stage(), /Unexpected Headless database dependency/u);
      assert.deepEqual(accesses, []);
      assert.deepEqual(fs.existsSync(f.output) ? physicalFiles(f.output) : [], []);
    }
  });
  for (const alias of ['file', 'ancestor']) {
    test(`${lane} trace denies a ${alias} alias before reading a database sentinel`, async t => {
      if (process.platform === 'win32') { t.skip('Symbolic-link creation needs a separately provisioned Windows privilege.'); return; }
      const f = stagingFixture(t, lane), database = path.join(f.source, 'medical.db');
      const target = alias === 'file' ? path.join(f.source, 'innocent.js') : path.join(f.source, 'alias/innocent.js');
      if (alias === 'file') fs.symlinkSync(database, target);
      else {
        const external = path.join(f.directory, 'synthetic-external');
        write(path.join(external, 'innocent.js'), 'SYNTHETIC PRIVATE SENTINEL\n');
        fs.symlinkSync(external, path.join(f.source, 'alias'));
      }
      f.trace.probes = [target];
      const accesses = observePrivateAccess(t, [target, database]);
      await assert.rejects(f.stage());
      assert.deepEqual(accesses, []);
      assert.deepEqual(fs.existsSync(f.output) ? physicalFiles(f.output) : [], []);
    });
  }
  test(`${lane} trace denies an external file before reading its content`, async t => {
    const f = stagingFixture(t, lane), external = write(path.join(f.directory, 'outside.js'), 'SYNTHETIC PRIVATE SENTINEL\n');
    f.trace.probes = [external];
    const accesses = observePrivateAccess(t, [external]);
    await assert.rejects(f.stage()); assert.deepEqual(accesses, []);
  });
}

test('builder commits the Headless roster after inner signing and before outer sealing (source order only)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/build-apple-macos-app.sh'), 'utf8');
  const stage = source.indexOf('stage-headless-runtime.mjs" --stage');
  const check = source.indexOf('stage-headless-runtime.mjs" --check');
  const outer = source.indexOf('codesign "${SIGN_ARGS[@]}" "$APP"');
  const inner = source.indexOf('codesign "${SIGN_ARGS[@]}" "$native_code"');
  assert.ok(inner >= 0 && inner < stage && stage < outer && outer < check, 'Signing order changed');
  assert.equal(source.slice(outer).includes('stage-headless-runtime.mjs" --stage'), false);
});
