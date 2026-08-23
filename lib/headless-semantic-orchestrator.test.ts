/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createHeadlessSemanticOrchestrator,
    type HeadlessSemanticHost,
} from './headless-semantic-orchestrator';

const request = {
    adapterKind: 'chat' as const,
    intent: 'synthetic: summarize the selected fixture',
    requestRef: 'req_opaque0001',
    idempotencyRef: 'idem_opaque0001',
};

function fixture(overrides: Partial<HeadlessSemanticHost> = {}) {
    let calls = 0;
    let epoch = 7;
    const host: HeadlessSemanticHost = {
        acquireContext: () => ({ sessionRef: 'ses_opaque0001', activeRole: 'role_clinician', leaseEpoch: epoch, revoked: false, maxOperations: 1 }),
        plan: () => ({ operationId: 'op.fixture.read', input: { subjectRef: 'subject_opaque0001' } }),
        authorize: () => ({ allowed: true, policyDecision: 'per_operation_allow' }),
        registry: [{
            operationId: 'op.fixture.read', capabilityId: 'web-01-anagrafica-paziente-lista-ricerca-view-create-update', applicationServiceRef: 'appsvc:fixture-read',
            maximumStage: 'read', fabricDependency: null, inputKeys: ['subjectRef'],
            execute: () => { calls += 1; return { outcome: 'read', response: 'synthetic-response: fixture ready' }; },
        }],
        clock: () => '2026-08-24T08:00:00.000Z',
        entropy: () => 'act_opaque0001',
        ...overrides,
    };
    return { host, calls: () => calls, setEpoch: (value: number) => { epoch = value; } };
}

test('executes one explicitly mapped named operation and emits a PHI-safe receipt', () => {
    const { host, calls } = fixture();
    const result = createHeadlessSemanticOrchestrator(host).run(request);
    assert.equal(calls(), 1);
    assert.deepEqual(result, {
        response: 'synthetic-response: fixture ready',
        receipt: {
            requestRef: 'req_opaque0001', actionRef: 'act_opaque0001', capabilityId: 'web-01-anagrafica-paziente-lista-ricerca-view-create-update', outcome: 'read',
            policyDecision: 'per_operation_allow', revisionBinding: 'lease:7', createdAt: '2026-08-24T08:00:00.000Z',
        },
        writesPerformed: 0,
        applyPolicy: 'none',
    });
    assert.equal(createHeadlessSemanticOrchestrator(fixture().host).run({ ...request, adapterKind: 'voice' }).receipt.outcome, 'read');
});

test('rejects caller authority, planner-selected service, hostile records, and thenables', () => {
    const { host } = fixture();
    const runner = createHeadlessSemanticOrchestrator(host);
    for (const key of ['session', 'role', 'authority', 'provider', 'model', 'venue', 'egress', 'confirmation', 'apply', 'applicationServiceRef'])
        assert.throws(() => runner.run({ ...request, [key]: 'caller-choice' } as never), /request_invalid/);
    assert.throws(() => runner.run({ ...request, adapterKind: 'rest' } as never), /request_invalid/);
    assert.throws(() => runner.run({ ...request, intent: 'synthetic: execute SQL' }), /request_invalid/);
    let reads = 0;
    const getter = Object.defineProperty({ ...request }, 'intent', { get: () => { reads += 1; return 'synthetic: trap'; }, enumerable: true });
    assert.throws(() => runner.run(getter as never), /request_invalid/);
    assert.equal(reads, 0);
    for (const key of ['applicationServiceRef', 'provider', 'authority', 'confirmation']) {
        const planned = fixture({ plan: () => ({ operationId: 'op.fixture.read', input: { subjectRef: 'subject_opaque0001' }, [key]: 'planner-choice' } as never) });
        assert.throws(() => createHeadlessSemanticOrchestrator(planned.host).run(request), /plan_invalid/);
    }
    const promised = fixture({ plan: async () => ({ operationId: 'op.fixture.read', input: {} }) as never });
    assert.throws(() => createHeadlessSemanticOrchestrator(promised.host).run(request), /plan_invalid/);
    assert.throws(() => createHeadlessSemanticOrchestrator(new Proxy(host, {}) as never), /host_invalid/);
    assert.throws(() => runner.run(Object.assign(Object.create({ inherited: true }), request)), /request_invalid/);
    assert.throws(() => runner.run({ ...request, [Symbol('authority')]: true } as never), /request_invalid/);
});

test('denies before execution when session, role, lease, revocation, authorization, or limits fail', () => {
    for (const acquireContext of [
        () => ({ sessionRef: '', activeRole: 'role_clinician', leaseEpoch: 7, revoked: false, maxOperations: 1 }),
        () => ({ sessionRef: 'ses_opaque0001', activeRole: '', leaseEpoch: 7, revoked: false, maxOperations: 1 }),
        () => ({ sessionRef: 'ses_opaque0001', activeRole: 'role_clinician', leaseEpoch: 0, revoked: false, maxOperations: 1 }),
        () => ({ sessionRef: 'ses_opaque0001', activeRole: 'role_clinician', leaseEpoch: 7, revoked: true, maxOperations: 1 }),
        () => ({ sessionRef: 'ses_opaque0001', activeRole: 'role_clinician', leaseEpoch: 7, revoked: false, maxOperations: 0 }),
    ]) {
        const candidate = fixture({ acquireContext });
        assert.throws(() => createHeadlessSemanticOrchestrator(candidate.host).run(request));
        assert.equal(candidate.calls(), 0);
    }
    const denied = fixture({ authorize: () => ({ allowed: false, policyDecision: 'per_operation_deny' }) });
    assert.throws(() => createHeadlessSemanticOrchestrator(denied.host).run(request), /authorization_denied/);
    assert.equal(denied.calls(), 0);
});

test('burns replay, detects swallowed reentry, and denies late host drift without a receipt', () => {
    const first = fixture();
    const runner = createHeadlessSemanticOrchestrator(first.host);
    runner.run(request);
    assert.throws(() => runner.run(request), /idempotency_replayed/);

    const holder: { runner?: ReturnType<typeof createHeadlessSemanticOrchestrator> } = {};
    const reentrant = fixture();
    reentrant.host.registry[0]!.execute = () => {
        try { holder.runner!.run({ ...request, idempotencyRef: 'idem_nested0001' }); } catch { /* swallowed by hostile service */ }
        return { outcome: 'read', response: 'synthetic-response: must not publish' };
    };
    holder.runner = createHeadlessSemanticOrchestrator(reentrant.host);
    assert.throws(() => holder.runner!.run(request), /operation_reentered/);
    assert.throws(() => holder.runner!.run(request), /idempotency_replayed/);

    const drift = fixture();
    drift.host.registry[0]!.execute = () => { drift.setEpoch(8); return { outcome: 'read', response: 'synthetic-response: stale' }; };
    assert.throws(() => createHeadlessSemanticOrchestrator(drift.host).run(request), /context_stale/);
});

test('rejects unmapped capability identity, unsafe service output, SQL semantics, and sparse registries', () => {
    const unmapped = fixture(); unmapped.host.registry[0]!.capabilityId = 'name-similarity';
    assert.throws(() => createHeadlessSemanticOrchestrator(unmapped.host).run(request), /registry_invalid/);
    const unsafe = fixture(); unsafe.host.registry[0]!.execute = () => ({ outcome: 'read', response: 'synthetic-response: ok', prompt: 'leak' } as never);
    assert.throws(() => createHeadlessSemanticOrchestrator(unsafe.host).run(request), /service_output_invalid/);
    const thenable = fixture(); thenable.host.registry[0]!.execute = () => Promise.resolve({ outcome: 'read', response: 'synthetic-response: late' });
    assert.throws(() => createHeadlessSemanticOrchestrator(thenable.host).run(request), /service_output_invalid/);
    const callableProxy = fixture(); callableProxy.host.registry[0]!.execute = new Proxy(() => ({ outcome: 'read', response: 'synthetic-response: hidden' }), {});
    assert.throws(() => createHeadlessSemanticOrchestrator(callableProxy.host), /registry_invalid/);
    const sql = fixture(); sql.host.registry[0]!.applicationServiceRef = 'sql:patients';
    assert.throws(() => createHeadlessSemanticOrchestrator(sql.host).run(request), /registry_invalid/);
    const sensitive = fixture(); sensitive.host.registry[0]!.inputKeys = ['patientId'];
    assert.throws(() => createHeadlessSemanticOrchestrator(sensitive.host), /registry_invalid/);
    const freePrompt = fixture({ plan: () => ({ operationId: 'op.fixture.read', input: { subjectRef: 'prompt_opaque0001' } }) });
    assert.throws(() => createHeadlessSemanticOrchestrator(freePrompt.host).run(request), /plan_invalid/);
    const sparse = fixture(); sparse.host.registry = new Array(1);
    assert.throws(() => createHeadlessSemanticOrchestrator(sparse.host), /host_invalid/);
});
