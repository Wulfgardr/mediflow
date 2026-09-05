/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

function canonicalResult() {
  const canonical = <T extends object>(value: T): Readonly<T> =>
    Object.freeze(Object.assign(Object.create(null) as T, value));
  const value = result();
  return canonical({ ...value, items: Object.freeze(value.items.map((item) => canonical(item))),
    receipt: canonical(value.receipt) });
}

function createSyntheticOpenLoopsRead(scopes: unknown[]) {
  return (sourcesValue: unknown) => {
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
          return canonicalResult();
        } catch (error) { sources.denyPermit(execution); throw error; }
      },
      cancel: () => { cancelled = true; }, dispose: () => { cancelled = true; },
    } };
  };
}

function terminalAuditSink(audits: unknown[]) {
  return (_intent: unknown, decideAtCommit: () => unknown) => {
    const audit = decideAtCommit();
    audits.push(audit);
    return audit;
  };
}

async function runRealMini(command: 'open-loops' | 'follow-up-proposal') {
  let sequence = 0;
  let stdout = '', stderr = '';
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });
  const audits: unknown[] = [];
  const terminalAudits: unknown[] = [];
  const scopes: unknown[] = [];
  const launcher = createAuthenticatedAgentLauncherV1({
    now: () => 1_000,
    nextRef: (kind: string) => {
      sequence += 1;
      return kind === 'bootstrap' ? `aipb_${sequence.toString(16).padStart(32, '0')}`
        : kind === 'follow_up_proposal' ? `aipfp_${sequence.toString(16).padStart(64, '0')}`
          : kind === 'follow_up_proposal_receipt' ? `aipfr_${sequence.toString(16).padStart(64, '0')}`
        : `${kind.replaceAll('_', '.')}.synthetic.${String(sequence).padStart(8, '0')}`;
    },
    hashRef: (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`,
    writeAudit: async (value: unknown) => { audits.push(value); },
    commitTerminalAudit: terminalAuditSink(terminalAudits),
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
      process.stdout!.setEncoding('utf8'); process.stderr!.setEncoding('utf8');
      process.stdout!.on('data', (chunk: string) => { stdout += chunk; });
      process.stderr!.on('data', (chunk: string) => { stderr += chunk; });
      process.once('exit', resolveExit);
      process.stdin!.end(JSON.stringify({ command, args: {} }));
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
    createOpenLoopsRead: createSyntheticOpenLoopsRead(scopes),
    previewCheckupStatus: async () => { throw new Error('not exercised'); },
  });

  const session = await launcher.launch();
  assert.equal(session.status, 'authenticated');
  assert.equal(await exited, 0, `${stdout}\n${stderr}\naudits=${JSON.stringify(audits)} scopes=${JSON.stringify(scopes)}`);
  assert.equal(stderr, '');
  return { response: JSON.parse(stdout) as { ok: boolean; result: unknown }, audits, terminalAudits, scopes, session };
}

test('launches a real Mini child and serves host-scoped open loops over authenticated inherited IPC', async () => {
  const { response, audits, scopes, session } = await runRealMini('open-loops');
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, result());
  assert.equal(scopes.length, 1);
  assert.doesNotMatch(JSON.stringify(audits), new RegExp(`${PATIENT_ID}|${AMBULATORY_ID}`, 'u'));
  assert.equal(session.close(), false);
});

test('serves a real Mini follow-up proposal without writes or apply authority', async () => {
  const { response, audits, scopes, session } = await runRealMini('follow-up-proposal');
  const proposal = response.result as { maximumStage?: unknown; reviewRequired?: unknown; writesPerformed?: unknown;
    apply?: unknown; receipt?: Record<string, unknown> };
  assert.equal(response.ok, true);
  assert.deepEqual([proposal.maximumStage, proposal.reviewRequired, proposal.writesPerformed, proposal.apply],
    ['proposal_only', true, 0, 'none']);
  assert.deepEqual([proposal.receipt?.maximumStage, proposal.receipt?.writesPerformed, proposal.receipt?.apply],
    ['proposal_only', 0, 'none']);
  assert.equal(scopes.length, 1);
  assert.doesNotMatch(JSON.stringify(audits), new RegExp(`${PATIENT_ID}|${AMBULATORY_ID}`, 'u'));
  assert.equal(session.close(), false);
});

function semanticInput(terminologyOnly = false) {
  const terminology = {
    stepRef: 'step_terminology',
    operationId: 'mediflow.terminology.search.v1',
    input: { schemaVersion: 'mediflow.terminology.search.input.v1',
      operationId: 'mediflow.terminology.search.v1', system: 'LOINC', query: 'blood pressure', limit: 1 },
  };
  return {
    schemaVersion: 'mediflow.semantic-query-operation.input.v1',
    operationId: 'mediflow.semantic_query_plan.execute.v1',
    budget: { maxSteps: terminologyOnly ? 1 : 2, maxDurationMs: 200, maxOutputBytes: 24 * 1024 },
    explanation: 'Read synthetic host-owned sources.',
    steps: terminologyOnly ? [terminology] : [{
      stepRef: 'step_open_loops',
      operationId: 'mediflow.patient.open_loops.read.v1',
      input: { schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: 'mediflow.patient.open_loops.read.v1' },
    }, terminology],
  };
}

function mutableHostContext() {
  return { status: 'available', userRef: 'user.synthetic.local.0001',
    parentRef: 'parent.synthetic.web.0001', purposeCode: 'care_coordination', patientId: PATIENT_ID,
    ambulatoryId: AMBULATORY_ID, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
    restartGeneration: 1, parentGeneration: 1, policyGeneration: 1,
    expiresAt: 5_000, bootstrapExpiresAt: 2_000 };
}

type SyntheticRpcOptions = Readonly<{
  operationId?: string; input?: unknown;
  onAudit?: (audit: unknown, context: ReturnType<typeof mutableHostContext>) => void;
  commitTerminalAudit?: (intent: unknown, decideAtCommit: () => unknown) => unknown;
  previewCheckupStatus?: (input: unknown, signal: AbortSignal) => Promise<unknown>;
}>;

async function runSyntheticRpc(options: SyntheticRpcOptions = {}) {
  let sequence = 0;
  let publishCount = 0;
  let terminated = false;
  const audits: unknown[] = [];
  const terminalAudits: unknown[] = [];
  const scopes: unknown[] = [];
  const hashInputs: string[] = [];
  const hostContext = mutableHostContext();
  const messageListeners = new Set<(frame: unknown) => void>();
  let resolveRpc!: (frame: unknown) => void;
  const rpcResponse = new Promise<unknown>((resolve) => { resolveRpc = resolve; });
  const launcher = createAuthenticatedAgentLauncherV1({
    now: () => 1_000,
    nextRef: (kind: string) => {
      sequence += 1;
      return kind === 'bootstrap' ? `aipb_${sequence.toString(16).padStart(32, '0')}`
        : `${kind.replaceAll('_', '.')}.synthetic.${String(sequence).padStart(8, '0')}`;
    },
    hashRef: (value: string) => {
      hashInputs.push(value);
      return `sha256:${createHash('sha256').update(value).digest('hex')}`;
    },
    writeAudit: async (value: unknown) => { audits.push(value); options.onAudit?.(value, hostContext); },
    commitTerminalAudit: options.commitTerminalAudit ?? terminalAuditSink(terminalAudits),
    readHostContext: () => ({ ...hostContext }),
    spawnChild: (environment: Readonly<Record<string, string>>) => {
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
        publish: (frame: string) => {
          publishCount += 1;
          if (publishCount === 1) {
            queueMicrotask(() => {
              for (const listener of messageListeners) listener(JSON.stringify({
                schemaVersion: 'mediflow.aip.operation.request.v1', method: 'call', requestId: 'rpc_semantic_1',
                operationId: options.operationId ?? 'mediflow.semantic_query_plan.execute.v1',
                input: options.input ?? semanticInput(),
              }));
            });
          } else resolveRpc(JSON.parse(frame) as unknown);
        },
        onClose: () => () => undefined,
        terminate: () => { terminated = true; },
      };
    },
    createOpenLoopsRead: createSyntheticOpenLoopsRead(scopes),
    previewCheckupStatus: options.previewCheckupStatus ?? (async () => { throw new Error('not exercised'); }),
  });

  const session = await launcher.launch();
  const response = await rpcResponse as Record<string, unknown>;
  return { response, audits, terminalAudits, scopes, hashInputs, hostContext, session,
    terminated: () => terminated };
}

test('composes the bounded semantic planner through the authenticated launcher', async () => {
  const current = await runSyntheticRpc();
  const response = current.response as { outcome: unknown; result?: { operation?: Record<string, unknown>;
    value?: { steps?: Array<{ operationId?: unknown; output?: Record<string, unknown> }>;
      receipt?: Record<string, unknown> } } };
  assert.equal(response.outcome, 'completed', JSON.stringify({ response, audits: current.audits,
    terminalAudits: current.terminalAudits, scopes: current.scopes }));
  assert.deepEqual(response.result?.operation, {
    operationId: 'mediflow.semantic_query_plan.execute.v1',
    capabilityId: 'mediflow.semantic_query_plan.execute.v1',
    serviceRef: 'SemanticQueryOperationServiceV1', maximumStage: 'read_only',
  });
  assert.deepEqual(response.result?.value?.steps?.map((step) => step.operationId),
    ['mediflow.patient.open_loops.read.v1', 'mediflow.terminology.search.v1']);
  const childReceipt = response.result?.value?.steps?.[0]?.output?.receipt as Record<string, unknown> | undefined;
  assert.deepEqual([response.result?.value?.steps?.[0]?.output?.snapshotRevision, childReceipt?.snapshotRevision,
    childReceipt?.receiptRef], [7, 7, `aipr_${'2'.repeat(64)}`]);
  assert.deepEqual([response.result?.value?.receipt?.outcome, response.result?.value?.receipt?.writesPerformed,
    response.result?.value?.receipt?.applyPolicy], ['orchestration', 0, 'none']);
  const lineage = Array.from(new Set(current.hashInputs.filter((value) =>
    value.startsWith('mediflow.semantic-query-source-lineage.v1\0'))));
  assert.equal(lineage.length, 2);
  const parts = lineage.map((value) => value.split('\0'));
  assert.equal(parts[0]?.[1], parts[1]?.[1]);
  assert.match(parts[0]?.[1] ?? '', /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(parts[0]?.[1], (current.scopes[0] as { scopeDigest?: unknown })?.scopeDigest);
  assert.deepEqual(parts.map((value) => value.slice(2)), [[
    '1', '0', '2', 'mediflow.terminology.search.v1', 'mediflow.terminology.search.v1',
    'AipTerminologySearchServiceV1', 'mediflow.terminology.search.input.v1',
    'mediflow.terminology.search.output.v1', 'read_only',
  ], [
    '1', '0', '2', 'mediflow.patient.open_loops.read.v1', 'mediflow.patient.open_loops.read.v1',
    'PatientOpenLoopsReadServiceV1', 'mediflow.patient.open_loops.read.input.v1',
    'mediflow.patient.open_loops.read.result.v1', 'read_only',
  ]]);
  assert.equal(current.terminalAudits.length, 1);
  assert.doesNotMatch(JSON.stringify(current.terminalAudits),
    new RegExp(`${PATIENT_ID}|${AMBULATORY_ID}|sourceRefs|blood pressure`, 'u'));
  assert.doesNotMatch(JSON.stringify(current.audits), new RegExp(`${PATIENT_ID}|${AMBULATORY_ID}`, 'u'));
  assert.equal(current.scopes.length, 1);
  assert.equal(current.session.close(), true);
  assert.equal(current.terminated(), true);
});

test('opens and finalizes the checkup permit only at proposal_only after a current Web result', async () => {
  let forwarded: unknown;
  const input = { schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
    operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef: `hcsr_${'a'.repeat(64)}`,
    targetStatus: 'completed', expectedRevision: 1 };
  const current = await runSyntheticRpc({ operationId: 'mediflow.patient.checkup.status.transition.v1', input,
    previewCheckupStatus: async (value) => { forwarded = value; return {
      schemaVersion: 'mediflow.checkup-status.ipc.v1', type: 'preview_result',
      requestRef: `hcqr_${'b'.repeat(32)}`, operationId: 'mediflow.patient.checkup.status.transition.v1',
      outcome: 'proposed', proposalRef: `hcsp_${'c'.repeat(64)}`, expiresAt: 2_000 } } });
  assert.deepEqual({ ...(forwarded as Record<string, unknown>) }, input);
  const result = current.response.result as { operation?: Record<string, unknown>; value?: Record<string, unknown> };
  assert.equal(current.response.outcome, 'completed', JSON.stringify(current.response));
  assert.deepEqual(result.operation, { operationId: 'mediflow.patient.checkup.status.transition.v1',
    capabilityId: 'mediflow.patient.checkup.status.transition.v1',
    serviceRef: 'HeadlessCheckupStatusTransitionServiceV1', maximumStage: 'proposal_only' });
  assert.deepEqual(result.value, { schemaVersion: 'mediflow.patient.checkup.status.transition.preview-result.v1',
    operationId: 'mediflow.patient.checkup.status.transition.v1', outcome: 'proposed',
    proposalRef: `hcsp_${'c'.repeat(64)}`, expiresAt: 2_000 });
  assert.equal(current.session.close(), true);
});

test('denies patient or ambulatory identity drift with an unchanged numeric tuple', async () => {
  for (const field of ['patientId', 'ambulatoryId'] as const) {
    let mutated = false;
    const current = await runSyntheticRpc({ operationId: 'mediflow.terminology.search.v1',
      input: { schemaVersion: 'mediflow.terminology.search.input.v1',
        operationId: 'mediflow.terminology.search.v1', system: 'LOINC', query: 'blood pressure', limit: 1 },
      onAudit: (audit, context) => {
        const value = audit as { eventType?: unknown; outcome?: unknown; operation?: unknown };
        if (!mutated && value.eventType === 'authorization' && value.outcome === 'allowed'
          && value.operation === 'mediflow.terminology.search.v1') {
          context[field] = `changed-${field}`; mutated = true;
        }
      } });
    assert.equal(mutated, true);
    assert.deepEqual([current.response.outcome, current.response.denialCode], ['denied', 'service_failed']);
    assert.equal(current.audits.some((audit) => {
      const value = audit as { eventType?: unknown; outcome?: unknown };
      return value.eventType === 'terminology_search' && value.outcome === 'allowed';
    }), false);
    assert.doesNotMatch(JSON.stringify(current.audits), /synthetic-patient-id|synthetic-ambulatory-id/u);
    assert.equal(current.session.close(), true);
  }
});

test('denies a semantic outer permit when the bound scope registry restarts', async () => {
  let mutated = false;
  const current = await runSyntheticRpc({ input: semanticInput(true), onAudit: (audit, context) => {
    const value = audit as { eventType?: unknown; outcome?: unknown; operation?: unknown };
    if (!mutated && value.eventType === 'authorization' && value.outcome === 'allowed'
      && value.operation === 'mediflow.semantic_query_plan.execute.v1') {
      context.restartGeneration += 1; mutated = true;
    }
  } });
  assert.equal(mutated, true);
  assert.deepEqual([current.response.outcome, current.response.denialCode], ['denied', 'service_failed']);
  assert.deepEqual(current.terminalAudits.map((audit) => [(audit as { outcome?: unknown }).outcome,
    (audit as { denialCode?: unknown }).denialCode]), [['denied', 'currentness_denied']]);
  assert.equal(current.scopes.length, 0);
  assert.equal(current.session.close(), true);
});

test('does not accept a no-op terminal audit port as a successful semantic commit', async () => {
  const current = await runSyntheticRpc({ input: semanticInput(true), commitTerminalAudit: () => undefined });
  assert.deepEqual([current.response.outcome, current.response.denialCode], ['denied', 'service_failed']);
  assert.equal(current.session.close(), true);
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
    commitTerminalAudit: terminalAuditSink([]),
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
    previewCheckupStatus: async () => { throw new Error('not exercised'); },
  });
  const session = await launcher.launch();
  assert.equal(session.restart(), true);
  assert.equal(session.restart(), false);
  assert.equal(terminated, true);
  await assert.rejects(launcher.launch(), (error: unknown) =>
    (error as { code?: string }).code === 'already_started');
});
