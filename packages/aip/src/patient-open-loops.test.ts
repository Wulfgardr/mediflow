/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    createPatientOpenLoopsReadServiceV1,
} from './patient-open-loops';

const NOW = 1_800_000_000_000;
const OWNER = Object.freeze(Object.create(null));
const LEASE = Object.freeze(Object.create(null));
const SNAPSHOT = Object.freeze(Object.create(null));

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
    return canonical({
        now: () => NOW,
        nextRef: () => `aipr_${'c'.repeat(64)}`,
        hashRef: (value: string) => `sha256:${(value.startsWith('owner') ? 'a'
            : value.startsWith('lease') ? 'b' : 'd').repeat(64)}`,
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

    const result = await service.read({
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

    await assert.rejects(service.read({
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('snapshot_unavailable'));
});

test('maps an immediate fake-port rejection to snapshot_unavailable, not timeout', async () => {
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => Promise.reject(new Error('synthetic private detail')),
    }));

    await assert.rejects(service.read({
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

    await assert.rejects(service.read({
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

    await assert.rejects(service.read({
        schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
        operationId: PATIENT_OPEN_LOOPS_READ_OPERATION_V1,
    }), isError('snapshot_unavailable'));
});

test('accepts only the named broker-owned purpose code', async () => {
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        acquireLease: () => makeLease({ purposeCode: 'patient_123456789' }),
    }));

    await assert.rejects(service.read({
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
        await assert.rejects(service.read(candidate), isError('invalid_input'));
    }
    assert.equal(getterReads, 0);
    assert.equal((await service.read(validInput())).outcome, 'read');
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
        await assert.rejects(service.read(validInput()), isError('snapshot_unavailable'));
    }
    assert.equal(accessorReads, 0);
});

test('linearizes a one-use lease across concurrent and replayed reads', async () => {
    const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
    let reads = 0;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => { reads += 1; return pendingSnapshot.promise; },
    }));
    const first = service.read(validInput());
    const contender = service.read(validInput());

    await assert.rejects(contender, isError('lease_replay'));
    pendingSnapshot.resolve(makeSnapshot());
    const result = await first;
    assert.equal(result.outcome, 'read');
    await assert.rejects(service.read(validInput()), isError('lease_replay'));
    assert.equal(reads, 1);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.items), true);
    assert.equal(Object.isFrozen(result.items[0]), true);
    assert.equal(Object.isFrozen(result.receipt), true);
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

    await assert.rejects(service.read(validInput()), isError('timeout'));
    assert.ok(Date.now() - startedAt < 500);
    pendingSnapshot.resolve(makeSnapshot());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(capture.signal?.aborted, true);
    assert.equal(auditCalls, 0);
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
        const read = service.read(validInput());
        assert.equal(scenario.stop(service), true);
        await assert.rejects(read, isError(scenario.code));
        pendingSnapshot.resolve(makeSnapshot());
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(capture.signal?.aborted, true);
        assert.equal(audits, 0);
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
        await assert.rejects(service.read(validInput()), isError('snapshot_unavailable'));
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
    await assert.rejects(mutatedValueService.read(validInput()), isError('snapshot_unavailable'));
    assert.equal(thenReads, 0);

    const native = Promise.resolve(makeSnapshot());
    Object.defineProperty(native, 'then', {
        get: () => { thenReads += 1; throw new Error('own then must be bypassed'); },
    });
    const service = createPatientOpenLoopsReadServiceV1(makeSources({ readSnapshot: () => native }));
    assert.equal((await service.read(validInput())).outcome, 'read');
    assert.equal(thenReads, 0);
});

test('a reentrant read loses without perturbing the original operation', async () => {
    let nested: Promise<unknown> | null = null;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        readSnapshot: () => {
            nested = service.read(validInput()).then(
                () => null,
                (error: unknown) => error,
            );
            return Promise.resolve(makeSnapshot());
        },
    }));

    assert.equal((await service.read(validInput())).outcome, 'read');
    assert.ok(nested);
    assert.equal(isError('lease_replay')(await nested), true);
});

test('checks currentness after audit and keeps the audit PHI-safe', async () => {
    let selectionEpoch = 9;
    let audit: Record<string, unknown> | null = null;
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        writeAudit: (record: Record<string, unknown>) => {
            audit = record;
            selectionEpoch += 1;
            return Promise.resolve();
        },
        readCurrentness: () => makeCurrent({ selectionEpoch }),
    }));

    await assert.rejects(service.read(validInput()), isError('scope_changed'));
    assert.ok(audit);
    assert.equal(Object.getPrototypeOf(audit), null);
    assert.equal(Object.isFrozen(audit), true);
    assert.equal(/patientId|owner\.internal|lease\.internal|aipl_|openedAt|dueAt|description/u
        .test(JSON.stringify(audit)), false);
});

test('fails closed on audit rejection, slow audit and non-monotonic host clock', async () => {
    const rejectedAudit = createPatientOpenLoopsReadServiceV1(makeSources({
        writeAudit: () => Promise.reject(new Error('synthetic clinical detail')),
    }));
    await assert.rejects(rejectedAudit.read(validInput()), isError('audit_unavailable'));

    const pendingAudit = deferred<void>();
    let currentnessCalls = 0;
    const slowAudit = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 20,
        writeAudit: () => pendingAudit.promise,
        readCurrentness: () => { currentnessCalls += 1; return makeCurrent(); },
    }));
    await assert.rejects(slowAudit.read(validInput()), isError('timeout'));
    pendingAudit.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(currentnessCalls, 0);

    const times = [NOW, NOW + 1, NOW];
    const regressedClock = createPatientOpenLoopsReadServiceV1(makeSources({ now: () => times.shift() }));
    await assert.rejects(regressedClock.read(validInput()), isError('operation_unavailable'));
});

test('distinguishes broker expiry from operation timeout', async () => {
    const pendingSnapshot = deferred<ReturnType<typeof makeSnapshot>>();
    const service = createPatientOpenLoopsReadServiceV1(makeSources({
        timeoutMs: 100,
        acquireLease: () => makeLease({ expiresAt: NOW + 15 }),
        readSnapshot: () => pendingSnapshot.promise,
    }));

    await assert.rejects(service.read(validInput()), isError('expired'));
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

    await assert.rejects(service.read(validInput()), isError('timeout'));
    assert.equal(currentnessCalls, 0);
});
