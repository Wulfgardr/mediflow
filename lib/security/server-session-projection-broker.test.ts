/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { type SmartImportProjection } from '../smart-import-projection.ts';
import { createTypedProjectionBroker, ProjectionBrokerError } from '../typed-projection-broker.ts';
import {
    bindProjectionBrokerToActiveWebSessionResource,
    bindProjectionBrokerToServerSession,
    ServerSessionProjectionBrokerBindingError,
} from './server-session-projection-broker.ts';
import {
    clearAllSessions,
    createSession,
    deleteSession,
    getSession,
    mintActiveWebSessionResourcePort,
    releaseActiveWebSessionResourcePort,
    retireServerSessionForApplicationLock,
    retireServerSessionForLogout,
    resolveActiveWebServerSession,
} from './server-session';
import { begin as beginWebAuthSession, issue as issueWebAuthSession } from './web-auth-session-issuer';

const NOW = '2026-08-22T12:00:00.000Z';
const REF = 'synthetic-1234567890abcdef';
const SYNTHETIC_USER_ID = ['synthetic', 'user'].join('-');
const SYNTHETIC_USERNAME = ['synthetic', 'clinician'].join('-');
let sequence = 0;

afterEach(() => clearAllSessions());

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
    const attempt = beginWebAuthSession('login'); assert.ok(attempt);
    const issued = issueWebAuthSession(attempt, { id, username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(issued);
    const session = resolveActiveWebServerSession(issued.sessionId); assert.ok(session);
    const resourcePort = mintActiveWebSessionResourcePort(session); assert.ok(resourcePort);
    return { resourcePort, session, sessionId: issued.sessionId };
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

test('server session deletion revokes its bound broker before the next consume', () => {
    const session = createSession({ id: SYNTHETIC_USER_ID, username: SYNTHETIC_USERNAME, role: 'clinician' });
    const boundary = createBoundary(`session.${session.id}`);
    const handle = ingest(boundary);
    bindProjectionBrokerToServerSession(session.id, boundary.control);

    deleteSession(session.id);

    assert.equal(getSession(session.id), null);
    assertRevoked(boundary, handle);
});

test('missing or expired sessions leave no consumable unowned broker', () => {
    for (const sessionId of ['missing-session', 'expired-session']) {
        const boundary = createBoundary(`session.${REF}-${sessionId}`);
        const handle = ingest(boundary);
        if (sessionId === 'expired-session') {
            const session = createSession({ id: SYNTHETIC_USER_ID, username: SYNTHETIC_USERNAME, role: 'clinician' });
            session.expiresAt = 0;
            assert.throws(
                () => bindProjectionBrokerToServerSession(session.id, boundary.control),
                ServerSessionProjectionBrokerBindingError,
            );
        } else {
            assert.throws(
                () => bindProjectionBrokerToServerSession(sessionId, boundary.control),
                ServerSessionProjectionBrokerBindingError,
            );
        }
        assertRevoked(boundary, handle);
    }
});

test('ACTIVE Web retirement revokes the bound broker exactly once', () => {
    const cases = [
        ['delete', (active: ReturnType<typeof activeResource>) => retireServerSessionForLogout(active.sessionId)],
        ['lock', (active: ReturnType<typeof activeResource>) => retireServerSessionForApplicationLock(active.sessionId)],
    ] as const;
    for (const [reason, retire] of cases) {
        const active = activeResource(`synthetic-broker-${reason}`);
        const counted = countingControl();
        bindProjectionBrokerToActiveWebSessionResource(active.resourcePort, counted.control);
        retire(active); retire(active);
        assert.equal(counted.calls(), 1, reason);
        assert.equal(releaseActiveWebSessionResourcePort(active.resourcePort), false, reason);
    }
});

test('explicit unregister is idempotent and does not revoke the broker', () => {
    const first = activeResource('synthetic-broker-first'); const firstControl = countingControl();
    const unregister = bindProjectionBrokerToActiveWebSessionResource(first.resourcePort, firstControl.control);
    unregister(); unregister(); retireServerSessionForLogout(first.sessionId);
    assert.equal(firstControl.calls(), 0);
    assert.equal(releaseActiveWebSessionResourcePort(first.resourcePort), false);
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
        assert.equal(releaseActiveWebSessionResourcePort(active.resourcePort), true);
        retireServerSessionForLogout(active.sessionId);
        const outcomes = [
            () => { throw new Error('synthetic'); },
            () => Promise.reject(new Error('synthetic')),
            () => Object.defineProperty({}, 'then', { get() { reads += 1; throw new Error('synthetic'); } }),
        ];
        for (let index = 0; index < outcomes.length; index += 1) {
            const denied = activeResource(`synthetic-broker-denied-${index}`);
            assert.equal(releaseActiveWebSessionResourcePort(denied.resourcePort), true);
            const counted = countingControl(outcomes[index]);
            assert.throws(() => bindProjectionBrokerToActiveWebSessionResource(denied.resourcePort, counted.control), ServerSessionProjectionBrokerBindingError);
            assert.equal(counted.calls(), 1); assert.equal(releaseActiveWebSessionResourcePort(denied.resourcePort), false);
            retireServerSessionForLogout(denied.sessionId);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual([unhandled, reads], [0, 0]);
    } finally { process.off('unhandledRejection', listener); }
});
