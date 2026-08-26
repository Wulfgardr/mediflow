/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import { createDocumentSynthesisSourceSetCurrentnessOwner } from './document-synthesis-source-set-currentness-owner.ts';
import { createDocumentSynthesisSourceSetLease, DocumentSynthesisSourceSetLeaseConfigurationError } from './document-synthesis-source-set-lease.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession } from '../../security/server-session.ts';

const USER = { id: ['synthetic', 'lease', 'user'].join('.'), username: ['synthetic', 'lease', 'clinician'].join('.'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.lease', ambulatoryId: 'ambulatory.synthetic.lease' };
const n = (value: number) => BigInt(value);
afterEach(() => clearAllSessions());

function source(epoch = 3, revision = 7, freshness = 11) {
    const result = captureDocumentSynthesisSourceSet({ sourceSetEpoch: n(epoch), revocationGeneration: n(5), sources: [{ documentSourceRef: 'document.synthetic.lease', documentRevision: n(revision), documentFreshnessEpoch: n(freshness), sourceText: 'Synthetic source.' }] });
    assert.equal(result.status, 'available'); if (result.status !== 'available') throw new Error('synthetic source unavailable'); return result.sourceSet;
}
function fixture(clock: () => number = () => 1_000) {
    let entropy = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ clock, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index), resolve: (_session, pair) => Object.freeze({ ...pair }) });
    const session = createSession(USER, 'web'); const owner = registry.acquire(session); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: source() }));
    return { session, owner, capsule, lease: () => createDocumentSynthesisSourceSetLease(Object.freeze({ owner, session, capsule })) };
}

test('issues a same-process opaque token and burns it before granting one execution', () => {
    const state = fixture(); const lease = state.lease(); const token = lease.issue();
    assert.ok(token); assert.equal(Object.getPrototypeOf(token), null); assert.equal(Object.isFrozen(token), true); assert.deepEqual(Reflect.ownKeys(token), []);
    assert.equal(lease.consume(token), true); assert.equal(lease.consume(token), false); assert.equal(lease.issue(), null);
});

test('has no source, provider, authority, or residue on invalid configuration or issue denial', () => {
    const state = fixture();
    for (const value of [Object.freeze({ owner: state.owner, session: state.session, capsule: state.capsule, sourceSet: source() }), Object.freeze({ owner: state.owner, session: state.session, capsule: { ...state.capsule } })]) assert.throws(() => createDocumentSynthesisSourceSetLease(value), DocumentSynthesisSourceSetLeaseConfigurationError);
    state.capsule.revoke(); const lease = state.lease(); assert.equal(lease.issue(), null); assert.equal(Reflect.ownKeys(lease).includes('sourceSet'), false);
});

test('revalidates immediately and burns denials for source drift, revoke, selection, expiry, logout, dispose, and restart', () => {
    const stale = fixture(); const staleLease = stale.lease(); const staleToken = staleLease.issue(); assert.ok(staleToken); assert.equal(stale.capsule.transition(source(4, 8)), true); assert.equal(staleLease.consume(staleToken), false); assert.equal(staleLease.consume(staleToken), false);
    const cases: Array<(state: ReturnType<typeof fixture>) => void> = [
        (state) => state.capsule.revoke(),
        (state) => state.owner.issueSelection({ expectedEpoch: 1, ...PAIR }),
        (state) => { state.session.expiresAt = 1_000; },
        (state) => deleteSession(state.session.id),
        (state) => state.capsule.dispose(),
        () => clearAllSessions(),
    ];
    for (const change of cases) { const state = fixture(); const lease = state.lease(); const token = lease.issue(); assert.ok(token); change(state); assert.equal(lease.consume(token), false); assert.equal(lease.consume(token), false); }
});

test('rejects foreign, proxy, accessor, hidden, symbol, thenable, and reentrant inputs without caller reads or post-return work', async () => {
    const state = fixture(); const foreign = fixture(); let reads = 0; let traps = 0;
    const accessor = Object.freeze(Object.defineProperty({ owner: state.owner, session: state.session, capsule: state.capsule }, 'owner', { enumerable: true, get() { reads += 1; return state.owner; } }));
    const proxy = new Proxy(Object.freeze({ owner: state.owner, session: state.session, capsule: state.capsule }), { get() { traps += 1; throw new Error('trap'); } });
    for (const value of [accessor, proxy, Object.freeze({ owner: state.owner, session: state.session, capsule: state.capsule, [Symbol('x')]: true }), Object.freeze(Object.defineProperty({ owner: state.owner, session: state.session, capsule: state.capsule }, 'hidden', { value: true })), Object.freeze({ owner: state.owner, session: state.session, capsule: state.capsule, then() {} }), Object.freeze({ owner: foreign.owner, session: state.session, capsule: state.capsule })]) assert.throws(() => createDocumentSynthesisSourceSetLease(value), DocumentSynthesisSourceSetLeaseConfigurationError);
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    const lease = state.lease(); const token = lease.issue(); assert.ok(token); assert.equal(lease.consume(new Proxy(token, { get() { traps += 1; throw new Error('trap'); } })), false); if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then; assert.equal(reads, 0); assert.equal(traps, 0);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(lease.consume(token), true);
});

test('poisons host-clock reentry without deferred work', async () => {
    let lease: ReturnType<ReturnType<typeof fixture>['lease']> | null = null; let armed = false;
    const state = fixture(() => { if (armed) lease?.issue(); return 1_000; }); lease = state.lease(); armed = true;
    assert.equal(lease.issue(), null); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(lease.issue(), null);
});
