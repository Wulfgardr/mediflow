/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createFullPortProjectionOwnerProcessOwner } from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import { resolve } from './web-auth-lifecycle-owner-adapter.ts';
import {
    issueSyntheticWebSession, issueSyntheticWebSessionContext, retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({ id: 'synthetic-user', username: 'synthetic-clinician', role: 'clinician' }); const PAIR = Object.freeze({ patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
const sessions = new Set<ServerSession>();
let sequence = 0;

const resolved = (pair: Readonly<{ patientId: string; ambulatoryId: string }>, patientVersion = 1) =>
    Object.freeze({ ...pair, patientVersion });

function session(): ServerSession { const value = issueSyntheticWebSession(USER, `projection-selection-${sequence += 1}`);
    sessions.add(value); return value; }

afterEach(() => { for (const value of sessions) retireSyntheticWebSession(value); sessions.clear(); });

test('selection lifecycle publishes only opaque scope and registration behind the unchanged registry', () => {
    const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair) });
    const { registry, selectionLifecycleController: lifecycle, selectionBindingController: binding,
        selectionCommitBindingController: commitBinding } = processOwner;
    const value = session(); const owner = registry.acquire(value);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null; let uses = 0;

    assert.deepEqual(Reflect.ownKeys(processOwner), [
        'registry', 'selectionLifecycleController', 'selectionBindingController', 'selectionCommitBindingController',
    ]);
    assert.deepEqual(Reflect.ownKeys(lease), [
        'sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef', 'expiresAt',
    ]);
    assert.equal(Reflect.get(lease, 'patientVersion'), undefined);
    assert.deepEqual(Reflect.ownKeys(lifecycle), [
        'withCurrentSelection', 'registerDependent', 'confirmDependent', 'unregisterDependent', 'withCurrentDependent',
    ]);
    assert.deepEqual(Reflect.ownKeys(binding), ['withCurrentDependentBinding']);
    assert.deepEqual(Reflect.ownKeys(commitBinding), ['withCurrentCommitBinding']);
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    assert.ok(scope); assert.equal(Object.isFrozen(scope), true); assert.deepEqual(Reflect.ownKeys(scope), []);
    const registration = lifecycle.registerDependent(scope, () => { uses = -100; });
    assert.ok(registration); assert.equal(Object.isFrozen(registration), true); assert.deepEqual(Reflect.ownKeys(registration), []);
    assert.equal(lifecycle.confirmDependent(scope, registration), true);
    let exposed: unknown = null;
    assert.equal(binding.withCurrentDependentBinding(scope, registration, (candidate) => { exposed = candidate; }), true);
    assert.ok(exposed && typeof exposed === 'object');
    assert.equal(Object.getPrototypeOf(exposed), null); assert.equal(Object.isFrozen(exposed), true);
    assert.deepEqual(Reflect.ownKeys(exposed), ['selection', 'patientVersion']);
    const hostBinding = exposed as { selection: Record<string, unknown>; patientVersion: number };
    assert.equal(hostBinding.patientVersion, 1);
    assert.equal(Object.getPrototypeOf(hostBinding.selection), null); assert.equal(Object.isFrozen(hostBinding.selection), true);
    assert.deepEqual(Reflect.ownKeys(hostBinding.selection), [
        'scopeIdentity', 'sessionRef', 'patientRef', 'ambulatoryRef', 'leaseRef', 'selectionEpoch', 'expiresAt',
    ]);
    assert.equal(hostBinding.selection.scopeIdentity, scope);
    assert.deepEqual(Object.fromEntries(Object.entries(hostBinding.selection).filter(([key]) => key !== 'scopeIdentity')), {
        sessionRef: lease.sessionRef, patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef,
        leaseRef: lease.leaseRef, selectionEpoch: lease.selectionEpoch, expiresAt: lease.expiresAt,
    });
    assert.equal(lifecycle.withCurrentDependent(scope, registration, () => { uses += 1; }), true);
    assert.equal(uses, 1);
    assert.equal(lifecycle.withCurrentSelection(value, (current) => {
        const withdrawn = lifecycle.registerDependent(current, () => { uses = -200; })!;
        assert.equal(lifecycle.unregisterDependent(current, withdrawn), true);
    }), false);
    assert.equal(Reflect.get(registry, 'selectionLifecycleController'), undefined);
    assert.equal(Reflect.get(registry, 'selectionBindingController'), undefined);
    assert.equal(Reflect.get(registry, 'selectionCommitBindingController'), undefined);
    assert.equal(Reflect.get(owner, 'selectionLifecycleController'), undefined);
    assert.equal(Reflect.get(owner, 'selectionBindingController'), undefined);
    assert.equal(Reflect.get(owner, 'selectionCommitBindingController'), undefined);
});

test('selection lifecycle accepts a fresh authenticated projection of the same current Web session', () => {
    const context = issueSyntheticWebSessionContext(USER, `projection-selection-${sequence += 1}`); sessions.add(context.session);
    const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair) });
    const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(context.session);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const refreshed = resolve(context.session.id, context.controlId);
    assert.equal(refreshed.status, 'active'); if (refreshed.status !== 'active') assert.fail('expected refreshed projection');
    assert.notEqual(refreshed.projection, context.session); let scope: unknown = null;
    assert.equal(lifecycle.withCurrentSelection(refreshed.projection as ServerSession, (candidate) => { scope = candidate; }), true);
    assert.ok(scope);
});

test('selection lifecycle snapshots every dependent before reselection, expiry, and disposal', () => {
    for (const terminal of ['reselection', 'expiry', 'dispose'] as const) {
        const value = session(); let now = value.createdAt; const calls: string[] = [];
        const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair), clock: () => now });
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

test('patient version drift denies private currentness, drains every dependent, and requires reselection', () => {
    const value = session(); let patientVersion = 3; let resolves = 0; const calls: string[] = [];
    const processOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => { resolves += 1; return resolved(pair, patientVersion); },
    });
    const { registry, selectionLifecycleController: lifecycle, selectionBindingController: binding } = processOwner;
    const owner = registry.acquire(value); const first = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    const firstRegistration = lifecycle.registerDependent(scope, () => { calls.push('first'); });
    const secondRegistration = lifecycle.registerDependent(scope, () => { calls.push('second'); });
    assert.ok(firstRegistration); assert.ok(secondRegistration);
    let observedVersion = 0;
    assert.equal(binding.withCurrentDependentBinding(scope, firstRegistration, (current) => {
        observedVersion = current.patientVersion;
    }), true);
    assert.equal(observedVersion, 3);

    patientVersion = 4;
    let callbacks = 0;
    assert.equal(binding.withCurrentDependentBinding(scope, firstRegistration, () => { callbacks += 1; }), false);
    assert.equal(callbacks, 0); assert.deepEqual(calls, ['first', 'second']);
    assert.equal(lifecycle.confirmDependent(scope, firstRegistration), false);
    assert.equal(lifecycle.confirmDependent(scope, secondRegistration), false);
    assert.throws(() => owner.dereferenceSelection(value, {
        sessionRef: first.sessionRef, selectionEpoch: first.selectionEpoch, patientRef: first.patientRef,
        ambulatoryRef: first.ambulatoryRef, leaseRef: first.leaseRef,
    }), (error: unknown) => (error as { code?: unknown }).code === 'stale_selection');

    const replacement = owner.issueSelection({ expectedEpoch: first.selectionEpoch, ...PAIR });
    assert.equal(replacement.selectionEpoch, 2);
    assert.ok(resolves >= 6);
    assert.equal(Reflect.get(replacement, 'patientVersion'), undefined);
});

test('public dereference rejects patient version drift and drains the private selection lifecycle', () => {
    const value = session(); let patientVersion = 1; const calls: string[] = [];
    const processOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => resolved(pair, patientVersion),
    });
    const { registry, selectionLifecycleController: lifecycle } = processOwner;
    const owner = registry.acquire(value); const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    const registration = lifecycle.registerDependent(scope, () => { calls.push('drained'); });
    assert.ok(registration);

    patientVersion = 2;
    assert.throws(() => owner.dereferenceSelection(value, {
        sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef,
    }), (error: unknown) => (error as { code?: unknown }).code === 'stale_selection');
    assert.deepEqual(calls, ['drained']);
    assert.equal(lifecycle.confirmDependent(scope, registration), false);
});

test('every private selection currentness path rereads the same canonical patient version source', () => {
    const value = session(); let patientVersion = 7; let resolves = 0; let disposals = 0;
    const processOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => { resolves += 1; return resolved(pair, patientVersion); },
    });
    const { registry, selectionLifecycleController: lifecycle, selectionBindingController: binding } = processOwner;
    const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null; let before = resolves;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    assert.ok(resolves > before);

    before = resolves;
    const registration = lifecycle.registerDependent(scope, () => { disposals += 1; });
    assert.ok(registration); assert.ok(resolves > before);
    before = resolves;
    assert.equal(lifecycle.confirmDependent(scope, registration), true); assert.ok(resolves > before);
    before = resolves;
    assert.equal(lifecycle.withCurrentDependent(scope, registration, () => undefined), true); assert.ok(resolves > before);
    before = resolves;
    assert.equal(binding.withCurrentDependentBinding(scope, registration, () => undefined), true); assert.ok(resolves > before);

    patientVersion = 8; before = resolves;
    assert.equal(lifecycle.confirmDependent(scope, registration), false);
    assert.ok(resolves > before); assert.equal(disposals, 1);
});

test('binding final fence drains the exact dependent when patient version changes inside its callback', () => {
    const value = session(); let patientVersion = 1; const calls: string[] = [];
    const processOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => resolved(pair, patientVersion),
    });
    const { registry, selectionLifecycleController: lifecycle, selectionBindingController: binding } = processOwner;
    const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    const exact = lifecycle.registerDependent(scope, () => { calls.push('exact'); });
    const sibling = lifecycle.registerDependent(scope, () => { calls.push('sibling'); });
    assert.ok(exact); assert.ok(sibling);
    const foreign = Object.freeze(Object.create(null)); let callbackRuns = 0;
    assert.equal(binding.withCurrentDependentBinding(scope, foreign, () => { callbackRuns += 100; }), false);
    assert.equal(binding.withCurrentDependentBinding(scope, exact, () => { callbackRuns += 1; patientVersion = 2; }), false);
    assert.equal(callbackRuns, 1); assert.deepEqual(calls, ['exact', 'sibling']);
});

test('selection lifecycle retirement is immediate and callback failure drains only its dependent', async () => {
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair) });
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
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair) });
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
    const value = session(); const processOwner = createFullPortProjectionOwnerProcessOwner({ resolve: (_session, pair) => resolved(pair) });
    const { registry, selectionLifecycleController: lifecycle } = processOwner; const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR }); let scope: object | null = null;
    assert.equal(lifecycle.withCurrentSelection(value, (candidate) => { scope = candidate; }), true);
    assert.ok(lifecycle.registerDependent(scope, () => owner.dispose()));

    assert.throws(() => owner.issueSelection({ expectedEpoch: 1, ...PAIR }),
        (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');
    assert.throws(() => owner.snapshotSelectionEpoch(value),
        (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');
});
