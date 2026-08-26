/* @Codex */
import assert from 'node:assert/strict';
import { copyFileSync, unlinkSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDocumentSynthesisMultiSourcePrompt } from './document-synthesis-multi-source-prompt.ts';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import {
    createDocumentSynthesisSourceSetCurrentnessOwner,
    DocumentSynthesisSourceSetCurrentnessOwnerConfigurationError,
    resolveDocumentSynthesisSourceSetCurrentnessAccessor,
    resolveDocumentSynthesisSourceSetExecutionInputAccessor,
} from './document-synthesis-source-set-currentness-owner.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession } from '../../security/server-session.ts';

const USER = { id: ['synthetic', 'currentness', 'user'].join('-'), username: ['synthetic', 'currentness', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.currentness', ambulatoryId: 'ambulatory.synthetic.currentness' };
const n = (value: number | string) => BigInt(value);

afterEach(() => clearAllSessions());

function sourceSet(epoch = n(3), revoked = n(5), revision = n(7), freshness = n(11), reference = 'document.synthetic.currentness', sourceText = 'Synthetic source text') {
    const result = captureDocumentSynthesisSourceSet({
        sources: [{ documentSourceRef: reference, documentRevision: revision, documentFreshnessEpoch: freshness, sourceText }],
        sourceSetEpoch: epoch, revocationGeneration: revoked,
    });
    assert.equal(result.status, 'available');
    if (result.status !== 'available') throw new Error('expected synthetic source set');
    return result.sourceSet;
}

function prompt(sourceSetValue: ReturnType<typeof sourceSet>): string {
    const result = buildDocumentSynthesisMultiSourcePrompt(sourceSetValue);
    assert.equal(result.status, 'available');
    if (result.status !== 'available') throw new Error('expected synthetic prompt');
    return result.prompt;
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

test('resolves only its branded same-owner capsule into one atomic execution-input accessor', () => {
    const first = ownerWithSelection(); const second = ownerWithSelection(); const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: first.owner, session: first.session, sourceSet: sourceSet() }));
    const accessor = resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, first.owner, first.session);
    assert.ok(accessor); assert.equal(accessor instanceof Promise, false); assert.ok(accessor.snapshot());
    const executionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, first.owner, first.session);
    assert.ok(executionInput); assert.equal(executionInput instanceof Promise, false); assert.deepEqual(Object.keys(executionInput), ['snapshotExecutionInput']); assert.equal(Object.getPrototypeOf(executionInput), null); assert.equal(Object.isFrozen(executionInput), true);
    const snapshot = executionInput.snapshotExecutionInput(); assert.ok(snapshot); assert.equal(Object.getPrototypeOf(snapshot), null); assert.equal(Object.isFrozen(snapshot), true); assert.deepEqual(Object.keys(snapshot), ['currentness', 'prompt']); assert.equal(snapshot.prompt, prompt(sourceSet())); assert.equal(snapshot.currentness.sourceSetEpoch, n(3));
    assert.equal(resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, second.owner, second.session), null);
    assert.equal(resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, second.owner, second.session), null);
    let reads = 0; let traps = 0;
    const forged = Object.freeze({ snapshot() { reads += 1; return null; }, transition() { reads += 1; return false; }, revoke() { reads += 1; }, dispose() { reads += 1; } });
    const executionForged = Object.freeze({ snapshotExecutionInput() { reads += 1; return null; } });
    const proxied = new Proxy(capsule, { get() { traps += 1; throw new Error('trap'); } });
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'WeakSet');
    try { Object.defineProperty(globalThis, 'WeakSet', { configurable: true, value: class { } }); for (const value of [forged, executionForged, Object.freeze({ ...capsule }), Object.freeze({ ...executionInput }), proxied, Object.freeze({ then() {} })]) { assert.equal(resolveDocumentSynthesisSourceSetCurrentnessAccessor(value, first.owner, first.session), null); assert.equal(resolveDocumentSynthesisSourceSetExecutionInputAccessor(value, first.owner, first.session), null); } assert.ok(resolveDocumentSynthesisSourceSetCurrentnessAccessor(capsule, first.owner, first.session)); assert.ok(resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, first.owner, first.session)); }
    finally { Object.defineProperty(globalThis, 'WeakSet', prior!); }
    assert.equal(reads, 0); assert.equal(traps, 0);
});

test('rejects a separately evaluated module capsule before any member access', async () => {
    const state = ownerWithSelection(); const authentic = sourceSet();
    const sourcePath = fileURLToPath(new URL('./document-synthesis-source-set-currentness-owner.ts', import.meta.url));
    const foreignPath = fileURLToPath(new URL('./document-synthesis-source-set-currentness-owner.cross-module-fixture.ts', import.meta.url));
    copyFileSync(sourcePath, foreignPath);
    try {
        const foreign = await import(foreignPath) as typeof import('./document-synthesis-source-set-currentness-owner.ts');
        const foreignCapsule = foreign.createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: state.owner, session: state.session, sourceSet: authentic }));
        assert.equal(resolveDocumentSynthesisSourceSetExecutionInputAccessor(foreignCapsule, state.owner, state.session), null);
    } finally { unlinkSync(foreignPath); }
});

test('uses captured execution-input intrinsics after broad post-import poisoning without then or deferred work', () => {
    const state = ownerWithSelection(); const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: state.owner, session: state.session, sourceSet: sourceSet() }));
    const priorCreate = Object.getOwnPropertyDescriptor(Object, 'create'); const priorFreeze = Object.getOwnPropertyDescriptor(Object, 'freeze'); const priorOwnKeys = Object.getOwnPropertyDescriptor(Reflect, 'ownKeys'); const priorThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    try {
        Object.defineProperty(Object, 'create', { configurable: true, value() { throw new Error('ambient Object.create'); } });
        Object.defineProperty(Object, 'freeze', { configurable: true, value() { throw new Error('ambient Object.freeze'); } });
        Object.defineProperty(Reflect, 'ownKeys', { configurable: true, value() { throw new Error('ambient Reflect.ownKeys'); } });
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; throw new Error('ambient then'); } });
        const accessor = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, state.owner, state.session); const input = accessor?.snapshotExecutionInput();
        assert.equal(input?.prompt, prompt(sourceSet())); assert.equal(input?.currentness.sourceSetEpoch, n(3)); assert.equal(input instanceof Promise, false);
    } finally {
        Object.defineProperty(Object, 'create', priorCreate!); Object.defineProperty(Object, 'freeze', priorFreeze!); Object.defineProperty(Reflect, 'ownKeys', priorOwnKeys!);
        if (priorThen) Object.defineProperty(Object.prototype, 'then', priorThen); else Reflect.deleteProperty(Object.prototype, 'then');
    }
    assert.equal(reads, 0);
});

test('atomically binds each returned currentness-and-prompt pair to one exact authentic source set', () => {
    const { session, owner } = ownerWithSelection();
    const alpha = sourceSet(n(3), n(5), n(7), n(11), 'document.synthetic.currentness', 'Alpha source text');
    const beta = sourceSet(n(4), n(5), n(7), n(11), 'document.synthetic.currentness', 'Beta source text');
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: alpha }));
    const executionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, owner, session);
    assert.ok(executionInput); assert.deepEqual(Object.keys(executionInput), ['snapshotExecutionInput']); assert.notEqual(prompt(alpha), prompt(beta));
    const alphaInput = executionInput.snapshotExecutionInput(); assert.ok(alphaInput); assert.equal(alphaInput.prompt, prompt(alpha)); assert.equal(alphaInput.currentness.sourceSetEpoch, n(3));
    assert.equal(capsule.transition(beta), true);
    const betaInput = executionInput.snapshotExecutionInput(); assert.ok(betaInput); assert.equal(betaInput.prompt, prompt(beta)); assert.equal(betaInput.currentness.sourceSetEpoch, n(4));
    assert.equal(alphaInput.prompt, prompt(alpha)); assert.equal(alphaInput.currentness.sourceSetEpoch, n(3)); assert.notDeepEqual(alphaInput, betaInput);
    assert.equal(capsule.transition(alpha), false);
    assert.deepEqual(executionInput.snapshotExecutionInput(), betaInput);
    assert.equal(capsule.transition(Object.freeze({})), false);
    assert.deepEqual(executionInput.snapshotExecutionInput(), betaInput);
});

test('requires a strictly increasing source-set epoch and nondecreasing revocation generation', () => {
    const { session, owner } = ownerWithSelection();
    const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: sourceSet() }));
    assert.equal(capsule.transition(sourceSet(n(4), n(5), n(8))), true);
    assert.deepEqual(capsule.snapshot()?.sources[0] && { ...capsule.snapshot()!.sources[0]! }, { label: 'S1', documentSourceRef: 'document.synthetic.currentness', documentRevision: n(8), documentFreshnessEpoch: n(11) });
    assert.equal(capsule.transition(sourceSet(n(3), n(5))), false);
    assert.equal(capsule.snapshot()?.sourceSetEpoch, n(4));
    const noRevocationRollback = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: sourceSet() }));
    assert.equal(noRevocationRollback.transition(sourceSet(n(4), n(4))), false);
    assert.equal(noRevocationRollback.snapshot()?.sourceSetEpoch, n(3));
});

test('rejects regressed source lineage while retaining the prior currentness and prompt pair', () => {
    const retains = (capsule: ReturnType<typeof createDocumentSynthesisSourceSetCurrentnessOwner>, owner: ReturnType<typeof ownerWithSelection>['owner'], session: ReturnType<typeof ownerWithSelection>['session'], stale: ReturnType<typeof sourceSet>, retry: ReturnType<typeof sourceSet>) => {
        const executionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, owner, session);
        const before = executionInput?.snapshotExecutionInput();
        assert.equal(capsule.transition(stale), false); assert.deepEqual(executionInput?.snapshotExecutionInput(), before);
        assert.equal(capsule.transition(retry), true);
    };
    const revision = ownerWithSelection(); const revisionCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: revision.owner, session: revision.session, sourceSet: sourceSet() }));
    retains(revisionCapsule, revision.owner, revision.session, sourceSet(n(4), n(5), n(6)), sourceSet(n(5), n(5), n(8)));
    const freshness = ownerWithSelection(); const freshnessCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: freshness.owner, session: freshness.session, sourceSet: sourceSet() }));
    retains(freshnessCapsule, freshness.owner, freshness.session, sourceSet(n(4), n(5), n(7), n(10)), sourceSet(n(5), n(5), n(8)));
    const aba = ownerWithSelection(); const abaCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: aba.owner, session: aba.session, sourceSet: sourceSet() }));
    assert.equal(abaCapsule.transition(sourceSet(n(4), n(5), n(1), n(1), 'document.synthetic.currentness.b')), true);
    retains(abaCapsule, aba.owner, aba.session, sourceSet(n(5), n(5), n(6), n(10)), sourceSet(n(6), n(5), n(8)));
    const mixed = ownerWithSelection(); const mixedCapsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: mixed.owner, session: mixed.session, sourceSet: sourceSet() }));
    assert.equal(mixedCapsule.transition(captureMixed(n(4), n(8), n(12))), true);
    retains(mixedCapsule, mixed.owner, mixed.session, captureMixed(n(5), n(7), n(13)), sourceSet(n(6), n(5), n(9)));
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
    const executionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, state.owner, state.session); assert.ok(executionInput);
    capsule.revoke(); assert.equal(capsule.snapshot(), null); assert.equal(executionInput.snapshotExecutionInput(), null);
    const disposed = ownerWithSelection(); const disposal = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: disposed.owner, session: disposed.session, sourceSet: sourceSet() }));
    const disposedExecutionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(disposal, disposed.owner, disposed.session); assert.ok(disposedExecutionInput);
    disposal.dispose(); assert.equal(disposal.snapshot(), null); assert.equal(disposedExecutionInput.snapshotExecutionInput(), null);
    const reselection = ownerWithSelection(); const afterSelection = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: reselection.owner, session: reselection.session, sourceSet: sourceSet() }));
    const reselectionExecutionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(afterSelection, reselection.owner, reselection.session); assert.ok(reselectionExecutionInput);
    reselection.owner.issueSelection({ expectedEpoch: 1, ...PAIR }); assert.equal(afterSelection.snapshot(), null); assert.equal(reselectionExecutionInput.snapshotExecutionInput(), null);
    let now = 1_000; const expiring = ownerWithSelection(() => now);
    const expiry = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: expiring.owner, session: expiring.session, sourceSet: sourceSet(n(4)) }));
    const expiringExecutionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(expiry, expiring.owner, expiring.session); assert.ok(expiringExecutionInput);
    now = expiring.session.expiresAt; assert.equal(expiry.snapshot(), null); assert.equal(expiringExecutionInput.snapshotExecutionInput(), null);
    const loggedOut = ownerWithSelection(); const logout = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: loggedOut.owner, session: loggedOut.session, sourceSet: sourceSet() }));
    const logoutExecutionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(logout, loggedOut.owner, loggedOut.session); assert.ok(logoutExecutionInput);
    deleteSession(loggedOut.session.id); assert.equal(logout.snapshot(), null); assert.equal(logoutExecutionInput.snapshotExecutionInput(), null);
    const restarted = ownerWithSelection(); const restart = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: restarted.owner, session: restarted.session, sourceSet: sourceSet() }));
    const restartedExecutionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(restart, restarted.owner, restarted.session); assert.ok(restartedExecutionInput);
    clearAllSessions(); assert.equal(restart.snapshot(), null); assert.equal(restartedExecutionInput.snapshotExecutionInput(), null);
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

test('rejects reentry through the owner clock without publishing a partial replacement or post-return work', () => {
    let capsule: ReturnType<typeof createDocumentSynthesisSourceSetCurrentnessOwner> | null = null;
    let armed = false;
    const before = sourceSet(); const next = sourceSet(n(4), n(5), n(8), n(11), 'document.synthetic.currentness', 'Replacement text');
    const state = ownerWithSelection(() => { if (armed) capsule?.transition(next); return 1_000; });
    capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner: state.owner, session: state.session, sourceSet: before }));
    const executionInput = resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, state.owner, state.session); assert.ok(executionInput);
    armed = true; assert.equal(capsule.transition(next), false); armed = false;
    assert.equal(executionInput.snapshotExecutionInput()?.currentness.sourceSetEpoch, n(3)); assert.equal(executionInput.snapshotExecutionInput()?.prompt, prompt(before));
});
