// Explicit opt-in real Codex test. No installation or persistent configuration writes.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { createAgentVerifier, mention, pluginId, sha256, tools, verifyInventory } from './codex-agent-contract.mjs';

const { values } = parseArgs({ options: { 'codex-cli': { type: 'string', default: 'codex' }, marketplace: { type: 'string' } } });
assert.ok(values.marketplace, 'Supply --marketplace /absolute/path/to/personal/marketplace.json');
assert.equal(resolve(values.marketplace), values.marketplace, 'Marketplace path must be absolute');
assert.ok(process.versions.node.startsWith('24.'), 'Use pinned Node 24');
const env = { ...process.env, RUST_LOG: 'off' };
const configPath = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), 'config.toml');
const fileHash = async (path) => {
  try { return sha256(await readFile(path)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const settingsHash = () => Promise.all([configPath, values.marketplace].map(fileHash));
const before = await settingsHash();
const version = execFileSync(values['codex-cli'], ['--version'], { env, encoding: 'utf8', timeout: 25_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const installed = JSON.parse(execFileSync(values['codex-cli'], ['plugin', 'list', '--json'],
  { env, encoding: 'utf8', timeout: 25_000, stdio: ['ignore', 'pipe', 'ignore'] })).installed;
assert.ok(installed.some((plugin) => plugin.pluginId === pluginId && plugin.enabled), 'Expected enabled installed synthetic plugin');
const pluginOverrides = Object.fromEntries(installed.map((plugin) => [plugin.pluginId, { enabled: plugin.pluginId === pluginId }]));
// JSON strings are also TOML basic strings. One inline table preserves @ and - in IDs.
const inlinePlugins = 'plugins={' + Object.entries(pluginOverrides).map(([id, value]) => `${JSON.stringify(id)}={enabled=${value.enabled}}`).join(',') + '}';
const child = spawn(values['codex-cli'], ['app-server', '--stdio', '-c', inlinePlugins, '-c', 'features.apps=false'],
  { env, stdio: ['pipe', 'pipe', 'ignore'] });
const pending = new Map();
let nextId = 1;
let observer;
let finishTurn;
let rejectTurn;
let protocolFailure;
let stage = 'startup';
let evidence;
let closing = false;
function fail(error) {
  protocolFailure ||= error;
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
  rejectTurn?.(error);
}
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method && message.id != null) {
      // Do not grant elicitation, filesystem, OAuth or tool approvals.
      throw new Error(`Unexpected host request: ${message.method}`);
    }
    if (message.id != null) {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`RPC ${waiter.method} failed (${message.error.code})`));
        else waiter.resolve(message.result);
      }
    } else if (message.method) {
      observer?.observe(message.method, message.params);
      if (message.method === 'turn/completed') finishTurn?.();
    }
  } catch (error) { fail(error); }
});
child.on('error', fail);
child.on('exit', () => { if (!closing) fail(new Error('App-server exited')); });
function call(method, params) {
  stage = method;
  if (protocolFailure) return Promise.reject(protocolFailure);
  const id = nextId++;
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 25_000);
    pending.set(id, { method, resolve: (value) => { clearTimeout(timer); resolveCall(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await call('initialize', { clientInfo: { name: 'mediflow_synthetic_agent_smoke', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const { plugin } = await call('plugin/read', { pluginName: 'mediflow-synthetic', marketplacePath: values.marketplace });
  assert.equal(plugin.summary.id, pluginId);
  assert.equal(plugin.summary.installed, true);
  assert.equal(plugin.summary.enabled, true);
  assert.equal(plugin.summary.source.type, 'local');
  assert.equal(plugin.summary.localVersion, '0.1.0');
  assert.deepEqual(plugin.mcpServers, ['mediflow-synthetic']);
  const cwd = plugin.summary.source.path;
  const { config } = await call('config/read', { cwd, includeLayers: false });
  const { thread } = await call('thread/start', { cwd, ephemeral: true, model: 'gpt-6.1-sol',
    approvalPolicy: 'never', sandbox: 'read-only', config: {
      plugins: pluginOverrides,
      mcp_servers: Object.fromEntries(Object.keys(config.mcp_servers || {}).map((name) => [name, { enabled: false }])),
      features: { apps: false, shell_tool: false }, web_search: 'disabled', model_reasoning_effort: 'low',
    } });
  const inventory = await call('mcpServerStatus/list', { threadId: thread.id, detail: 'toolsAndAuthOnly', limit: 100 });
  assert.ok(inventory.nextCursor == null, 'Incomplete inventory');
  verifyInventory(inventory.data);
  const resource = await call('mcpServer/resource/read', { threadId: thread.id, server: 'mediflow-synthetic', uri: 'ui://mediflow-synthetic/review' });
  assert.equal(resource.contents.length, 1);
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  const resourceHash = sha256(resource.contents[0].text);
  assert.equal(resourceHash, sha256(await readFile(new URL('../dist/app.html', import.meta.url))), 'Installed UI differs from this built source');
  observer = createAgentVerifier(thread.id);
  let turnTimer;
  const completed = new Promise((resolveTurn, reject) => {
    finishTurn = resolveTurn; rejectTurn = reject;
    turnTimer = setTimeout(() => reject(new Error('Agent turn timeout')), 100_000);
  });
  // Attach rejection handling before turn/start can emit notifications.
  completed.catch(() => {});
  try {
    const { turn } = await call('turn/start', { threadId: thread.id, input: [
      { type: 'text', text: `[@mediflow-synthetic](${mention.path}) This is an authorized synthetic-only host routing test. Invoke both bundled tools ${tools.join(' and ')} exactly once each with empty arguments {}. Do not use other tools, read files, access patients, modify data or attach model context. Return a short summary of the two returned views. If the tools cannot be invoked, say so and stop. All examples are invented.` }, mention,
    ] });
    await completed;
    observer.bindTurn(turn.id);
  } finally { clearTimeout(turnTimer); }
  stage = 'agent_verification';
  const calls = observer.finish();
  evidence = { passed: true, cliVersion: version, activePlugin: pluginId, model: 'gpt-6.1-sol',
    inputMode: 'structured plugin mention', actualAgentCalls: calls, resourceSha256: resourceHash,
    personalConfigUnchanged: true, personalMarketplaceUnchanged: true, desktopUiTested: false, modelContextUpdateTested: false };
} catch {
  // Never print raw host messages, configuration values or rejected payloads.
  console.error(`CODEX_SYNTHETIC_SMOKE_FAILED (${stage})`);
  process.exitCode = 1;
} finally {
  closing = true;
  child.kill('SIGTERM');
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await new Promise((done) => { if (child.exitCode != null || child.signalCode != null) done(); else child.once('exit', done); });
  clearTimeout(killTimer);
  lines.close();
  try { assert.deepEqual(await settingsHash(), before); }
  catch { console.error('CODEX_SYNTHETIC_SETTINGS_CHANGED'); process.exitCode = 1; }
}
if (protocolFailure && !process.exitCode) { console.error('CODEX_SYNTHETIC_PROTOCOL_FAILED'); process.exitCode = 1; }
if (!process.exitCode && evidence) console.log(JSON.stringify(evidence));
