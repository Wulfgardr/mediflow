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
    const patientSnapshot = patientInsight.snapshot();
    const ocrSnapshot = ocr.snapshot();
    assert.ok(patientSnapshot); assert.ok(ocrSnapshot);
    assert.notEqual(patientInsight, secondPatientInsight);
    assert.notEqual(patientInsight, ocr);
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
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), true);
    assert.equal(patientInsight.snapshot()!.terminal, true);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), false);
    assert.equal(patientInsight.abort(Object.freeze({ replacement })), false);
});

test('accepts only frozen exact own data records without reading hostile inputs', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintPatientInsightLeaseCommitPort(value);
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

    for (const request of [accessor, proxy, Object.freeze({ expected: current, extra: true }), hidden,
        Object.freeze({ expected: current, [Symbol('synthetic')]: true }), custom, { expected: current }]) {
        assert.equal(port.prepare(request as never), null);
    }
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('stages a private replacement before a single terminal owner-state replacement', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintPatientInsightLeaseCommitPort(value);
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

test('aborts once before commit and never rolls a completed state back', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintOcrLeaseCommitPort(value);
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

test('denies nested public operations during a Patient Insight or OCR snapshot', () => {
    for (const kind of ['patient-insight', 'ocr'] as const) for (const operation of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const) {
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
        const port = kind === 'patient-insight' ? owner.mintPatientInsightLeaseCommitPort(value) : owner.mintOcrLeaseCommitPort(value);
        const current = port.snapshot()!.currentRef;
        armed = true;
        assert.equal(port.snapshot(), null);
        assert.deepEqual(port.snapshot(), { currentRef: current, stagedRef: null, generation: 0, terminal: operation === 'dispose' });
    }
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
