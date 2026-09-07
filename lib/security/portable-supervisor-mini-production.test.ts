/* @Codex */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const root = fs.realpathSync(process.cwd());
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-mini-production-')));
const dataDir = path.join(temporary, 'data');
const webDirectory = path.join(temporary, 'web');
fs.mkdirSync(dataDir); fs.mkdirSync(webDirectory);
process.env.MEDIFLOW_DATA_DIR = dataDir;
delete process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN;
const PATIENT = 'patient.synthetic.mini';
const AMBULATORY = 'ambulatory.synthetic.mini';
const database = new Database(path.join(dataDir, 'medical.db'));
for (const migration of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(root, 'drizzle', migration), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
database.prepare("INSERT INTO ambulatories (id, name, type, is_default) VALUES (?, 'Synthetic Mini', 'test', 1)")
  .run(AMBULATORY);
database.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, is_archived, version)
  VALUES (?, 'Synthetic', 'Mini', 'SYNTHETIC-MINI', 0, 7)`).run(PATIENT);
database.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
  .run(PATIENT, AMBULATORY);
database.close();

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
    resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 7 }), clock: Date.now,
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
    } else if (message === 'fixture.lock') {
      try { await controller.retire('application_lock'); retireSyntheticWebSession(session);
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
after(() => { dbServer.$client.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

async function until(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Mini production fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const ending of ['lock', 'reselection', 'eof', 'web_exit', 'currentness'] as const) {
  test(`production Mini uses genuine Web authority and terminates on ${ending}`, { timeout: 15_000 }, async (t) => {
    const children: ChildProcess[] = [];
    const exits: Promise<void>[] = [];
    let webOutput = '', miniOutput = '';
    const runtime = createPortableSupervisorProductionV1('mini', {
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
        exits.push(new Promise((resolve) => child.once('exit', () => resolve())));
        child.stdout!.on('data', (chunk) => { if (mini) miniOutput += chunk; else webOutput += chunk; });
        child.stderr!.on('data', (chunk) => { webOutput += chunk; });
        return child;
      },
    });
    t.after(async () => {
      runtime.terminate();
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      await Promise.all(exits);
    });
    const mini = children[0]!, web = children[1]!;
    assert.notEqual(mini.pid, web.pid); assert.notEqual(mini.pid, process.pid);
    const request = async (command: string) => {
      const count = miniOutput.split('\n').filter(Boolean).length;
      mini.stdin!.write(`${JSON.stringify({ command, args: {} })}\n`);
      await until(() => miniOutput.split('\n').filter(Boolean).length > count);
      return JSON.parse(miniOutput.split('\n').filter(Boolean)[count]!);
    };
    await until(() => webOutput.includes('FIXTURE_READY') || webOutput.includes('FIXTURE_FAILED')
      || children.some((child) => child.exitCode !== null || child.signalCode !== null));
    assert.match(webOutput, /FIXTURE_READY/u, webOutput + miniOutput);
    const before = await request('status');
    assert.equal(before.ok, true); assert.equal(before.result.transport, 'connected');
    assert.equal(before.result.session, 'not_unlocked'); assert.equal(before.result.ready, false);
    assert.deepEqual(before.result.capabilities, []);
    assert.equal(before.result.nextStep.code, 'AUTHORIZE_IN_OWNED_WEB');
    assert.equal((await request('capabilities')).error.code, 'SESSION_NOT_UNLOCKED');
    web.send('fixture.authorize');
    await until(() => webOutput.includes('FIXTURE_ACTIVATED') || webOutput.includes('FIXTURE_DENIED')
      || children.some((child) => child.exitCode !== null || child.signalCode !== null));
    assert.match(webOutput, /FIXTURE_ACTIVATED/u);
    const active = await request('status');
    assert.equal(active.ok, true); assert.equal(active.result.ready, true);
    assert.equal(active.result.session, 'authorized');
    const catalog = await request('capabilities');
    assert.equal(catalog.ok, true);
    assert.deepEqual(catalog.result.operations, active.result.capabilities);
    assert.ok(catalog.result.operations.some((item: { operationId: string }) =>
      item.operationId === 'mediflow.terminology.search.v1'));
    assert.ok(catalog.result.operations.every((item: { maximumStage: string }) =>
      ['read_only', 'proposal_only'].includes(item.maximumStage)));
    if (ending === 'lock') web.send('fixture.lock');
    else if (ending === 'reselection') web.send('fixture.reselect');
    else if (ending === 'web_exit') web.kill();
    else if (ending === 'currentness') {
      dbServer.$client.prepare('UPDATE patients SET version = 8 WHERE id = ?').run(PATIENT);
      mini.stdin!.write('{"command":"status","args":{}}\n');
    }
    else mini.stdin!.end();
    await until(() => children.every((child) => child.exitCode !== null || child.signalCode !== null));
    await runtime.closed;
    assert.equal(runtime.terminate(), false);
    if (ending === 'lock') assert.match(webOutput, /FIXTURE_REVOKED/u);
    assert.doesNotMatch(miniOutput, /patient\.synthetic|ambulatory\.synthetic|synthetic-mini-user|FIXTURE_/u);
    const responses = miniOutput.split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(responses.length === 4 || (ending === 'currentness' && responses.length === 5));
    if (responses.length === 5) {
      assert.equal(responses[4].ok, false); assert.equal(responses[4].status.ready, false);
    }
    dbServer.$client.prepare('UPDATE patients SET version = 7 WHERE id = ?').run(PATIENT);
    for (const line of miniOutput.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  });
}
