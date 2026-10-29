import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { ordinaryLauncherEnvironment } from '../plugins/mediflow-local-ui/src/runtime-environment.mjs';
import { localUiArchiveLock } from './launcher-state.mjs';
import { readProductIdentity } from './launcher-helpers.mjs';

const unavailable = () => { throw new Error('navigation_unavailable'); };
export async function navigateOwnedLocalUiRuntime(child, intent, signal, expiresAt = Date.now() + 8000, expected) {
  signal.throwIfAborted();
  if (!child?.connected || typeof child.send !== 'function' || child.exitCode !== null || child.signalCode !== null) return unavailable();
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      if (child.connected) child.send({ type: 'mediflow-local-ui-cancel', requestId }, () => {});
    };
    let settled = false;
    const finish = (error, ready) => {
      if (settled) return;
      settled = true;
      child.off('message', message); child.off('exit', exited); child.off('disconnect', exited);
      signal.removeEventListener('abort', abort);
      if (error) { cancel(); reject(error); } else resolve(ready);
    };
    const abort = () => finish(signal.reason);
    const exited = () => finish(new Error('navigation_unavailable'));
    const message = frame => {
      if (frame?.type !== 'mediflow-local-ui-result' || frame.requestId !== requestId) return;
      if (signal.aborted) return abort();
      if (frame.status === 'waiting') finish(null, false);
      else if (frame.status === 'accepted') finish(null, true);
      else finish(new Error('navigation_unavailable'));
    };
    child.on('message', message); child.once('exit', exited); child.once('disconnect', exited);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    child.send({ type: 'mediflow-local-ui-navigate', requestId, intent, expiresAt,
      sourceFingerprint: expected?.sourceFingerprint, dataDir: expected?.dataDir }, error => { if (error) finish(error); });
  });
}

export function createLocalUiRuntimeNavigator({ sourceRoot, dataDir, revision }) {
  if (!path.isAbsolute(sourceRoot) || fs.realpathSync(sourceRoot) !== sourceRoot
    || !path.isAbsolute(dataDir) || fs.realpathSync(dataDir) !== dataDir) return unavailable();
  const identity = readProductIdentity(sourceRoot);
  if (identity.worktreeHash !== 'clean' || identity.revision !== revision.slice(0, 12)) return unavailable();
  const expected = { sourceFingerprint: identity.sourceFingerprint, dataDir };
  let starting = null, launcher = null, startingChild = null, closed = false;
  const start = async signal => {
    const port = await archiveBrowserPort(dataDir);
    if (closed || signal.aborted) return unavailable();
    const child = spawn(process.execPath, [path.join(sourceRoot, 'scripts/mediflow.mjs'), '--riusa'], {
      cwd: sourceRoot, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], shell: false,
      env: { ...ordinaryLauncherEnvironment(dataDir), PORT: String(port) },
    });
    startingChild = child;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('navigation_unavailable')), 8000);
        const exited = () => finish(new Error('navigation_unavailable'));
        const abort = () => finish(new Error('navigation_unavailable'));
        const receive = frame => {
          if (frame?.type !== 'mediflow-local-ui-connected') return;
          finish(frame.dataDir === expected.dataDir && frame.sourceFingerprint === expected.sourceFingerprint
            ? null : new Error('navigation_unavailable'));
        };
        const finish = error => {
          clearTimeout(timer); signal.removeEventListener('abort', abort); child.off('message', receive); child.off('error', exited);
          child.off('exit', exited); child.off('disconnect', exited);
          if (error) { if (child.connected) child.disconnect(); reject(error); } else resolve();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        child.on('message', receive); child.once('error', exited); child.once('exit', exited); child.once('disconnect', exited);
      });
      if (!child.connected || child.exitCode !== null || child.signalCode !== null) return unavailable();
      launcher = child;
      const retire = () => { if (launcher === child) launcher = null; };
      child.once('exit', retire); child.once('disconnect', retire);
    } finally { startingChild = null; child.unref(); child.channel?.unref(); }
  };
  const navigate = async (intent, signal) => {
    if (closed) return unavailable();
    const expiresAt = Date.now() + 8000;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    deadline.throwIfAborted();
    if (!launcher) { starting ??= start(deadline).finally(() => { starting = null; }); await starting; }
    for (;;) {
      deadline.throwIfAborted();
      if (await navigateOwnedLocalUiRuntime(launcher, intent, deadline, expiresAt, expected)) return;
      await new Promise(resolve => { const timer = setTimeout(resolve, 100); timer.unref(); });
    }
  };
  navigate.close = () => {
    closed = true;
    if (startingChild?.connected) startingChild.disconnect();
    if (launcher?.connected) launcher.disconnect();
    launcher = null;
  };
  return navigate;
}

export async function archiveBrowserPort(dataDir) {
  const file = path.join(path.dirname(localUiArchiveLock(dataDir)), 'browser-port.json');
  const read = () => {
    if (fs.lstatSync(file).isSymbolicLink()) return unavailable();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 || process.getuid && stat.uid !== process.getuid()) return unavailable();
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (Object.keys(value).join(',') !== 'port' || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) return unavailable();
      return value.port;
    } finally { fs.closeSync(fd); }
  };
  try { return read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const port = server.address().port;
    try { fs.writeFileSync(file, JSON.stringify({ port }), { flag: 'wx', mode: 0o600 }); return port; }
    catch (error) { if (error.code !== 'EEXIST') throw error; return read(); }
  } finally { await new Promise(resolve => server.close(resolve)); }
}
