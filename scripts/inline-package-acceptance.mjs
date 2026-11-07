import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { isolatedHost, changeInlinePackage } from './inline-package-lifecycle.mjs';

const source = path.resolve('plugins/mediflow-chat-demo');
const require = createRequire(path.join(source, 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-c10b-acceptance-')));
const data = path.join(root, 'synthetic-data');
const seeded = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/seed-performance-baseline.mjs', '--data-dir', data, '--patients', '2'], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' }, timeout: 60000,
});
assert.equal(seeded.status, 0, seeded.stderr);
const digest = () => createHash('sha256').update(fs.readFileSync(path.join(data, 'medical.db'))).digest('hex');
const original = digest();
const packages = ['0.1.0', '0.1.1'].map(version => {
  const destination = path.join(root, `demo-${version}`);
  fs.mkdirSync(destination);
  for (const file of ['src', 'dist', 'plugin.json', 'package.json']) fs.cpSync(path.join(source, file), path.join(destination, file), { recursive: true });
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(destination, 'node_modules'));
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'plugin.json')));
  fs.writeFileSync(path.join(destination, 'plugin.json'), JSON.stringify({ ...manifest, version }));
  return destination;
});
const results = [];
for (const [host, binary] of [['codex', process.env.MEDIFLOW_CODEX_BIN], ['claude-code', process.env.MEDIFLOW_CLAUDE_BIN], ['claude-desktop', undefined]]) {
  if (host !== 'claude-desktop' && !binary) throw new Error(`Binary required for ${host}`);
  const target = isolatedHost(path.join(root, host), host, binary);
  const installed = changeInlinePackage(target, 'install', packages[0]);
  const before = host === 'claude-desktop' ? fs.readFileSync(target.config, 'utf8') : target.run(['mcp', 'list']);
  assert.match(before, /mediflow-chat-demo/);
  fs.mkdirSync(path.join(packages[0], '.local'), { recursive: true });
  fs.writeFileSync(path.join(packages[0], '.local/allowed-origins.json'), JSON.stringify(['https://c10b.example']));
  const client = new Client({ name: 'c10b-acceptance', version: '1' });
  const transport = new StdioClientTransport({ ...installed.receipt.server, env: target.env, stderr: 'pipe' });
  let receipt;
  try {
    await client.connect(transport);
    receipt = await client.callTool({ name: 'mediflow_chat_demo_open', arguments: {} });
    assert.equal(receipt.isError, undefined);
    assert.match(receipt.content[0].text, /Dimostrazione MediFlow disponibile/);
    const resource = await client.readResource({ uri: 'ui://mediflow-chat-demo/reader' });
    assert.match(resource.contents[0].text, /Elena Vela/);
    const connection = JSON.parse(resource.contents[0].text.match(/<script id="demo-connection" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.notEqual(new URL(connection.endpoint).port, '3000');
    const admission = await fetch(connection.endpoint + '/admit', { method: 'POST', headers: { Origin: 'https://c10b.example', 'X-Demo-View': randomUUID() } });
    assert.equal(admission.status, 200);
  } finally { await client.close(); }
  fs.writeFileSync(path.join(target.root, 'onboarding-receipt.json'), JSON.stringify(receipt));
  const audit = fs.readFileSync(installed.auditFile, 'utf8');
  changeInlinePackage(target, 'install', packages[1]);
  assert.ok(fs.readFileSync(installed.auditFile, 'utf8').startsWith(audit));
  changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo');
  const after = host === 'claude-desktop' ? fs.readFileSync(target.config, 'utf8') : target.run(['mcp', 'list']);
  assert.doesNotMatch(after, /mediflow-chat-demo/);
  changeInlinePackage(target, 'install', packages[1]);
  assert.equal(digest(), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target.root, 'onboarding-receipt.json'))), receipt);
  const events = fs.readFileSync(installed.auditFile, 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.status === 'complete');
  assert.deepEqual(events.map(e => e.action), ['install', 'upgrade', 'revoke', 'install']);
  changeInlinePackage(target, 'revoke', undefined, 'mediflow-chat-demo');
  results.push({ host, before, after, auditFile: installed.auditFile, config: target.config });
}
fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ root, node: process.version, syntheticDatabaseSha256: original,
  upgrade: 'Same executable payload; test-only manifest versions 0.1.0 and 0.1.1', results }, null, 2));
process.stdout.write(JSON.stringify({ root, results }, null, 2) + '\n');
