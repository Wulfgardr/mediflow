/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { createTypedProjectionBroker, ProjectionBrokerError } from '../typed-projection-broker.ts';
import {
    createFullPortProjectionOwnerFactory,
    createLegacyProjectionOwnerFactory,
    createServerSessionProjectionOwnerRegistry,
    createPortProjectionOwnerFactory,
    disposeDurableReviewCommitPort,
    isServerSessionProjectionOwner,
    ServerSessionProjectionOwnerError,
    spendDurableReviewCommitPort,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, type ServerSession } from './server-session.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = { id: ['synthetic', 'user'].join('-'), username: ['synthetic', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };
let finalSessionSequence = 0;
const finalSessions = new Set<ServerSession>();

afterEach(() => {
    for (const value of finalSessions) retireSyntheticWebSession(value);
    finalSessions.clear();
    clearAllSessions();
});

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
}

function activePortSession(): ServerSession {
    finalSessionSequence += 1;
    const value = issueSyntheticWebSession(USER, `projection-owner-${finalSessionSequence}`);
    finalSessions.add(value);
    return value;
}

function retirePortSession(value: ServerSession): void {
    retireSyntheticWebSession(value);
    finalSessions.delete(value);
}

test('port factory reveals one owner only after exact final-owner authority commits', () => {
    const value = activePortSession();
    let brokerCalls = 0;
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
        brokerFactory: () => { brokerCalls += 1; throw new Error('must remain split'); } });
    const owner = registry.acquire(value);
    assert.equal(registry.acquire(value), owner);
    assert.equal(registry.isAuthenticOwner(owner), true);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    assert.equal(lease.selectionEpoch, 1);
    assert.equal(Reflect.get(owner, 'acquireProjectionIngest'), undefined);
    assert.equal(Reflect.get(owner, 'resolveProjectionService'), undefined);
    assert.equal(Reflect.get(owner, 'withLeaseCriticalSection'), undefined);
    assert.equal(brokerCalls, 0);
    retirePortSession(value);
    assert.throws(() => owner.snapshotSelectionEpoch(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
});

test('port owner surface cannot recover legacy callback or broker authority', () => {
    const value = activePortSession();
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const forbidden = ['acquireProjectionIngest', 'resolveProjectionService', 'withLeaseCriticalSection'] as const;
    let effects = 0;

    assert.equal(Object.getPrototypeOf(owner), null);
    assert.equal(Object.isFrozen(owner), true);
    assert.equal(isServerSessionProjectionOwner(owner), false);
    assert.deepEqual(Reflect.ownKeys(owner), [
        'snapshotSelectionEpoch', 'snapshotReviewContextEpoch', 'issueSelection', 'dereferenceSelection',
        'mintPatientInsightLeaseCommitPort', 'mintOcrLeaseCommitPort', 'mintDocumentSynthesisLeaseCommitPort',
        'mintTreatmentReasoningLeaseCommitPort', 'mintDurableReviewCommitPort', 'dispose',
    ]);
    for (const key of forbidden) {
        assert.equal(Reflect.has(owner, key), false);
        assert.equal(Reflect.get(owner, key), undefined);
        assert.equal(Object.getOwnPropertyDescriptor(owner, key), undefined);
    }
    const cast = owner as unknown as { withLeaseCriticalSection(session: ServerSession, callback: () => void): void };
    assert.throws(() => cast.withLeaseCriticalSection(value, () => { effects += 1; }), TypeError);
    assert.equal(effects, 0);
    const issueAlias = owner.issueSelection;
    assert.throws(() => issueAlias({ expectedEpoch: 1, ...PAIR }),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
    assert.throws(() => Object.defineProperty(owner, 'withLeaseCriticalSection', {
        get() { effects += 1; return () => undefined; },
    }), TypeError);
    assert.equal(effects, 0);

    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'withLeaseCriticalSection');
    try {
        Object.defineProperty(Object.prototype, 'withLeaseCriticalSection', {
            configurable: true, get() { effects += 1; return () => undefined; },
        });
        assert.equal(Reflect.get(owner, 'withLeaseCriticalSection'), undefined);
        assert.equal(effects, 0);
    } finally {
        if (inherited) Object.defineProperty(Object.prototype, 'withLeaseCriticalSection', inherited);
        else delete (Object.prototype as { withLeaseCriticalSection?: unknown }).withLeaseCriticalSection;
    }

    let traps = 0;
    const hostile = new Proxy(owner, { get() { traps += 1; throw new Error('synthetic trap'); } });
    assert.equal(registry.isAuthenticOwner(hostile), false);
    assert.equal(traps, 0);
    retirePortSession(value);
});

test('port owner surface stays registry-private across foreign registries', () => {
    const value = activePortSession();
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const owner = registry.acquire(value);
    const foreignRegistry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const foreignOwner = foreignRegistry.acquire(value);
    assert.equal(registry.isAuthenticOwner(foreignOwner), false);
    assert.equal(foreignRegistry.isAuthenticOwner(owner), false);
    assert.equal(Reflect.get(foreignOwner, 'withLeaseCriticalSection'), undefined);
    assert.equal(Reflect.get(foreignOwner, 'acquireProjectionIngest'), undefined);
    foreignOwner.dispose(); owner.dispose();
    retirePortSession(value);
});

test('port factory rejects legacy, forged, hostile, wrong-channel, expired, and retired sessions', () => {
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const denied = (value: ServerSession) => assert.throws(() => registry.acquire(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_ineligible');
    denied(session());
    const exact = activePortSession();
    denied(Object.freeze({ ...exact }));
    let traps = 0;
    denied(new Proxy(exact, { get() { traps += 1; throw new Error('synthetic trap'); } }));
    assert.equal(traps, 0);
    denied(Object.freeze({ ...exact, authChannel: 'native' }));
    denied(Object.freeze({ ...exact, expiresAt: Date.now() - 1 }));
    const owner = registry.acquire(exact);
    retirePortSession(exact);
    assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
});

test('port factory keeps every lease commit port on exact final-owner authority', () => {
    const value = activePortSession();
    const owner = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) }).acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    assert.ok(owner.mintPatientInsightLeaseCommitPort(value).snapshot());
    assert.ok(owner.mintOcrLeaseCommitPort(value).snapshot());
    assert.ok(owner.mintDocumentSynthesisLeaseCommitPort(value).snapshot());
    assert.ok(owner.mintTreatmentReasoningLeaseCommitPort(value).snapshot());
    assert.equal(spendDurableReviewCommitPort(owner.mintDurableReviewCommitPort(value)), true);
    retirePortSession(value);
});

test('port lease currentness rechecks exact authority after hostile clock retirement', () => {
    const value = activePortSession();
    let retire = false; let retireCalls = 0;
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), clock: () => {
        if (retire && retireCalls === 0) { retireCalls += 1; retirePortSession(value); }
        return Date.now();
    } });
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const port = owner.mintPatientInsightLeaseCommitPort(value);
    retire = true;
    assert.equal(port.snapshot(), null);
    assert.equal(retireCalls, 1);
    assert.throws(() => owner.snapshotSelectionEpoch(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
});

test('final-owner retirement terminally removes its facade and every commit port from the registry', () => {
    const value = activePortSession();
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const ports = [owner.mintPatientInsightLeaseCommitPort(value), owner.mintOcrLeaseCommitPort(value),
        owner.mintDocumentSynthesisLeaseCommitPort(value), owner.mintTreatmentReasoningLeaseCommitPort(value)];
    const durable = owner.mintDurableReviewCommitPort(value);

    retirePortSession(value);
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
    for (const port of ports) assert.equal(port.snapshot(), null);
    assert.equal(spendDurableReviewCommitPort(durable), false);
    assert.throws(() => owner.issueSelection({ expectedEpoch: 1, ...PAIR }),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
});

test('historical deletion cannot replace final-owner retirement across registries', () => {
    const value = activePortSession();
    const first = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const second = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const firstOwner = first.acquire(value); const secondOwner = second.acquire(value);
    firstOwner.issueSelection({ expectedEpoch: 0, ...PAIR });
    secondOwner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const firstPort = firstOwner.mintPatientInsightLeaseCommitPort(value);
    const secondPort = secondOwner.mintOcrLeaseCommitPort(value);

    deleteSession(value.id);
    assert.equal(first.lookup(value.id), firstOwner);
    assert.equal(second.lookup(value.id), secondOwner);
    assert.ok(firstPort.snapshot());
    assert.ok(secondPort.snapshot());
    retirePortSession(value);
    assert.equal(first.lookup(value.id), null, 'first registry lookup');
    assert.equal(second.lookup(value.id), null, 'second registry lookup');
    assert.equal(first.isAuthenticOwner(firstOwner), false);
    assert.equal(second.isAuthenticOwner(secondOwner), false);
    assert.equal(firstPort.snapshot(), null, 'first registry commit port');
    assert.equal(secondPort.snapshot(), null, 'second registry commit port');
    firstOwner.dispose(); secondOwner.dispose();
    assert.equal(first.lookup(value.id), null);
    assert.equal(second.lookup(value.id), null);
});

test('historical global clear cannot replace final-owner retirement', () => {
    const value = activePortSession();
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const port = owner.mintTreatmentReasoningLeaseCommitPort(value);
    clearAllSessions();
    assert.equal(registry.lookup(value.id), owner);
    assert.equal(registry.isAuthenticOwner(owner), true);
    assert.ok(port.snapshot());
    retirePortSession(value);
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
    assert.equal(port.snapshot(), null);
});

test('final-owner port currentness expiry terminally cleans the facade before returning', () => {
    const value = activePortSession();
    let now = value.createdAt;
    const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), clock: () => now });
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const durable = owner.mintDurableReviewCommitPort(value);

    now = value.expiresAt;
    assert.equal(port.snapshot(), null);
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
    assert.equal(spendDurableReviewCommitPort(durable), false);
    owner.dispose(); owner.dispose();
    assert.equal(registry.lookup(value.id), null);
    retirePortSession(value);
});

test('first final-owner selection at or after finite expiry cleans before typed denial', async () => {
    const value = activePortSession(); let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', onUnhandled);
    try {
        for (const now of [value.expiresAt, value.expiresAt + 1]) {
            const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), clock: () => now });
            const owner = registry.acquire(value);
            assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }),
                (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'lease_expired');
            assert.equal(registry.lookup(value.id), null);
            assert.equal(registry.isAuthenticOwner(owner), false);
            assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }),
                (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
            assert.throws(() => owner.mintOcrLeaseCommitPort(value),
                (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    } finally { process.off('unhandledRejection', onUnhandled); }
    assert.equal(unhandled, 0);
    retirePortSession(value);
});

test('every callback-free facade operation terminally cleans failed final-owner currentness', () => {
    const value = activePortSession();
    type PortOwner = ReturnType<ReturnType<typeof createPortProjectionOwnerFactory>['acquire']>;
    type Lease = ReturnType<PortOwner['issueSelection']>;
    const operations = [
        (owner: PortOwner) => owner.snapshotSelectionEpoch(value),
        (owner: PortOwner) => owner.snapshotReviewContextEpoch(value),
        (owner: PortOwner) => owner.issueSelection({ expectedEpoch: 1, ...PAIR }),
        (owner: PortOwner, lease: Lease) => owner.dereferenceSelection(value, {
            sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
            ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef,
        }),
        (owner: PortOwner) => owner.mintPatientInsightLeaseCommitPort(value),
        (owner: PortOwner) => owner.mintOcrLeaseCommitPort(value),
        (owner: PortOwner) => owner.mintDocumentSynthesisLeaseCommitPort(value),
        (owner: PortOwner) => owner.mintTreatmentReasoningLeaseCommitPort(value),
        (owner: PortOwner) => owner.mintDurableReviewCommitPort(value),
    ];
    const records = operations.map((operation) => {
        const registry = createPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
        const owner = registry.acquire(value);
        const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        return { operation, registry, owner, lease };
    });
    retirePortSession(value);
    for (const { operation, registry, owner, lease } of records) {
        assert.throws(() => operation(owner, lease),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.equal(registry.lookup(value.id), null);
        assert.equal(registry.isAuthenticOwner(owner), false);
    }
});

test('full port factory exposes its complete broker and critical-section surface only while current', () => {
    const value = activePortSession();
    let revocations = 0;
    const registry = createFullPortProjectionOwnerFactory({
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
        brokerFactory: (config) => {
            const broker = createTypedProjectionBroker(config, {
                clock: () => new Date(value.createdAt).toISOString(),
                entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
            });
            return Object.freeze({
                ingest: broker.ingest,
                service: broker.service,
                control: Object.freeze({
                    lock: () => broker.control.lock(),
                    revoke: () => { revocations += 1; broker.control.revoke(); },
                    changeSelection: (input: Parameters<typeof broker.control.changeSelection>[0]) =>
                        broker.control.changeSelection(input),
                }),
            });
        },
    });
    const owner = registry.acquire(value);

    assert.equal(Object.isFrozen(owner), true);
    assert.equal(isServerSessionProjectionOwner(owner), true);
    assert.equal(registry.isAuthenticOwner(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner), [
        'snapshotSelectionEpoch', 'snapshotReviewContextEpoch', 'acquireProjectionIngest',
        'resolveProjectionService', 'issueSelection', 'dereferenceSelection',
        'withLeaseCriticalSection', 'dispose', 'mintPatientInsightLeaseCommitPort',
        'mintOcrLeaseCommitPort', 'mintDocumentSynthesisLeaseCommitPort',
        'mintTreatmentReasoningLeaseCommitPort', 'mintDurableReviewCommitPort',
    ]);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const tuple = {
        sessionRef: lease.sessionRef,
        selectionEpoch: lease.selectionEpoch,
        patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef,
        leaseRef: lease.leaseRef,
    };
    const ingest = owner.acquireProjectionIngest(value, tuple);
    const service = owner.resolveProjectionService(value);
    assert.equal(typeof ingest.ingest, 'function');
    assert.equal(typeof service.consume, 'function');
    assert.deepEqual(owner.withLeaseCriticalSection(value, (selection) => selection), PAIR);
    assert.equal(registry.lookup(value.id), owner);

    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /const brokerPort = mintResourcePort\(presentedSession\);[\s\S]{0,240}binding\.unregister = bindProjectionBrokerToActiveWebSessionResource\(brokerPort, candidate\.control\);/u);

    retirePortSession(value);
    assert.equal(revocations, 1);
    assert.equal(registry.lookup(value.id), null);
    assert.equal(registry.isAuthenticOwner(owner), false);
    assert.throws(
        () => ingest.ingest({} as never),
        (error: unknown) => error instanceof ProjectionBrokerError && error.code === 'broker_revoked',
    );
    assert.throws(
        () => owner.resolveProjectionService(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable',
    );
    assert.throws(
        () => owner.withLeaseCriticalSection(value, () => PAIR),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable',
    );
});

test('legacy factory remains the default and port publication has a lexical-only reveal tail', () => {
    const first = session(); const legacy = createLegacyProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    assert.equal(legacy.acquire(first).snapshotSelectionEpoch(first), 0);
    const second = session(); const compatible = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) });
    assert.equal(compatible.acquire(second).snapshotSelectionEpoch(second), 0);

    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /const exposedOwner = authorityKind === 'port-full' \? completedOwner : completedPortOwner;[\s\S]*if \(!commitResourceUse\(acquisitionUse\)\) return fail\('session_ineligible'\);\s+portRevealActive = false;\s+revealed = true;[\s\S]*return exposedOwner as Owner;/u);
    assert.match(source, /from '\.\/web-auth-lifecycle-owner-adapter';/u);
    assert.doesNotMatch(source, /(?:abort|begin|commit)ActiveWebSessionResourceUse|(?:mint|release)ActiveWebSessionResourcePort|resolveActiveWebServerSession/u);
    assert.match(source, /export function createServerSessionProjectionOwnerRegistry[\s\S]*return createLegacyProjectionOwnerFactory\(sourceOverrides\);/u);
});

function ownerWithSelection(now = 1_000) {
    let clock = now;
    let entropy = 0;
    let patientVersion = 1;
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => clock,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion }),
    });
    const value = session();
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return { registry, value, owner, setClock: (next: number) => { clock = next; },
        setPatientVersion: (next: number) => { patientVersion = next; } };
}

test('keeps authentic owner identity private to the registry', () => {
    const { registry, value, owner } = ownerWithSelection();
    const lookalike = Object.freeze({ ...owner });
    assert.equal(isServerSessionProjectionOwner(owner), true);
    assert.equal(registry.isAuthenticOwner(owner), true);
    assert.equal(isServerSessionProjectionOwner(lookalike), false);
    assert.equal(registry.isAuthenticOwner(lookalike), false);
    assert.equal(registry.acquire(value), owner);
});

test('selection and review epoch snapshots deny patient version drift before reporting currentness', () => {
    for (const snapshot of ['selection', 'review'] as const) {
        const state = ownerWithSelection(); state.setPatientVersion(2);
        assert.throws(() => snapshot === 'selection'
            ? state.owner.snapshotSelectionEpoch(state.value)
            : state.owner.snapshotReviewContextEpoch(state.value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    }
});

test('removes the generic commit turn surface and mints separated closed ports', () => {
    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:LeaseCommitTurn|spendLeaseCommitTurn|withLeaseCommitTurn)/u);
    const { value, owner } = ownerWithSelection();
    const patientInsight = owner.mintPatientInsightLeaseCommitPort(value);
    const secondPatientInsight = owner.mintPatientInsightLeaseCommitPort(value);
    const ocr = owner.mintOcrLeaseCommitPort(value);
    const documentSynthesis = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const treatmentReasoning = owner.mintTreatmentReasoningLeaseCommitPort(value);
    const patientSnapshot = patientInsight.snapshot();
    const ocrSnapshot = ocr.snapshot();
    const documentSnapshot = documentSynthesis.snapshot();
    assert.ok(patientSnapshot); assert.ok(ocrSnapshot); assert.ok(documentSnapshot);
    assert.notEqual(patientInsight, secondPatientInsight);
    assert.notEqual(patientInsight, ocr);
    assert.notEqual(patientInsight, documentSynthesis);
    assert.notEqual(ocr, documentSynthesis);
    assert.notEqual(patientInsight, treatmentReasoning);
    assert.notEqual(ocr, treatmentReasoning);
    assert.notEqual(documentSynthesis, treatmentReasoning);
    assert.deepEqual(Object.keys(patientInsight), ['snapshot', 'prepare', 'commit', 'abort', 'dispose']);
    assert.equal(Object.isFrozen(patientInsight), true);
    assert.equal(Object.getPrototypeOf(patientSnapshot.currentRef), null);
    assert.equal(Object.isFrozen(patientSnapshot.currentRef), true);
    const replacement = patientInsight.prepare(Object.freeze({ expected: patientSnapshot.currentRef }));
    assert.ok(replacement);
    assert.equal(secondPatientInsight.commit(Object.freeze({
        expected: secondPatientInsight.snapshot()!.currentRef, replacement,
    } as never)), false);
    assert.equal(ocr.commit(Object.freeze({ expected: ocrSnapshot.currentRef, replacement } as never)), false);
    assert.equal(documentSynthesis.commit(Object.freeze({ expected: documentSnapshot.currentRef, replacement } as never)), false);
    assert.equal(treatmentReasoning.commit(Object.freeze({ expected: treatmentReasoning.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), true);
    assert.equal(patientInsight.snapshot()!.terminal, true);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), false);
    assert.equal(patientInsight.abort(Object.freeze({ replacement })), false);
});

test('lease commit ports deny patient version drift at mint and every authority-bearing operation', () => {
    const mintDrift = ownerWithSelection(); mintDrift.setPatientVersion(2);
    assert.throws(() => mintDrift.owner.mintPatientInsightLeaseCommitPort(mintDrift.value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');

    for (const operation of ['snapshot', 'prepare', 'commit', 'abort'] as const) {
        const state = ownerWithSelection(); const port = state.owner.mintPatientInsightLeaseCommitPort(state.value);
        const before = port.snapshot(); assert.ok(before);
        const replacement = operation === 'commit' || operation === 'abort'
            ? port.prepare(Object.freeze({ expected: before.currentRef })) : null;
        if (operation === 'commit' || operation === 'abort') assert.ok(replacement);
        state.setPatientVersion(2);
        const result = operation === 'snapshot' ? port.snapshot()
            : operation === 'prepare' ? port.prepare(Object.freeze({ expected: before.currentRef }))
                : operation === 'commit' ? port.commit(Object.freeze({ expected: before.currentRef, replacement: replacement! }))
                    : port.abort(Object.freeze({ replacement: replacement! }));
        assert.equal(result, operation === 'snapshot' || operation === 'prepare' ? null : false);
    }

    const durableMintDrift = ownerWithSelection(); durableMintDrift.setPatientVersion(2);
    assert.throws(() => durableMintDrift.owner.mintDurableReviewCommitPort(durableMintDrift.value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    const durableUseDrift = ownerWithSelection();
    const durable = durableUseDrift.owner.mintDurableReviewCommitPort(durableUseDrift.value);
    durableUseDrift.setPatientVersion(2);
    assert.equal(spendDurableReviewCommitPort(durable), false);
});

test('mints a data-only durable review commit port that remains owner-locked until disposal', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDurableReviewCommitPort(value);
    assert.equal(Object.getPrototypeOf(port), null);
    assert.equal(Object.isFrozen(port), true);
    assert.deepEqual(Object.keys(port), []);
    assert.equal(spendDurableReviewCommitPort(port), true);
    assert.equal(spendDurableReviewCommitPort(port), false);
    assert.throws(() => owner.mintDurableReviewCommitPort(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    disposeDurableReviewCommitPort(port);
    assert.doesNotThrow(() => owner.mintDurableReviewCommitPort(value));
});

test('durable review commit port rejects forged, cloned, proxied, foreign, expired, stale, logged-out, and disposed values', () => {
    const first = ownerWithSelection();
    const port = first.owner.mintDurableReviewCommitPort(first.value);
    let traps = 0; let thenReads = 0;
    const proxy = new Proxy(port, { get() { traps += 1; throw new Error('synthetic trap'); } });
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { thenReads += 1; return () => undefined; } }));
    for (const value of [null, Object.freeze(Object.create(null)), Object.freeze({ ...port }), proxy, thenable]) {
        assert.equal(spendDurableReviewCommitPort(value), false);
        disposeDurableReviewCommitPort(value);
    }
    assert.equal(traps, 0);
    assert.equal(thenReads, 0);
    const second = ownerWithSelection();
    assert.equal(spendDurableReviewCommitPort(second.owner.mintDurableReviewCommitPort(second.value)), true);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(spendDurableReviewCommitPort(port), false);
    disposeDurableReviewCommitPort(port);

    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintDurableReviewCommitPort(expired.value);
    expired.setClock(expired.value.expiresAt);
    assert.equal(spendDurableReviewCommitPort(expiryPort), false);
    const loggedOut = ownerWithSelection(); const logoutPort = loggedOut.owner.mintDurableReviewCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(spendDurableReviewCommitPort(logoutPort), false);
    const disposed = ownerWithSelection(); const disposedPort = disposed.owner.mintDurableReviewCommitPort(disposed.value);
    disposed.owner.dispose();
    assert.equal(spendDurableReviewCommitPort(disposedPort), false);
    const restarted = ownerWithSelection(); const restartedPort = restarted.owner.mintDurableReviewCommitPort(restarted.value);
    clearAllSessions();
    assert.equal(spendDurableReviewCommitPort(restartedPort), false);
});

test('durable review commit port poisons hostile-clock reentry into generic and H1f mint paths', () => {
    for (const reenter of ['durable', 'patient', 'ocr', 'document', 'treatment', 'dispose'] as const) {
        let armed = false;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
            clock: () => { if (armed) {
                armed = false;
                if (reenter === 'durable') spendDurableReviewCommitPort(port);
                else if (reenter === 'patient') owner.mintPatientInsightLeaseCommitPort(value);
                else if (reenter === 'ocr') owner.mintOcrLeaseCommitPort(value);
                else if (reenter === 'document') owner.mintDocumentSynthesisLeaseCommitPort(value);
                else if (reenter === 'treatment') owner.mintTreatmentReasoningLeaseCommitPort(value);
                else owner.dispose();
            } return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const port = owner.mintDurableReviewCommitPort(value);
        armed = true;
        assert.equal(spendDurableReviewCommitPort(port), false);
        assert.equal(spendDurableReviewCommitPort(port), false);
        disposeDurableReviewCommitPort(port);
        if (reenter !== 'dispose') assert.doesNotThrow(() => owner.mintDurableReviewCommitPort(value));
    }
});

test('owner-wide lease-port isolation denies every H1f outer operation against durable mint, spend, and dispose', () => {
    for (const kind of ['patient', 'ocr', 'document', 'treatment'] as const)
        for (const outer of ['snapshot', 'prepare', 'commit', 'abort'] as const)
            for (const nested of ['mint', 'spend', 'dispose'] as const) {
                let armed = false; let nestedResult: unknown = undefined;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        try { nestedResult = nested === 'mint' ? owner.mintDurableReviewCommitPort(value)
                            : nested === 'spend' ? spendDurableReviewCommitPort(durable) : disposeDurableReviewCommitPort(durable); } catch { nestedResult = 'denied'; }
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value);
                owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const h1f = kind === 'patient' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const before = h1f.snapshot()!;
                const staged = outer === 'commit' || outer === 'abort' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))! : null;
                const durable = nested === 'mint' ? null : owner.mintDurableReviewCommitPort(value);
                armed = true;
                const result = outer === 'snapshot' ? h1f.snapshot() : outer === 'prepare' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))
                    : outer === 'commit' ? h1f.commit(Object.freeze({ expected: before.currentRef, replacement: staged! })) : h1f.abort(Object.freeze({ replacement: staged! }));
                assert.equal(result, outer === 'snapshot' || outer === 'prepare' ? null : false);
                assert.equal(nestedResult, nested === 'mint' ? 'denied' : nested === 'spend' ? false : undefined);
                const after = h1f.snapshot()!;
                assert.equal(after.currentRef, before.currentRef);
                assert.equal(after.stagedRef, staged);
                assert.equal(after.generation, before.generation);
                assert.equal(after.terminal, false);
                if (durable) { assert.equal(spendDurableReviewCommitPort(durable), true); disposeDurableReviewCommitPort(durable); }
            }
});

test('owner-wide lease-port isolation denies durable mint and spend against every H1f port operation', () => {
    for (const kind of ['patient', 'ocr', 'document', 'treatment'] as const)
        for (const nested of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const)
            for (const outer of ['mint', 'spend'] as const) {
                let armed = false; let nestedResult: unknown = undefined;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        nestedResult = nested === 'snapshot' ? h1f.snapshot() : nested === 'prepare' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))
                            : nested === 'commit' ? h1f.commit(Object.freeze({ expected: before.currentRef, replacement: staged! }))
                                : nested === 'abort' ? h1f.abort(Object.freeze({ replacement: staged! })) : h1f.dispose();
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value);
                owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const h1f = kind === 'patient' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const before = h1f.snapshot()!;
                const staged = nested === 'commit' || nested === 'abort' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))! : null;
                const durable = outer === 'spend' ? owner.mintDurableReviewCommitPort(value) : null;
                armed = true;
                if (outer === 'mint') assert.throws(() => owner.mintDurableReviewCommitPort(value), ServerSessionProjectionOwnerError);
                else assert.equal(spendDurableReviewCommitPort(durable), false);
                assert.equal(nestedResult, nested === 'snapshot' || nested === 'prepare' ? null : nested === 'commit' || nested === 'abort' ? false : undefined);
                const after = h1f.snapshot()!;
                assert.equal(after.currentRef, before.currentRef);
                assert.equal(after.stagedRef, staged);
                assert.equal(after.generation, before.generation);
                assert.equal(after.terminal, false);
                if (durable) disposeDurableReviewCommitPort(durable);
            }
});

test('Treatment Reasoning port has a private brand and fails closed for stale, expired, replayed, disposed, and foreign authority', () => {
    const first = ownerWithSelection();
    const treatment = first.owner.mintTreatmentReasoningLeaseCommitPort(first.value);
    const patientInsight = first.owner.mintPatientInsightLeaseCommitPort(first.value);
    const ocr = first.owner.mintOcrLeaseCommitPort(first.value);
    const documentSynthesis = first.owner.mintDocumentSynthesisLeaseCommitPort(first.value);
    const current = treatment.snapshot()!.currentRef;
    const replacement = treatment.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientInsight.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(ocr.abort(Object.freeze({ replacement } as never)), false);
    assert.equal(documentSynthesis.commit(Object.freeze({ expected: documentSynthesis.snapshot()!.currentRef, replacement } as never)), false);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    first.owner.issueSelection({ expectedEpoch: 2, ...PAIR });
    assert.equal(treatment.commit(Object.freeze({ expected: current, replacement })), false);

    const expired = ownerWithSelection();
    const expiredPort = expired.owner.mintTreatmentReasoningLeaseCommitPort(expired.value);
    const expiredCurrent = expiredPort.snapshot()!.currentRef;
    const expiredReplacement = expiredPort.prepare(Object.freeze({ expected: expiredCurrent }));
    assert.ok(expiredReplacement);
    expired.setClock(expired.value.expiresAt);
    assert.equal(expiredPort.commit(Object.freeze({ expected: expiredCurrent, replacement: expiredReplacement })), false);

    const loggedOut = ownerWithSelection();
    const loggedOutPort = loggedOut.owner.mintTreatmentReasoningLeaseCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(loggedOutPort.snapshot(), null);
    assert.throws(() => first.owner.mintTreatmentReasoningLeaseCommitPort(session()));
    first.owner.dispose();
    assert.equal(treatment.snapshot(), null);
});

test('Treatment Reasoning accepts frozen exact data without hostile or ambient then reads and does no post-return work', async () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintTreatmentReasoningLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    let traps = 0; let ambientReads = 0; let unhandled = 0;
    const hostile = new Proxy(Object.freeze({ expected: current }), {
        get() { traps += 1; throw new Error('synthetic hostile get'); },
        ownKeys() { traps += 1; throw new Error('synthetic hostile ownKeys'); },
    });
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    const onUnhandled = () => { unhandled += 1; };
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { ambientReads += 1; return undefined; } });
    process.on('unhandledRejection', onUnhandled);
    try {
        assert.equal(port.prepare(hostile as never), null);
        const replacement = port.prepare(Object.freeze({ expected: current }));
        assert.ok(replacement);
        assert.equal(port.commit(Object.freeze({ expected: current, replacement })), true);
        assert.deepEqual(port.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(traps, 0);
    assert.equal(ambientReads, 0);
    assert.equal(unhandled, 0);
});

test('Document Synthesis accepts only frozen exact own data records without reading hostile inputs', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    let reads = 0; let traps = 0;
    const accessor = Object.freeze(Object.defineProperty({}, 'expected', {
        enumerable: true, get() { reads += 1; return current; },
    }));
    const proxy = new Proxy(Object.freeze({ expected: current }), {
        get() { traps += 1; throw new Error('synthetic get trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic ownKeys trap'); },
    });
    const hidden = Object.freeze(Object.defineProperty({ expected: current }, 'hidden', { value: true }));
    const custom = Object.freeze(Object.assign(Object.create(null), { expected: current }));
    const thenable = Object.freeze(Object.defineProperty({ expected: current }, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));

    for (const request of [accessor, proxy, Object.freeze({ expected: current, extra: true }), hidden,
        Object.freeze({ expected: current, [Symbol('synthetic')]: true }), custom, thenable, { expected: current }]) {
        assert.equal(port.prepare(request as never), null);
    }
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('Document Synthesis stages a private replacement before a single terminal owner-state replacement', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const before = port.snapshot()!;
    const replacement = port.prepare(Object.freeze({ expected: before.currentRef }));
    assert.ok(replacement);
    const staged = port.snapshot()!;
    assert.equal(staged.currentRef, before.currentRef);
    assert.equal(staged.stagedRef, replacement);
    assert.equal(staged.generation, before.generation);
    assert.equal(port.commit(Object.freeze({ expected: before.currentRef, replacement })), true);
    const committed = port.snapshot()!;
    assert.equal(committed.currentRef, replacement);
    assert.equal(committed.stagedRef, null);
    assert.equal(committed.generation, before.generation + 1);
    assert.equal(committed.terminal, true);
});

test('Document Synthesis aborts once before commit and never rolls a completed state back', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    const replacement = port.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(port.abort(Object.freeze({ replacement })), true);
    assert.equal(port.snapshot()!.currentRef, current);
    assert.equal(port.snapshot()!.stagedRef, null);
    assert.equal(port.abort(Object.freeze({ replacement })), false);
    assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);
});

test('fails closed on reselection, expiry, logout, disposal, cross-session, and fresh registry', () => {
    const first = ownerWithSelection();
    const port = first.owner.mintPatientInsightLeaseCommitPort(first.value);
    const current = port.snapshot()!.currentRef;
    const replacement = port.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);

    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintOcrLeaseCommitPort(expired.value);
    const expiryCurrent = expiryPort.snapshot()!.currentRef;
    const expiryReplacement = expiryPort.prepare(Object.freeze({ expected: expiryCurrent }));
    expired.setClock(expired.value.expiresAt);
    assert.equal(expiryPort.commit(Object.freeze({ expected: expiryCurrent, replacement: expiryReplacement! })), false);

    const loggedOut = ownerWithSelection(); const logoutPort = loggedOut.owner.mintOcrLeaseCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(logoutPort.snapshot(), null);
    const foreign = session();
    assert.throws(() => first.owner.mintPatientInsightLeaseCommitPort(foreign));
    assert.throws(() => ({ mint: first.owner.mintPatientInsightLeaseCommitPort }).mint(first.value));
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.value.id), null);
    first.owner.dispose();
    assert.equal(port.snapshot(), null);
});

test('denies same-kind nested operations and isolates all four kinds during snapshots', () => {
    for (const kind of ['patient-insight', 'ocr', 'document-synthesis', 'treatment-reasoning'] as const) for (const operation of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const) {
        let armed = false;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
            clock: () => { if (armed) { armed = false;
                if (operation === 'snapshot') port.snapshot(); else if (operation === 'prepare') port.prepare(Object.freeze({ expected: current } as never));
                else if (operation === 'commit') port.commit(Object.freeze({ expected: current, replacement: current } as never));
                else if (operation === 'abort') port.abort(Object.freeze({ replacement: current } as never)); else port.dispose();
            } return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const port = kind === 'patient-insight' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
            : kind === 'document-synthesis' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
        const current = port.snapshot()!.currentRef;
        armed = true;
        assert.equal(port.snapshot(), null);
        assert.deepEqual(port.snapshot(), { currentRef: current, stagedRef: null, generation: 0, terminal: operation === 'dispose' });
    }
});

test('all ports deny every nested operation while snapshot, prepare, commit, or abort is in flight', () => {
    for (const kind of ['patient-insight', 'ocr', 'document-synthesis', 'treatment-reasoning'] as const)
        for (const outer of ['snapshot', 'prepare', 'commit', 'abort'] as const)
            for (const nested of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const) {
                let armed = false;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        if (nested === 'snapshot') port.snapshot(); else if (nested === 'prepare') port.prepare(Object.freeze({ expected: current } as never));
                        else if (nested === 'commit') port.commit(Object.freeze({ expected: current, replacement } as never));
                        else if (nested === 'abort') port.abort(Object.freeze({ replacement } as never)); else port.dispose();
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const port = kind === 'patient-insight' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document-synthesis' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const current = port.snapshot()!.currentRef;
                const replacement = outer === 'commit' || outer === 'abort' ? port.prepare(Object.freeze({ expected: current }))! : current;
                armed = true;
                if (outer === 'snapshot') assert.equal(port.snapshot(), null);
                else if (outer === 'prepare') assert.equal(port.prepare(Object.freeze({ expected: current })), null);
                else if (outer === 'commit') assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);
                else assert.equal(port.abort(Object.freeze({ replacement })), false);
                assert.equal(port.snapshot()!.terminal, nested === 'dispose');
            }
});

test('all ports dispose synchronously without a reentry boundary', () => {
    const { value, owner } = ownerWithSelection();
    for (const port of [owner.mintPatientInsightLeaseCommitPort(value), owner.mintOcrLeaseCommitPort(value),
        owner.mintDocumentSynthesisLeaseCommitPort(value), owner.mintTreatmentReasoningLeaseCommitPort(value)]) {
        port.dispose();
        assert.equal(port.snapshot()!.terminal, true);
    }
});

test('Document Synthesis ports cannot union authority with Patient Insight or OCR ports', () => {
    const { value, owner } = ownerWithSelection();
    const document = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const patient = owner.mintPatientInsightLeaseCommitPort(value);
    const ocr = owner.mintOcrLeaseCommitPort(value);
    const current = document.snapshot()!.currentRef;
    const replacement = document.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(patient.commit(Object.freeze({ expected: patient.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(ocr.abort(Object.freeze({ replacement } as never)), false);
    assert.equal(document.commit(Object.freeze({ expected: current, replacement })), true);
    assert.deepEqual(document.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
});

test('Document Synthesis port never reads ambient then or schedules post-return work', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0; let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    process.on('unhandledRejection', onUnhandled);
    try {
        const before = reads; const replacement = port.prepare(Object.freeze({ expected: current }));
        assert.ok(replacement); assert.equal(port.commit(Object.freeze({ expected: current, replacement })), true);
        assert.deepEqual(port.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
        assert.equal(reads, before);
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(unhandled, 0);
});

test('lease critical section denies patient version drift before callback and at its final fence', () => {
    for (const phase of ['before', 'inside'] as const) {
        const state = ownerWithSelection(); let callbacks = 0;
        if (phase === 'before') state.setPatientVersion(2);
        assert.throws(() => state.owner.withLeaseCriticalSection(state.value, () => {
            callbacks += 1;
            if (phase === 'inside') state.setPatientVersion(2);
            return 'synthetic result';
        }), (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
        assert.equal(callbacks, phase === 'before' ? 0 : 1);
    }
});

test('denies a result when the final critical-section clock disposes its session owner', () => {
    for (const result of [Object.freeze({ kind: 'normal' }), Object.freeze({ then() { /* probe only */ } })]) {
        let arm = false; let armedClockReads = 0;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), entropy: () => new Uint8Array(16),
            clock: () => { if (arm && ++armedClockReads === 2) deleteSession(value.id); return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        assert.throws(() => owner.withLeaseCriticalSection(value, () => { arm = true; return result; }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.equal(registry.lookup(value.id), null);
    }
});

test('never republishes selection after lifecycle disposal during resolve or final clock', () => {
    for (const phase of ['resolve', 'clock'] as const) for (const lifecycle of ['owner', 'session'] as const) for (const existing of [false, true]) {
        let arm = false; let entropy = 0;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => { if (arm && phase === 'resolve') dispose(); return Object.freeze({ ...pair, patientVersion: 1 }); },
            entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
            clock: () => { if (arm && phase === 'clock') dispose(); return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        if (existing) owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const expectedEpoch = existing ? 1 : 0;
        const dispose = () => { if (lifecycle === 'owner') owner.dispose(); else deleteSession(value.id); };
        arm = true;
        assert.throws(() => owner.issueSelection({ expectedEpoch, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.equal(registry.lookup(value.id), null);
        assert.throws(() => owner.snapshotSelectionEpoch(value),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.throws(() => owner.issueSelection({ expectedEpoch, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
    }
});

test('keeps nested issueSelection busy while resolving the outer selection', () => {
    let arm = false;
    const registry = createServerSessionProjectionOwnerRegistry({
        resolve: (_session, pair) => { if (arm) assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'selection_busy');
            return Object.freeze({ ...pair, patientVersion: 1 }); },
        entropy: () => new Uint8Array(16), clock: () => 1_000,
    });
    const value = session(); const owner = registry.acquire(value); arm = true;
    assert.equal(owner.issueSelection({ expectedEpoch: 0, ...PAIR }).selectionEpoch, 1);
    arm = false;
    assert.equal(owner.snapshotSelectionEpoch(value), 1);
});
