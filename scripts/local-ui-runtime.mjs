import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ordinaryLauncherEnvironment } from '../plugins/mediflow-local-ui/src/runtime-environment.mjs';
import { prepareLauncherState } from './launcher-state.mjs';
import { probeRunningInstance, readProductIdentity } from './launcher-helpers.mjs';

const unavailable = () => { throw new Error('navigation_unavailable'); };
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};

export async function navigateExistingLocalUiRuntime(receipt, expected, intent, signal, expiresAt = Date.now() + 8000) {
  signal.throwIfAborted();
  if (!receipt || receipt.checkoutPath !== expected.sourceRoot || !alive(receipt.pid)) return unavailable();
  if (receipt.choiceUrl === undefined) return false;
  if (receipt.dataDir !== expected.dataDir
    || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[a-f0-9]{48}\/$/u.test(receipt.choiceUrl)) return unavailable();
  const status = await fetch(new URL('state', receipt.choiceUrl), { signal });
  if (!status.ok) return unavailable();
  const state = await status.json();
  if (!state.ready) return false;
  if (state.navigationReady !== true) return unavailable();
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(state.url)
    || !(await probeRunningInstance(state.url, expected.sourceFingerprint)).ok) return unavailable();
  const requestId = crypto.randomUUID();
  const headers = { Origin: new URL(receipt.choiceUrl).origin, 'Content-Type': 'application/json' };
  let revocation;
  const cancel = () => revocation ??= (async () => {
    try { await fetch(new URL('cancel-navigation', receipt.choiceUrl), { method: 'POST', headers,
      body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(1000) }); } catch { /* Best-effort revocation; the handoff also expires. */ }
  })();
  const abort = () => { void cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const response = await fetch(new URL('navigate', receipt.choiceUrl), { method: 'POST', signal, headers,
      body: JSON.stringify({ intent, requestId, expiresAt }) });
    signal.throwIfAborted();
    if (response.status !== 202) return unavailable();
  } catch (error) { await cancel(); throw error; }
  finally { signal.removeEventListener('abort', abort); }
  return true;
}

export function createLocalUiRuntimeNavigator({ sourceRoot, dataDir, revision }) {
  if (!path.isAbsolute(sourceRoot) || fs.realpathSync(sourceRoot) !== sourceRoot
    || !path.isAbsolute(dataDir) || fs.realpathSync(dataDir) !== dataDir) return unavailable();
  const identity = readProductIdentity(sourceRoot);
  if (identity.worktreeHash !== 'clean' || identity.revision !== revision.slice(0, 12)) return unavailable();
  const expected = { sourceRoot, dataDir, sourceFingerprint: identity.sourceFingerprint };
  const receiptFile = path.join(prepareLauncherState(sourceRoot).lockDirectory, 'instance.json');
  const read = () => {
    try {
      const stat = fs.lstatSync(receiptFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
        || (process.getuid && stat.uid !== process.getuid())) return unavailable();
      return JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  let starting = null;
  const start = async () => {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
    });
    const child = spawn(process.execPath, [path.join(sourceRoot, 'scripts/mediflow.mjs'), '--riusa'], {
      cwd: sourceRoot, detached: true, stdio: 'ignore', shell: false,
      env: { ...ordinaryLauncherEnvironment(dataDir), PORT: String(port) },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  };
  return async (intent, signal) => {
    const expiresAt = Date.now() + 8000;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    deadline.throwIfAborted();
    const first = read();
    if (!first || !alive(first.pid)) { starting ??= start().finally(() => { starting = null; }); await starting; }
    for (;;) {
      deadline.throwIfAborted();
      const receipt = read();
      if (receipt && alive(receipt.pid) && await navigateExistingLocalUiRuntime(receipt, expected, intent, deadline, expiresAt)) return;
      await new Promise(resolve => { const timer = setTimeout(resolve, 100); timer.unref(); });
    }
  };
}
