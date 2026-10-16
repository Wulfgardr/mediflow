#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';
import { appLayout, checkHeadlessRuntime } from './stage-headless-runtime.mjs';
import { OPERATION_DESCRIPTORS, publicCatalog } from '../packages/mcp/src/contracts.ts';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let BASE_URL;
const ORDINARY_URL = 'http://127.0.0.1:3001';
// the same real authenticated smoke, now against an extracted app.
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--app'),
  'Usage: mediflow-headless-supervisor-standalone-smoke.mjs [--app <physical.app>]');
const APP = args[1] ?? null;
const layout = APP ? appLayout(APP) : null;
let expectedWebIdentity;
const ownedPids = new Set();
async function verifyBackendIdentity(url) {
  const response = await fetch(new URL('/api/system/revision', url), { headers: { 'Cache-Control': 'no-store' } });
  assert.equal(response.status, 200, 'Backend revision must be available before login');
  const identity = await response.json();
  assert.equal(identity.revision, expectedWebIdentity.revision.slice(0, 12), 'Backend revision must match the verified Web build');
  assert.equal(identity.sourceFingerprint, expectedWebIdentity.sourceFingerprint, 'Backend source must match the verified Web build');
  assert.equal(identity.fingerprint, expectedWebIdentity.sourceFingerprint);
}
function snapshotApp() {
  if (!APP) return null;
  const records = [];
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      const value = stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile()
        ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
      records.push([path.relative(APP, file), stat.mode, value]);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file);
    }
  };
  walk(APP); return records;
}
function rememberDescendants(pid) {
  const windows = process.platform === 'win32';
  const result = windows
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ParentProcessId }"],
    { encoding: 'utf8', env: process.env, timeout: 30_000, maxBuffer: 1024 * 1024 })
    : spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', env: {}, timeout: 5_000 });
  assert.equal(result.status, 0, 'Cannot observe child cleanup');
  if (windows) assert.match(result.stdout.trim(), /^\d+ \d+(?:\r?\n\d+ \d+)*$/u, 'Invalid process observation');
  const rows = result.stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number));
  const found = new Set([pid]);
  for (;;) {
    const before = found.size;
    for (const [child, parent] of rows) if (found.has(parent)) found.add(child);
    if (found.size === before) break;
  }
  found.delete(pid); for (const child of found) ownedPids.add(child);
  return found.size;
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function assertReaped() {
  for (let attempt = 0; attempt < 200 && [...ownedPids].some(alive); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(![...ownedPids].some(alive), 'Supervisor left a live child after revocation/cleanup');
  ownedPids.clear();
}
function launch(dataDir, foreignCwd) {
  return spawn(process.execPath, layout ? [layout.launcher] : [path.join(ROOT, 'scripts/source-runtime.mjs'), 'headless'], {
    cwd: layout ? foreignCwd : ROOT,
    env: layout ? { MEDIFLOW_DATA_DIR: dataDir, PATH: foreignCwd,
      MEDIFLOW_NODE_BINARY: path.join(foreignCwd, 'node'),
      MEDIFLOW_STRIP_TYPES_NODE: path.join(foreignCwd, 'node'), MEDIFLOW_APP_REVISION: 'caller-must-not-win' }
      : { ...process.env, MEDIFLOW_DATA_DIR: dataDir,
        MEDIFLOW_PROVIDER_V2_ENABLED: '0', MEDIFLOW_PROVIDER_V2_NETWORK: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
async function prebindShutdown(dataDir, foreignCwd, kind) {
  const child = launch(dataDir, foreignCwd);
  const exit = new Promise(resolve => child.once('exit', resolve));
  let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  const rpc = rpcClient(child);
  try {
    BASE_URL = await waitForHeadlessReady(() => stderr, child);
    await verifyBackendIdentity(BASE_URL);
    assert.ok(rememberDescendants(child.pid) >= 2, 'Expected real Web and MCP children');
    await rpc.send('server/discover');
    const denied = await rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
    assert.equal(denied.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    if (kind === 'EOF') child.stdin.end(); else child.kill('SIGTERM');
    assert.equal(await withTimeout(exit, kind + ' cleanup'), 0);
    await assertReaped(); rpc.assertHealthy(); assert.equal(rpc.remainder(), '');
  } finally { await terminateChild(child); }
}
const USERNAME = 'synthetic-supervisor-smoke', PATIENT_ID = 'patient.synthetic.supervisor-smoke';
const DISCLOSURE_SENTINEL = 'SYNTHETIC_C16_PRIVATE_SERVICE_NOT_FOR_AGENT';
const CHECKUP_ID = 'checkup.synthetic.supervisor-smoke', CHECKUP_TITLE = 'Synthetic bounded checkup';
const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'mediflow-production-smoke', version: '1.0.0' },
});
function webMutationHeaders(cookieHeader, archiveGeneration, hasJsonBody = true) {
  assert.match(archiveGeneration, /^[0-9a-f-]{36}$/u);
  return {
    Cookie: cookieHeader,
    'x-mediflow-archive-generation': archiveGeneration,
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
    Origin: BASE_URL,
    'Sec-Fetch-Site': 'same-origin',
  };
}
function withTimeout(promise, label, delayMs = 8_000) {
  return Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), delayMs);
    timer.unref();
  })]);
}
function prepareSyntheticDatabase(dataDir) {
  const prepared = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'prepare-e2e-db.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
      E2E_PIN: '1234', E2E_USERNAME: USERNAME,
      E2E_DISPLAY_NAME: 'Synthetic Supervisor Smoke',
      E2E_AMBULATORY_NAME: 'Synthetic Ambulatory Smoke',
    },
    encoding: 'utf8',
  });
  assert.equal(prepared.status, 0, 'Synthetic database preparation failed');
  assert.equal(fs.existsSync(path.join(dataDir, 'medical.db')), true);
}
function rpcClient(child) {
  let buffer = '', nextId = 1, protocolError = null;
  const pending = new Map(), lines = [];
  const failProtocol = (reason) => {
    if (protocolError) return;
    protocolError = new Error(`Supervisor JSON-RPC protocol error: ${reason}.`);
    for (const { reject } of pending.values()) reject(protocolError);
    pending.clear();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (protocolError) return;
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) { failProtocol('blank stdout frame'); return; }
      let message;
      try { message = JSON.parse(line); }
      catch { failProtocol('malformed stdout frame'); return; }
      if (message?.jsonrpc !== '2.0' || !Number.isSafeInteger(message.id)) {
        failProtocol('invalid JSON-RPC frame'); return;
      }
      lines.push(line);
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle.resolve(message);
      }
    }
  });
  child.stdout.on('error', () => failProtocol('stdout stream failure'));
  child.stdin.on('error', () => failProtocol('stdin stream failure'));
  const send = (method, params = {}) => {
    if (protocolError) return Promise.reject(protocolError);
    const id = nextId;
    nextId += 1;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method,
      params: { ...params, _meta: META } })}\n`);
    return withTimeout(response, method);
  };
  const assertHealthy = () => { if (protocolError) throw protocolError; };
  return Object.freeze({ send, lines, pending, remainder: () => buffer, assertHealthy });
}
function hasExited(child) { return child.exitCode !== null || child.signalCode !== null; }
function waitForExit(child, delayMs) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer); child.off('exit', onExit); resolve(exited);
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    timer = setTimeout(() => finish(hasExited(child)), delayMs);
    timer.unref();
  });
}
async function terminateChild(child) {
  if (!child || hasExited(child)) return;
  const gracefulExit = waitForExit(child, 5_000);
  child.kill('SIGTERM');
  if (await gracefulExit) return;
  const forcedExit = waitForExit(child, 2_000);
  child.kill('SIGKILL');
  await forcedExit;
}
async function waitForReady(readStderr, child) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    if (readStderr().includes('Ready in')) return;
    if (child.exitCode !== null) throw new Error('Production Supervisor exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Production Supervisor did not become ready');
}
async function waitForHeadlessReady(readStderr, child) {
  for (let attempt = 0; attempt < 6_000; attempt += 1) {
    const match = readStderr().match(/^MEDIFLOW_HEADLESS_WEB_READY (.+)$/mu);
    if (match) {
      const { url } = JSON.parse(match[1]);
      assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/u);
      const address = new URL(url);
      assert.ok(Number(address.port) <= 65535);
      return url;
    }
    if (hasExited(child)) throw new Error('Production Supervisor exited before Web address readiness');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Production Supervisor did not publish its ready Web address');
}
async function concurrentSupervisors(foreignCwd) {
  const instances = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-concurrent-supervisor-')));
      const instance = { dataDir, child: null, stderr: '', rpc: null };
      instances.push(instance);
      prepareSyntheticDatabase(dataDir);
      instance.child = launch(dataDir, foreignCwd);
      instance.child.stderr.setEncoding('utf8');
      instance.child.stderr.on('data', chunk => { instance.stderr += chunk; });
      instance.rpc = rpcClient(instance.child);
    }
    const urls = await Promise.all(instances.map(instance =>
      waitForHeadlessReady(() => instance.stderr, instance.child)));
    assert.notEqual(urls[0], urls[1], 'Each live Supervisor must own a different backend port');
    const generations = [];
    for (const [index, instance] of instances.entries()) {
      assert.ok(rememberDescendants(instance.child.pid) >= 2);
      await verifyBackendIdentity(urls[index]);
      const login = await loginWithWebAuthControl(urls[index], { username: USERNAME, password: '1234' });
      assert.equal(login.response.status, 200, 'Login must use the announced backend');
      assert.ok(login.cookieHeader);
      generations.push(login.json.archiveGeneration);
      const other = await fetch(new URL('/api/ambulatories', urls[1 - index]),
        { headers: { Cookie: login.cookieHeader } });
      assert.equal(other.status, 401, 'A session from the other synthetic archive must be denied');
    }
    assert.notEqual(generations[0], generations[1], 'Synthetic archives must be separate');
    for (let round = 0; round < 2; round += 1) {
      for (const instance of instances) {
        assert.equal(hasExited(instance.child), false);
        const discovery = await instance.rpc.send('server/discover');
        assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
        const listed = await instance.rpc.send('tools/list');
        assert.ok(listed.result.tools.some(item => item.name === 'mediflow.system.headless_status.v1'));
        const denied = await instance.rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
        assert.equal(denied.result.content[0].text, 'MediFlow operation denied: host_unbound.');
        assert.doesNotMatch(instance.stderr, /EADDRINUSE/u);
        instance.rpc.assertHealthy();
      }
    }
  } finally {
    await Promise.all(instances.map(instance => terminateChild(instance.child)));
    await assertReaped();
    for (const instance of instances) fs.rmSync(instance.dataDir, { recursive: true, force: true });
  }
}
async function activateSyntheticSelection() {
  const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: '1234' });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookieHeader);
  const jsonHeaders = webMutationHeaders(login.cookieHeader, login.json.archiveGeneration);
  const ambulatoryResponse = await fetch(new URL('/api/ambulatories', BASE_URL),
    { headers: { Cookie: login.cookieHeader } });
  assert.equal(ambulatoryResponse.status, 200);
  const ambulatories = await ambulatoryResponse.json();
  const ambulatoryId = ambulatories.find((item) => item.isDefault)?.id ?? ambulatories[0]?.id;
  assert.equal(typeof ambulatoryId, 'string');
  const patientResponse = await fetch(new URL('/api/patients', BASE_URL), {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ id: PATIENT_ID, firstName: 'Synthetic', lastName: 'Supervisor',
      taxCode: 'SYNTHETIC-SUPERVISOR-SMOKE', birthDate: '1970-01-01T00:00:00.000Z' }),
  });
  assert.equal(patientResponse.status, 201);
  const checkupResponse = await fetch(new URL('/api/checkups', BASE_URL), {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ id: CHECKUP_ID, patientId: PATIENT_ID,
      date: '2030-01-01T09:00:00.000Z', title: CHECKUP_TITLE, status: 'pending' }),
  });
  assert.equal(checkupResponse.status, 201);
  assert.deepEqual(await checkupResponse.json(), { id: CHECKUP_ID, version: 1 });
  const prescriptionResponse = await fetch(new URL('/api/service-prescriptions', BASE_URL), {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ id: 'prescription.synthetic.c16', patientId: PATIENT_ID,
      prescribedAt: '2020-01-01T00:00:00.000Z', category: 'lab', status: 'prescribed',
      serviceName: DISCLOSURE_SENTINEL }),
  });
  assert.equal(prescriptionResponse.status, 201);
  const itemResponse = await fetch(new URL('/api/service-prescription-items', BASE_URL), {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ id: 'item.synthetic.c16', prescriptionId: 'prescription.synthetic.c16',
      serviceName: DISCLOSURE_SENTINEL, status: 'prescribed', category: 'lab',
      scheduledAt: '2020-01-01T00:00:00.000Z' }),
  });
  assert.equal(itemResponse.status, 201);
  const sourceResponse = await fetch(new URL(`/api/service-prescriptions?patientId=${PATIENT_ID}`, BASE_URL),
    { headers: { Cookie: login.cookieHeader } });
  assert.equal(sourceResponse.status, 200);
  assert.ok(JSON.stringify(await sourceResponse.json()).includes(DISCLOSURE_SENTINEL));
  const epochResponse = await fetch(new URL('/api/ai/smart-import/selection', BASE_URL),
    { headers: { Cookie: login.cookieHeader } });
  assert.equal(epochResponse.status, 200);
  const { selectionEpoch: expectedEpoch } = await epochResponse.json();
  const selectionResponse = await fetch(new URL('/api/ai/smart-import/selection', BASE_URL), {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ expectedEpoch, patientId: PATIENT_ID, ambulatoryId }),
  });
  assert.equal(selectionResponse.status, 200);
  const selection = await selectionResponse.json();
  const activationResponse = await fetch(
    new URL(`/api/patients/${PATIENT_ID}/intelligent-host/activate`, BASE_URL),
    { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ selectionEpoch: selection.selection.selectionEpoch }) },
  );
  assert.equal(activationResponse.status, 200);
  const enrollmentResponse = await fetch(
    new URL('/api/system/intelligent-host/checkup-active-role', BASE_URL),
    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ candidatePin: '1234' }) },
  );
  assert.equal(enrollmentResponse.status, 201);
  assert.deepEqual(await enrollmentResponse.json(), {
    schemaVersion: 'mediflow.headless-checkup-active-role-enrollment.v1',
    status: 'active', attestationVersion: 1,
  });
  const checkupSelectionResponse = await fetch(
    new URL(`/api/patients/${PATIENT_ID}/intelligent-host/checkup-status`, BASE_URL),
    { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ checkupId: CHECKUP_ID }) },
  );
  const checkupSelection = await checkupSelectionResponse.json();
  assert.equal(checkupSelectionResponse.status, 200, JSON.stringify(checkupSelection));
  const { checkupRef, uiBindingRef, resourceTitle, resourceRevision } = checkupSelection;
  assert.match(checkupRef, /^hcsr_[0-9a-f]{64}$/u);
  assert.match(uiBindingRef, /^hcub_[0-9a-f]{64}$/u);
  assert.equal(resourceTitle, CHECKUP_TITLE);
  assert.equal(resourceRevision, 1);
  return Object.freeze({ cookieHeader: login.cookieHeader, archiveGeneration: login.json.archiveGeneration, checkupRef, uiBindingRef,
    resourceTitle, resourceRevision });
}
function verifyCommittedTransition(dataDir, receipt) {
  const database = new Database(path.join(dataDir, 'medical.db'), { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(database.prepare('SELECT status, version FROM checkups WHERE id = ?').get(CHECKUP_ID),
      { status: 'completed', version: 2 });
    const rows = database.prepare(`SELECT redacted_metadata AS metadata FROM audit_events
      WHERE event_type = 'checkup.updated' AND subject_type = 'checkup' AND subject_ref = ?`)
      .all(receipt.resourceRefHash);
    assert.equal(rows.length, 1);
    const audit = JSON.parse(rows[0].metadata);
    assert.equal(audit.schemaVersion, 'mediflow.patient.checkup.status.transition.audit.v1');
    assert.deepEqual(audit.receipt, receipt);
  } finally { database.close(); }
}
async function verifyOrdinaryWeb(child, cookieHeader, archiveGeneration) {
  assert.equal(child.exitCode, null, 'Agent teardown interrupted independent Web');
  const headers = { ...webMutationHeaders(cookieHeader, archiveGeneration), Origin: ORDINARY_URL };
  const response = await fetch(new URL('/api/patients', ORDINARY_URL), {
    method: 'POST', headers,
    body: JSON.stringify({ id: 'patient.synthetic.independent-web', firstName: 'Synthetic',
      lastName: 'Independent', taxCode: 'SYNTHETIC-C16-INDEPENDENT', birthDate: '1970-01-01' }),
  });
  assert.equal(response.status, 201);
  const read = await fetch(new URL('/api/patients', ORDINARY_URL), { headers });
  assert.equal(read.status, 200);
  assert.ok((await read.json()).some(item => item.id === 'patient.synthetic.independent-web'));
}
function tool(name, argumentsValue = {}) { return { name, arguments: argumentsValue }; }
async function main() {
  const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-production-smoke-')));
  const foreignCwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-extracted-cwd-')));
  const marker = path.join(foreignCwd, 'substitution-was-executed');
  fs.writeFileSync(path.join(foreignCwd, 'node'), `#!/bin/sh\n: > '${marker}'\nexit 99\n`, { mode: 0o755 });
  let child = null, ordinary = null, stderr = '', before = null; try {
    if (APP) { await checkHeadlessRuntime(APP); before = snapshotApp(); }
    expectedWebIdentity = JSON.parse(fs.readFileSync(path.join(layout?.web ?? path.join(ROOT, '.next/standalone'), 'mediflow-build-identity.json'), 'utf8'));
    await concurrentSupervisors(foreignCwd);
    prepareSyntheticDatabase(dataDir);
    ordinary = spawn(process.execPath, [path.join(layout?.web ?? path.join(ROOT, '.next/standalone'), 'server.js')], {
      cwd: ROOT, env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3001',
        MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
        MEDIFLOW_APP_REVISION: expectedWebIdentity.revision.slice(0, 12), MEDIFLOW_APP_BRANCH: expectedWebIdentity.branch,
        MEDIFLOW_APP_WORKTREE_HASH: expectedWebIdentity.worktreeHash,
        MEDIFLOW_APP_SOURCE_FINGERPRINT: expectedWebIdentity.sourceFingerprint,
        MEDIFLOW_APP_FINGERPRINT: expectedWebIdentity.sourceFingerprint,
        MEDIFLOW_PROVIDER_V2_ENABLED: '0', MEDIFLOW_PROVIDER_V2_NETWORK: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ordinaryOutput = '';
    for (const stream of [ordinary.stdout, ordinary.stderr]) {
      stream.setEncoding('utf8'); stream.on('data', chunk => { ordinaryOutput += chunk; });
    }
    await waitForReady(() => ordinaryOutput, ordinary);
    await verifyBackendIdentity(ORDINARY_URL);
    const ordinaryLogin = await loginWithWebAuthControl(ORDINARY_URL, { username: USERNAME, password: '1234' });
    assert.equal(ordinaryLogin.response.status, 200);
    assert.ok(ordinaryLogin.cookieHeader);
    child = launch(dataDir, foreignCwd);
    const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const rpc = rpcClient(child);
    BASE_URL = await waitForHeadlessReady(() => stderr, child);
    await verifyBackendIdentity(BASE_URL);
    if (APP) assert.ok(rememberDescendants(child.pid) >= 2, 'Expected real Web and MCP children');
    const discovery = await rpc.send('server/discover');
    assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
    const prebind = await rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
    assert.equal(prebind.result.isError, true);
    assert.equal(prebind.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    const selection = await activateSyntheticSelection();
    assert.equal(ordinaryLogin.json.archiveGeneration, selection.archiveGeneration, 'Independent Web must use the same archive');
    const { cookieHeader, checkupRef, uiBindingRef, resourceTitle, resourceRevision } = selection;
    const jsonHeaders = webMutationHeaders(cookieHeader, selection.archiveGeneration);
    const cloudProbe = await fetch(new URL('/api/system/cloud-provider-probe', BASE_URL), {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ intent: 'run_synthetic_nonclinical_probe' }),
    });
    assert.equal(cloudProbe.status, 409);
    assert.equal((await cloudProbe.json()).code, 'provider_probe_disabled');
    const capabilities = await rpc.send('tools/call', tool('mediflow.system.capabilities.v1'));
    assert.deepEqual(capabilities.result.structuredContent, publicCatalog(OPERATION_DESCRIPTORS));
    const listed = await rpc.send('tools/list');
    assert.deepEqual(new Set(listed.result.tools.map(item => item.name)), new Set([
      'mediflow.system.headless_status.v1', 'mediflow.system.capabilities.v1',
      ...OPERATION_DESCRIPTORS.map(item => item.operationId),
    ]));
    for (const descriptor of OPERATION_DESCRIPTORS) {
      assert.equal(listed.result.tools.find(item => item.name === descriptor.operationId)
        ._meta['mediflow/maximumStage'], descriptor.maximumStage);
    }
    const terminology = await rpc.send('tools/call', tool('mediflow.terminology.search.v1', {
      system: 'LOINC', query: 'glucose', limit: 1,
    }));
    assert.equal(terminology.result.structuredContent.items.length, 1);
    assert.equal(terminology.result.structuredContent.receipt.egress, 'none');
    const loops = await rpc.send('tools/call', tool('mediflow.patient.open_loops.read.v1'));
    assert.equal(loops.result.structuredContent.items.length, 1);
    assert.equal(loops.result.structuredContent.items[0].kind, 'results_pending');
    assert.match(loops.result.structuredContent.items[0].loopRef, /^aipl_[0-9a-f]{64}$/u);
    const repeatedRead = await rpc.send('tools/call', tool('mediflow.patient.open_loops.read.v1'));
    assert.deepEqual(repeatedRead.result.structuredContent.items, loops.result.structuredContent.items);
    for (const argumentsValue of [{ patientId: 'patient.synthetic.wrong' }, { confirmation: true }]) {
      const denied = await rpc.send('tools/call', tool('mediflow.patient.open_loops.read.v1', argumentsValue));
      assert.equal(denied.result.isError, true);
    }
    const oversized = await rpc.send('tools/call', tool('mediflow.terminology.search.v1', {
      system: 'LOINC', query: 'x'.repeat(513), limit: 1,
    }));
    assert.equal(oversized.result.isError, true);
    const proposal = await rpc.send('tools/call', tool('mediflow.patient.open_loops.follow_up.propose.v1'));
    assert.equal(proposal.result.structuredContent.apply, 'none');
    assert.equal(proposal.result.structuredContent.items.length, 1);
    assert.equal(proposal.result.structuredContent.items[0].loopRef, loops.result.structuredContent.items[0].loopRef);
    const semantic = await rpc.send('tools/call', tool('mediflow.semantic_query_plan.execute.v1', {
      budget: { maxSteps: 2, maxDurationMs: 250, maxOutputBytes: 32_768 },
      explanation: 'Synthetic bounded local read',
      steps: [
        { stepRef: 'step_terminology', operationId: 'mediflow.terminology.search.v1',
          input: { system: 'LOINC', query: 'glucose', limit: 1 } },
        { stepRef: 'step_open_loops', operationId: 'mediflow.patient.open_loops.read.v1', input: {} },
      ],
    }));
    assert.equal(semantic.result.structuredContent.receipt.writesPerformed, 0);
    assert.equal(semantic.result.structuredContent.steps.length, 2);
    const stalePreview = await rpc.send('tools/call', tool('mediflow.patient.checkup.status.transition.v1', {
      checkupRef, targetStatus: 'completed', expectedRevision: 2,
    }));
    assert.equal(stalePreview.result.structuredContent.outcome, 'denied');
    const checkupPreview = await rpc.send('tools/call',
      tool('mediflow.patient.checkup.status.transition.v1', {
        checkupRef, targetStatus: 'completed', expectedRevision: 1,
      }));
    assert.equal(checkupPreview.result.isError, undefined);
    const preview = checkupPreview.result.structuredContent;
    assert.equal(preview.outcome, 'proposed');
    assert.match(preview.proposalRef, /^hcsp_[0-9a-f]{64}$/u);
    const proposalResponse = await fetch(new URL(
      `/api/patients/${PATIENT_ID}/intelligent-host/checkup-status/proposals/${preview.proposalRef}`,
      BASE_URL,
    ), { headers: { Cookie: cookieHeader, 'Cache-Control': 'no-store',
      'x-mediflow-checkup-ui-binding': uiBindingRef } });
    assert.equal(proposalResponse.status, 200);
    assert.deepEqual(await proposalResponse.json(), {
      schemaVersion: 'mediflow.patient.checkup.status.transition.proposal-view.v1',
      proposalRef: preview.proposalRef, targetStatus: 'completed', expectedRevision: 1,
      expiresAt: preview.expiresAt, resourceTitle, resourceRevision,
    });
    const confirmationUrl = new URL(
      `/api/patients/${PATIENT_ID}/intelligent-host/checkup-status/proposals/${preview.proposalRef}`,
      BASE_URL,
    );
    const confirm = async (candidatePin) => {
      const response = await fetch(confirmationUrl, { method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ targetStatus: 'completed', expectedRevision: 1, candidatePin,
          uiBindingRef }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const receipt = await confirm('1234');
    assert.equal(receipt.outcome, 'status_transitioned');
    assert.equal(receipt.toStatus, 'completed');
    assert.equal(receipt.previousRevision, 1);
    assert.equal(receipt.newRevision, 2);
    assert.match(receipt.receiptRefHash, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(await confirm('9999'), receipt);
    const checkupsResponse = await fetch(new URL(`/api/checkups?patientId=${PATIENT_ID}`, BASE_URL), {
      headers: { Cookie: cookieHeader, 'Cache-Control': 'no-store' },
    });
    assert.equal(checkupsResponse.status, 200);
    const committedCheckup = (await checkupsResponse.json()).find((item) => item.id === CHECKUP_ID);
    assert.equal(committedCheckup.status, 'completed');
    assert.equal(committedCheckup.version, 2);
    const operationRevocationResponse = await fetch(
      new URL(`/api/patients/${PATIENT_ID}/intelligent-host/checkup-status`, BASE_URL),
      { method: 'DELETE', headers: webMutationHeaders(cookieHeader, selection.archiveGeneration, false) },
    );
    assert.equal(operationRevocationResponse.status, 200);
    assert.deepEqual(await operationRevocationResponse.json(), { state: 'revoked' });
    const retiredProposal = await fetch(confirmationUrl, { headers: { Cookie: cookieHeader,
      'x-mediflow-checkup-ui-binding': uiBindingRef } });
    assert.equal(retiredProposal.status, 401);
    const postOperationStatus = await rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
    assert.equal(postOperationStatus.result.structuredContent.writes, 0);
    const roleRevocationResponse = await fetch(
      new URL('/api/system/intelligent-host/checkup-active-role', BASE_URL),
      { method: 'DELETE', headers: jsonHeaders,
        body: JSON.stringify({ candidatePin: '1234' }) },
    );
    assert.equal(roleRevocationResponse.status, 200);
    assert.deepEqual(await roleRevocationResponse.json(), {
      schemaVersion: 'mediflow.headless-checkup-active-role-revocation.v1',
      status: 'revoked', attestationVersion: 1, revocationGeneration: 1,
    });
    const postRoleStatus = await rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
    assert.equal(postRoleStatus.result.structuredContent.writes, 0);
    const authenticatedCheck = await fetch(new URL('/api/auth/check', BASE_URL), {
      headers: { Cookie: cookieHeader, 'Cache-Control': 'no-store' },
    });
    assert.equal(authenticatedCheck.status, 200);
    assert.equal((await authenticatedCheck.json()).hasSession, true);
    const logout = await fetch(new URL('/api/auth/logout', BASE_URL), {
      method: 'POST', headers: webMutationHeaders(cookieHeader, selection.archiveGeneration, false),
    });
    assert.equal(logout.status, 204);
    assert.equal(await withTimeout(exit, 'Supervisor terminal exit'), 0);
    verifyCommittedTransition(dataDir, receipt);
    await prebindShutdown(dataDir, foreignCwd, 'EOF');
    await verifyOrdinaryWeb(ordinary, ordinaryLogin.cookieHeader, ordinaryLogin.json.archiveGeneration);
    if (APP) await assertReaped();
    rpc.assertHealthy();
    assert.equal(rpc.pending.size, 0);
    assert.equal(rpc.remainder(), '');
    assert.ok(rpc.lines.every((line) => { try { const frame = JSON.parse(line);
      return frame?.jsonrpc === '2.0' && Number.isSafeInteger(frame.id); } catch { return false; } }));
    const forbidden = /patient\.synthetic|checkup\.synthetic|synthetic-supervisor|synthetic bounded checkup|synthetic supervisor smoke|synthetic ambulatory smoke|synthetic supervisor/iu;
    assert.doesNotMatch(rpc.lines.join('\n'), forbidden);
    assert.doesNotMatch(stderr, forbidden);
    assert.equal(rpc.lines.join('\n').includes(DISCLOSURE_SENTINEL), false);
    assert.equal(stderr.includes(DISCLOSURE_SENTINEL), false);
    assert.doesNotMatch(JSON.stringify(receipt), forbidden);
    if (APP) {
      await prebindShutdown(dataDir, foreignCwd, 'SIGTERM');
      assert.equal(fs.existsSync(marker), false, 'cwd/PATH substitution executed');
      await checkHeadlessRuntime(APP);
      assert.deepEqual(snapshotApp(), before, 'The extracted app changed during smoke');
    }
    process.stdout.write(`${APP ? 'Extracted-app MCP' : 'Production Supervisor'} smoke passed: two concurrent isolated authenticated backends, post-readiness discovery/tools/list, five operations, governed checkup, one update/audit, revoke and clean exit${APP ? ', EOF/SIGTERM child cleanup and immutable app' : ''}.\n`);
  } catch (error) {
    if (stderr) process.stderr.write(stderr);
    throw error;
  } finally {
    if (APP && child && !hasExited(child)) rememberDescendants(child.pid);
    await terminateChild(child);
    await terminateChild(ordinary);
    // Recovery does not turn a failed cleanup assertion into a PASS.
    for (const pid of ownedPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(foreignCwd, { recursive: true, force: true });
  }
}
await main();
