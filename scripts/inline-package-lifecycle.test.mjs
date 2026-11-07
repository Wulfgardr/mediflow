import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolatedHost, changeInlinePackage } from './inline-package-lifecycle.mjs';

for (const [host, binary] of [['claude-desktop', undefined], ['claude-code', process.env.MEDIFLOW_CLAUDE_BIN], ['codex', process.env.MEDIFLOW_CODEX_BIN]]) {
  test(`${host}: clean install, upgrade, revoke, reinstall preserve audit and unrelated settings`, { skip: host !== 'claude-desktop' && !binary }, t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-inline-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = isolatedHost(root, host, binary);
    const packages = ['0.1.0', '0.1.1'].map(version => {
      const dir = path.join(root, version);
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'dist'));
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'mediflow-chat-demo', version }));
      fs.writeFileSync(path.join(dir, 'src/stdio.mjs'), '');
      fs.writeFileSync(path.join(dir, 'dist/app.html'), 'synthetic');
      fs.writeFileSync(path.join(dir, '.env'), 'SECRET_MUST_NOT_COPY');
      return dir;
    });
    if (host !== 'codex') {
      fs.mkdirSync(path.dirname(target.config), { recursive: true });
      fs.writeFileSync(target.config, JSON.stringify({ preference: 'keep', mcpServers: { other: { command: '/synthetic/other' } } }));
    }
    const install = dir => changeInlinePackage(target, 'install', dir);
    const first = install(packages[0]);
    assert.equal(first.receipt.active, true);
    const originalAudit = fs.readFileSync(first.auditFile, 'utf8');
    const upgraded = install(packages[1]);
    assert.equal(upgraded.receipt.previousVersion, '0.1.0');
    assert.equal(upgraded.receipt.version, '0.1.1');
    assert.ok(fs.readFileSync(first.auditFile, 'utf8').startsWith(originalAudit));
    const revoked = changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo');
    assert.equal(revoked.receipt.active, false);
    const config = fs.readFileSync(target.config, 'utf8');
    assert.doesNotMatch(config, /mediflow-chat-demo|SECRET_MUST_NOT_COPY/);
    if (host !== 'codex') { assert.equal(JSON.parse(config).preference, 'keep'); assert.ok(JSON.parse(config).mcpServers.other); }
    const reinstalled = install(packages[1]);
    const events = fs.readFileSync(reinstalled.auditFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.filter(e => e.status === 'complete').map(e => e.action), ['install', 'upgrade', 'revoke', 'install']);
    assert.equal(reinstalled.receipt.active, true);
    if (host !== 'claude-desktop') {
      const shown = target.run(['mcp', 'get', 'mediflow-chat-demo']);
      assert.match(shown, /mediflow-chat-demo/);
    }
    changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo');
  });
}

test('unmanaged desktop registration are refused with original bytes preserved', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-inline-negative-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = isolatedHost(root, 'claude-desktop');
  fs.mkdirSync(path.dirname(target.config), { recursive: true });
  const bytes = JSON.stringify({ mcpServers: { 'mediflow-chat-demo': { command: '/unmanaged' } } });
  fs.writeFileSync(target.config, bytes);
  assert.throws(() => changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo'), /Unmanaged/);
  assert.equal(fs.readFileSync(target.config, 'utf8'), bytes);
});


test('host lock prevents concurrent configuration writers before any audit mutation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-inline-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = isolatedHost(root, 'claude-desktop');
  fs.writeFileSync(path.join(root, 'claude-desktop.lock'), 'owned by another operation');
  assert.throws(() => changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo'), /EEXIST/);
  assert.equal(fs.existsSync(target.config), false);
  assert.equal(fs.existsSync(path.join(root, 'receipts/claude-desktop/mediflow-chat-demo/audit.jsonl')), false);
});

test('codex registration with environment changed after install is refused, not overwritten', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-inline-codex-env-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = { type: 'stdio', command: '/synthetic/node', args: ['/synthetic/stdio.mjs'] };
  const listing = path.join(root, 'listing.json'), calls = path.join(root, 'calls.log');
  const list = env => fs.writeFileSync(listing, JSON.stringify([{ name: 'mediflow-chat-demo', enabled: true,
    disabled_reason: null, transport: { ...server, env, env_vars: [], cwd: null },
    startup_timeout_sec: null, tool_timeout_sec: null, auth_status: 'unsupported' }]));
  const stub = path.join(root, 'codex-stub.mjs');
  fs.writeFileSync(stub, `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[3] === 'list') process.stdout.write(fs.readFileSync(${JSON.stringify(listing)}, 'utf8'));
`, { mode: 0o755 });
  const target = isolatedHost(root, 'codex', stub);
  const state = path.join(root, 'receipts', 'codex', 'mediflow-chat-demo');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'receipt.json'), JSON.stringify({ name: 'mediflow-chat-demo', version: '0.1.0', active: true, server }));
  list({ CUSTOM_SETTING: '1' });
  assert.throws(() => changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo'), /changed/);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['mcp list --json']);
  list(null);
  changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo');
  assert.match(fs.readFileSync(calls, 'utf8'), /mcp remove mediflow-chat-demo/);
});
