import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { trackClose, stopServer } from './owned-server.mjs';

test('a server that exits before readiness does not block the cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
  const closed = trackClose(child);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.notEqual(child.exitCode, null);
  const outcome = await Promise.race([stopServer(child, closed).then(() => 'stopped'),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 3000))]);
  assert.equal(outcome, 'stopped');
});

test('a running server is stopped and its close awaited', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const closed = trackClose(child);
  await stopServer(child, closed);
  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
