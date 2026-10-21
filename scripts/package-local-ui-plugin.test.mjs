import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { packageLocalUiPlugin } from './package-local-ui-plugin.mjs';

const root = path.resolve('plugins/mediflow-local-ui');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('portable, Codex and Claude manifests share identity and fixed entrypoint with native placeholders', () => {
  const base = json('plugin.json'), codex = json('.codex-plugin/plugin.json'), claude = json('.claude-plugin/plugin.json');
  for (const manifest of [codex, claude]) for (const key of ['name', 'version', 'description', 'author']) assert.deepEqual(manifest[key], base[key]);
  for (const [file, placeholder] of [['mcp.json', '${PLUGIN_ROOT}'], ['.mcp.codex.json', '${PLUGIN_ROOT}'], ['.mcp.claude.json', '${CLAUDE_PLUGIN_ROOT}']]) {
    const servers = json(file).mcpServers;
    assert.deepEqual(Object.keys(servers), ['mediflow-local-ui']);
    assert.deepEqual(servers['mediflow-local-ui'], { type: 'stdio', command: 'node', args: [`${placeholder}/src/launch.mjs`] });
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
