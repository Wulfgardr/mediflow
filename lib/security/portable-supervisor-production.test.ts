/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

import {
  decodePortableSupervisorWebIpcFrameV1,
  encodePortableSupervisorWebIpcFrameV1,
} from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
import type { PortableSupervisorProductionChildProcessesV1 } from
  './portable-supervisor-child-processes.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-supervisor-runtime-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const bootstrap = new Database(path.join(dataDir, 'medical.db'));
for (const migration of fs.readdirSync(path.join(process.cwd(), 'drizzle'))
  .filter((name) => name.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(process.cwd(), 'drizzle', migration), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();

const { createPortableSupervisorProductionRuntimeV1 } = await import('./portable-supervisor-production.ts');
const { dbServer } = await import('../db-server.ts');
after(() => { dbServer.$client.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const SCHEMA = 'mediflow.portable-supervisor.web-ipc.v1';
const REQUEST = `pswr_${'1'.repeat(32)}`;
const CHALLENGE = `pswc_${'2'.repeat(64)}`;
const capture = Object.freeze({
  schemaVersion: 'mediflow.portable-supervisor.web-capture.v1',
  userRef: `user.${'3'.repeat(64)}`, parentRef: `parent.${'4'.repeat(64)}`,
  patientId: 'patient.synthetic.supervisor.runtime',
  ambulatoryId: 'ambulatory.synthetic.supervisor.runtime',
  selectionEpoch: 2, expectedPatientVersion: 7, expiresAt: 20_000,
});

function request(value: Record<string, unknown>): string {
  return encodePortableSupervisorWebIpcFrameV1({ schemaVersion: SCHEMA, requestRef: REQUEST, ...value });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
  throw new Error('synthetic wait timed out');
}

function fixture() {
  let now = 1_000;
  let webListener: ((frame: unknown) => void) | null = null;
  let terminalListener: ((reason: 'web_disconnect' | 'mcp_disconnect') => void) | null = null;
  const events: string[] = [], sent: string[] = [];
  const sendCallbacks: Array<(error: Error | null) => void> = [];
  const scheduled: Array<{ active: boolean; callback: () => void }> = [];
  const launch = deferred<Readonly<{
    schemaVersion: 'mediflow.headless.authenticated-launch.v1'; status: 'authenticated'; close(): boolean;
  }>>();
  let active = false;
  const mirror = Object.freeze({
    activate: () => { events.push('mirror.activate'); active = true; return true; },
    readHostContext: () => {
      if (!active) throw new Error('synthetic context absent');
      return Object.freeze({ expiresAt: 19_000 });
    },
    revoke: () => { events.push('mirror.revoke'); const changed = active; active = false; return changed; },
  });
  const children: PortableSupervisorProductionChildProcessesV1 = Object.freeze({
    mcpPort: Object.freeze({
      connection: Object.freeze({}), subscribe: () => () => undefined,
      publish: () => undefined, onClose: () => () => undefined,
      terminate: () => { events.push('mcp.port.terminate'); },
    }),
    subscribeWeb: (listener: (frame: unknown) => void) => {
      webListener = listener; return () => { webListener = null; events.push('web.unsubscribe'); };
    },
    sendWeb: (frame: string, complete: (error: Error | null) => void) => {
      sent.push(frame); events.push(`web.send.${decodePortableSupervisorWebIpcFrameV1(frame).outcome}`);
      sendCallbacks.push(complete);
    },
    onTerminal: (listener: (reason: 'web_disconnect' | 'mcp_disconnect') => void) => {
      terminalListener = listener; return () => { terminalListener = null; events.push('child.unsubscribe'); };
    },
    terminateMcp: () => { events.push('mcp.terminate'); },
    terminateWeb: () => { events.push('web.terminate'); },
    terminateAll: () => { events.push('all.terminate'); },
  });
  const runtime = createPortableSupervisorProductionRuntimeV1({
    now: () => now, nextChallenge: () => CHALLENGE,
    schedule: (delay, callback) => {
      assert.equal(delay, 250); const timer = { active: true, callback }; scheduled.push(timer);
      events.push('web.drain.scheduled'); return () => { timer.active = false; };
    },
    mirror, children,
    launchMcp: () => { events.push('mcp.launch'); return launch.promise; },
  });
  return {
    runtime, events, sent, sendCallbacks, launch,
    send(frame: unknown) { assert.ok(webListener); webListener(frame); },
    childExit(reason: 'web_disconnect' | 'mcp_disconnect') { assert.ok(terminalListener); terminalListener(reason); },
    drainAck() {
      let timer = scheduled.shift();
      while (timer && !timer.active) timer = scheduled.shift();
      assert.ok(timer?.active); timer.active = false; timer.callback();
    },
    setNow(value: number) { now = value; },
  };
}

async function prepare(current: ReturnType<typeof fixture>): Promise<string> {
  current.send(request({ method: 'prepare' }));
  await waitFor(() => current.sent.length === 1);
  const prepared = decodePortableSupervisorWebIpcFrameV1(current.sent[0]);
  assert.equal(prepared.outcome, 'prepared');
  current.sendCallbacks.shift()?.(null);
  return prepared.challenge as string;
}

test('emits activated only after launch resolves and the bound context is reread', async () => {
  const current = fixture();
  const challenge = await prepare(current);
  current.send(request({ method: 'activate', challenge, capture }));
  await waitFor(() => current.events.includes('mcp.launch'));
  assert.equal(current.sent.length, 1);
  current.launch.resolve(Object.freeze({
    schemaVersion: 'mediflow.headless.authenticated-launch.v1', status: 'authenticated',
    close: () => { current.events.push('session.close'); return true; },
  }));
  await waitFor(() => current.sent.length === 2);
  const activated = decodePortableSupervisorWebIpcFrameV1(current.sent[1]);
  assert.equal(activated.outcome, 'activated'); assert.equal(activated.expiresAt, 19_000);
  assert.deepEqual(current.events.slice(0, 3), ['web.send.prepared', 'mirror.activate', 'mcp.launch']);
  current.sendCallbacks.shift()?.(null);
  current.runtime.terminate(); await current.runtime.closed;
});

test('revokes authority and MCP before waiting for the revoke ACK send callback', async () => {
  const current = fixture();
  const challenge = await prepare(current);
  current.send(request({ method: 'activate', challenge, capture }));
  current.launch.resolve(Object.freeze({
    schemaVersion: 'mediflow.headless.authenticated-launch.v1', status: 'authenticated',
    close: () => { current.events.push('session.close'); return true; },
  }));
  await waitFor(() => current.sent.length === 2); current.sendCallbacks.shift()?.(null);

  current.send(request({ method: 'revoke_all', reason: 'application_lock' }));
  await waitFor(() => current.sent.length === 3);
  const revoked = decodePortableSupervisorWebIpcFrameV1(current.sent[2]);
  assert.equal(revoked.outcome, 'revoked');
  assert.deepEqual(current.events.slice(-5), [
    'session.close', 'mirror.revoke', 'mcp.terminate',
    'web.drain.scheduled', 'web.send.revoked',
  ]);
  assert.equal(current.events.includes('web.terminate'), false);
  current.send(request({ method: 'revoke_all', reason: 'explicit',
    requestRef: `pswr_${'5'.repeat(32)}` }));
  assert.equal(current.sent.length, 3);
  current.sendCallbacks.shift()?.(null);
  assert.equal(current.events.includes('web.terminate'), false);
  current.drainAck(); await current.runtime.closed;
  assert.equal(current.events.filter((event) => event === 'web.terminate').length, 1);
  assert.equal(current.events.filter((event) => event === 'mirror.revoke').length, 1);
});

test('drains an activation denial after a terminal launcher failure, then stops Web once', async () => {
  const current = fixture(); const challenge = await prepare(current);
  current.send(request({ method: 'activate', challenge, capture }));
  current.launch.reject(new Error('synthetic launcher failure'));
  await waitFor(() => current.sent.length === 2);
  const denied = decodePortableSupervisorWebIpcFrameV1(current.sent[1]);
  assert.equal(denied.outcome, 'denied'); assert.equal(denied.denialCode, 'activation_failed');
  assert.equal(current.events.includes('mcp.terminate'), true);
  assert.equal(current.events.includes('web.terminate'), false);
  current.sendCallbacks.shift()?.(null); current.drainAck(); await current.runtime.closed;
  assert.equal(current.events.filter((event) => event === 'web.terminate').length, 1);
  assert.equal(current.events.filter((event) => event === 'mirror.revoke').length, 1);
});

test('bounds a terminal ACK whose Web send callback never settles', async () => {
  const current = fixture();
  const challenge = await prepare(current);
  current.send(request({ method: 'activate', challenge, capture }));
  current.launch.resolve(Object.freeze({
    schemaVersion: 'mediflow.headless.authenticated-launch.v1', status: 'authenticated',
    close: () => { current.events.push('session.close'); return true; },
  }));
  await waitFor(() => current.sent.length === 2); current.sendCallbacks.shift()?.(null);

  current.send(request({ method: 'revoke_all', reason: 'logout' }));
  await waitFor(() => current.sent.length === 3);
  assert.equal(current.events.includes('mirror.revoke'), true);
  current.drainAck();
  await current.runtime.closed;
  assert.equal(current.events.filter((event) => event === 'web.terminate').length, 1);
});

test('child loss or malformed Web IPC terminalizes the complete topology once', async () => {
  for (const mode of ['child', 'protocol'] as const) {
    const current = fixture();
    if (mode === 'child') current.childExit('mcp_disconnect');
    else current.send('{"noncanonical":true}');
    await current.runtime.closed;
    assert.equal(current.events.filter((event) => event === 'mcp.terminate').length >= 1, true);
    assert.equal(current.events.filter((event) => event === 'web.terminate').length, 1);
    assert.equal(current.runtime.terminate(), false);
  }
});
