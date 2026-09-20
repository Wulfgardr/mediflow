/* @Codex */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { assertNodeRuntime, readNodeContract } from '../../scripts/node-runtime-contract.mjs';
import {
  capabilitiesOutputSchema, terminologyOutputSchema, openLoopsOutputSchema,
  followUpProposalOutputSchema, semanticQueryOutputSchema,
} from '../../packages/mcp/src/contracts.ts';

const root = fs.realpathSync(process.cwd());
// The canonical runner may probe alternative nodes: an unsupported child must not qualify acceptance.
assertNodeRuntime(readNodeContract(root));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-mini-production #%-')));
let closeHostDatabase: () => void = () => undefined;
after(() => {
  try { closeHostDatabase(); }
  finally { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
const dataDir = path.join(temporary, 'data');
const webDirectory = path.join(temporary, 'web');
fs.mkdirSync(dataDir); fs.mkdirSync(webDirectory);
process.env.MEDIFLOW_DATA_DIR = dataDir;
delete process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN;
const PATIENT = 'patient.synthetic.mini';
const AMBULATORY = 'ambulatory.synthetic.mini';
const OTHER_PATIENT = 'patient.synthetic.other-mini';
const ITEM = 'service.synthetic.mini';
// Synthetic source dates are safely beyond the existing fourteen-day derivation threshold.
const OPENED_AT_SECONDS = Math.floor(Date.now() / 1_000) - 30 * 86_400;
const database = new Database(path.join(dataDir, 'medical.db'));
try {
  for (const migration of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(fs.readFileSync(path.join(root, 'drizzle', migration), 'utf8')
      .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
  }
  database.pragma('foreign_keys = ON');
  database.prepare("INSERT INTO ambulatories (id, name, type, is_default) VALUES (?, 'Synthetic Mini', 'test', 1)")
    .run(AMBULATORY);
  for (const [patientId, itemId] of [[PATIENT, ITEM], [OTHER_PATIENT, 'service.synthetic.other-mini']]) {
    database.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, is_archived, version)
      VALUES (?, 'Synthetic', 'Mini', ?, 0, 7)`).run(patientId, `SYNTHETIC-${itemId}`);
    database.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
      .run(patientId, AMBULATORY);
    const prescriptionId = `prescription.${itemId}`;
    // A different source date makes an accidental other-patient selection observable as well.
    const openedAt = patientId === PATIENT ? OPENED_AT_SECONDS : OPENED_AT_SECONDS - 7 * 86_400;
    database.prepare(`INSERT INTO service_prescriptions
      (id, patient_id, prescribed_at, service_name, created_at, updated_at)
      VALUES (?, ?, ?, 'Synthetic pending service', ?, ?)`).run(
      prescriptionId, patientId, openedAt, openedAt, openedAt);
    database.prepare(`INSERT INTO service_prescription_items
      (id, patient_id, prescription_id, service_name, created_at, updated_at)
      VALUES (?, ?, ?, 'Synthetic pending service', ?, ?)`).run(
      itemId, patientId, prescriptionId, openedAt, openedAt);
  }
  assert.deepEqual(database.pragma('foreign_key_check'), []);
} finally { database.close(); }

const url = (relative: string) => JSON.stringify(pathToFileURL(path.join(root, relative)).href);
const webTargetPath = path.join(webDirectory, 'server.js');
// Benign Web fixture: real Web lifecycle projections, selection and capture owners,
// real session controller and IPC bridge. Only the browser gesture and acquisition are test inputs.
fs.writeFileSync(webTargetPath, `/* @Codex */
(async () => {
  await import(${url('scripts/register-strip-types-loader.mjs')});
  const { createHash } = await import('node:crypto');
  const { issueSyntheticWebSession, retireSyntheticWebSession } =
    await import(${url('lib/security/web-auth-lifecycle-owner-test-fixture.ts')});
  const { createPortableSupervisorPatientVersionProductionV1 } =
    await import(${url('lib/security/portable-supervisor-patient-version-production.ts')});
  const readPatientVersion = createPortableSupervisorPatientVersionProductionV1();
  const { createFullPortProjectionOwnerProcessOwner } =
    await import(${url('lib/security/server-session-projection-owner.ts')});
  const { createPortableSupervisorWebCaptureOwnerProcessV1 } =
    await import(${url('lib/security/portable-supervisor-context-owner.ts')});
  const { createPortableSupervisorWebSessionControllerV1 } =
    await import(${url('lib/security/portable-supervisor-web-session-controller.ts')});
  const { createPortableSupervisorCheckupWebSessionPortV1 } =
    await import(${url('lib/security/portable-supervisor-checkup-web-session-port.ts')});
  const { activatePortableSupervisorWebIpcV1, revokePortableSupervisorWebIpcV1,
    disconnectPortableSupervisorWebIpcV1 } =
    await import(${url('lib/security/portable-supervisor-web-ipc-bridge.ts')});
  let session = null, owner = null, selection = null;
  const pair = { patientId: ${JSON.stringify(PATIENT)}, ambulatoryId: ${JSON.stringify(AMBULATORY)} };
  const selectionProcess = createFullPortProjectionOwnerProcessOwner({
    resolve: (_session, pair) => Object.freeze({ ...pair,
      patientVersion: readPatientVersion(pair.patientId, pair.ambulatoryId) }), clock: Date.now,
  });
  const captureProcess = createPortableSupervisorWebCaptureOwnerProcessV1({
    acquireAuthenticatedContext: async () => session && owner
      ? Object.freeze(Object.assign(Object.create(null), { session, owner })) : null,
    selectionLifecycle: selectionProcess.selectionLifecycleController,
    selectionBinding: selectionProcess.selectionBindingController,
    selectionCommitBinding: selectionProcess.selectionCommitBindingController,
    clock: Date.now,
    hashRef: (value) => 'sha256:' + createHash('sha256').update(value).digest('hex'),
    scheduler: (delay, callback) => { const timer = setTimeout(callback, delay); timer.unref();
      return () => clearTimeout(timer); },
  });
  const controller = createPortableSupervisorWebSessionControllerV1({
    acquireCaptureOwner: captureProcess.acquire,
    activateBridge: activatePortableSupervisorWebIpcV1,
    revokeBridge: revokePortableSupervisorWebIpcV1,
    disconnectBridge: disconnectPortableSupervisorWebIpcV1,
    checkupLifecycle: createPortableSupervisorCheckupWebSessionPortV1({ now: Date.now }).controller,
  });
  process.on('message', async (message) => {
    if (message === 'fixture.authorize') {
      try {
        session = issueSyntheticWebSession({ id: 'synthetic-mini-user',
          username: 'synthetic-mini-clinician', role: 'clinician' }, 'mini-production');
        owner = selectionProcess.registry.acquire(session);
        selection = owner.issueSelection({ expectedEpoch: 0, ...pair });
        const result = await controller.activateCurrentSelection({
          expectedPatientId: pair.patientId, selectionEpoch: selection.selectionEpoch,
        });
        if (result.state !== 'active') throw new Error('not active');
        process.stdout.write('FIXTURE_ACTIVATED\\n');
      } catch { process.stdout.write('FIXTURE_DENIED\\n'); }
    } else if (message === 'fixture.lock' || message === 'fixture.logout') {
      try { await controller.retire(message === 'fixture.lock' ? 'application_lock' : 'logout'); retireSyntheticWebSession(session);
        process.stdout.write('FIXTURE_REVOKED\\n'); } catch { process.stdout.write('FIXTURE_DENIED\\n'); }
    } else if (message === 'fixture.reselect') {
      owner.issueSelection({ expectedEpoch: selection.selectionEpoch, ...pair });
    }
  });
  process.stdout.write('FIXTURE_READY\\n');
})().catch(() => { process.stderr.write('FIXTURE_FAILED\\n'); process.exitCode = 1;
  if (process.connected) process.disconnect(); });
`, 'utf8');

const { createPortableSupervisorProductionV1 } = await import('./portable-supervisor-production.ts');
const { dbServer } = await import('../db-server.ts');
closeHostDatabase = () => { dbServer.$client.close(); };

async function until(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Mini production fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// @Codex: exit can precede stdout delivery; close proves the Web streams drained.
function waitForWebFixtureMarker(child: ChildProcess, output: () => string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let closed = false;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', check);
      child.stderr?.removeListener('data', check);
      child.removeListener('close', onClose);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      if (output().includes(marker)) finish();
      else if (closed || /FIXTURE_DENIED|FIXTURE_FAILED/u.test(output())) {
        finish(new Error(`Mini Web fixture ended before ${marker}`));
      }
    };
    const onClose = () => { closed = true; check(); };
    const timer = setTimeout(() => finish(new Error('Mini production fixture timed out')), 8_000);
    child.stdout?.on('data', check);
    child.stderr?.on('data', check);
    child.once('close', onClose);
    check();
  });
}

const operationRequests = [
  { command: 'terminology search', args: { system: 'LOINC', query: 'emoglobina', limit: 2 } },
  { command: 'open-loops', args: {} },
  { command: 'follow-up-proposal', args: {} },
  { command: 'semantic-query', args: {
    budget: { maxSteps: 2, maxDurationMs: 250, maxOutputBytes: 32_768 },
    explanation: 'Read local terminology and the selected synthetic patient open loops.',
    steps: [{ stepRef: 'step_terminology', operationId: 'mediflow.terminology.search.v1',
      input: { system: 'LOINC', query: 'emoglobina', limit: 2 } },
    { stepRef: 'step_open_loops', operationId: 'mediflow.patient.open_loops.read.v1', input: {} }],
  } },
];
const scenarios = [
  ...['lock', 'logout', 'reselection', 'eof', 'empty_eof', 'web_exit', 'currentness'].map(ending => ({ ending,
    revokedRequest: { command: 'status', args: {} } })),
  ...operationRequests.map(revokedRequest => ({ ending: `currentness:${revokedRequest.command}`, revokedRequest })),
];
type StoredAudit = { event_type: string; outcome: string; redacted_metadata: string };
function successfulAudits(family: string) {
  return (dbServer.$client.prepare('SELECT event_type, outcome, redacted_metadata FROM audit_events').all() as
    StoredAudit[]).filter(row => row.outcome === 'success' && (family === 'semantic_query'
      ? row.event_type === 'agent.semantic_query.executed'
      : JSON.parse(row.redacted_metadata).flags?.includes(`family:${family}`)));
}
const auditedFamilies = ['terminology_search', 'patient_open_loops_read',
  'patient_open_loops_follow_up_proposal', 'semantic_query'] as const;
function auditCounts() {
  return Object.fromEntries(auditedFamilies.map(family => [family, successfulAudits(family).length]));
}
function auditRows(): string[] {
  return dbServer.$client.prepare('SELECT * FROM audit_events ORDER BY rowid').all()
    .map(row => createHash('sha256').update(JSON.stringify(row)).digest('hex'));
}
/** Host-only test inspection. The Mini child still receives only the late-bound IPC marker. */
function dataSnapshot() {
  const tables = dbServer.$client.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name <> 'audit_events' ORDER BY name`).all() as
    Array<{ name: string }>;
  return tables.map(({ name }) => {
    const identifier = '"' + name.replaceAll('"', '""') + '"';
    const rows = dbServer.$client.prepare(`SELECT * FROM ${identifier}`).all().map(row => JSON.stringify(row)).sort();
    return { table: name, rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  });
}
for (const { ending, revokedRequest } of scenarios) {
  test(`production Mini uses genuine Web authority and terminates on ${ending}`, { timeout: 15_000 }, async (t) => {
    const expectedItems = ending === 'empty_eof' ? 0 : 1;
    // Fixture setup, before the no-write baseline; not a write delegated to the agent.
    dbServer.$client.prepare('UPDATE service_prescription_items SET report_received_at = ? WHERE id = ?')
      .run(expectedItems === 0 ? Math.floor(Date.now() / 1_000) : null, ITEM);
    const children: ChildProcess[] = [];
    const exits: Promise<void>[] = [];
    let webOutput = '', miniOutput = '';
    let runtime: ReturnType<typeof createPortableSupervisorProductionV1> | null = null;
    t.after(async () => {
      runtime?.terminate();
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      await Promise.all(exits);
      dbServer.$client.prepare('UPDATE patients SET version = 7 WHERE id = ?').run(PATIENT);
      dbServer.$client.prepare('UPDATE service_prescription_items SET report_received_at = NULL WHERE id = ?').run(ITEM);
    });
    runtime = createPortableSupervisorProductionV1('mini', {
      webDirectory, webTargetPath,
      spawnChild: (command, args, options) => {
        const mini = children.length === 0;
        assert.deepEqual(options.stdio, mini ? ['inherit', 'inherit', 'inherit', 'ipc'] : ['ignore', 2, 2, 'ipc']);
        if (mini) {
          assert.equal(args.at(-1), '--session');
          assert.equal(args.at(-2), path.join(root, 'packages/mini/src/cli.ts'));
          assert.deepEqual(options.env, { MEDIFLOW_AIP_OPERATION_RPC: 'late_bound_authenticated_inherited_child_ipc_v1' });
        }
        const child = spawn(command, [...args], { ...options, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        children.push(child);
        exits.push(new Promise((resolve) => {
          child.once('exit', () => resolve());
          child.once('error', () => { if (child.pid === undefined) resolve(); });
        }));
        child.stdout!.on('data', (chunk) => { if (mini) miniOutput += chunk; else webOutput += chunk; });
        child.stderr!.on('data', (chunk) => { webOutput += chunk; });
        return child;
      },
    });
    const mini = children[0]!, web = children[1]!;
    assert.notEqual(mini.pid, web.pid); assert.notEqual(mini.pid, process.pid);
    const request = async (command: string, args: unknown = {}) => {
      const count = miniOutput.split('\n').filter(Boolean).length;
      mini.stdin!.write(`${JSON.stringify({ command, args })}\n`);
      await until(() => miniOutput.split('\n').filter(Boolean).length > count);
      return JSON.parse(miniOutput.split('\n').filter(Boolean)[count]!);
    };
    await until(() => webOutput.includes('FIXTURE_READY') || webOutput.includes('FIXTURE_FAILED')
      || children.some((child) => child.exitCode !== null || child.signalCode !== null));
    assert.match(webOutput, /FIXTURE_READY/u, webOutput + miniOutput);
    const initialData = dataSnapshot();
    const initialAudits = auditRows();
    const before = await request('status');
    assert.equal(before.ok, true); assert.equal(before.result.transport, 'connected');
    assert.equal(before.result.session, 'not_unlocked'); assert.equal(before.result.ready, false);
    assert.deepEqual(before.result.capabilities, []);
    assert.equal(before.result.nextStep.code, 'AUTHORIZE_IN_OWNED_WEB');
    assert.equal((await request('capabilities')).error.code, 'SESSION_NOT_UNLOCKED');
    for (const operation of operationRequests) {
      assert.equal((await request(operation.command, operation.args)).error.code, 'SESSION_NOT_UNLOCKED');
    }
    assert.deepEqual(dataSnapshot(), initialData);
    assert.deepEqual(auditRows(), initialAudits, 'unbound Mini does not execute or audit operations');
    web.send('fixture.authorize');
    await waitForWebFixtureMarker(web, () => webOutput, 'FIXTURE_ACTIVATED');
    assert.match(webOutput, /FIXTURE_ACTIVATED/u);
    const active = await request('status');
    assert.equal(active.ok, true); assert.equal(active.result.ready, true);
    assert.equal(active.result.session, 'authorized');
    const catalog = await request('capabilities');
    assert.equal(catalog.ok, true);
    capabilitiesOutputSchema.parse(catalog.result);
    assert.deepEqual(catalog.result.operations, active.result.capabilities);
    for (const operationId of ['mediflow.terminology.search.v1', 'mediflow.patient.open_loops.read.v1',
      'mediflow.patient.open_loops.follow_up.propose.v1', 'mediflow.semantic_query_plan.execute.v1']) {
      assert.ok(catalog.result.operations.some((item: { operationId: string }) =>
        item.operationId === operationId), `missing bound operation: ${operationId}`);
    }
    assert.ok(catalog.result.operations.every((item: { maximumStage: string }) =>
      ['read_only', 'proposal_only'].includes(item.maximumStage)));
    const auditCount = successfulAudits('terminology_search').length;
    const readCount = successfulAudits('patient_open_loops_read').length;
    const proposalCount = successfulAudits('patient_open_loops_follow_up_proposal').length;
    const semanticCount = successfulAudits('semantic_query').length;
    const search = await request(operationRequests[0]!.command, operationRequests[0]!.args);
    assert.equal(search.ok, true, JSON.stringify(search));
    terminologyOutputSchema.parse(search.result);
    assert.equal(search.result.applicationServiceRef, 'AipTerminologySearchServiceV1');
    assert.equal(search.result.outcome, 'read');
    assert.equal(search.result.items[0]?.code, '718-7');
    assert.equal(search.result.receipt.resultCount, search.result.items.length);
    assert.equal(search.result.receipt.writesPerformed, 0);
    assert.equal(search.result.receipt.egress, 'none');
    assert.equal(successfulAudits('terminology_search').length, auditCount + 1);
    assert.deepEqual(dataSnapshot(), initialData, 'terminology search changes no non-audit table');

    const readResponse = await request('open-loops');
    assert.equal(readResponse.ok, true, JSON.stringify(readResponse));
    const read = openLoopsOutputSchema.parse(readResponse.result);
    assert.equal(read.items.length, expectedItems, 'only the selected patient contributes loops');
    assert.equal(read.truncated, false);
    for (const item of read.items) {
      assert.equal(item.kind, 'results_pending');
      assert.equal(item.temporalState, 'overdue');
      assert.equal(item.openedAt, OPENED_AT_SECONDS * 1_000);
      assert.match(item.loopRef, /^aipl_[0-9a-f]{64}$/u);
    }
    assert.equal(read.receipt.itemCount, expectedItems);
    assert.equal(successfulAudits('patient_open_loops_read').length, readCount + 1);
    assert.deepEqual(dataSnapshot(), initialData, 'open-loops changes no non-audit table');

    const proposalResponse = await request('follow-up-proposal');
    assert.equal(proposalResponse.ok, true, JSON.stringify(proposalResponse));
    const proposal = followUpProposalOutputSchema.parse(proposalResponse.result);
    assert.equal(proposal.outcome, 'proposed');
    assert.equal(proposal.maximumStage, 'proposal_only');
    assert.equal(proposal.reviewRequired, true);
    assert.equal(proposal.writesPerformed, 0);
    assert.equal(proposal.apply, 'none');
    assert.equal(proposal.receipt.egress, 'none');
    assert.equal(proposal.receipt.itemCount, expectedItems);
    assert.deepEqual(proposal.items, read.items.map(item => ({ loopRef: item.loopRef, action: 'review_result' })));
    assert.equal(successfulAudits('patient_open_loops_read').length, readCount + 2);
    assert.equal(successfulAudits('patient_open_loops_follow_up_proposal').length, proposalCount + 1);
    assert.deepEqual(dataSnapshot(), initialData, 'proposal is not persisted as a clinical commit');

    const semanticRequest = operationRequests[3]!;
    const semanticResponse = await request(semanticRequest.command, semanticRequest.args);
    assert.equal(semanticResponse.ok, true, JSON.stringify(semanticResponse));
    const semantic = semanticQueryOutputSchema.parse(semanticResponse.result);
    assert.equal(semantic.outcome, 'read_completed');
    assert.equal(semantic.steps.length, 2);
    assert.equal(semantic.receipt.operationCount, 2);
    assert.equal(semantic.receipt.writesPerformed, 0);
    assert.equal(semantic.receipt.applyPolicy, 'none');
    assert.equal(semantic.receipt.policyDecision, 'allowed');
    assert.equal(semantic.steps[0]!.stepRef, 'step_terminology');
    assert.equal(semantic.steps[1]!.stepRef, 'step_open_loops');
    const semanticTerm = terminologyOutputSchema.parse(semantic.steps[0]!.output);
    const semanticRead = openLoopsOutputSchema.parse(semantic.steps[1]!.output);
    assert.equal(semanticTerm.items[0]?.code, '718-7');
    assert.deepEqual(semanticRead.items, read.items);
    assert.equal(successfulAudits('terminology_search').length, auditCount + 2);
    assert.equal(successfulAudits('patient_open_loops_read').length, readCount + 3);
    assert.equal(successfulAudits('patient_open_loops_follow_up_proposal').length, proposalCount + 1);
    assert.equal(successfulAudits('semantic_query').length, semanticCount + 1);
    assert.deepEqual(dataSnapshot(), initialData, 'semantic execution changes no non-audit table');
    assert.deepEqual(auditRows().slice(0, initialAudits.length), initialAudits, 'prior audits are append-only');
    const terminalAuditCounts = auditCounts();
    const responseCount = miniOutput.split('\n').filter(Boolean).length;
    if (ending === 'lock') web.send('fixture.lock');
    else if (ending === 'logout') web.send('fixture.logout');
    else if (ending === 'reselection') web.send('fixture.reselect');
    else if (ending === 'web_exit') web.kill();
    else if (ending.startsWith('currentness')) {
      dbServer.$client.prepare('UPDATE patients SET version = 8 WHERE id = ?').run(PATIENT);
      mini.stdin!.write(JSON.stringify(revokedRequest) + '\n');
    }
    else mini.stdin!.end();
    const terminalData = dataSnapshot();
    await until(() => children.every((child) => child.exitCode !== null || child.signalCode !== null));
    await runtime.closed;
    assert.equal(runtime.terminate(), false);
    if (ending === 'lock' || ending === 'logout') assert.match(webOutput, /FIXTURE_REVOKED/u);
    assert.doesNotMatch(miniOutput, /patient\.synthetic|ambulatory\.synthetic|service\.synthetic|prescription\.service|Synthetic pending service|synthetic-mini-user|FIXTURE_/u);
    const responses = miniOutput.split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(responses.length === responseCount || (ending.startsWith('currentness') && responses.length === responseCount + 1));
    if (responses.length > responseCount) {
      assert.equal(responses[responseCount].ok, false); assert.equal(responses[responseCount].status.ready, false);
    }
    assert.deepEqual(auditCounts(), terminalAuditCounts, 'no successful operation after context revocation');
    assert.deepEqual(dataSnapshot(), terminalData, 'shutdown performs no clinical write');
    for (const line of miniOutput.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  });
}

// @Codex: force the proven exit-before-stdout ordering, then require the real marker.
test('Web fixture marker survives exit before stdout delivery', async (t) => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('FIXTURE_ACTIVATED\\n');"], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stdout!.pause();
  const exited = new Promise<void>(resolve => child.once('exit', () => {
    assert.equal(output, '');
    resolve();
  }));
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  await waitForWebFixtureMarker(child, () => output, 'FIXTURE_ACTIVATED');
  await exited;
  await closed;
  assert.equal(output, 'FIXTURE_ACTIVATED\n');
});

// @Codex: a closed Web fixture without an activation marker still fails closed.
test('Web fixture closure cannot substitute for the activation marker', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: ['ignore', 'pipe', 'pipe'] });
  await assert.rejects(waitForWebFixtureMarker(child, () => '', 'FIXTURE_ACTIVATED'),
    /Mini Web fixture ended before FIXTURE_ACTIVATED/u);
});
