/* @Codex */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAuthenticatedAgentLauncherV1 } from './authenticated-agent-launcher.ts';

const CURRENT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEPENDENCY_ROOT = process.env.MEDIFLOW_TEST_DEPENDENCY_ROOT ?? CURRENT_ROOT;
const LOADER = `${DEPENDENCY_ROOT}/scripts/register-strip-types-loader.mjs`;
const CLI = `${DEPENDENCY_ROOT}/packages/mini/src/cli.ts`;
const DIGEST = `sha256:${'a'.repeat(64)}`;
const PATIENT_ID = 'synthetic-patient-id';
const AMBULATORY_ID = 'synthetic-ambulatory-id';

function result() {
  return {
    schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
    operationId: 'mediflow.patient.open_loops.read.v1',
    capabilityId: 'mediflow.patient.open_loops.read.v1', outcome: 'read',
    items: [{ loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending', temporalState: 'overdue',
      openedAt: 100, dueAt: 900, revision: 1 }], truncated: false, snapshotRevision: 7,
    receipt: { schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1',
      receiptRef: `aipr_${'2'.repeat(64)}`, operationId: 'mediflow.patient.open_loops.read.v1',
      capabilityId: 'mediflow.patient.open_loops.read.v1', outcome: 'read', ownerRefHash: DIGEST,
      leaseRefHash: DIGEST, receiptRefHash: DIGEST, generation: 1, revocationGeneration: 0,
      selectionEpoch: 2, snapshotRevision: 7, itemCount: 1, truncated: false, timestamp: 1_000 },
  };
}

test('launches a real Mini child and serves host-scoped open loops over authenticated inherited IPC', async () => {
  let sequence = 0;
  let child: ChildProcess | null = null;
  let stdout = '', stderr = '';
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });
  const audits: unknown[] = [];
  const scopes: unknown[] = [];
  const launcher = createAuthenticatedAgentLauncherV1({
    now: () => 1_000,
    nextRef: (kind: string) => {
      sequence += 1;
      return kind === 'bootstrap' ? `aipb_${sequence.toString(16).padStart(32, '0')}`
        : `${kind.replaceAll('_', '.')}.synthetic.${String(sequence).padStart(8, '0')}`;
    },
    hashRef: (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`,
    writeAudit: async (value: unknown) => { audits.push(value); },
    readHostContext: () => ({ status: 'available', userRef: 'user.synthetic.local.0001',
      parentRef: 'parent.synthetic.web.0001', purposeCode: 'care_coordination', patientId: PATIENT_ID,
      ambulatoryId: AMBULATORY_ID, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
      restartGeneration: 1, parentGeneration: 1, policyGeneration: 1,
      expiresAt: 5_000, bootstrapExpiresAt: 2_000 }),
    spawnChild: (environment: Readonly<Record<string, string>>) => {
      const process = spawn(globalThis.process.execPath,
        ['--experimental-strip-types', '--import', LOADER, CLI], {
          cwd: DEPENDENCY_ROOT, env: { ...environment } as NodeJS.ProcessEnv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });
      child = process;
      process.stdout!.setEncoding('utf8'); process.stderr!.setEncoding('utf8');
      process.stdout!.on('data', (chunk: string) => { stdout += chunk; });
      process.stderr!.on('data', (chunk: string) => { stderr += chunk; });
      process.once('exit', resolveExit);
      process.stdin!.end('{"command":"open-loops","args":{}}');
      const connection = Object.freeze(Object.create(null)) as object;
      return {
        connection,
        subscribe: (listener: (frame: unknown) => void) => {
          process.on('message', listener); return () => process.off('message', listener);
        },
        publish: (frame: string) => { if (!process.connected) throw new Error('disconnected'); process.send(frame); },
        onClose: (listener: () => void) => {
          process.once('exit', listener); process.once('error', listener);
          return () => { process.off('exit', listener); process.off('error', listener); };
        },
        terminate: () => { if (process.exitCode === null && process.signalCode === null) process.kill(); },
      };
    },
    createOpenLoopsRead: (sourcesValue: unknown) => {
      const sources = sourcesValue as {
        current: () => unknown; beginPermit: (permit: unknown, current: unknown, claim: unknown) => object;
        bindPermit: (execution: object, binding: unknown, current: unknown, claim: unknown) => object;
        finalizeBoundPermit: (execution: object, binding: unknown, current: unknown, claim: unknown) => true;
        denyPermit: (execution: object) => boolean; resolveHostScope: (execution: object) => unknown;
      };
      let cancelled = false;
      return { service: {
        read: async (permit: unknown, input: unknown) => {
          const claim = Object.freeze(Object.assign(Object.create(null), {
            operation: 'mediflow.patient.open_loops.read.v1',
            capabilityId: 'mediflow.patient.open_loops.read.v1',
          }));
          const current = sources.current();
          const execution = sources.beginPermit(permit, current, claim);
          try {
            const scope = sources.resolveHostScope(execution) as Record<string, unknown> | null;
            scopes.push(scope);
            assert.equal(scope?.patientId, PATIENT_ID); assert.equal(scope?.ambulatoryId, AMBULATORY_ID);
            assert.deepEqual({ ...(input as object) }, { schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
              operationId: 'mediflow.patient.open_loops.read.v1' });
            const binding = Object.freeze(Object.assign(Object.create(null), { scopeDigest: scope?.scopeDigest,
              generation: scope?.generation, revocationGeneration: scope?.revocationGeneration,
              selectionEpoch: scope?.selectionEpoch }));
            const bound = sources.bindPermit(execution, binding, sources.current(), claim);
            assert.equal(sources.finalizeBoundPermit(bound, binding, sources.current(), claim), true);
            if (cancelled) throw new Error('cancelled');
            return result();
          } catch (error) { sources.denyPermit(execution); throw error; }
        },
        cancel: () => { cancelled = true; }, dispose: () => { cancelled = true; },
      } };
    },
  });

  const session = await launcher.launch();
  assert.equal(session.status, 'authenticated');
  assert.equal(await exited, 0, `${stdout}\n${stderr}\naudits=${JSON.stringify(audits)} scopes=${JSON.stringify(scopes)}`);
  assert.equal(stderr, '');
  const response = JSON.parse(stdout) as { ok: boolean; result: ReturnType<typeof result> };
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, result());
  assert.equal(scopes.length, 1);
  assert.equal(JSON.stringify(audits).includes(PATIENT_ID), false);
  assert.equal(JSON.stringify(audits).includes(AMBULATORY_ID), false);
  assert.equal(child?.exitCode, 0);
  assert.equal(session.close(), false);
});

test('propagates restart to RPC, scope, broker and the authenticated child', async () => {
  let sequence = 0;
  let terminated = false;
  const messageListeners = new Set<(frame: unknown) => void>();
  const launcher = createAuthenticatedAgentLauncherV1({
    now: () => 1_000,
    nextRef: (kind: string) => {
      sequence += 1;
      return kind === 'bootstrap' ? `aipb_${sequence.toString(16).padStart(32, '0')}`
        : `${kind.replaceAll('_', '.')}.synthetic.${String(sequence).padStart(8, '0')}`;
    },
    hashRef: (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`,
    writeAudit: async () => undefined,
    readHostContext: () => ({ status: 'available', userRef: 'user.synthetic.local.0001',
      parentRef: 'parent.synthetic.web.0001', purposeCode: 'care_coordination', patientId: PATIENT_ID,
      ambulatoryId: AMBULATORY_ID, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
      restartGeneration: 1, parentGeneration: 1, policyGeneration: 1,
      expiresAt: 5_000, bootstrapExpiresAt: 2_000 }),
    spawnChild: (environment: Readonly<Record<string, string>>) => {
      assert.deepEqual(Reflect.ownKeys(environment).sort(),
        ['MEDIFLOW_AIP_BOOTSTRAP_REF', 'MEDIFLOW_AIP_OPERATION_RPC'].sort());
      const bootstrapRef = environment.MEDIFLOW_AIP_BOOTSTRAP_REF!;
      const connection = Object.freeze(Object.create(null)) as object;
      queueMicrotask(() => {
        for (const listener of messageListeners) listener(JSON.stringify({
          schemaVersion: 'mediflow.aip.bootstrap.v1', operation: 'bootstrap', bootstrapRef,
        }));
      });
      return {
        connection,
        subscribe: (listener: (frame: unknown) => void) => {
          messageListeners.add(listener); return () => messageListeners.delete(listener);
        },
        publish: () => undefined,
        onClose: () => () => undefined,
        terminate: () => { terminated = true; },
      };
    },
    createOpenLoopsRead: () => ({ service: { read: async () => result(), cancel: () => undefined,
      dispose: () => undefined } }),
  });
  const session = await launcher.launch();
  assert.equal(session.restart(), true);
  assert.equal(session.restart(), false);
  assert.equal(terminated, true);
  await assert.rejects(launcher.launch(), (error: unknown) =>
    (error as { code?: string }).code === 'already_started');
});
