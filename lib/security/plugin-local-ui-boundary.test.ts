import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { LOCAL_UI_WEB_READY, createLocalUiSupervisorRuntime } from './portable-supervisor-local-ui.ts';
import type { PortableSupervisorProductionChildProcessesV1 } from './portable-supervisor-child-processes.ts';
import { LOCAL_UI_TOOL_ID, LOCAL_UI_RPC_MODE, LOCAL_UI_RESULT, LOCAL_UI_INTENTS } from '../../packages/mcp/src/local-ui-contract.ts';
import { installLocalUiWebNavigation } from '../../scripts/local-ui-web-navigation.mjs';

const SENTINEL = 'SYNTHETIC_CF_STORY_SECRET_757';
const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'synthetic-local-ui-test', version: '1' } };

function fixture(ready = true) {
  const child = spawn(process.execPath, ['--import', pathToFileURL(`${process.cwd()}/scripts/register-strip-types-loader.mjs`).href,
    'scripts/local-ui-mcp-stdio.mjs'], { env: { NODE_ENV: 'test', MEDIFLOW_AIP_OPERATION_RPC: LOCAL_UI_RPC_MODE, NODE_NO_WARNINGS: '1' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const pending = new Map<number, (value: any) => void>();
  const wire: string[] = [], web: string[] = [], stderr: string[] = [];
  let buffer = '', counter = 0, terminal: (() => void) | undefined, stopped = false;
  child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', text => stderr.push(text));
  child.stdout!.on('data', text => {
    buffer += text;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      wire.push(line); const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id);
    }
  });
  const port = { connection: {}, subscribe(listener: (frame: unknown) => void) {
    child.on('message', listener); return () => { child.off('message', listener); };
  }, publish(frame: string) { child.send(frame); }, onClose() { return () => {}; }, terminate() { child.kill(); } };
  let webListener: ((frame: unknown) => void) | undefined;
  const children = { mcpPort: port, subscribeWeb(listener: (frame: unknown) => void) { webListener = listener; return () => {}; },
    sendWeb(frame: string, done: (error: Error | null) => void) { web.push(frame); done(null); },
    onTerminal(listener: () => void) { terminal = listener; return () => { terminal = undefined; }; },
    terminateAll() { stopped = true; child.kill(); }, terminateMcp() { child.kill(); }, terminateWeb() {} };
  const runtime = createLocalUiSupervisorRuntime(children as unknown as PortableSupervisorProductionChildProcessesV1);
  if (ready) webListener?.(LOCAL_UI_WEB_READY);
  const request = (method: string, params: object) => {
    const id = ++counter;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('synthetic_timeout')), 5_000);
      pending.set(id, value => { clearTimeout(timer); resolve(value); });
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: META } }) + '\n');
    });
  };
  return { request, web, wire, stderr, runtime, ready: () => webListener?.(LOCAL_UI_WEB_READY), terminal: () => terminal?.(), stopped: () => stopped, child };
}

test('real MCP and parent admit only enum navigation before any clinical binding', async () => {
  const f = fixture();
  try {
    const listed = await f.request('tools/list', {});
    assert.deepEqual(listed.result.tools.map((tool: any) => tool.name), [LOCAL_UI_TOOL_ID]);
    for (const intent of LOCAL_UI_INTENTS) {
      const result = await f.request('tools/call', { name: LOCAL_UI_TOOL_ID, arguments: { intent } });
      assert.deepEqual(result.result, { content: [{ type: 'text', text: 'continue_in_mediflow' }], structuredContent: LOCAL_UI_RESULT });
    }
    assert.equal(f.web.length, 4);
    for (const input of [{ intent: SENTINEL }, { intent: 'search', patientId: SENTINEL },
      { intent: 'history', profile: 'clinical' }, { intent: 'search', capability: SENTINEL },
      { intent: 'search', _meta: { secret: SENTINEL } }, {}, { [SENTINEL]: 'history' }]) {
      const result = await f.request('tools/call', { name: LOCAL_UI_TOOL_ID, arguments: input });
      assert.equal(result.result.isError, true);
      assert.equal(result.result.content[0].text, 'MediFlow navigation unavailable.');
    }
    for (const name of ['mediflow.patient.open_loops.read.v1', 'patient-profile.read.v1',
      'mediflow.terminology.search.v1', 'mediflow.semantic_query_plan.execute.v1',
      'mediflow.patient.checkup.status.transition.v1', SENTINEL]) {
      assert.ok((await f.request('tools/call', { name, arguments: { secret: SENTINEL } })).error);
    }
    await f.request('resources/read', { uri: `ui://${SENTINEL}` });
    await f.request('prompts/get', { name: SENTINEL });
    assert.equal(f.web.length, 4);
    assert.doesNotMatch([...f.wire, ...f.stderr, ...f.web].join('\n'), new RegExp(SENTINEL));
    f.terminal(); await f.runtime.closed; assert.equal(f.stopped(), true);
    assert.equal(f.runtime.terminate(), false);
  } finally { f.runtime.terminate(); }
});

test('parent RPC denies clinical IDs, forged capabilities/profile and duplicate requests before services', async () => {
  let receive!: (frame: unknown) => void;
  const output: any[] = [], web: string[] = [];
  const children = { subscribeWeb(listener: (frame: unknown) => void) { listener(LOCAL_UI_WEB_READY); return () => {}; }, mcpPort: { subscribe(listener: typeof receive) { receive = listener; return () => {}; },
    publish(frame: string) { output.push(JSON.parse(frame)); } }, sendWeb(frame: string, done: (error: Error | null) => void) { web.push(frame); done(null); },
    onTerminal() { return () => {}; }, terminateAll() {} };
  const runtime = createLocalUiSupervisorRuntime(children as unknown as PortableSupervisorProductionChildProcessesV1);
  let sequence = 0;
  const call = (operationId: string, input: unknown, extras = {}) => {
    receive(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call',
      requestId: `rpc_test_${++sequence}`, operationId, input, ...extras }));
  };
  const { OPERATION_DESCRIPTORS } = await import('../../packages/mcp/src/contracts.ts');
  for (const descriptor of OPERATION_DESCRIPTORS) call(descriptor.operationId, { secret: SENTINEL });
  call(LOCAL_UI_TOOL_ID, { intent: 'search', profile: 'clinical' });
  call(LOCAL_UI_TOOL_ID, { intent: 'search' }, { capabilityId: 'patient-profile.read.v1' });
  call(LOCAL_UI_TOOL_ID, { intent: SENTINEL });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(output.every(frame => frame.outcome === 'denied'));
  assert.equal(web.length, 0);
  const frame = JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call',
    requestId: 'rpc_once', operationId: LOCAL_UI_TOOL_ID, input: { intent: 'search' } });
  receive(frame); receive(frame);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(web.length, 1); assert.ok(output.some(value => value.denialCode === 'request_conflict'));
  assert.doesNotMatch(JSON.stringify(output), new RegExp(SENTINEL));
  runtime.terminate(); receive(frame); assert.equal(web.length, 1);
});

test('private Web navigation opens a constant URL, broadcasts only to current documents and never replays', () => {
  const channel = new EventEmitter(), opened: string[] = [], seen: string[] = [];
  const target = {} as typeof globalThis;
  const close = installLocalUiWebNavigation(channel, 'http://127.0.0.1:12345', (url: string) => opened.push(url), target);
  const send = (intent: string, extras = {}) => channel.emit('message', JSON.stringify({ schemaVersion: 'mediflow.local-ui.navigation.v1', intent, ...extras }));
  send('search'); send('history');
  assert.deepEqual(opened, ['http://127.0.0.1:12345/plugin-local-ui', 'http://127.0.0.1:12345/plugin-local-ui']);
  (target as unknown as Record<symbol, unknown>)[Symbol.for('mediflow.local-ui.navigation.v1')] = (intent: string) => { seen.push(intent); return true; };
  assert.deepEqual(seen, []);
  send('identity'); assert.deepEqual(seen, ['identity']);
  send(SENTINEL); send('search', { patientId: SENTINEL });
  assert.deepEqual(seen, ['identity']);
  channel.emit('disconnect'); send('history'); assert.deepEqual(seen, ['identity']); close();
});

test('restricted parent composition contains no clinical owner, lease, port or service imports', () => {
  const source = readFileSync(new URL('./portable-supervisor-local-ui.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /create.*(?:Owner|Lease|Mirror|Audit)|patient-profile|checkup|db-server|authenticated-agent-launcher/u);
});

 test('cold first tools/call waits for private Web transport readiness, cancellation never replays', async () => {
  const f = fixture(false);
  try {
    await f.request('tools/list', {});
    const call = f.request('tools/call', { name: LOCAL_UI_TOOL_ID, arguments: { intent: 'search' } });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.web.length, 0);
    f.ready(); assert.equal((await call).result.structuredContent.status, 'continue_in_mediflow');
    assert.equal(f.web.length, 1);
  } finally { f.runtime.terminate(); }
  const cancelled = fixture(false);
  try {
    await cancelled.request('tools/list', {});
    void cancelled.request('tools/call', { name: LOCAL_UI_TOOL_ID, arguments: { intent: 'history' } }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    cancelled.runtime.terminate(); cancelled.ready();
    assert.equal(cancelled.web.length, 0);

  } finally { cancelled.runtime.terminate(); }
});
