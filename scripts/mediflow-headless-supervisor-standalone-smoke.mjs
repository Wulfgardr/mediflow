#!/usr/bin/env node
/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';
const ROOT = process.cwd(), BASE_URL = 'http://127.0.0.1:3000';
const USERNAME = 'synthetic-supervisor-smoke', PATIENT_ID = 'patient.synthetic.supervisor-smoke';
const CHECKUP_ID = 'checkup.synthetic.supervisor-smoke', CHECKUP_TITLE = 'Synthetic bounded checkup';
const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'mediflow-production-smoke', version: '1.0.0' },
});
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
async function activateSyntheticSelection() {
  const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: '1234' });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookieHeader);
  const jsonHeaders = { Cookie: login.cookieHeader, 'Content-Type': 'application/json' };
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
  assert.equal(checkupSelectionResponse.status, 200);
  const { checkupRef, uiBindingRef, resourceTitle, resourceRevision } = await checkupSelectionResponse.json();
  assert.match(checkupRef, /^hcsr_[0-9a-f]{64}$/u);
  assert.match(uiBindingRef, /^hcub_[0-9a-f]{64}$/u);
  assert.equal(resourceTitle, CHECKUP_TITLE);
  assert.equal(resourceRevision, 1);
  return Object.freeze({ cookieHeader: login.cookieHeader, checkupRef, uiBindingRef,
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
function tool(name, argumentsValue = {}) { return { name, arguments: argumentsValue }; }
async function main() {
  const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-production-smoke-')));
  let child = null; try {
    prepareSyntheticDatabase(dataDir);
    child = spawn(process.execPath,
      [path.join(ROOT, 'scripts', 'run-strip-types.mjs'),
        path.join(ROOT, 'scripts', 'mediflow-headless-supervisor.mjs')], {
        cwd: ROOT, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir,
          MEDIFLOW_PROVIDER_V2_ENABLED: '0', MEDIFLOW_PROVIDER_V2_NETWORK: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const rpc = rpcClient(child);
    await waitForReady(() => stderr, child);
    const discovery = await rpc.send('server/discover');
    assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28']);
    const prebind = await rpc.send('tools/call', tool('mediflow.system.headless_status.v1'));
    assert.equal(prebind.result.isError, true);
    assert.equal(prebind.result.content[0].text, 'MediFlow operation denied: host_unbound.');
    const selection = await activateSyntheticSelection();
    const { cookieHeader, checkupRef, uiBindingRef, resourceTitle, resourceRevision } = selection;
    const cloudProbe = await fetch(new URL('/api/system/cloud-provider-probe', BASE_URL), {
      method: 'POST', headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'run_synthetic_nonclinical_probe' }),
    });
    assert.equal(cloudProbe.status, 409);
    assert.equal((await cloudProbe.json()).code, 'provider_probe_disabled');
    const capabilities = await rpc.send('tools/call', tool('mediflow.system.capabilities.v1'));
    assert.equal(capabilities.result.structuredContent.operations.length, 5);
    const terminology = await rpc.send('tools/call', tool('mediflow.terminology.search.v1', {
      system: 'LOINC', query: 'glucose', limit: 1,
    }));
    assert.equal(terminology.result.structuredContent.items.length, 1);
    assert.equal(terminology.result.structuredContent.receipt.egress, 'none');
    const loops = await rpc.send('tools/call', tool('mediflow.patient.open_loops.read.v1'));
    assert.deepEqual(loops.result.structuredContent.items, []);
    const proposal = await rpc.send('tools/call', tool('mediflow.patient.open_loops.follow_up.propose.v1'));
    assert.equal(proposal.result.structuredContent.apply, 'none');
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
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
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
      { method: 'DELETE', headers: { Cookie: cookieHeader } },
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
      { method: 'DELETE', headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
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
      method: 'POST', headers: { Cookie: cookieHeader },
    });
    assert.equal(logout.status, 204);
    assert.equal(await withTimeout(exit, 'Supervisor terminal exit'), 0);
    verifyCommittedTransition(dataDir, receipt);
    rpc.assertHealthy();
    assert.equal(rpc.pending.size, 0);
    assert.equal(rpc.remainder(), '');
    assert.ok(rpc.lines.every((line) => { try { const frame = JSON.parse(line);
      return frame?.jsonrpc === '2.0' && Number.isSafeInteger(frame.id); } catch { return false; } }));
    const forbidden = /patient\.synthetic|checkup\.synthetic|synthetic-supervisor|synthetic bounded checkup|synthetic supervisor smoke|synthetic ambulatory smoke|synthetic supervisor/iu;
    assert.doesNotMatch(rpc.lines.join('\n'), forbidden);
    assert.doesNotMatch(stderr, forbidden);
    assert.doesNotMatch(JSON.stringify(receipt), forbidden);
    process.stdout.write('Production Supervisor smoke passed: five operations, governed checkup, one update/audit, revoke and clean exit.\n');
  } finally {
    await terminateChild(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
await main();
