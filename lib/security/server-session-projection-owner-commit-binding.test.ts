/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createFullPortProjectionOwnerProcessOwner } from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import {
    issueSyntheticWebSession, retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({
    id: 'synthetic-user', username: ['synthetic', 'clinician'].join('-'), role: 'clinician',
});
const PAIR = Object.freeze({
    patientId: 'patient.synthetic.commit.01', ambulatoryId: 'ambulatory.synthetic.commit.01',
});
const sessions = new Set<ServerSession>();
let sequence = 0;

function session(): ServerSession {
    const value = issueSyntheticWebSession(USER, `projection-commit-binding-${sequence += 1}`);
    sessions.add(value);
    return value;
}

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function fixture() {
    const value = session();
    let now = value.createdAt;
    let patientVersion = 7;
    const processOwner = createFullPortProjectionOwnerProcessOwner({
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion }),
        clock: () => now,
    });
    const owner = processOwner.registry.acquire(value);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let scope: object | null = null;
    assert.equal(processOwner.selectionLifecycleController.withCurrentSelection(
        value, (candidate) => { scope = candidate; },
    ), true);
    assert.ok(scope);
    const expected = record({
        webSessionId: value.id,
        sessionRef: lease.sessionRef,
        patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef,
        leaseRef: lease.leaseRef,
        selectionEpoch: lease.selectionEpoch,
        patientVersion,
    });
    return {
        processOwner, value, lease, scope, expected,
        setNow(candidate: number) { now = candidate; },
        setPatientVersion(candidate: number) { patientVersion = candidate; },
    };
}

afterEach(() => {
    for (const value of sessions) retireSyntheticWebSession(value);
    sessions.clear();
});

test('private commit binding resolves one current opaque scope to the exact canonical clinical context', () => {
    const current = fixture();
    let binding: unknown = null;
    assert.equal(current.processOwner.selectionCommitBindingController.withCurrentCommitBinding(
        current.scope,
        current.expected,
        (candidate) => { binding = candidate; },
    ), true);
    assert.ok(binding && typeof binding === 'object');
    assert.equal(Object.getPrototypeOf(binding), null);
    assert.equal(Object.isFrozen(binding), true);
    assert.deepEqual(Reflect.ownKeys(binding), ['patientId', 'ambulatoryId', 'patientVersion']);
    assert.deepEqual(binding, record({ ...PAIR, patientVersion: 7 }));
});

test('foreign scope, non-closed expected records, and any locator tuple or version mismatch stay inert', () => {
    const current = fixture();
    const controller = current.processOwner.selectionCommitBindingController;
    let callbacks = 0;
    const operation = () => { callbacks += 1; };
    const reordered = record({
        sessionRef: current.expected.sessionRef,
        webSessionId: current.expected.webSessionId,
        patientRef: current.expected.patientRef,
        ambulatoryRef: current.expected.ambulatoryRef,
        leaseRef: current.expected.leaseRef,
        selectionEpoch: current.expected.selectionEpoch,
        patientVersion: current.expected.patientVersion,
    });
    const accessor = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(current.expected)) {
        Object.defineProperty(accessor, key, {
            get: () => Reflect.get(current.expected, key), enumerable: true, configurable: false,
        });
    }
    Object.freeze(accessor);
    const malformed: unknown[] = [
        Object.freeze({ ...current.expected }),
        Object.assign(Object.create(null), current.expected),
        record({ ...current.expected, future: true }),
        reordered,
        accessor,
        new Proxy(current.expected, {}),
    ];

    assert.equal(controller.withCurrentCommitBinding(
        Object.freeze(Object.create(null)), current.expected, operation,
    ), false);
    for (const candidate of malformed) {
        assert.equal(controller.withCurrentCommitBinding(
            current.scope, candidate as typeof current.expected, operation,
        ), false);
    }
    for (const candidate of [
        record({ ...current.expected, webSessionId: 'f'.repeat(64) }),
        record({ ...current.expected, sessionRef: `ssr_${'1'.repeat(32)}` }),
        record({ ...current.expected, patientRef: `ptr_${'2'.repeat(32)}` }),
        record({ ...current.expected, ambulatoryRef: `abr_${'3'.repeat(32)}` }),
        record({ ...current.expected, leaseRef: `lsr_${'4'.repeat(32)}` }),
        record({ ...current.expected, selectionEpoch: current.expected.selectionEpoch + 1 }),
        record({ ...current.expected, patientVersion: current.expected.patientVersion + 1 }),
    ]) {
        assert.equal(controller.withCurrentCommitBinding(current.scope, candidate, operation), false);
    }
    assert.equal(callbacks, 0);
});

test('source version, Web resource, and expiry must each remain current before and after the callback', () => {
    const mutations = [
        (current: ReturnType<typeof fixture>) => current.setPatientVersion(8),
        (current: ReturnType<typeof fixture>) => current.setNow(current.lease.expiresAt),
        (current: ReturnType<typeof fixture>) => {
            retireSyntheticWebSession(current.value); sessions.delete(current.value);
        },
    ];
    for (const mutate of mutations) {
        for (const mutateInsideCallback of [false, true]) {
            const current = fixture(); let callbacks = 0;
            if (!mutateInsideCallback) mutate(current);
            assert.equal(current.processOwner.selectionCommitBindingController.withCurrentCommitBinding(
                current.scope, current.expected, () => {
                    callbacks += 1; if (mutateInsideCallback) mutate(current);
                },
            ), false);
            assert.equal(callbacks, mutateInsideCallback ? 1 : 0);
        }
    }
});

test('the final currentness fence still runs when the callback itself fails', () => {
    const current = fixture();
    let disposals = 0;
    const registration = current.processOwner.selectionLifecycleController.registerDependent(
        current.scope, () => { disposals += 1; },
    );
    assert.ok(registration);

    assert.equal(current.processOwner.selectionCommitBindingController.withCurrentCommitBinding(
        current.scope, current.expected, () => {
            current.setPatientVersion(8);
            throw new Error('synthetic commit callback failure');
        },
    ), false);
    assert.equal(disposals, 1);
    assert.equal(current.processOwner.selectionLifecycleController.confirmDependent(
        current.scope, registration,
    ), false);
});

test('the controller invokes only one synchronous callback and rejects reentry or authority expansion', () => {
    const current = fixture();
    const controller = current.processOwner.selectionCommitBindingController;
    let callbacks = 0;
    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected,
        async () => { callbacks += 100; }), false);
    assert.equal(callbacks, 0);

    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected, () => {
        callbacks += 1; return Promise.resolve();
    }), false);
    assert.equal(callbacks, 1);

    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected, () => {
        callbacks += 1; throw new Error('synthetic callback failure');
    }), false);
    assert.equal(callbacks, 2);

    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected, () => {
        callbacks += 1;
        assert.equal(controller.withCurrentCommitBinding(
            current.scope, current.expected, () => { callbacks += 100; },
        ), false);
    }), false);
    assert.equal(callbacks, 3);

    let registration: unknown = 'not-called';
    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected, () => {
        callbacks += 1;
        registration = current.processOwner.selectionLifecycleController.registerDependent(
            current.scope, () => undefined,
        );
    }), false);
    assert.equal(callbacks, 4);
    assert.equal(registration, null);

    assert.equal(controller.withCurrentCommitBinding(current.scope, current.expected, () => {
        callbacks += 1;
    }), true);
    assert.equal(callbacks, 5);
});

test('raw clinical identifiers exist only on the callback binding and no public owner surface expands', () => {
    const current = fixture();
    let callbackBinding: unknown = null;
    assert.equal(current.processOwner.selectionCommitBindingController.withCurrentCommitBinding(
        current.scope, current.expected, (binding) => { callbackBinding = binding; },
    ), true);
    assert.deepEqual(callbackBinding, record({ ...PAIR, patientVersion: 7 }));
    assert.equal(Reflect.get(current.expected, 'patientId'), undefined);
    assert.equal(Reflect.get(current.expected, 'ambulatoryId'), undefined);
    assert.equal(Reflect.get(current.processOwner.selectionCommitBindingController, 'patientId'), undefined);
    assert.equal(Reflect.get(current.processOwner.registry, 'selectionCommitBindingController'), undefined);
    assert.equal(Reflect.get(current.processOwner.registry, 'withCurrentCommitBinding'), undefined);
    const publicOwner = current.processOwner.registry.lookup(current.value.id);
    assert.ok(publicOwner);
    assert.equal(Reflect.get(publicOwner, 'selectionCommitBindingController'), undefined);
    assert.equal(Reflect.get(publicOwner, 'withCurrentCommitBinding'), undefined);
});
