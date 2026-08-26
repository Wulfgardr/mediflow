/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import {
    createDocumentSynthesisSourceSetCurrentnessOwner,
    DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError,
    resolveDocumentSynthesisSourceSetCurrentnessAccessor,
} from './document-synthesis-source-set-currentness-owner.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession } from '../../security/server-session.ts';

const USER = { id: ['synthetic', 'currentness', 'user'].join('-'), username: ['synthetic', 'currentness', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.currentness', ambulatoryId: 'ambulatory.synthetic.currentness' };
const n = (value: number | string) => BigInt(value);

afterEach(() => clearAllSessions());

function sourceSet(epoch = n(3), revoked = n(5), revision = n(7), freshness = n(11), reference = 'document.synthetic.currentness') {
    const result = captureDocumentSynthesisSourceSet({
        sources: [{ documentSourceRef: reference, documentRevision: revision, documentFreshnessEpoch: freshness, sourceText: 'Synthetic source text' }],
        sourceSetEpoch: epoch, revocationGeneration: revoked,
    });
    assert.equal(result.status, 'available');
    if (result.status !== 'available') throw new Error('expected synthetic source set');
    return result.sourceSet;
}

function ownerWithSelection(clock: () => number = () => 1_000) {
    let entropy = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ clock, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index), resolve: (_session, pair) => Object.freeze({ ...pair }) });
    const session = createSession(USER, 'web'); const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return { session, owner };
}

test('captures only host-minted C3c2 currentness under the live Document Synthesis owner port', () => {
    const { session, owner } = ownerWithSelection();
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: sourceSet() }));
    const snapshot = capsule.snapshot();
    assert.deepEqual({ ...snapshot, sources: snapshot?.sources.map((item) => ({ ...item })) }, {
        sourceSetEpoch: n(3), revocationGeneration: n(5),
        sources: [{ label: 'S1', documentSourceRef: 'document.synthetic.currentness', documentRevision: n(7), documentFreshnessEpoch: n(11) }],
    });
    assert.ok(snapshot); assert.equal(Object.getPrototypeOf(snapshot), null); assert.equal(Object.isFrozen(snapshot), true);
    assert.deepEqual(Object.keys(snapshot!.sources[0]!), ['label', 'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']);
    assert.deepEqual(Object.keys(capsule), ['snapshot', 'transition', 'revoke', 'dispose']);
    assert.equal(capsule instanceof Promise, false);
});

test('resolves only its branded same-owner capsule without ambient, proxy, thenable, or deferred access', () => {
    const first = ownerWithSelection(); const second = ownerWithSelection(); const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: first.owner, session: first.session, sourceSet: sourceSet() }));
    const accessor = resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, first.owner, first.session);
    assert.ok(accessor); assert.equal(accessor instanceof Promise, false); assert.ok(accessor.snapshot());
    assert.equal(resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, second.owner, second.session), null);
    let reads = 0; let traps = 0;
    const forged = Object.freeze({ snapshot() { reads += 1; return null; }, transition() { reads += 1; return false; }, revoke() { reads += 1; }, dispose() { reads += 1; } });
    const proxied = new Proxy(capsule, { get() { traps += 1; throw new Error('trap'); } });
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'WeakSet');
    try { Object.defineProperty(globalThis, 'WeakSet', { configurable: true, value: class { } }); for (const value of [forged, Object.freeze({ ...capsule }), proxied, Object.freeze({ then() {} })]) assert.equal(resolveDocumentSynthesisSourceSetCurrentnessAccessor(value, first.owner, first.session), null); assert.ok(resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, first.owner, first.session)); }
    finally { Object.defineProperty(globalThis, 'WeakSet', prior!); }
    assert.equal(reads, 0); assert.equal(traps, 0);
});

test('requires a strictly increasing source-set epoch and nondecreasing revocation generation', () => {
    const { session, owner } = ownerWithSelection();
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: sourceSet() }));
    assert.equal(capsule.transition(sourceSet(n(4), n(5), n(8))), true);
    assert.deepEqual(capsule.snapshot()?.sources[0] && { ...capsule.snapshot()!.sources[0]! }, { label: 'S1', documentSourceRef: 'document.synthetic.currentness', documentRevision: n(8), documentFreshnessEpoch: n(11) });
    assert.equal(capsule.transition(sourceSet(n(3), n(5))), false);
    assert.equal(capsule.snapshot(), null);
    const noRevocationRollback = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: sourceSet() }));
    assert.equal(noRevocationRollback.transition(sourceSet(n(4), n(4))), false);
    assert.equal(noRevocationRollback.snapshot(), null);
});

test('terminally rejects regressed source lineage, including reintroduced and mixed sources', () => {
    const terminal = (capsule: ReturnType<typeof createDocumentSynthesisSourceSetCurrentnessOwner>, stale: ReturnType<typeof sourceSet>, retry: ReturnType<typeof sourceSet>) => {
        assert.equal(capsule.transition(stale), false); assert.equal(capsule.snapshot(), null); assert.equal(capsule.transition(retry), false);
    };
    const revision = ownerWithSelection(); const revisionCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: revision.owner, session: revision.session, sourceSet: sourceSet() }));
    terminal(revisionCapsule, sourceSet(n(4), n(5), n(6)), sourceSet(n(5), n(5), n(8)));
    const freshness = ownerWithSelection(); const freshnessCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: freshness.owner, session: freshness.session, sourceSet: sourceSet() }));
    terminal(freshnessCapsule, sourceSet(n(4), n(5), n(7), n(10)), sourceSet(n(5), n(5), n(8)));
    const aba = ownerWithSelection(); const abaCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: aba.owner, session: aba.session, sourceSet: sourceSet() }));
    assert.equal(abaCapsule.transition(sourceSet(n(4), n(5), n(1), n(1), 'document.synthetic.currentness.b')), true);
    terminal(abaCapsule, sourceSet(n(5), n(5), n(6), n(10)), sourceSet(n(6), n(5), n(8)));
    const mixed = ownerWithSelection(); const mixedCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: mixed.owner, session: mixed.session, sourceSet: sourceSet() }));
    assert.equal(mixedCapsule.transition(captureMixed(n(4), n(8), n(12))), true);
    terminal(mixedCapsule, captureMixed(n(5), n(7), n(13)), sourceSet(n(6), n(5), n(9)));
});

function captureMixed(epoch: bigint, firstRevision: bigint, secondFreshness: bigint) {
    const result = captureDocumentSynthesisSourceSet({ sources: [
        { documentSourceRef: 'document.synthetic.currentness', documentRevision: firstRevision, documentFreshnessEpoch: n(11), sourceText: 'Synthetic source text A' },
        { documentSourceRef: 'document.synthetic.currentness.b', documentRevision: n(1), documentFreshnessEpoch: secondFreshness, sourceText: 'Synthetic source text B' },
    ], sourceSetEpoch: epoch, revocationGeneration: n(5) });
    assert.equal(result.status, 'available'); if (result.status !== 'available') throw new Error('expected synthetic source set');
    return result.sourceSet;
}

test('fails closed after revocation, disposal, reselection, expiry, logout, and restart', () => {
    const state = ownerWithSelection();
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: state.owner, session: state.session, sourceSet: sourceSet() }));
    capsule.revoke(); assert.equal(capsule.snapshot(), null);
    const disposed = ownerWithSelection(); const disposal = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: disposed.owner, session: disposed.session, sourceSet: sourceSet() }));
    disposal.dispose(); assert.equal(disposal.snapshot(), null);
    const reselection = ownerWithSelection(); const afterSelection = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: reselection.owner, session: reselection.session, sourceSet: sourceSet() }));
    reselection.owner.issueSelection({ expectedEpoch: 1, ...PAIR }); assert.equal(afterSelection.snapshot(), null);
    let now = 1_000; const expiring = ownerWithSelection(() => now);
    const expiry = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: expiring.owner, session: expiring.session, sourceSet: sourceSet(n(4)) }));
    now = expiring.session.expiresAt; assert.equal(expiry.snapshot(), null);
    const loggedOut = ownerWithSelection(); const logout = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: loggedOut.owner, session: loggedOut.session, sourceSet: sourceSet() }));
    deleteSession(loggedOut.session.id); assert.equal(logout.snapshot(), null);
    const restarted = ownerWithSelection(); const restart = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: restarted.owner, session: restarted.session, sourceSet: sourceSet() }));
    clearAllSessions(); assert.equal(restart.snapshot(), null);
});

test('rejects forged, cloned, foreign, hostile, and thenable configuration or transitions without reads', () => {
    const first = ownerWithSelection(); const second = ownerWithSelection(); const authentic = sourceSet();
    const rejected = (value: unknown) => assert.throws(() => createDocumentSynthesisSourceSetCurrentnessOwner(value), DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError);
    rejected(Object.freeze({ owner: first.owner, session: second.session, sourceSet: authentic }));
    rejected(Object.freeze({ owner: { ...first.owner }, session: first.session, sourceSet: authentic }));
    rejected(Object.freeze({ owner: first.owner, session: first.session, sourceSet: { ...authentic } }));
    let reads = 0; let traps = 0;
    const accessor = {}; Object.defineProperty(accessor, 'owner', { enumerable: true, get() { reads += 1; return first.owner; } }); Object.defineProperty(accessor, 'session', { enumerable: true, value: first.session }); Object.defineProperty(accessor, 'sourceSet', { enumerable: true, value: authentic });
    const proxy = new Proxy(Object.freeze({ owner: first.owner, session: first.session, sourceSet: authentic }), { get() { traps += 1; throw new Error('trap'); } });
    rejected(Object.freeze({ owner: first.owner, session: first.session, sourceSet: authentic, then: () => undefined })); rejected(accessor); rejected(proxy);
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: first.owner, session: first.session, sourceSet: authentic }));
    assert.equal(capsule.transition({ then: () => undefined }), false); assert.equal(reads, 0); assert.equal(traps, 0);
});

test('poisons reentry through the owner clock without post-return work', () => {
    let capsule: ReturnType<typeof createDocumentSynthesisSourceSetCurrentnessOwner> | null = null;
    let armed = false;
    const state = ownerWithSelection(() => { if (armed) capsule?.snapshot(); return 1_000; });
    capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: state.owner, session: state.session, sourceSet: sourceSet() }));
    armed = true; assert.equal(capsule.snapshot(), null); assert.equal(capsule.snapshot(), null);
});
