/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessCheckupStatusTransitionServiceV1,
    HeadlessCheckupStatusTransitionV1Error,
} from './checkup-status-transition.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const OWNER_HASH = `sha256:${'b'.repeat(64)}`;
const RESOURCE_HASH = `sha256:${'c'.repeat(64)}`;
const PROOF_HASH = `sha256:${'d'.repeat(64)}`;
const RECEIPT_HASH = `sha256:${'e'.repeat(64)}`;
const CHECKUP_REF = `hcsr_${'11'.repeat(32)}`;
const PROPOSAL_REF = `hcsp_${'22'.repeat(32)}`;
const SECOND_PROPOSAL_REF = `hcsp_${'23'.repeat(32)}`;
const IDEMPOTENCY_KEY = `hcsi_${'33'.repeat(32)}`;
const SECOND_IDEMPOTENCY_KEY = `hcsi_${'34'.repeat(32)}`;

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function handle(): object {
    return Object.freeze(Object.create(null)) as object;
}

function input(targetStatus: 'completed' | 'cancelled' = 'completed', expectedRevision = 7) {
    return {
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: OPERATION,
        checkupRef: CHECKUP_REF,
        targetStatus,
        expectedRevision,
    };
}

function hasCode(expected: string) {
    return (error: unknown): boolean => error instanceof HeadlessCheckupStatusTransitionV1Error
        && error.code === expected;
}

type MutableSnapshot = {
    ownerIdentity: object;
    resourceIdentity: object;
    fromStatus: 'pending' | 'completed' | 'cancelled';
    revision: number;
    generation: number;
    revocationGeneration: number;
    selectionEpoch: number;
};

function harness(overrides: Partial<Record<'now' | 'nextRef' | 'digestCommand' | 'readSnapshot'
    | 'consumeConfirmation' | 'commit', (...args: never[]) => unknown>> = {}) {
    let now = 1_000;
    const ownerIdentity = handle();
    const resourceIdentity = handle();
    const proof = handle();
    const snapshot: MutableSnapshot = {
        ownerIdentity,
        resourceIdentity,
        fromStatus: 'pending',
        revision: 7,
        generation: 3,
        revocationGeneration: 0,
        selectionEpoch: 9,
    };
    const refs = [PROPOSAL_REF, IDEMPOTENCY_KEY, SECOND_PROPOSAL_REF, SECOND_IDEMPOTENCY_KEY];
    const calls = { read: 0, proof: 0, commit: 0 };
    let lastRead: unknown;
    let lastBinding: unknown;
    let lastCommand: unknown;
    const receipt = (targetStatus: 'completed' | 'cancelled' = 'completed') => record({
        schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1',
        operationId: OPERATION,
        capabilityId: OPERATION,
        outcome: 'status_transitioned' as const,
        denialCode: null,
        fromStatus: 'pending' as const,
        toStatus: targetStatus,
        previousRevision: 7,
        newRevision: 8,
        ownerRefHash: OWNER_HASH,
        resourceRefHash: RESOURCE_HASH,
        proofRefHash: PROOF_HASH,
        receiptRefHash: RECEIPT_HASH,
        generation: 3,
        revocationGeneration: 0,
        selectionEpoch: 9,
        timestamp: 1_001,
    });
    const sources = {
        now: () => now,
        nextRef: () => refs.shift(),
        digestCommand: () => DIGEST,
        readSnapshot: (command: unknown) => {
            calls.read += 1;
            lastRead = command;
            return record({ status: 'available' as const, ...snapshot });
        },
        consumeConfirmation: (_proof: unknown, binding: unknown, operation: (proofBinding: unknown) => unknown) => {
            calls.proof += 1;
            lastBinding = binding;
            return operation(record({ proofRefHash: PROOF_HASH, confirmedAt: 1_000 }));
        },
        commit: (command: unknown) => {
            calls.commit += 1;
            lastCommand = command;
            const target = (command as { targetStatus: 'completed' | 'cancelled' }).targetStatus;
            return record({ status: 'committed' as const, receipt: receipt(target) });
        },
        ...overrides,
    };
    const service = createHeadlessCheckupStatusTransitionServiceV1(sources);
    return {
        service, snapshot, proof, calls, receipt, ownerIdentity, resourceIdentity,
        setNow: (value: number) => { now = value; },
        lastRead: () => lastRead, lastBinding: () => lastBinding, lastCommand: () => lastCommand,
    };
}

test('crea una preview PHI-safe, opaca e idempotente per lo stesso comando', () => {
    const h = harness();
    const first = h.service.preview(input());
    const replay = h.service.preview(input());

    assert.equal(first, replay);
    assert.deepEqual(first, record({
        schemaVersion: 'mediflow.patient.checkup.status.transition.preview.v1',
        operationId: OPERATION,
        outcome: 'preview_required',
        proposalRef: PROPOSAL_REF,
        expiresAt: 121_000,
    }));
    assert.equal(Object.getPrototypeOf(first), null);
    assert.equal(Object.isFrozen(first), true);
    assert.doesNotMatch(JSON.stringify(first), /"patientId"|"checkupRef"|hcsr_|"title"|"notes"|"date"/u);
    assert.deepEqual(h.lastRead(), record({
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: OPERATION,
        checkupRef: CHECKUP_REF,
        targetStatus: 'completed',
        expectedRevision: 7,
    }));
});

test('nega input extra, accessor, non-enumerable, prototype e Proxy senza attivare trap o port', () => {
    const h = harness();
    const invalid: unknown[] = [
        { ...input(), patientId: 'synthetic-patient' },
        { ...input(), targetStatus: 'pending' },
        { ...input(), expectedRevision: 0 },
        { ...input(), expectedRevision: Number.MAX_SAFE_INTEGER },
        { ...input(), checkupRef: 'raw-database-id' },
        Object.defineProperty(input(), 'operationId', { enumerable: true, get() { throw new Error('no getter'); } }),
        Object.defineProperty(input(), 'checkupRef', { enumerable: false }),
        Object.assign(Object.create({ inherited: true }), input()),
    ];
    for (const value of invalid) assert.throws(() => h.service.preview(value), hasCode('invalid_input'));

    let traps = 0;
    const proxy = new Proxy(input(), {
        getPrototypeOf() { traps += 1; throw new Error('must not reflect'); },
        ownKeys() { traps += 1; throw new Error('must not reflect'); },
        getOwnPropertyDescriptor() { traps += 1; throw new Error('must not reflect'); },
    });
    assert.throws(() => h.service.preview(proxy), hasCode('invalid_input'));
    assert.equal(traps, 0);
    assert.equal(h.calls.read, 0);
});

test('nega snapshot non corrente o ostile senza pubblicare una preview', () => {
    for (const [candidate, code] of [
        [record({ status: 'denied', code: 'resource_unavailable' }), 'resource_unavailable'],
        [record({ status: 'denied', code: 'scope_changed' }), 'scope_changed'],
        [record({ status: 'available', ownerIdentity: handle(), resourceIdentity: handle(), fromStatus: 'completed', revision: 7, generation: 3, revocationGeneration: 0, selectionEpoch: 9 }), 'transition_unavailable'],
        [record({ status: 'available', ownerIdentity: handle(), resourceIdentity: handle(), fromStatus: 'pending', revision: 8, generation: 3, revocationGeneration: 0, selectionEpoch: 9 }), 'revision_conflict'],
        [{ status: 'available', then() { throw new Error('must not assimilate'); } }, 'operation_unavailable'],
    ] as const) {
        const h = harness({ readSnapshot: (() => candidate) as never });
        assert.throws(() => h.service.preview(input()), hasCode(code));
    }

    let traps = 0;
    const proxy = new Proxy({ status: 'available' }, { ownKeys() { traps += 1; throw new Error('no trap'); } });
    const h = harness({ readSnapshot: (() => proxy) as never });
    assert.throws(() => h.service.preview(input()), hasCode('operation_unavailable'));
    assert.equal(traps, 0);
});

test('conferma una sola volta con proof privato e restituisce la stessa receipt al replay esatto', () => {
    const h = harness();
    const preview = h.service.preview(input('cancelled'));
    const first = h.service.confirm(preview.proposalRef, h.proof);
    const replay = h.service.confirm(preview.proposalRef, h.proof);

    assert.equal(first, replay);
    assert.equal(first.toStatus, 'cancelled');
    assert.equal(first.previousRevision, 7);
    assert.equal(first.newRevision, 8);
    assert.equal(h.calls.proof, 1);
    assert.equal(h.calls.commit, 1);
    assert.doesNotMatch(JSON.stringify(first),
        /"patientId"|"checkupRef"|hcsr_|"title"|"notes"|"date"|"prompt"|"provider"/u);
    assert.deepEqual(Reflect.ownKeys(h.lastBinding() as object), [
        'operationId', 'proposalRef', 'commandDigest', 'ownerIdentity', 'resourceIdentity',
        'targetStatus', 'expectedRevision', 'generation', 'revocationGeneration',
        'selectionEpoch', 'expiresAt',
    ]);
    assert.deepEqual(Reflect.ownKeys(h.lastCommand() as object), [
        'operationId', 'capabilityId', 'idempotencyKey', 'commandDigest', 'ownerIdentity',
        'resourceIdentity', 'fromStatus', 'targetStatus', 'expectedRevision', 'generation',
        'revocationGeneration', 'selectionEpoch', 'proofRefHash', 'confirmedAt',
    ]);
});

test('rilegge currentness e nega expiry, revisione, scope, stato e restart prima del proof', () => {
    const cases: ReadonlyArray<readonly [(snapshot: MutableSnapshot) => void, string]> = [
        [(snapshot) => { snapshot.revision = 8; }, 'revision_conflict'],
        [(snapshot) => { snapshot.selectionEpoch = 10; }, 'scope_changed'],
        [(snapshot) => { snapshot.generation = 4; }, 'scope_changed'],
        [(snapshot) => { snapshot.revocationGeneration = 1; }, 'scope_changed'],
        [(snapshot) => { snapshot.ownerIdentity = handle(); }, 'scope_changed'],
        [(snapshot) => { snapshot.resourceIdentity = handle(); }, 'resource_unavailable'],
        [(snapshot) => { snapshot.fromStatus = 'cancelled'; }, 'transition_unavailable'],
    ];
    for (const [mutate, code] of cases) {
        const h = harness();
        const preview = h.service.preview(input());
        mutate(h.snapshot);
        assert.throws(() => h.service.confirm(preview.proposalRef, h.proof), hasCode(code));
        assert.equal(h.calls.proof, 0);
        assert.equal(h.calls.commit, 0);
    }

    const expired = harness();
    const preview = expired.service.preview(input());
    expired.setNow(preview.expiresAt);
    assert.throws(() => expired.service.confirm(preview.proposalRef, expired.proof), hasCode('preview_expired'));
    assert.equal(expired.calls.proof, 0);

    const restarted = harness();
    assert.throws(() => restarted.service.confirm(PROPOSAL_REF, restarted.proof), hasCode('restart_changed'));
    restarted.service.dispose();
    assert.throws(() => restarted.service.preview(input()), hasCode('operation_unavailable'));
});

test('nega proof assente, Proxy, callback zero o doppia e risultati asincroni', async () => {
    const absent = harness();
    const absentPreview = absent.service.preview(input());
    assert.throws(() => absent.service.confirm(absentPreview.proposalRef, null), hasCode('confirmation_required'));
    assert.throws(() => absent.service.confirm(absentPreview.proposalRef, `hsap_${'11'.repeat(32)}`),
        hasCode('proof_unavailable'));

    let traps = 0;
    const proxiedProof = new Proxy({}, { getPrototypeOf() { traps += 1; throw new Error('no trap'); } });
    const proxied = harness();
    assert.throws(() => proxied.service.confirm(proxied.service.preview(input()).proposalRef, proxiedProof), hasCode('proof_unavailable'));
    assert.equal(traps, 0);

    for (const consumeConfirmation of [
        () => true,
        (_proof: unknown, _binding: unknown, operation: (value: unknown) => unknown) => {
            const proofBinding = record({ proofRefHash: PROOF_HASH, confirmedAt: 1_000 });
            operation(proofBinding);
            operation(proofBinding);
            return true;
        },
        () => Promise.resolve(true),
    ]) {
        const h = harness({ consumeConfirmation: consumeConfirmation as never });
        const current = h.service.preview(input());
        assert.throws(() => h.service.confirm(current.proposalRef, h.proof), hasCode('proof_unavailable'));
        assert.equal(h.calls.commit, 0);
    }

    const malformed = harness({
        consumeConfirmation: ((_proof: unknown, _binding: unknown, operation: (value: unknown) => unknown) =>
            operation({ proofRefHash: PROOF_HASH, confirmedAt: 1_000, patientId: 'blocked' })) as never,
    });
    assert.throws(() => malformed.service.confirm(malformed.service.preview(input()).proposalRef, malformed.proof), hasCode('proof_unavailable'));

    await new Promise<void>((resolve) => setImmediate(resolve));
});

test('linearizza reentry e un solo commit vince', () => {
    const context: { service?: ReturnType<typeof createHeadlessCheckupStatusTransitionServiceV1>;
        proposalRef: string; proof?: object } = { proposalRef: '' };
    let nestedCode = '';
    const h = harness({
        commit: ((command: unknown) => {
            try { context.service!.confirm(context.proposalRef, context.proof!); } catch (error) {
                nestedCode = (error as HeadlessCheckupStatusTransitionV1Error).code;
            }
            const targetStatus = (command as { targetStatus: 'completed' | 'cancelled' }).targetStatus;
            return record({ status: 'committed', receipt: h.receipt(targetStatus) });
        }) as never,
    });
    context.service = h.service;
    context.proof = h.proof;
    context.proposalRef = h.service.preview(input()).proposalRef;
    const receipt = h.service.confirm(context.proposalRef, h.proof);

    assert.equal(receipt.outcome, 'status_transitioned');
    assert.equal(nestedCode, 'proof_replayed');
    assert.equal(h.calls.proof, 1);
});

test('la revoca reentrante durante read o commit impedisce pubblicazione ed esito', () => {
    const readContext: { service?: ReturnType<typeof createHeadlessCheckupStatusTransitionServiceV1> } = {};
    const available = record({ status: 'available' as const, ownerIdentity: handle(), resourceIdentity: handle(),
        fromStatus: 'pending' as const, revision: 7, generation: 3, revocationGeneration: 0, selectionEpoch: 9 });
    const read = harness({ readSnapshot: (() => { readContext.service!.dispose(); return available; }) as never });
    readContext.service = read.service;
    assert.throws(() => read.service.preview(input()), hasCode('operation_unavailable'));

    const commitContext: { service?: ReturnType<typeof createHeadlessCheckupStatusTransitionServiceV1> } = {};
    const commit = harness({
        commit: ((command: unknown) => {
            commitContext.service!.dispose();
            const targetStatus = (command as { targetStatus: 'completed' | 'cancelled' }).targetStatus;
            return record({ status: 'committed', receipt: commit.receipt(targetStatus) });
        }) as never,
    });
    commitContext.service = commit.service;
    const preview = commit.service.preview(input());
    assert.throws(() => commit.service.confirm(preview.proposalRef, commit.proof), hasCode('operation_unavailable'));
});

test('propaga solo denial commit ammessi e respinge receipt o return ostili', async () => {
    for (const code of ['idempotency_conflict', 'audit_unavailable', 'commit_unavailable',
        'revision_conflict', 'transition_unavailable', 'scope_changed'] as const) {
        const h = harness({ commit: (() => record({ status: 'denied', code })) as never });
        const preview = h.service.preview(input());
        assert.throws(() => h.service.confirm(preview.proposalRef, h.proof), hasCode(code));
    }

    for (const commit of [
        () => ({ status: 'committed', receipt: { ...harness().receipt(), patientId: 'blocked' } }),
        () => ({ status: 'unknown' }),
        () => { throw new Error('synthetic storage failure'); },
    ]) {
        const h = harness({ commit: commit as never });
        assert.throws(() => h.service.confirm(h.service.preview(input()).proposalRef, h.proof), hasCode('commit_unavailable'));
    }

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
        const h = harness({ commit: (() => Promise.reject(new Error('late synthetic failure'))) as never });
        assert.throws(() => h.service.confirm(h.service.preview(input()).proposalRef, h.proof), hasCode('commit_unavailable'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('mantiene una sola proposta attiva per owner e risorsa e libera lo slot a expiry', () => {
    const h = harness();
    const first = h.service.preview(input('completed'));
    assert.throws(() => h.service.preview(input('cancelled')), hasCode('operation_unavailable'));
    h.setNow(first.expiresAt);
    const second = h.service.preview(input('cancelled'));
    assert.equal(second.proposalRef, SECOND_PROPOSAL_REF);
    assert.notEqual(second.proposalRef, first.proposalRef);
});
