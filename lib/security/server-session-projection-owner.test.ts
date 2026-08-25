/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    isServerSessionProjectionOwner,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, type ServerSession } from './server-session.ts';

const USER = { id: ['synthetic', 'user'].join('-'), username: ['synthetic', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
}

function ownerWithSelection(now = 1_000) {
    let clock = now;
    let entropy = 0;
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => clock,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
        resolve: (_session, pair) => Object.freeze({ ...pair }),
    });
    const value = session();
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return { registry, value, owner, setClock: (next: number) => { clock = next; } };
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
            resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
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
                    resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
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

test('denies a result when the final critical-section clock disposes its session owner', () => {
    for (const result of [Object.freeze({ kind: 'normal' }), Object.freeze({ then() { /* probe only */ } })]) {
        let arm = false; let armedClockReads = 0;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
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
            resolve: (_session, pair) => { if (arm && phase === 'resolve') dispose(); return pair; },
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
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'selection_busy'); return pair; },
        entropy: () => new Uint8Array(16), clock: () => 1_000,
    });
    const value = session(); const owner = registry.acquire(value); arm = true;
    assert.equal(owner.issueSelection({ expectedEpoch: 0, ...PAIR }).selectionEpoch, 1);
    assert.equal(owner.snapshotSelectionEpoch(value), 1);
});
