import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { packageLocalUiPlugin } from './package-local-ui-plugin.mjs';
import { generatePayloadLedger } from './generate-runtime-payload-ledger.mjs';

const root = path.resolve('plugins/mediflow-local-ui');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('portable, Codex and Claude manifests share identity and client-specific launch commands', () => {
  const base = json('plugin.json'), codex = json('.codex-plugin/plugin.json'), claude = json('.claude-plugin/plugin.json');
  for (const manifest of [codex, claude]) for (const key of ['name', 'version', 'description', 'author']) assert.deepEqual(manifest[key], base[key]);
  for (const [file, placeholder] of [['mcp.json', '${PLUGIN_ROOT}'], ['.mcp.codex.json', '${PLUGIN_ROOT}'], ['.mcp.claude.json', '${CLAUDE_PLUGIN_ROOT}']]) {
    const servers = json(file).mcpServers;
    assert.deepEqual(Object.keys(servers), ['mediflow-local-ui']);
    assert.deepEqual(servers['mediflow-local-ui'], file === '.mcp.claude.json'
      ? { type: 'stdio', command: 'node', args: [`${placeholder}/src/launch.mjs`] }
      : { type: 'stdio', command: './bin/mediflow-local-ui', args: [] });
  }
  assert.equal(codex.mcpServers, './.mcp.codex.json'); assert.equal(claude.mcpServers, './.mcp.claude.json');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'skills/local-ui/SKILL.md'), 'utf8'), /(?:npx|SELECT\s+|fetch\()/u);
});

test('template without admitted configuration fails closed with fixed stderr and no output', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'src/launch.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'MediFlow navigation unavailable.\n');
});

test('packager refuses missing ledgers before creating any package', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-plugin-package-'));
  try {
    const data = path.join(directory, 'data'), destination = path.join(directory, 'plugin'); fs.mkdirSync(data);
    assert.throws(() => packageLocalUiPlugin(destination, data, directory));
    assert.equal(fs.existsSync(destination), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('generated Codex package uses an executable plugin-relative launcher and pins Node in runtime.json', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-plugin-generated-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = path.join(directory, 'data'), destination = path.join(directory, 'plugin');
  fs.mkdirSync(data);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    const verifier = ${JSON.stringify(new URL('./source-runtime.mjs', import.meta.url).href)};
    registerHooks({ load(url, context, nextLoad) {
      if (url === verifier) return { format: 'module', shortCircuit: true,
        source: 'export const verifySourceRuntime = () => ({ identity: { revision: "' + 'a'.repeat(40) + '" } });' };
      return nextLoad(url, context);
    } });
    const { packageLocalUiPlugin } = await import(${JSON.stringify(new URL('./package-local-ui-plugin.mjs', import.meta.url).href)});
    packageLocalUiPlugin(${JSON.stringify(destination)}, ${JSON.stringify(data)}, ${JSON.stringify(directory)});
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['mcp.json', '.mcp.codex.json']) {
    const server = JSON.parse(fs.readFileSync(path.join(destination, name))).mcpServers['mediflow-local-ui'];
    assert.equal(server.command, './bin/mediflow-local-ui');
    assert.deepEqual(server.args, []);
    assert.equal(path.isAbsolute(server.command), false);
    const launcher = path.join(destination, server.command);
    assert.ok(fs.statSync(launcher).isFile());
    fs.accessSync(launcher, fs.constants.X_OK);
  }
  const runtime = JSON.parse(fs.readFileSync(path.join(destination, 'runtime.json')));
  assert.equal(runtime.nodePath, fs.realpathSync(process.execPath));
  assert.equal(runtime.dataDir, data);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, '.mcp.claude.json')))
    .mcpServers['mediflow-local-ui'].command, runtime.nodePath);
});

test('POSIX launcher uses the pinned Node independently of cwd and PATH, preserving arguments and environment', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-launcher-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const plugin = path.join(directory, 'plugin with spaces');
  fs.mkdirSync(path.join(plugin, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'src'));
  const launcher = path.join(plugin, 'bin/mediflow-local-ui');
  fs.copyFileSync(path.join(root, 'bin/mediflow-local-ui'), launcher);
  fs.writeFileSync(path.join(plugin, 'runtime.json'), JSON.stringify({ nodePath: process.execPath }));
  fs.writeFileSync(path.join(plugin, 'src/launch.mjs'), `
    process.stdout.write(JSON.stringify({ executable: process.execPath,
      args: process.argv.slice(2), sentinel: process.env.MEDIFLOW_LAUNCHER_TEST }));`);
  const args = ['with spaces', '', '"quoted"', '$(not executed)', '--flag'];
  const result = spawnSync(launcher, args, { cwd: os.tmpdir(), encoding: 'utf8',
    env: { PATH: '/nonexistent', MEDIFLOW_LAUNCHER_TEST: 'synthetic environment' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { executable: process.execPath, args, sentinel: 'synthetic environment' });
  const nonExecutable = path.join(directory, 'not executable');
  fs.writeFileSync(nonExecutable, 'synthetic', { mode: 0o600 });
  for (const config of [{}, { nodePath: path.join(directory, 'absent') }, { nodePath: nonExecutable },
    { nodePath: directory }, { nodePath: 'node' }, { nodePath: null }]) {
    fs.writeFileSync(path.join(plugin, 'runtime.json'), JSON.stringify(config));
    const failed = spawnSync(launcher, [], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr, 'MediFlow navigation unavailable.\n');
  }
  fs.unlinkSync(path.join(plugin, 'runtime.json'));
  const missing = spawnSync(launcher, [], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, 'MediFlow navigation unavailable.\n');
});

function admittedPackage(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-plugin-runtime-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'), web = path.join(source, '.next/standalone');
  const data = path.join(directory, 'data'), destination = path.join(directory, 'plugin');
  const marker = path.join(directory, 'supervisor.json');
  fs.mkdirSync(data);
  const project = path.resolve('.');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
  const put = (base, name, value) => {
    const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  put(source, '.nvmrc', '24\n');
  put(source, 'package.json', { engines: { node: '>=24 <25' } });
  put(source, 'scripts/source-runtime.mjs', `
    import { startSourceRuntime } from ${JSON.stringify(new URL('./source-runtime.mjs', import.meta.url).href)};
    await startSourceRuntime(process.argv[2], ${JSON.stringify(source)});`);
  put(web, 'package.json', { name: 'synthetic-plugin-runtime', version: '0.0.0' });
  put(web, 'server.js', 'throw new Error("Unexpected Web startup in synthetic fixture");');
  put(web, '.next/BUILD_ID', 'synthetic-plugin-build');
  put(web, 'mediflow-runtime-contract.json', { schemaVersion: 1,
    node: { major: 24, version: '24.21.0', moduleVersion: process.versions.modules },
    platform: process.platform, arch: process.arch });
  put(web, 'mediflow-build-identity.json', { schemaVersion: 1, revision,
    buildId: 'synthetic-plugin-build', branch: 'synthetic', sourceFingerprint: 'synthetic' });
  put(web, 'scripts/register-strip-types-loader.mjs', '');
  put(web, 'scripts/mediflow-headless-supervisor.mjs', `
    import fs from 'node:fs';
    export function runHeadlessSupervisorV1(options, profile) {
      fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
        nodePath: fs.realpathSync(process.execPath), profile, dataDir: process.env.MEDIFLOW_DATA_DIR,
        revision: process.env.MEDIFLOW_PLUGIN_EXPECTED_REVISION,
        legacyCopy: process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY,
        unexpectedEnvironment: process.env.MEDIFLOW_PLUGIN_TEST_SECRET ?? null }));
    }`);
  put(web, 'node_modules/better-sqlite3/package.json', { name: 'better-sqlite3', version: 'synthetic', main: 'index.js' });
  put(web, 'node_modules/better-sqlite3/index.js', `module.exports = class {
    constructor(name) { if (name !== ':memory:') throw new Error('Non-synthetic database'); }
    prepare() { return { get: () => ({ value: 1 }) }; } close() {} };`);
  const ledger = path.join(source, '.next/runtime-payload-ledger.json');
  put(source, '.next/runtime-payload-ledger.json', generatePayloadLedger({ sourceRoot: project,
    payloadRoot: web, profile: 'standalone', expectedRuntime: { nodeVersion: '24.21.0',
      nodeAbi: process.versions.modules, platform: process.platform, arch: process.arch } }));
  packageLocalUiPlugin(destination, data, source);
  const launch = path.join(destination, 'src/launch.mjs');
  const run = (nodeArgs = [], args = []) => spawnSync(process.execPath, [...nodeArgs, launch, ...args], {
    encoding: 'utf8', timeout: 10_000, env: { MEDIFLOW_PLUGIN_TEST_SECRET: 'synthetic-not-forwarded' },
  });
  return { destination, marker, revision, data, web, ledger, run };
}

test('Node 24 packages and launches a sealed synthetic 24.21 payload with the pinned physical runtime', t => {
  const f = admittedPackage(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.marker)), { nodePath: fs.realpathSync(process.execPath),
    profile: 'plugin_local_ui', dataDir: f.data, revision: f.revision,
    legacyCopy: '1', unexpectedEnvironment: null });
});

test('the runtime launcher rejects extra arguments, Node flags and noncanonical or mismatched nodePath', t => {
  const f = admittedPackage(t), configFile = path.join(f.destination, 'runtime.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  const alias = path.join(f.destination, 'node-alias');
  fs.symlinkSync(process.execPath, alias);
  const denied = result => {
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'MediFlow navigation unavailable.\n');
    assert.equal(fs.existsSync(f.marker), false);
  };
  denied(f.run([], ['unexpected'])); denied(f.run(['--trace-warnings']));
  for (const nodePath of ['node', alias, path.join(f.web, 'server.js')]) {
    fs.writeFileSync(configFile, JSON.stringify({ ...config, nodePath }));
    denied(f.run());
  }
});

for (const mutation of ['revision', 'ledger', 'payload']) {
  test(`the packaged launcher rejects changed ${mutation} before the synthetic Supervisor`, t => {
    const f = admittedPackage(t);
    if (mutation === 'revision') {
      const file = path.join(f.destination, 'runtime.json'), config = JSON.parse(fs.readFileSync(file));
      fs.writeFileSync(file, JSON.stringify({ ...config, revision: 'b'.repeat(40) }));
    } else if (mutation === 'ledger') {
      const ledger = JSON.parse(fs.readFileSync(f.ledger)); ledger.payload.contentSha256 = '0'.repeat(64);
      fs.writeFileSync(f.ledger, JSON.stringify(ledger));
    } else fs.appendFileSync(path.join(f.web, 'server.js'), '// altered');
    const result = f.run();
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'MediFlow navigation unavailable.\n');
    assert.equal(fs.existsSync(f.marker), false);
  });
}
