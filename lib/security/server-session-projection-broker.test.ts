/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { type SmartImportProjection } from '../smart-import-projection.ts';
import { createTypedProjectionBroker, ProjectionBrokerError } from '../typed-projection-broker.ts';
import {
    bindProjectionBrokerToActiveWebSessionResource,
    ServerSessionProjectionBrokerBindingError,
} from './server-session-projection-broker.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';
import { mintResourcePort, releaseResourcePort, retire as retireWebAuthSession } from './web-auth-lifecycle-owner-adapter';

const NOW = '2026-08-22T12:00:00.000Z';
const REF = 'synthetic-1234567890abcdef';
const SYNTHETIC_USER_ID = ['synthetic', 'user'].join('-');
const SYNTHETIC_USERNAME = ['synthetic', 'clinician'].join('-');
let sequence = 0;
const finalSessions = new Set<ReturnType<typeof issueSyntheticWebSession>>();

afterEach(() => {
    for (const session of finalSessions) retireSyntheticWebSession(session);
    finalSessions.clear();
});

function createBoundary(sessionRef: string) {
    return createTypedProjectionBroker({
        sessionRef,
        ambulatoryRef: `ambulatory.${REF}`,
        patientRef: `patient.${REF}`,
        selectionEpoch: 1,
        leaseRef: `lease.${REF}`,
        expiresAt: '2026-08-22T12:10:00.000Z',
    }, {
        clock: () => NOW,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });
}

function projection(): SmartImportProjection {
    return {
        schemaVersion: 'mediflow.smart-import.projection.v1',
        capability: 'smart_import',
        patientRef: `patient.${REF}`,
        selectionEpoch: 1,
        patientRevision: 2,
        sourceRevision: 3,
        capturedAt: NOW,
        currentDiagnoses: [],
        currentActiveTherapies: [],
        therapyCandidateHints: [],
        sources: [{
            id: `source.${REF}`,
            kind: 'clinical-entry',
            label: 'Diario sintetico',
            date: NOW,
            content: 'Evidenza clinica interamente sintetica.',
        }],
    };
}

function ingest(boundary: ReturnType<typeof createBoundary>): string {
    sequence += 1;
    return boundary.ingest.ingest({ projection: projection(), requestId: `request.ingest-${REF}-${sequence}` });
}

function activeResource(id: string) {
    const session = issueSyntheticWebSession({ id, username: SYNTHETIC_USERNAME, role: 'clinician' },
        `projection-broker-${sequence += 1}`);
    finalSessions.add(session);
    const resourcePort = mintResourcePort(session); assert.ok(resourcePort);
    return { resourcePort, session };
}

type BrokerControl = Parameters<typeof bindProjectionBrokerToActiveWebSessionResource>[1];

function countingControl(revoke: () => unknown = () => undefined) {
    let calls = 0;
    return {
        control: { lock() {}, revoke() { calls += 1; return revoke(); }, changeSelection() {} } as BrokerControl,
        calls: () => calls,
    };
}

function assertRevoked(boundary: ReturnType<typeof createBoundary>, handle: string): void {
    sequence += 1;
    assert.throws(
        () => boundary.service.consume({
            handle,
            capability: 'smart_import',
            requestId: `request.consume-${REF}-${sequence}`,
        }),
        (error) => error instanceof ProjectionBrokerError
            && error.code === 'broker_revoked'
            && !/Evidenza|Diario/u.test(error.message),
    );
}

test('final-owner retirement revokes its bound broker before the next consume', () => {
    const active = activeResource(SYNTHETIC_USER_ID);
    const boundary = createBoundary(`session.${active.session.id}`);
    const handle = ingest(boundary);
    bindProjectionBrokerToActiveWebSessionResource(active.resourcePort, boundary.control);

    retireSyntheticWebSession(active.session);

    assertRevoked(boundary, handle);
});

test('released or retired final-owner resources leave no consumable unowned broker', () => {
    for (const state of ['released', 'retired'] as const) {
        const active = activeResource(`synthetic-broker-${state}`);
        const boundary = createBoundary(`session.${REF}-${state}`);
        const handle = ingest(boundary);
        if (state === 'released') assert.equal(releaseResourcePort(active.resourcePort), true);
        else retireSyntheticWebSession(active.session);
        assert.throws(
            () => bindProjectionBrokerToActiveWebSessionResource(active.resourcePort, boundary.control),
            ServerSessionProjectionBrokerBindingError,
        );
        assertRevoked(boundary, handle);
    }
});

test('ACTIVE Web retirement revokes the bound broker exactly once', () => {
    const cases = [
        ['delete', (active: ReturnType<typeof activeResource>) => retireWebAuthSession(active.session, 'delete')],
        ['dispose', (active: ReturnType<typeof activeResource>) => retireWebAuthSession(active.session, 'dispose')],
    ] as const;
    for (const [reason, retire] of cases) {
        const active = activeResource(`synthetic-broker-${reason}`);
        const counted = countingControl();
        bindProjectionBrokerToActiveWebSessionResource(active.resourcePort, counted.control);
        retire(active); retire(active);
        assert.equal(counted.calls(), 1, reason);
        assert.equal(releaseResourcePort(active.resourcePort), false, reason);
    }
});

test('explicit unregister is idempotent and does not revoke the broker', () => {
    const first = activeResource('synthetic-broker-first'); const firstControl = countingControl();
    const unregister = bindProjectionBrokerToActiveWebSessionResource(first.resourcePort, firstControl.control);
    unregister(); unregister(); retireSyntheticWebSession(first.session);
    assert.equal(firstControl.calls(), 0);
    assert.equal(releaseResourcePort(first.resourcePort), false);
});

test('registration failure is opaque, revokes once, and leaves the port terminal', async () => {
    let unhandled = 0; let reads = 0;
    const listener = () => { unhandled += 1; }; process.on('unhandledRejection', listener);
    try {
        const active = activeResource('synthetic-broker-hostile');
        for (const hostile of [{ ...active.resourcePort }, new Proxy(active.resourcePort, {})]) {
            const counted = countingControl();
            assert.throws(() => bindProjectionBrokerToActiveWebSessionResource(hostile as typeof active.resourcePort, counted.control), ServerSessionProjectionBrokerBindingError);
            assert.equal(counted.calls(), 1);
        }
        assert.equal(releaseResourcePort(active.resourcePort), true);
        retireSyntheticWebSession(active.session);
        const outcomes = [
            () => { throw new Error('synthetic'); },
            () => Promise.reject(new Error('synthetic')),
            () => Object.defineProperty({}, 'then', { get() { reads += 1; throw new Error('synthetic'); } }),
        ];
        for (let index = 0; index < outcomes.length; index += 1) {
            const denied = activeResource(`synthetic-broker-denied-${index}`);
            assert.equal(releaseResourcePort(denied.resourcePort), true);
            const counted = countingControl(outcomes[index]);
            assert.throws(() => bindProjectionBrokerToActiveWebSessionResource(denied.resourcePort, counted.control), ServerSessionProjectionBrokerBindingError);
            assert.equal(counted.calls(), 1); assert.equal(releaseResourcePort(denied.resourcePort), false);
            retireSyntheticWebSession(denied.session);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual([unhandled, reads], [0, 0]);
    } finally { process.off('unhandledRejection', listener); }
});
