/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { type SmartImportProjection } from '../smart-import-projection.ts';
import { createTypedProjectionBroker, ProjectionBrokerError } from '../typed-projection-broker.ts';
import {
    bindProjectionBrokerToServerSession,
    ServerSessionProjectionBrokerBindingError,
} from './server-session-projection-broker.ts';
import { clearAllSessions, createSession, deleteSession, getSession } from './server-session.ts';

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
