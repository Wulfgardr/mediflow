/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPortableSupervisorProductionChildProcessesV1 } from '../lib/security/portable-supervisor-child-processes.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GRACE_MS = 5_000;
const READY_TIMEOUT_MS = 5_000;
const EXIT_TIMEOUT_MS = GRACE_MS + 3_000;

class SyntheticChild extends EventEmitter {
  connected = true;
  exitCode = null;
  signalCode = null;
  killed = false;
  signals = [];
  failGracefulSignal = false;

  disconnect() { this.connected = false; this.emit('disconnect'); }
  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    if (this.failGracefulSignal && signal === 'SIGTERM') throw new Error('synthetic signal error');
    this.killed = true;
    return true;
  }
  send(_frame, complete) { complete?.(null); return true; }
  exit(signal = null) {
    this.exitCode = signal === null ? 0 : null;
    this.signalCode = signal;
    this.emit('exit', this.exitCode, signal);
    this.emit('close', this.exitCode, signal);
  }
}

// These files are test-only JavaScript targets, not substitutes for the product loader,
// Mini client, authentication owner, database, or a standalone Next.js bundle.
function fixture(t, spawnChild, childSource = 'export {};\n') {
  const directory = fs.mkdtempSync(path.join(ROOT, 'scripts', '.supervisor-shutdown-test-'));
  const dataDir = path.join(directory, 'data');
  const webDirectory = path.join(directory, 'web');
  const loaderPath = path.join(directory, 'empty-test-loader.mjs');
  const mcpTargetPath = path.join(directory, 'synthetic-agent.mjs');
  const webTargetPath = path.join(webDirectory, 'synthetic-web.mjs');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(webDirectory);
  fs.writeFileSync(loaderPath, 'export {};\n');
  fs.writeFileSync(mcpTargetPath, childSource);
  fs.writeFileSync(webTargetPath, childSource);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { dataDir, webDirectory, loaderPath, mcpTargetPath, webTargetPath, spawnChild };
}

function syntheticPair(t) {
  const mcp = new SyntheticChild();
  const web = new SyntheticChild();
  const calls = [];
  const options = fixture(t, (command, args, spawnOptions) => {
    calls.push({ command, args, options: spawnOptions });
    return calls.length === 1 ? mcp : web;
  });
  const children = createPortableSupervisorProductionChildProcessesV1(options);
  t.after(() => { mcp.exit(); web.exit(); });
  return { mcp, web, children, calls, options };
}

function mockClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
}

test('shutdown immediately severs IPC, stays synchronous, and preserves the spawn boundary', (t) => {
  mockClock(t);
  const { mcp, web, children, calls, options } = syntheticPair(t);
  const terminal = [];
  children.onTerminal((reason) => terminal.push(reason));
  assert.deepEqual(calls[0].options.env, { MEDIFLOW_AIP_OPERATION_RPC: 'late_bound_authenticated_inherited_child_ipc_v1' });
  assert.deepEqual(calls[1].options.env, {
    NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000', MEDIFLOW_DATA_DIR: options.dataDir,
  });
  assert.deepEqual(calls[0].options.stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
  assert.deepEqual(calls[1].options.stdio, ['ignore', 2, 2, 'ipc']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[1].options.shell, false);
  assert.equal(children.terminateAll(), undefined);
  assert.equal(mcp.connected, false);
  assert.equal(web.connected, false);
  assert.deepEqual(mcp.signals, ['SIGTERM']);
  assert.deepEqual(web.signals, ['SIGTERM']);
  assert.throws(() => children.mcpPort.publish('synthetic'), /mcp_disconnected/);
  let webError;
  children.sendWeb('synthetic', (error) => { webError = error; });
  assert.equal(webError?.message, 'web_disconnected');
  assert.deepEqual(terminal, []);
});

test('a delivered SIGTERM is not an exit; escalation is bounded and terminate is idempotent', (t) => {
  mockClock(t);
  const { mcp, web, children } = syntheticPair(t);
  children.terminateMcp();
  assert.equal(mcp.killed, true);
  t.mock.timers.tick(GRACE_MS - 1);
  children.terminateMcp();
  assert.deepEqual(mcp.signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  assert.deepEqual(mcp.signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(GRACE_MS * 2);
  assert.deepEqual(mcp.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(web.signals, []);
});

test('Mini keeps its fixed --session launch and the same bounded agent shutdown', (t) => {
  mockClock(t);
  const mcp = new SyntheticChild();
  const web = new SyntheticChild();
  const calls = [];
  const options = fixture(t, (command, args, spawnOptions) => {
    calls.push({ command, args, options: spawnOptions });
    return calls.length === 1 ? mcp : web;
  });
  const children = createPortableSupervisorProductionChildProcessesV1({ ...options, agentKind: 'mini' });
  t.after(() => { mcp.exit(); web.exit(); });
  assert.deepEqual(calls[0].args.slice(-2), [
    fs.realpathSync(path.join(ROOT, 'packages', 'mini', 'src', 'cli.ts')), '--session',
  ]);
  assert.deepEqual(calls[0].options.env, {
    MEDIFLOW_AIP_OPERATION_RPC: 'late_bound_authenticated_inherited_child_ipc_v1',
  });
  assert.equal(children.mcpPort.terminate(), undefined);
  assert.equal(mcp.connected, false);
  t.mock.timers.tick(GRACE_MS);
  assert.deepEqual(mcp.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(web.signals, []);
});

test('graceful exit cancels escalation for each exact child and removes shutdown listeners', (t) => {
  mockClock(t);
  const { mcp, web, children } = syntheticPair(t);
  const initialErrors = mcp.listenerCount('error');
  children.terminateAll();
  mcp.exit();
  web.exit('SIGTERM');
  t.mock.timers.tick(GRACE_MS * 2);
  assert.deepEqual(mcp.signals, ['SIGTERM']);
  assert.deepEqual(web.signals, ['SIGTERM']);
  assert.equal(mcp.listenerCount('error'), initialErrors);
});

test('a child already signalled but still alive is not exempt from the cleanup deadline', (t) => {
  mockClock(t);
  const { mcp, children } = syntheticPair(t);
  mcp.killed = true;
  children.terminateMcp();
  assert.deepEqual(mcp.signals, []);
  t.mock.timers.tick(GRACE_MS);
  assert.deepEqual(mcp.signals, ['SIGKILL']);
});

test('an error or a failed graceful signal does not falsely prove exit', (t) => {
  mockClock(t);
  const { mcp, children } = syntheticPair(t);
  mcp.failGracefulSignal = true;
  children.terminateMcp();
  assert.doesNotThrow(() => mcp.emit('error', new Error('synthetic shutdown error')));
  t.mock.timers.tick(GRACE_MS);
  assert.deepEqual(mcp.signals, ['SIGTERM', 'SIGKILL']);
});

test('close without exit cancels escalation, including asynchronous spawn failure cleanup', (t) => {
  mockClock(t);
  const mcp = new SyntheticChild();
  let calls = 0;
  const options = fixture(t, () => {
    if (++calls === 1) return mcp;
    throw new Error('synthetic web spawn failure');
  });
  assert.throws(() => createPortableSupervisorProductionChildProcessesV1(options), /web_spawn_failed/);
  // A failed spawn can emit error/close on a later turn, before normal watchers were installed.
  assert.doesNotThrow(() => mcp.emit('error', new Error('synthetic asynchronous spawn error')));
  mcp.emit('close', null, null);
  t.mock.timers.tick(GRACE_MS * 2);
  assert.deepEqual(mcp.signals, ['SIGTERM']);
  assert.equal(mcp.listenerCount('error'), 0);
});

test('partial startup still escalates the first child when the second spawn throws', (t) => {
  mockClock(t);
  const mcp = new SyntheticChild();
  let calls = 0;
  const options = fixture(t, () => {
    if (++calls === 1) return mcp;
    throw new Error('synthetic web spawn failure');
  });
  t.after(() => mcp.exit());
  assert.throws(() => createPortableSupervisorProductionChildProcessesV1(options), /web_spawn_failed/);
  t.mock.timers.tick(GRACE_MS);
  assert.deepEqual(mcp.signals, ['SIGTERM', 'SIGKILL']);
});

test('already exited children are never signalled again', (t) => {
  mockClock(t);
  const { mcp, web, children } = syntheticPair(t);
  mcp.exit();
  web.exit('SIGTERM');
  children.terminateAll();
  t.mock.timers.tick(GRACE_MS * 2);
  assert.deepEqual(mcp.signals, []);
  assert.deepEqual(web.signals, []);
});

function within(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function trackChild(child) {
  // Exit proves OS-process termination; close additionally waits for stdio/IPC handles.
  // Install both promises before signalling so a fast Windows exit cannot be missed.
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message === 'synthetic-ready') { cleanup(); resolve(); }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('synthetic child closed before readiness')); };
    const cleanup = () => {
      child.off('message', onMessage); child.off('error', onError); child.off('close', onClose);
    };
    child.on('message', onMessage); child.once('error', onError); child.once('close', onClose);
  });
  return { child, ready, exited };
}

test('real owned children exit after termination even when POSIX SIGTERM is handled', async (t) => {
  const tracked = [];
  // Register process cleanup before fixture directory cleanup (important on Windows).
  t.after(async () => {
    for (const { child } of tracked) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await within(Promise.all(tracked.map(({ exited }) => exited)), 3_000, 'real child cleanup timed out');
  });
  const options = fixture(t, (command, args, spawnOptions) => {
    const child = spawn(command, [...args], spawnOptions);
    tracked.push(trackChild(child));
    return child;
  }, `
process.on('SIGTERM', () => {});
process.on('disconnect', () => {});
setInterval(() => {}, 1_000);
process.send('synthetic-ready');
`);
  const children = createPortableSupervisorProductionChildProcessesV1(options);
  await within(Promise.all(tracked.map(({ ready }) => ready)), READY_TIMEOUT_MS, 'real children not ready');
  const terminal = [];
  children.onTerminal((reason) => terminal.push(reason));
  assert.equal(children.terminateAll(), undefined);
  assert.ok(tracked.every(({ child }) => child.connected === false));
  const exits = await within(Promise.all(tracked.map(({ exited }) => exited)), EXIT_TIMEOUT_MS,
    'owned children remained alive after termination');
  assert.deepEqual(terminal, []);
  for (const exit of exits) {
    // Windows terminates on SIGTERM; POSIX must exercise the delayed SIGKILL path.
    assert.equal(exit.code, null);
    assert.equal(exit.signal, process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
  }
});
