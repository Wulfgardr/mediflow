#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readProductIdentity, probeRunningInstance } from './launcher-helpers.mjs';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-launcher-smoke-'));
const windows = process.platform === 'win32';
const integrity = windows ? await import('./windows-stop-integrity-smoke.mjs') : null;
const data = path.join(fixture, 'archive');
fs.mkdirSync(data);
const env = { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
  ...(windows ? { APPDATA: path.join(fixture, 'profile', 'Roaming'), LOCALAPPDATA: path.join(fixture, 'profile', 'Local') } : {}) };
console.log('[smoke] ' + JSON.stringify({ node: process.version, execPath: process.execPath, uv: process.versions.uv, platform: process.platform }));
const identity = readProductIdentity();
const port = Number(process.env.PORT || 3000);
const url = `http://127.0.0.1:${port}`;
let child, reuseChild, diagnostic, choiceUrl, launchError, exited, stopAttempt;
const launch = () => {
  child = spawn(process.execPath, ['scripts/mediflow.mjs', '--scelta', 'web', '--senza-browser'], {
    env,
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'], detached: process.platform !== 'win32',
  });
  diagnostic = ''; choiceUrl = null; launchError = null;
  const owned = child, creation = crypto.randomUUID();
  console.log('[smoke] ' + JSON.stringify({ type: 'launcher-created', pid: owned.pid, creation, execPath: process.execPath }));
  exited = Promise.all([new Promise(resolve => owned.once('exit', code => { console.log('[smoke] launcher exit ' + owned.pid + ' ' + code); resolve(); })),
    new Promise(resolve => owned.stderr.once('close', () => { console.log('[smoke] ' + JSON.stringify({ type: 'launcher-stderr-close', pid: owned.pid, creation })); resolve(); }))]);
  stopAttempt = null;
  child.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    diagnostic = (diagnostic + chunk).slice(-32768);
    choiceUrl ||= diagnostic.match(/Avvio: (http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/)/u)?.[1];
  });
  child.on('error', error => { launchError = error; diagnostic += error.message; });
};
const requestStop = timeoutMs => {
  stopAttempt ||= (async () => {
    if (!choiceUrl) throw new Error('Sede di arresto del launcher posseduto non disponibile.');
    const controller = new AbortController();
    let timer;
    try {
      await Promise.race([(async () => {
        const response = await fetch(new URL('stop', choiceUrl), { method: 'POST',
          headers: { Origin: new URL(choiceUrl).origin, 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
        assert.equal(response.status, 200);
        await exited;
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Arresto del launcher non verificato entro ${timeoutMs} ms.`)), timeoutMs);
      })]);
    } finally { clearTimeout(timer); controller.abort(); }
  })();
  return stopAttempt;
};
launch();
const ready = async () => {
  const deadline = Date.now() + 15 * 60_000;
  while (true) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, `Launcher exited before readiness: ${diagnostic}`);
    assert.equal(child.signalCode, null, `Launcher terminated before readiness: ${diagnostic}`);
    assert.ok(Date.now() < deadline, 'Launcher build/start timeout (15 minutes)');
    if ((await probeRunningInstance(url, identity.sourceFingerprint)).ok && choiceUrl) {
      const state = await fetch(new URL('state', choiceUrl)).then(response => response.json());
      if (state.ready) break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
};
const generation = async () => {
  const { prepareLauncherState } = await import('./launcher-state.mjs');
  const { lockDirectory } = prepareLauncherState(process.cwd(), { env });
  const active = path.join(lockDirectory, 'active');
  const names = fs.readdirSync(active); assert.equal(names.length, 1);
  const directory = path.join(active, names[0]);
  const owner = JSON.parse(fs.readFileSync(path.join(directory, 'instance.json')));
  assert.equal(owner.pid, child.pid);
  console.log('[smoke] ' + JSON.stringify({ type: 'launcher-owner', pid: child.pid, generation: names[0], directory, data }));
  return directory;
};
let stopped = false;
try {
  await ready();
  const go = await fetch(new URL('go', choiceUrl), { redirect: 'manual' });
  assert.equal(go.status, 303);
  assert.equal(go.headers.get('location'), url);
  const second = spawn(process.execPath, ['scripts/mediflow.mjs', '--scelta', 'web', '--senza-browser'], {
    env, stdio: 'pipe',
  });
  reuseChild = second;
  console.log('[smoke] ' + JSON.stringify({ type: 'reuse-created', pid: second.pid, execPath: process.execPath }));
  let reuse = '';
  second.stderr.on('data', chunk => { reuse += chunk; });
  let reuseTimer;
  let reused;
  try {
    [reused] = await Promise.race([Promise.all([
      new Promise((resolve, reject) => { second.once('error', reject); second.once('exit', resolve); }),
      new Promise(resolve => second.stderr.once('close', resolve)),
    ]), new Promise((_, reject) => { reuseTimer = setTimeout(() => reject(new Error('Reuse child terminal observation missing.')), 5000); })]);
  } finally { clearTimeout(reuseTimer); }
  console.log('[smoke] ' + JSON.stringify({ type: 'reuse-terminal', pid: second.pid, code: reused }));
  assert.equal(reused, 0, reuse);
  assert.match(reuse, /già attivo/u);
  let firstGeneration, token;
  if (windows) {
    firstGeneration = await generation();
    const health = await fetch(new URL('/api/auth/check', url), { signal: AbortSignal.timeout(8000) });
    assert.equal(health.status, 200); assert.equal((await health.json()).db.state, 'ready');
    token = crypto.randomUUID(); integrity.committedArchiveProbe(data, token, true);
  }
  await requestStop(windows ? 8000 : 15000);
  assert.equal(child.exitCode, 0);
  assert.equal((await probeRunningInstance(url, identity.sourceFingerprint)).ok, false, 'Owned web server must stop');
  if (windows) {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }), 'Stopped Web remains reachable');
    assert.equal(fs.existsSync(firstGeneration), false, 'Stopped owner generation remains active');
    integrity.committedArchiveProbe(data, token);
    launch(); await ready();
    const restartedGeneration = await generation();
    assert.notEqual(restartedGeneration, firstGeneration, 'Restart reused the retired generation');
    const health = await fetch(new URL('/api/auth/check', url), { signal: AbortSignal.timeout(8000) });
    assert.equal(health.status, 200); assert.equal((await health.json()).db.state, 'ready');
    integrity.committedArchiveProbe(data, token);
    await requestStop(8000); assert.equal(child.exitCode, 0);
    assert.equal(fs.existsSync(restartedGeneration), false);
    assert.equal((await probeRunningInstance(url, identity.sourceFingerprint)).ok, false);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }), 'Restarted Web remains reachable after Stop');
    await integrity.windowsTransactionTreeProbe(fixture);
    console.log('[smoke] PASS: Windows Web stop/restart and committed archive; separate forced synthetic tree/transaction rollback.');
  }
  stopped = true;
  console.log('[smoke] PASS: unified launcher, verified fingerprint, redirect, same-folder reuse and shutdown.');
} finally {
  if (stopped) fs.rmSync(fixture, { recursive: true, force: true });
  else {
    if (!stopAttempt && child.exitCode === null && child.signalCode === null) {
      try { await requestStop(1000); } catch (error) { console.error(`[smoke] ${error.message}`); }
    }
    console.error(`[smoke] FAIL: fixture conservata per verifica: ${fixture}`);
    for (const owned of [child, reuseChild]) if (owned && owned.exitCode === null && owned.signalCode === null) {
      if (owned.connected) owned.disconnect();
      owned.stderr.unref?.(); owned.stdout?.unref?.(); owned.unref?.();
    }
  }
}
