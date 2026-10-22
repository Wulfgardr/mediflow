import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { packageLocalUiPlugin } from './package-local-ui-plugin.mjs';

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
