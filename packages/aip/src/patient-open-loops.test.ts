/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAipOwnerBrokerV1 } from './owner-broker.ts';
import {
    PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    PATIENT_OPEN_LOOPS_READ_TIMEOUT_MODE_V1,
    createPatientOpenLoopsReadServiceV1,
} from './patient-open-loops';

const NOW = 1_800_000_000_000;
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BROKER_BINDING = Object.freeze({
    peerRef: 'peer.local.synthetic.open-loops', runtimeRef: 'runtime.local.synthetic.open-loops',
    parentRef: 'parent.local.synthetic.open-loops', purposeCode: 'care_coordination',
    operation: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    scopeDigest: DIGEST, maxStage: 'read_only', budget: 4, expiresAt: NOW + 10_000,
    generation: 4, revocationGeneration: 1, selectionEpoch: 9, parentGeneration: 2,
    policyGeneration: 3, venue: 'local_intelligent_host', egressAllowed: false,
});
const BROKER_CURRENT = Object.freeze({
    peerRef: BROKER_BINDING.peerRef, runtimeRef: BROKER_BINDING.runtimeRef,
    generation: BROKER_BINDING.generation, revocationGeneration: BROKER_BINDING.revocationGeneration,
    selectionEpoch: BROKER_BINDING.selectionEpoch, parentGeneration: BROKER_BINDING.parentGeneration,
    policyGeneration: BROKER_BINDING.policyGeneration,
});
const BROKER_CLAIM = Object.freeze({ operation: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1 });
const OWNER = Object.freeze(Object.create(null));
const LEASE = Object.freeze(Object.create(null));
const SNAPSHOT = Object.freeze(Object.create(null));
const PERMIT = Object.freeze(Object.create(null));

function canonical<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function makeLease(overrides: Record<string, unknown> = {}) {
    return canonical({
        status: 'available', ownerIdentity: OWNER, leaseIdentity: LEASE,
        ownerRef: 'owner.internal-0001', leaseRef: 'lease.internal-0001', purposeCode: 'care_coordination',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
        capabilityId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, maxStage: 'read_only',
        generation: 4, revocationGeneration: 1, selectionEpoch: 9,
        restartGeneration: 2, expiresAt: NOW + 2_000, ...overrides,
    });
}

function makeItem(overrides: Record<string, unknown> = {}) {
    return canonical({
        loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending', temporalState: 'overdue',
        openedAt: NOW - 86_400_000, dueAt: NOW - 1_000, revision: 3, ...overrides,
    });
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
    return canonical({
        status: 'available', ownerIdentity: OWNER, leaseIdentity: LEASE, snapshotIdentity: SNAPSHOT,
        generation: 4, revocationGeneration: 1, selectionEpoch: 9, restartGeneration: 2,
        revision: 12, capturedAt: NOW, truncated: false, items: Object.freeze([makeItem()]), ...overrides,
    });
}

function makeCurrent(overrides: Record<string, unknown> = {}) {
    return canonical({
        status: 'current', ownerIdentity: OWNER, leaseIdentity: LEASE, snapshotIdentity: SNAPSHOT,
        generation: 4, revocationGeneration: 1, selectionEpoch: 9, restartGeneration: 2, revision: 12,
        ...overrides,
    });
}

function makeSources(overrides: Record<string, unknown> = {}) {
    const execution = Object.freeze(Object.create(null));
    let permitState: 'available' | 'active' | 'consumed' | 'denied' = 'available';
    return canonical({
        now: () => NOW,
        nextRef: () => `aipr_${'c'.repeat(64)}`,
        hashRef: (value: string) => `sha256:${(value.startsWith('owner') ? 'a'
            : value.startsWith('lease') ? 'b' : 'd').repeat(64)}`,
        current: () => BROKER_CURRENT,
        beginPermit: () => {
            if (permitState !== 'available') throw new Error('permit unavailable');
            permitState = 'active'; return execution;
        },
        finalizePermit: (candidate: unknown) => {
            if (candidate !== execution || permitState !== 'active') throw new Error('execution unavailable');
            permitState = 'consumed'; return true;
        },
        denyPermit: (candidate: unknown) => {
            if (candidate !== execution || permitState !== 'active') return false;
            permitState = 'denied'; return true;
        },
        acquireLease: () => makeLease(),
        readSnapshot: () => Promise.resolve(makeSnapshot()),
        readCurrentness: () => makeCurrent(),
        writeAudit: () => Promise.resolve(),
        timeoutMs: 500,
        ...overrides,
    });
}

function isError(code: string) {
    return (error: unknown) => error instanceof Error
        && 'code' in error && (error as { code: string }).code === code
        && !/patient|aipl_|owner\.internal|lease\.internal/u.test(error.message);
}

function validInput() {
    return {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function withAccessor(value: object, key: string, getter: () => unknown): object {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    descriptors[key] = { enumerable: true, configurable: false, get: getter };
    return Object.freeze(Object.defineProperties(Object.create(null), descriptors));
}

test('reads only the broker-owned patient selection and returns minimized opaque loops', async () => {
    const calls: string[] = [];
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: (_binding: object, request: Readonly<{ limit: number; signal: AbortSignal }>) => {
            calls.push(`read:${request.limit}`);
            return Promise.resolve(makeSnapshot());
        },
        writeAudit: (record: unknown) => {
            calls.push(`audit:${(record as { itemCount: number }).itemCount}`);
            return Promise.resolve();
        },
    }));

    const result = await service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    });

    assert.equal(result.schemaVersion, 'mediflow.patient.open_loops.read.result.v1');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.loopRef, `aipl_${'1'.repeat(64)}`);
    assert.equal(result.receipt.itemCount, 1);
    assert.deepEqual(calls, ['read:32', 'audit:1']);
    assert.equal(/patientId|patient\.internal|description|serviceName/u.test(JSON.stringify(result)), false);
});

test('rejects proxied source callbacks before they can become an authority boundary', () => {
    const proxiedNow = new Proxy(() => NOW, {});
    assert.throws(() => createPatientOpenLoopsReadServiceV1(makeSources({ now: proxiedNow })),
        isError('operation_unavailable'));
});

test('rejects a frozen item array with hidden own metadata', async () => {
    const items = [makeItem()] as Array<ReturnType<typeof makeItem>> & { hidden?: string };
    Object.defineProperty(items, 'hidden', { value: 'patient.internal-forbidden', enumerable: false });
    Object.freeze(items);
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => Promise.resolve(makeSnapshot({ items })),
    }));

    await assert.rejects(service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('snapshot_unavailable'));
});

test('maps an immediate fake-port rejection to snapshot_unavailable, not timeout', async () => {
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => Promise.reject(new Error('synthetic private detail')),
    }));

    await assert.rejects(service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('snapshot_unavailable'));
});

test('fences reentrant revocation before any patient snapshot read starts', async () => {
    let reads = 0;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        acquireLease: () => {
            service.revoke();
            return makeLease();
        },
        readSnapshot: () => {
            reads += 1;
            return Promise.resolve(makeSnapshot());
        },
    }));

    await assert.rejects(service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('revoked'));
    assert.equal(reads, 0);
});

test('rejects temporal states that disagree with their bounded due date', async () => {
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => Promise.resolve(makeSnapshot({
            items: Object.freeze([makeItem({ temporalState: 'unscheduled', dueAt: NOW + 1_000 })]),
        })),
    }));

    await assert.rejects(service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('snapshot_unavailable'));
});

test('accepts only the named broker-owned purpose code', async () => {
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        acquireLease: () => makeLease({ purposeCode: 'patient_123456789' }),
    }));

    await assert.rejects(service.read(PERMIT, {
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('lease_unavailable'));
});

test('rejects caller authority, accessors, symbols, proxies and exotic prototypes without consuming the lease', async () => {
    let getterReads = 0;
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'schemaVersion', {
        enumerable: true, get: () => { getterReads += 1; return 'mediflow.patient.open_loops.read.input.v1'; },
    });
    Object.defineProperty(accessor, 'operationId', {
        enumerable: true, value: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    });
    const withSymbol = { ...validInput(), [Symbol('authority')]: 'forbidden' };
    const nonEnumerable = validInput();
    Object.defineProperty(nonEnumerable, 'operationId', {
        value: PATIENT_OPEN_LOOPS_READ_OPERATION_V1, enumerable: false,
    });
    const proxied = new Proxy(validInput(), { ownKeys: () => { throw new Error('must not run'); } });
    const revoked = Proxy.revocable(validInput(), {});
    revoked.revoke();
    const service = createPatientOpenLoopsReadServiceV1(makeSources());
    const invalid = [
        { ...validInput(), patientId: 'patient.internal-forbidden' },
        accessor,
        withSymbol,
        nonEnumerable,
        Object.assign(Object.create({ authority: true }), validInput()),
        proxied,
        revoked.proxy,
        { operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
            schemaVersion: 'mediflow.patient.open_loops.read.input.v1' },
    ];

    for (const candidate of invalid) {
        await assert.rejects(service.read(PERMIT, candidate), isError('invalid_input'));
    }
    assert.equal(getterReads, 0);
    assert.equal((await service.read(PERMIT, validInput())).outcome, 'read');
});

test('rejects oversized, duplicate, identifying and hostile snapshot structures', async () => {
    let accessorReads = 0;
    const accessorItem = withAccessor(makeItem(), 'revision', () => { accessorReads += 1; return 3; });
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', {
        enumerable: true, get: () => { accessorReads += 1; return makeItem(); },
    });
    Object.freeze(accessorArray);
    const itemArray = Object.freeze([makeItem()]);
    const proxiedArray = new Proxy(itemArray, {});
    const revokedSnapshot = Proxy.revocable(makeSnapshot(), {});
    revokedSnapshot.revoke();
    const oversized = Object.freeze(Array.from({ length: 33 }, (_value, index) => makeItem({
        loopRef: `aipl_${index.toString(16).padStart(64, '0')}`,
    })));
    const variants: unknown[] = [
        makeSnapshot({ items: oversized }),
        makeSnapshot({ items: Object.freeze([makeItem(), makeItem()]) }),
        makeSnapshot({ items: Object.freeze([makeItem({ patientId: 'patient.internal-forbidden' })]) }),
        makeSnapshot({ items: Object.freeze([makeItem({ loopRef: 'patient.internal-forbidden' })]) }),
        makeSnapshot({ items: Object.freeze([accessorItem]) }),
        makeSnapshot({ items: accessorArray }),
        makeSnapshot({ items: proxiedArray }),
        new Proxy(makeSnapshot(), {}),
        revokedSnapshot.proxy,
        { ...makeSnapshot() },
    ];

    for (const candidate of variants) {
        const service = createPatientOpenLoopsReadServiceV1(makeSources({
            readSnapshot: () => Promise.resolve(candidate),
        }));
        await assert.rejects(service.read(PERMIT, validInput()), isError('snapshot_unavailable'));
    }
    assert.equal(accessorReads, 0);
});

test('linearizes a one-use lease across concurrent and replayed reads', async () => {
    const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
    let reads = 0;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => { reads += 1; return pendingSnapshot.promise; },
    }));
    const first = service.read(PERMIT, validInput());
    const contender = service.read(PERMIT, validInput());

    await assert.rejects(contender, isError('lease_replay'));
    pendingSnapshot.resolve(makeSnapshot());
    const result = await first;
    assert.equal(result.outcome, 'read');
    await assert.rejects(service.read(PERMIT, validInput()), isError('lease_replay'));
    assert.equal(reads, 1);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.items), true);
    assert.equal(Object.isFrozen(result.items[0]), true);
    assert.equal(Object.isFrozen(result.receipt), true);
});

test('consumes the exact lease once across services sharing the broker port', async () => {
    let reads = 0;
    const audits: Array<Record<string, unknown>> = [];
    const refs = ['agent.synthetic.open-loops', 'lease.synthetic.open-loops'];
    const broker = createAipOwnerBrokerV1({
        now: () => NOW, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined,
    });
    const permit = await broker.authorize(broker.issueLease(broker.issueOwner(BROKER_BINDING)),
        BROKER_CURRENT, BROKER_CLAIM);
    const sources = makeSources({
        current: () => BROKER_CURRENT, beginPermit: broker.beginPermit,
        finalizePermit: broker.finalizePermit, denyPermit: broker.denyPermit,
        readSnapshot: () => { reads += 1; return Promise.resolve(makeSnapshot()); },
        writeAudit: (record: unknown) => { audits.push(record as Record<string, unknown>); return Promise.resolve(); },
    });
    const first = createPatientOpenLoopsReadServiceV1(sources);
    const second = createPatientOpenLoopsReadServiceV1(sources);

    assert.equal((await first.read(permit, validInput())).outcome, 'read');
    await assert.rejects(second.read(permit, validInput()), isError('authorization_denied'));
    assert.equal(reads, 1);
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode, record.maxStage]), [
        ['allowed', null, 'read_only'], ['denied', 'authorization_denied', 'read_only'],
    ]);
    assert.doesNotMatch(JSON.stringify(audits), /patientId|owner\.internal|lease\.internal|aipl_|openedAt|dueAt/u);
});

test('times out a pending native Promise and discards its late completion', async () => {
    const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
    let auditCalls = 0;
    let currentnessCalls = 0;
    const capture: { signal?: AbortSignal } = {};
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 20,
        readSnapshot: (_binding: object, request: { signal: AbortSignal }) => {
            capture.signal = request.signal;
            return pendingSnapshot.promise;
        },
        writeAudit: () => { auditCalls += 1; return Promise.resolve(); },
        readCurrentness: () => { currentnessCalls += 1; return makeCurrent(); },
    }));
    const startedAt = Date.now();

    await assert.rejects(service.read(PERMIT, validInput()), isError('timeout'));
    assert.ok(Date.now() - startedAt < 500);
    pendingSnapshot.resolve(makeSnapshot());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(capture.signal?.aborted, true);
    assert.equal(auditCalls, 1);
    assert.equal(currentnessCalls, 0);
});

test('cancel, revocation, restart and dispose terminalize before late port completion', async () => {
    const cases = [
        { code: 'cancelled', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.cancel() },
        { code: 'revoked', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.revoke() },
        { code: 'restart_changed', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.restart() },
        { code: 'disposed', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.dispose() },
    ];
    for (const scenario of cases) {
        const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
        let audits = 0;
        const capture: { signal?: AbortSignal } = {};
        const service = createPatientOpenLoopsReadServiceV1(makeSources({
            readSnapshot: (_binding: object, request: { signal: AbortSignal }) => {
                capture.signal = request.signal;
                return pendingSnapshot.promise;
            },
            writeAudit: () => { audits += 1; return Promise.resolve(); },
        }));
        const read = service.read(PERMIT, validInput());
        assert.equal(scenario.stop(service), true);
        await assert.rejects(read, isError(scenario.code));
        pendingSnapshot.resolve(makeSnapshot());
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(capture.signal?.aborted, true);
        assert.equal(audits, 1);
        assert.equal(scenario.stop(service), false);
    }
});

test('never assimilates hostile thenables or proxied Promises', async () => {
    let thenReads = 0;
    const thenable = Object.defineProperty({}, 'then', {
        get: () => { thenReads += 1; throw new Error('hostile then'); },
    });
    const proxiedPromise = new Proxy(Promise.resolve(makeSnapshot()), {});
    const revokedPromise = Proxy.revocable(Promise.resolve(makeSnapshot()), {});
    revokedPromise.revoke();
    for (const candidate of [thenable, proxiedPromise, revokedPromise.proxy]) {
        const service = createPatientOpenLoopsReadServiceV1(makeSources({ readSnapshot: () => candidate }));
        await assert.rejects(service.read(PERMIT, validInput()), isError('snapshot_unavailable'));
    }
    assert.equal(thenReads, 0);

    const mutableSnapshot = Object.assign(Object.create(null), makeSnapshot());
    const fulfilledBeforeMutation = Promise.resolve(mutableSnapshot);
    Object.defineProperty(mutableSnapshot, 'then', {
        get: () => { thenReads += 1; throw new Error('resolved values must not be reassimilated'); },
    });
    const mutatedValueService = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => fulfilledBeforeMutation,
    }));
    await assert.rejects(mutatedValueService.read(PERMIT, validInput()), isError('snapshot_unavailable'));
    assert.equal(thenReads, 0);

    const native = Promise.resolve(makeSnapshot());
    Object.defineProperty(native, 'then', {
        get: () => { thenReads += 1; throw new Error('own then must be bypassed'); },
    });
    const service = createPatientOpenLoopsReadServiceV1(makeSources({ readSnapshot: () => native }));
    assert.equal((await service.read(PERMIT, validInput())).outcome, 'read');
    assert.equal(thenReads, 0);
});

test('a reentrant read loses without perturbing the original operation', async () => {
    let nested: Promise<unknown> | null = null;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => {
            nested = service.read(PERMIT, validInput()).then(
                () => null,
                (error: unknown) => error,
            );
            return Promise.resolve(makeSnapshot());
        },
    }));

    assert.equal((await service.read(PERMIT, validInput())).outcome, 'read');
    assert.ok(nested);
    assert.equal(isError('lease_replay')(await nested), true);
});

test('checks currentness after audit and keeps the audit PHI-safe', async () => {
    let selectionEpoch = 9;
    const audits: Array<Record<string, unknown>> = [];
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        writeAudit: (record: Record<string, unknown>) => {
            audits.push(record);
            if (record.outcome === 'allowed') selectionEpoch += 1;
            return Promise.resolve();
        },
        readCurrentness: () => makeCurrent({ selectionEpoch }),
    }));

    await assert.rejects(service.read(PERMIT, validInput()), isError('scope_changed'));
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'scope_changed']]);
    assert.equal(Object.getPrototypeOf(audits.at(-1)), null);
    assert.equal(Object.isFrozen(audits.at(-1)), true);
    assert.equal(/patientId|owner\.internal|lease\.internal|aipl_|openedAt|dueAt|description/u
        .test(JSON.stringify(audits)), false);
});

test('fails closed on audit rejection, slow audit and non-monotonic host clock', async () => {
    const rejectedAudit = createPatientOpenLoopsReadServiceV1(makeSources({
        writeAudit: () => Promise.reject(new Error('synthetic clinical detail')),
    }));
    await assert.rejects(rejectedAudit.read(PERMIT, validInput()), isError('audit_unavailable'));

    const pendingAudit = deferred<void>();
    let currentnessCalls = 0;
    const slowAudit = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 20,
        writeAudit: () => pendingAudit.promise,
        readCurrentness: () => { currentnessCalls += 1; return makeCurrent(); },
    }));
    await assert.rejects(slowAudit.read(PERMIT, validInput()), isError('timeout'));
    pendingAudit.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(currentnessCalls, 0);

    const times = [NOW, NOW + 1, NOW];
    const regressedClock = createPatientOpenLoopsReadServiceV1(makeSources({ now: () => times.shift() }));
    await assert.rejects(regressedClock.read(PERMIT, validInput()), isError('operation_unavailable'));
});

test('distinguishes broker expiry from operation timeout', async () => {
    const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 100,
        acquireLease: () => makeLease({ expiresAt: NOW + 15 }),
        readSnapshot: () => pendingSnapshot.promise,
    }));

    await assert.rejects(service.read(PERMIT, validInput()), isError('expired'));
    pendingSnapshot.resolve(makeSnapshot());
});

test('applies one real deadline across snapshot and audit even if the host clock stalls', async () => {
    let currentnessCalls = 0;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 30,
        readSnapshot: () => new Promise((resolve) => setTimeout(() => resolve(makeSnapshot()), 20)),
        writeAudit: () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
        readCurrentness: () => { currentnessCalls += 1; return makeCurrent(); },
    }));

    await assert.rejects(service.read(PERMIT, validInput()), isError('timeout'));
    assert.equal(currentnessCalls, 0);
});

test('post-fences cooperative synchronous callbacks with the broker clock', async () => {
    let timestamp = NOW;
    let audits = 0;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 20,
        now: () => timestamp,
        readSnapshot: () => {
            timestamp = NOW + 21;
            return Promise.resolve(makeSnapshot());
        },
        writeAudit: () => { audits += 1; return Promise.resolve(); },
    }));

    await assert.rejects(service.read(PERMIT, validInput()), isError('timeout'));
    assert.equal(audits, 1);
});

test('clock-fences hash callbacks before any allowed audit or publication', async () => {
    let timestamp = NOW;
    let hashes = 0;
    const audits: Array<Record<string, unknown>> = [];
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 20,
        now: () => timestamp,
        hashRef: () => {
            hashes += 1;
            timestamp = NOW + 21;
            return DIGEST;
        },
        writeAudit: (record: unknown) => { audits.push(record as Record<string, unknown>); return Promise.resolve(); },
    }));

    await assert.rejects(service.read(PERMIT, validInput()), isError('timeout'));
    assert.equal(hashes, 1);
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]), [['denied', 'timeout']]);
});

test('preserves reentrant terminal codes when acquire, read, hash or audit also throws', async () => {
    const scenarios = [
        { boundary: 'acquire', code: 'revoked', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.revoke() },
        { boundary: 'read', code: 'disposed', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.dispose() },
        { boundary: 'hash', code: 'cancelled', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.cancel() },
        { boundary: 'audit', code: 'revoked', stop: (service: ReturnType<typeof createPatientOpenLoopsReadServiceV1>) => service.revoke() },
    ] as const;
    for (const scenario of scenarios) {
        const audits: Array<Record<string, unknown>> = [];
        let allowedAuditAttempted = false;
        const service = createPatientOpenLoopsReadServiceV1(makeSources({
            acquireLease: () => {
                if (scenario.boundary === 'acquire') { scenario.stop(service); throw new Error('synthetic acquire detail'); }
                return makeLease();
            },
            readSnapshot: () => {
                if (scenario.boundary === 'read') { scenario.stop(service); throw new Error('synthetic read detail'); }
                return Promise.resolve(makeSnapshot());
            },
            hashRef: (value: string) => {
                if (scenario.boundary === 'hash') { scenario.stop(service); throw new Error('synthetic hash detail'); }
                return `sha256:${(value.startsWith('owner') ? 'a' : value.startsWith('lease') ? 'b' : 'd').repeat(64)}`;
            },
            writeAudit: (record: unknown) => {
                const typed = record as Record<string, unknown>;
                if (scenario.boundary === 'audit' && typed.outcome === 'allowed' && !allowedAuditAttempted) {
                    allowedAuditAttempted = true; scenario.stop(service); throw new Error('synthetic audit detail');
                }
                audits.push(typed); return Promise.resolve();
            },
        }));

        await assert.rejects(service.read(PERMIT, validInput()), isError(scenario.code));
        assert.deepEqual(audits.at(-1) && [audits.at(-1)?.outcome, audits.at(-1)?.denialCode],
            ['denied', scenario.code]);
    }
});

test('ends broker revocation during allowed audit with a terminal denial', async () => {
    const refs = ['agent.synthetic.audit-revoke-open-loops', 'lease.synthetic.audit-revoke-open-loops'];
    const broker = createAipOwnerBrokerV1({
        now: () => NOW, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async () => undefined,
    });
    const owner = broker.issueOwner(BROKER_BINDING);
    const permit = await broker.authorize(broker.issueLease(owner), BROKER_CURRENT, BROKER_CLAIM);
    const audits: Array<Record<string, unknown>> = [];
    let auditStarted!: () => void;
    let releaseAudit!: () => void;
    const started = new Promise<void>((resolve) => { auditStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseAudit = resolve; });
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        current: () => BROKER_CURRENT, beginPermit: broker.beginPermit,
        finalizePermit: broker.finalizePermit, denyPermit: broker.denyPermit,
        writeAudit: (record: unknown) => {
            const typed = record as Record<string, unknown>;
            audits.push(typed);
            if (typed.outcome === 'allowed') { auditStarted(); return blocked; }
            return Promise.resolve();
        },
    }));
    const reading = service.read(permit, validInput());
    await started;
    broker.revokeOwner(owner);
    releaseAudit();

    await assert.rejects(reading, isError('authorization_denied'));
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'authorization_denied']]);
    assert.doesNotMatch(JSON.stringify(audits.at(-1)), /patientId|owner\.internal|lease\.internal|aipl_/u);
});

test('does not claim hard preemption for cooperative sync ports when the host clock stalls', async () => {
    let stalled = false;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 10,
        hashRef: (value: string) => {
            if (!stalled) {
                stalled = true;
                const startedAt = performance.now();
                while (performance.now() - startedAt < 20) { /* bounded synthetic sync stall */ }
            }
            return `sha256:${(value.startsWith('owner') ? 'a' : value.startsWith('lease') ? 'b' : 'd').repeat(64)}`;
        },
    }));

    assert.equal((await service.read(PERMIT, validInput())).outcome, 'read');
    assert.equal(PATIENT_OPEN_LOOPS_READ_TIMEOUT_MODE_V1,
        'cooperative_pending_promise_and_post_callback_fence');
});
