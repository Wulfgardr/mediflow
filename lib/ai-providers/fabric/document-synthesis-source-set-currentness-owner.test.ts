/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import {
    createDocumentSynthesisSourceSetCurrentnessOwner,
    DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError,
} from './document-synthesis-source-set-currentness-owner.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, type ServerSession } from '../../security/server-session.ts';

const USER = { id: ['synthetic', 'currentness', 'user'].join('-'), username: ['synthetic', 'currentness', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.currentness', ambulatoryId: 'ambulatory.synthetic.currentness' };
const n = (value: number | string) => BigInt(value);

afterEach(() => clearAllSessions());

function sourceSet(epoch = n(3), revoked = n(5), revision = n(7)) {
    const result = captureDocumentSynthesisSourceSet({
        sources: [{ documentSourceRef: 'document.synthetic.currentness', documentRevision: revision, documentFreshnessEpoch: n(11), sourceText: 'Synthetic source text' }],
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
