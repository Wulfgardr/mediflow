import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAuthenticatedAgentLauncherV1 } from './authenticated-agent-launcher.ts';
import { createPatientProfileQuerySupervisorPortV1 } from '../security/patient-profile-query-supervisor-port.ts';
import { decodePatientProfileQueryIpcFrameV1, encodePatientProfileQueryIpcFrameV1 } from '../../packages/aip/src/patient-profile-query-ipc.ts';
import { type ProfileQuery, type ProfileResult } from '../patient-profile-scoped-contract.ts';

const OPERATION = 'patient-profile.read.v1';
const HANDLE = `pph_${'b'.repeat(64)}`;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOADER = new URL('../../scripts/register-strip-types-loader.mjs', import.meta.url).href;
const CLI = fileURLToPath(new URL('../../packages/mini/src/cli.ts', import.meta.url));
const open = { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 2 } as const;
type Options = { admitted?: boolean; auditFails?: boolean; drift?: boolean; replay?: boolean; projection?: 'profile' | 'notes' };

async function fixture(options: Options = {}) {
  const now = Date.now();
  const context = { status: 'available', userRef: 'user.synthetic.profile.0001', parentRef: 'parent.synthetic.profile.0001',
    purposeCode: 'care_coordination', patientId: 'synthetic-internal-patient', ambulatoryId: 'synthetic-internal-ambulatory',
    generation: 1, revocationGeneration: 0, selectionEpoch: 37, restartGeneration: 1, parentGeneration: 1,
    policyGeneration: 1, bootstrapExpiresAt: now + 5000, expiresAt: now + 60000 };
  let sequence = 0, queryCount = 0, child: ChildProcess | undefined;
  const audits: Array<Record<string, unknown>> = [], requests: ProfileQuery[] = [];
  const replies: unknown[] = [], waiting: Array<(value: unknown) => void> = [];
  let raw = '', stderr = '', capturedCall: string | null = null;
  let rpcListener: ((wire: unknown) => void) | null = null, replayed = false;
  let resolveReplay!: (value: unknown) => void;
  const replayResult = new Promise<unknown>(resolve => { resolveReplay = resolve; });
  const profile = createPatientProfileQuerySupervisorPortV1({
    randomBytes: size => Buffer.alloc(size, ++sequence),
    schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
    onTerminal: () => undefined,
    sendWeb: (wire, complete) => {
      const frame = decodePatientProfileQueryIpcFrameV1(wire);
      assert.equal(frame.type, 'query');
      if (frame.type !== 'query') throw new Error('query required');
      queryCount++; requests.push(frame.input); complete(null);
      const result: ProfileResult = { schemaVersion: 'mediflow.patient.profile-view.v1', operationId: OPERATION,
        contractVersion: 1, handle: HANDLE, projection: frame.input.projection, currentness: { revision: 3,
          selectionEpoch: context.selectionEpoch, observedAt: now, expiresAt: now + 30000 }, profile: frame.input.projection === 'notes' ? { notes: 'Synthetic bounded notes' } : {
            firstName: 'Synthetic', lastName: 'Patient', taxCode: 'SYNTHETIC-CODE', birthDate: null, address: null,
            phone: null, caregiver: null, diagnoses: null, exemptions: null, notes: 'Synthetic bounded notes',
            isAdi: false, isArchived: false, statusReason: null, archiveReason: null, archiveNote: null } } as ProfileResult;
      queueMicrotask(() => {
        if (options.drift) context.selectionEpoch++;
        profile.acceptWebFrame(encodePatientProfileQueryIpcFrameV1({ schemaVersion: 'mediflow.patient-profile.ipc.v1',
          type: 'query_result', requestRef: frame.requestRef, operationId: OPERATION, outcome: 'completed', result }));
      });
    },
  });
  const launcher = createAuthenticatedAgentLauncherV1({
    now: Date.now,
    nextRef: (kind: string) => kind === 'bootstrap' ? `aipb_${(++sequence).toString(16).padStart(32, '0')}`
      : `${kind.replaceAll('_', '.')}.synthetic.${String(++sequence).padStart(8, '0')}`,
    hashRef: (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`,
    writeAudit: async (value: Record<string, unknown>) => {
      audits.push(value);
      if (options.auditFails && value.operation === OPERATION) throw new Error('synthetic audit unavailable');
    },
    commitTerminalAudit: () => { throw new Error('semantic planner must not run'); },
    readHostContext: () => ({ ...context }),
    createOpenLoopsRead: (value: unknown) => {
      const sources = value as { current(): unknown; beginPermit(permit: unknown, current: unknown, claim: unknown): object;
        resolveHostScope(execution: object): { selectionEpoch: number; scopeDigest: string; generation: number; revocationGeneration: number };
        bindPermit(execution: object, binding: unknown, current: unknown, claim: unknown): object;
        finalizeBoundPermit(execution: object, binding: unknown, current: unknown, claim: unknown): unknown;
        denyPermit(execution: object): unknown };
      const canonical = <T extends object>(v: T) => Object.freeze(Object.assign(Object.create(null), v));
      return { service: { cancel: () => undefined, dispose: () => undefined,
        read: async (permit: unknown) => {
          const operation = 'mediflow.patient.open_loops.read.v1';
          const claim = canonical({ operation, capabilityId: operation });
          const execution = sources.beginPermit(permit, sources.current(), claim);
          try {
            const scope = sources.resolveHostScope(execution);
            const binding = canonical({ scopeDigest: scope.scopeDigest, generation: scope.generation,
              revocationGeneration: scope.revocationGeneration, selectionEpoch: scope.selectionEpoch });
            const bound = sources.bindPermit(execution, binding, sources.current(), claim);
            sources.finalizeBoundPermit(bound, binding, sources.current(), claim);
            return canonical({ schemaVersion: 'mediflow.patient.open_loops.read.result.v1', operationId: operation,
              capabilityId: operation, outcome: 'read', items: Object.freeze([]), truncated: false, snapshotRevision: 3,
              receipt: canonical({ schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1',
                receiptRef: `aipr_${'c'.repeat(64)}`, operationId: operation, capabilityId: operation, outcome: 'read',
                ownerRefHash: `sha256:${'d'.repeat(64)}`, leaseRefHash: `sha256:${'e'.repeat(64)}`, receiptRefHash: `sha256:${'f'.repeat(64)}`,
                generation: scope.generation, revocationGeneration: scope.revocationGeneration, selectionEpoch: scope.selectionEpoch,
                snapshotRevision: 3, itemCount: 0, truncated: false, timestamp: now }) });
          } catch (error) { sources.denyPermit(execution); throw error; }
        } } };
    },
    previewCheckupStatus: async () => { throw new Error('checkup must not run'); },
    ...(options.admitted === false ? {} : { patientProfileQueries: { projection: options.projection ?? 'notes', executeProfileQuery: profile.executeProfileQuery } }),
    spawnChild: (environment: Readonly<Record<string, string>>) => {
      const current = spawn(process.execPath, ['--experimental-strip-types', '--import', LOADER, CLI, '--session'], {
        cwd: ROOT, env: { ...environment, NODE_ENV: 'test', ...(process.env.MEDIFLOW_TEST_NODE_PATH ? { NODE_PATH: process.env.MEDIFLOW_TEST_NODE_PATH } : {}) },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
      child = current;
      current.stdout!.setEncoding('utf8'); current.stderr!.setEncoding('utf8');
      current.stderr!.on('data', value => { stderr += value; });
      current.stdout!.on('data', value => {
        raw += value;
        let newline;
        while ((newline = raw.indexOf('\n')) >= 0) {
          const reply = JSON.parse(raw.slice(0, newline)); raw = raw.slice(newline + 1);
          const waiter = waiting.shift(); if (waiter) waiter(reply); else replies.push(reply);
        }
      });
      return { connection: Object.freeze(Object.create(null)),
        subscribe: (listener: (value: unknown) => void) => {
          rpcListener = listener;
          const receive = (wire: unknown) => {
            if (typeof wire === 'string') {
              const frame = JSON.parse(wire);
              if (frame.method === 'call' && frame.operationId === OPERATION) capturedCall = wire;
            }
            listener(wire);
          };
          current.on('message', receive); return () => current.off('message', receive);
        },
        publish: (wire: string) => {
          const response = JSON.parse(wire);
          if (replayed && response.denialCode === 'request_conflict') { resolveReplay(response); return; }
          if (!current.connected) throw new Error('child unavailable'); current.send(wire);
          if (options.replay && capturedCall && response.outcome === 'completed' && response.result?.operation?.operationId === OPERATION) {
            replayed = true; queueMicrotask(() => rpcListener!(capturedCall));
          }
        },
        onClose: (listener: () => void) => { current.on('exit', listener); return () => current.off('exit', listener); },
        terminate: () => { if (current.connected) current.disconnect(); if (current.exitCode === null) current.kill(); },
      };
    },
  });
  const session = await launcher.launch();
  const request = async (command: string, args: unknown) => {
    const reply = new Promise<unknown>((resolve, reject) => {
      if (replies.length) return resolve(replies.shift());
      const timer = setTimeout(() => reject(new Error('Synthetic Mini reply timed out')), 5000);
      waiting.push(value => { clearTimeout(timer); resolve(value); });
    });
    child!.stdin!.write(`${JSON.stringify({ command, args })}\n`);
    return await reply as { ok: boolean; result?: Record<string, unknown>; error?: { code: string } };
  };
  const close = async () => {
    const exited = child!.exitCode !== null || child!.signalCode !== null ? Promise.resolve() : once(child!, 'exit');
    session.close(); profile.close(); await exited;
  };
  const readSelectionEpoch = async () => {
    const result = await request('open-loops', {});
    assert.equal(result.ok, true);
    const epoch = (result.result?.receipt as { selectionEpoch: number }).selectionEpoch;
    assert.ok(Number.isSafeInteger(epoch)); return epoch;
  };
  return { request, close, audits, requests, replayResult, readSelectionEpoch, queryCount: () => queryCount, stderr: () => stderr };
}

test('real Mini opens then rereads an admitted notes handle through authenticated RPC and correlated Web port without MCP/providers', async () => {
  const current = await fixture();
  try {
    const expectedSelectionEpoch = await current.readSelectionEpoch();
    const first = await current.request('profile-read', { ...open, expectedSelectionEpoch });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.result?.handle, HANDLE);
    assert.deepEqual(first.result?.profile, { notes: 'Synthetic bounded notes' });
    const second = await current.request('profile-read', { kind: 'read', contractVersion: 1, projection: 'notes',
      handle: first.result!.handle, expectedRevision: (first.result!.currentness as { revision: number }).revision });
    assert.equal(second.ok, true, JSON.stringify(second)); assert.equal(second.result?.handle, HANDLE);
    assert.equal(current.queryCount(), 2);
    const authorization = current.audits.filter(a => a.operation === OPERATION);
    assert.equal(authorization.length, 2); assert.ok(authorization.every(a => a.eventType === 'authorization' && a.outcome === 'allowed'));
    assert.doesNotMatch(JSON.stringify(current.audits), /Synthetic bounded notes|synthetic-internal-patient|pph_/u);
    assert.doesNotMatch(JSON.stringify(first), /patientId|ambulatoryId|database|dbPath/u);
  } finally { await current.close(); }
});

test('an existing open-loops connection does not automatically receive the profile operation', async () => {
  const current = await fixture({ admitted: false });
  try {
    const catalog = await current.request('capabilities', {});
    assert.equal(catalog.ok, true);
    assert.equal(JSON.stringify(catalog).includes(OPERATION), false);
    assert.equal((await current.request('profile-read', { ...open, expectedSelectionEpoch: await current.readSelectionEpoch() })).ok, false);
    assert.equal(current.queryCount(), 0);
    assert.equal(current.audits.some(a => a.operation === OPERATION), false);
  } finally { await current.close(); }
});

test('audit failure and projection escalation deny before the query, scope drift denies after await', async () => {
  for (const mode of ['audit', 'projection', 'drift'] as const) {
    const current = await fixture({ auditFails: mode === 'audit', drift: mode === 'drift' });
    try {
      const expectedSelectionEpoch = await current.readSelectionEpoch();
      const result = await current.request('profile-read', { ...open, expectedSelectionEpoch,
        ...(mode === 'projection' ? { projection: 'profile' } : {}) });
      assert.equal(result.ok, false, mode);
      assert.equal(current.queryCount(), mode === 'drift' ? 1 : 0, mode);
    } finally { await current.close(); }
  }
});

test('real Mini can read the fifteen-field profile and narrow its admitted projection to notes', async () => {
  const current = await fixture({ projection: 'profile' });
  try {
    const expectedSelectionEpoch = await current.readSelectionEpoch();
    const full = await current.request('profile-read', { ...open, projection: 'profile', expectedSelectionEpoch });
    assert.equal(full.ok, true);
    assert.equal(Object.keys(full.result?.profile as object).length, 15);
    assert.equal((full.result?.profile as { firstName: string }).firstName, 'Synthetic');
    const narrowed = await current.request('profile-read', { ...open, expectedSelectionEpoch });
    assert.equal(narrowed.ok, true);
    assert.deepEqual(narrowed.result?.profile, { notes: 'Synthetic bounded notes' });
  } finally { await current.close(); }
});

test('replays the actual Mini RPC requestId and denies it without a second query or authorization audit', async () => {
  const current = await fixture({ replay: true });
  try {
    assert.equal((await current.request('profile-read', { ...open, expectedSelectionEpoch: await current.readSelectionEpoch() })).ok, true);
    const replay = await current.replayResult as { outcome: string; denialCode: string };
    assert.equal(replay.outcome, 'denied'); assert.equal(replay.denialCode, 'request_conflict');
    assert.equal(current.queryCount(), 1);
    assert.equal(current.audits.filter(a => a.operation === OPERATION).length, 1);
  } finally { await current.close(); }
});
