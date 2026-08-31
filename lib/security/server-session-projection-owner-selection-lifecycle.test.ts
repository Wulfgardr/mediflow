/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createFullPortProjectionOwnerProcessOwner } from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({ id: 'synthetic-user', username: 'synthetic-clinician', role: 'clinician' }); const PAIR = Object.freeze({ patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
const sessions = new Set<ServerSession>();
let sequence = 0;

function session(): ServerSession { const value = issueSyntheticWebSession(USER, `projection-selection-${sequence += 1}`);
    sessions.add(value); return value; }

afterEach(() => { for (const value of sessions) retireSyntheticWebSession(value); sessions.clear(); });

test('selection lifecycle publishes only opaque scope and registration behind the unchanged registry', () => {
    const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => pair });
    const { registry, selectionLifecycleController: lifecycle } = processOwner;
    const value = session(); const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null; let uses = 0;

    assert.deepEqual(Reflect.ownKeys(processOwner), ['registry', 'selectionLifecycleController']);
    assert.deepEqual(Reflect.ownKeys(lifecycle), [
        'withCurrentSelection', 'registerDependent', 'confirmDependent', 'unregisterDependent', 'withCurrentDependent',
    ]);
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    assert.ok(scope); assert.equal(Object.isFrozen(scope), true); assert.deepEqual(Reflect.ownKeys(scope), []);
    const registration = lifecycle.registerDependent(scope, () => { uses = -100; });
    assert.ok(registration); assert.equal(Object.isFrozen(registration), true); assert.deepEqual(Reflect.ownKeys(registration), []);
    assert.equal(lifecycle.confirmDependent(scope, registration), true);
    assert.equal(lifecycle.withCurrentDependent(scope, registration, () => { uses += 1; }), true);
    assert.equal(uses, 1);
    assert.equal(lifecycle.withCurrentSelection(value, (current) => {
        const withdrawn = lifecycle.registerDependent(current, () => { uses = -200; })!;
        assert.equal(lifecycle.unregisterDependent(current, withdrawn), true);
    }), false);
    assert.equal(Reflect.get(registry, 'selectionLifecycleController'), undefined);
    assert.equal(Reflect.get(owner, 'selectionLifecycleController'), undefined);
});

test('selection lifecycle snapshots every dependent before reselection, expiry, and disposal', () => {
    for (const terminal of ['reselection', 'expiry', 'dispose'] as const) {
        const value = session(); let now = value.createdAt; const calls: string[] = [];
        const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => pair, clock: () => now });
        const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(value);
        owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null;
        assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
        const registrations: object[] = [];
        registrations.push(lifecycle.registerDependent(scope, () => {
            calls.push('first'); assert.equal(lifecycle.unregisterDependent(scope, registrations[1]), false);
            assert.equal(lifecycle.withCurrentSelection(value, () => undefined), false);
        })!);
        registrations.push(lifecycle.registerDependent(scope, () => { calls.push('second'); throw new Error('synthetic cleanup'); })!);
        registrations.push(lifecycle.registerDependent(scope, () => { calls.push('third'); })!);

        if (terminal === 'reselection') owner.issueSelection({ expectedEpoch: 1, ...PAIR });
        else if (terminal === 'expiry') { now = value.expiresAt; assert.equal(lifecycle.withCurrentSelection(value, () => undefined), false); }
        else owner.dispose();
        assert.deepEqual(calls, ['first', 'second', 'third'], terminal);
        for (const registration of registrations) assert.equal(lifecycle.confirmDependent(scope, registration), false);
    }
});

test('selection lifecycle retirement is immediate and callback failure drains only its dependent', async () => {
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => pair });
    const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null;
    lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; });
    const calls: string[] = []; const first = lifecycle.registerDependent(scope, () => { calls.push('first'); })!;
    const sibling = lifecycle.registerDependent(scope, () => { calls.push('sibling'); })!;
    assert.equal(lifecycle.withCurrentDependent(scope, first, () => {
        assert.equal(lifecycle.withCurrentDependent(scope, first, () => undefined), false);
    }), false);
    assert.deepEqual(calls, ['first']); assert.equal(lifecycle.confirmDependent(scope, sibling), true);
    const promise = Promise.reject(new Error('synthetic async result'));
    assert.equal(lifecycle.withCurrentDependent(scope, sibling, () => promise as never), false);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(calls, ['first', 'sibling']);

    const immediate = lifecycle.registerDependent(scope, () => { calls.push('retired'); })!;
    retireSyntheticWebSession(value); sessions.delete(value);
    assert.deepEqual(calls, ['first', 'sibling', 'retired']);
    assert.equal(lifecycle.unregisterDependent(scope, immediate), false);
});

test('private retirement snapshots sibling dependents before a reentrant unregister', () => {
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => pair });
    const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null; const calls: string[] = [];
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    const sibling = lifecycle.registerDependent(scope, () => { calls.push('sibling'); }); assert.ok(sibling);
    assert.ok(lifecycle.registerDependent(scope, () => {
        calls.push('attacker'); assert.equal(lifecycle.unregisterDependent(scope, sibling), false);
    }));

    retireSyntheticWebSession(value); sessions.delete(value);
    assert.deepEqual(calls.sort(), ['attacker', 'sibling']);
});

test('reselection does not publish after a dependent disposes the owner reentrantly', () => {
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => pair });
    const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    assert.ok(lifecycle.registerDependent(scope, () => owner.dispose()));

    assert.throws(() => owner.issueSelection({ expectedEpoch: 1, ...PAIR }),
        (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');
    assert.throws(() => owner.snapshotSelectionEpoch(value),
        (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');
});
