#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readProductIdentity, probeRunningInstance } from './launcher-helpers.mjs';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-launcher-smoke-'));
const identity = readProductIdentity();
const port = Number(process.env.PORT || 3000);
const url = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/mediflow.mjs', '--scelta', 'web', '--senza-browser'], {
  env: { ...process.env, MEDIFLOW_DATA_DIR: fixture, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
  stdio: ['ignore', 'inherit', 'pipe', 'ipc'], detached: process.platform !== 'win32',
});
let diagnostic = '', choiceUrl, launchError;
const exited = new Promise(resolve => child.once('exit', resolve));
let stopAttempt = null;
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
child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
  diagnostic = (diagnostic + chunk).slice(-32768);
  choiceUrl ||= diagnostic.match(/Avvio: (http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/)/u)?.[1];
});
child.on('error', error => { launchError = error; diagnostic += error.message; });
let stopped = false;
try {
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
  const go = await fetch(new URL('go', choiceUrl), { redirect: 'manual' });
  assert.equal(go.status, 303);
  assert.equal(go.headers.get('location'), url);
  const second = spawn(process.execPath, ['scripts/mediflow.mjs', '--scelta', 'web', '--senza-browser'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: fixture }, stdio: 'pipe',
  });
  let reuse = '';
  second.stderr.on('data', chunk => { reuse += chunk; });
  const reused = await new Promise((resolve, reject) => { second.once('error', reject); second.once('exit', resolve); });
  assert.equal(reused, 0, reuse);
  assert.match(reuse, /già attivo/u);
  await requestStop(15000);
  assert.equal(child.exitCode, 0);
  assert.equal((await probeRunningInstance(url, identity.sourceFingerprint)).ok, false, 'Owned web server must stop');
  stopped = true;
  console.log('[smoke] PASS: unified launcher, verified fingerprint, redirect, same-folder reuse and shutdown.');
} finally {
  if (stopped) fs.rmSync(fixture, { recursive: true, force: true });
  else {
    if (!stopAttempt && child.exitCode === null && child.signalCode === null) {
      try { await requestStop(1000); } catch (error) { console.error(`[smoke] ${error.message}`); }
    }
    console.error(`[smoke] FAIL: fixture conservata per verifica: ${fixture}`);
  }
}
