import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AUDIT_APPEND_ONLY_ERROR, ensureAuditSqliteSchema } from './audit-db';
import {
    AUDIT_SOURCE_SURFACE_HEADER,
    auditContextFromRequest,
    auditContextFromSession,
    auditSourceSurfaceFromRequest,
    buildAuditWriteInputFromRequest,
    sanitizeAuditMetadata,
    summarizeAuditEvents,
    withAuditContextMetadata,
    type AuditRecord,
} from './audit';
import { hasValidLocalApiToken } from './local-api-auth';

function buildAuditRecord(overrides: Partial<AuditRecord>): AuditRecord {
    return {
        schemaVersion: 1,
        eventId: 'evt-1',
        eventType: 'patient.updated',
        occurredAt: '2026-03-18T10:00:00.000Z',
        outcome: 'success',
        actorType: 'user',
        actorRef: 'user-1',
        subjectType: 'patient',
        subjectRef: 'patient-1',
        sourceSurface: 'web',
        requestId: 'req-1',
        redactedMetadata: null,
        createdAt: '2026-03-18T10:00:00.000Z',
        ...overrides,
    };
}

test('sanitizeAuditMetadata keeps only the PHI-safe whitelist', () => {
    const metadata = sanitizeAuditMetadata({
        changedFields: ['firstName', 'notes', 'documentInsights', 'notes'],
        resourceVersion: 3,
        counts: 1,
        flags: ['admin', 'contains phi?', 'admin'],
        reasonCode: 'invalid credentials',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    assert.deepEqual(metadata, {
        changedFields: ['firstName', 'notes', 'documentInsights'],
        resourceVersion: 3,
        counts: 1,
        flags: ['admin', 'contains_phi_'],
        reasonCode: 'invalid_credentials',
    });
});

test('audit schema blocks update and delete to preserve append-only semantics', () => {
    const sqlite = new Database(':memory:');
    ensureAuditSqliteSchema(sqlite);

    sqlite.prepare(`
        INSERT INTO audit_events (
            event_id, schema_version, event_type, occurred_at, outcome,
            actor_type, actor_ref, subject_type, source_surface, redacted_metadata
        ) VALUES (
            @eventId, 1, 'patient.updated', unixepoch(), 'success',
            'user', 'user-1', 'patient', 'web', '{"changedFields":["notes"]}'
        )
    `).run({ eventId: 'audit-1' });

    assert.throws(
        () => sqlite.prepare(`UPDATE audit_events SET outcome = 'failure' WHERE event_id = 'audit-1'`).run(),
        new RegExp(AUDIT_APPEND_ONLY_ERROR),
    );

    assert.throws(
        () => sqlite.prepare(`DELETE FROM audit_events WHERE event_id = 'audit-1'`).run(),
        new RegExp(AUDIT_APPEND_ONLY_ERROR),
    );
});

test('auditContextFromSession preserves the human actor for native requests', () => {
    assert.deepEqual(
        auditContextFromSession({
            id: 'native:user-1',
            userId: 'user-1',
            username: 'admin',
            role: 'admin',
            authChannel: 'native',
            createdAt: 0,
            expiresAt: 1,
        }),
        {
            actorType: 'user',
            actorRef: 'user-1',
            sourceSurface: 'native',
            authContext: 'local-token',
        },
    );

    assert.deepEqual(
        auditContextFromSession({
            id: 'local-api',
            userId: 'local-api',
            username: 'local-api',
            role: 'admin',
            authChannel: 'system',
            createdAt: 0,
            expiresAt: 1,
        }),
        {
            actorType: 'system',
            actorRef: 'local-api',
            sourceSurface: 'api',
            authContext: 'local-token',
        },
    );
});

test('auditSourceSurfaceFromRequest falls back to the default surface', () => {
    assert.equal(
        auditSourceSurfaceFromRequest(new Request('https://127.0.0.1/api/auth/login'), 'web'),
        'web',
    );
});

test('auditSourceSurfaceFromRequest accepts native surface markers', () => {
    const request = new Request('https://127.0.0.1/api/auth/login', {
        headers: {
            [AUDIT_SOURCE_SURFACE_HEADER]: 'native',
        },
    });

    assert.equal(auditSourceSurfaceFromRequest(request, 'web'), 'native');
});

test('withAuditContextMetadata appends the auth context flag', () => {
    assert.deepEqual(
        withAuditContextMetadata(
            {
                actorType: 'user',
                actorRef: 'user-1',
                sourceSurface: 'web',
                authContext: 'session',
            },
            {
                changedFields: ['notes'],
                flags: ['operator'],
            },
        ),
        {
            changedFields: ['notes'],
            flags: ['operator', 'auth:session'],
        },
    );
});

test('auditContextFromRequest marks shared routes as native only when a valid local token accompanies the session', () => {
    const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    process.env.MEDIFLOW_LOCAL_API_TOKEN = 'test-local-token';

    const request = new Request('https://127.0.0.1/api/settings', {
        headers: {
            Authorization: 'Bearer test-local-token',
        },
    });

    assert.deepEqual(
        auditContextFromRequest(request, {
            id: 'session-1',
            userId: 'user-1',
            username: 'admin',
            role: 'admin',
            authChannel: 'web',
            createdAt: 0,
            expiresAt: 1,
        }),
        {
            actorType: 'user',
            actorRef: 'user-1',
            sourceSurface: 'native',
            authContext: 'local-token',
        },
    );

    assert.deepEqual(
        auditContextFromRequest(request, null),
        {
            actorType: 'system',
            actorRef: 'local-api',
            sourceSurface: 'api',
            authContext: 'local-token',
        },
    );

    if (previousToken === undefined) {
        delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    } else {
        process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    }
});

test('local API token auth accepts Bearer and legacy headers but rejects raw Authorization tokens', () => {
    const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    process.env.MEDIFLOW_LOCAL_API_TOKEN = 'test-local-token';

    try {
        assert.equal(
            hasValidLocalApiToken(new Request('https://127.0.0.1/api/v1/patients', {
                headers: {
                    Authorization: 'Bearer test-local-token',
                },
            })),
            true,
        );

        assert.equal(
            hasValidLocalApiToken(new Request('https://127.0.0.1/api/v1/patients', {
                headers: {
                    Authorization: 'test-local-token',
                },
            })),
            false,
        );

        assert.equal(
            hasValidLocalApiToken(new Request('https://127.0.0.1/api/v1/patients', {
                headers: {
                    'x-mediflow-token': 'test-local-token',
                },
            })),
            true,
        );

        assert.equal(
            hasValidLocalApiToken(new Request('https://127.0.0.1/api/v1/patients', {
                headers: {
                    Authorization: 'Bearer wrong-token',
                },
            })),
            false,
        );
    } finally {
        if (previousToken === undefined) {
            delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
        } else {
            process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
        }
    }
});

test('buildAuditWriteInputFromRequest derives actor, request id, and PHI-safe metadata from the request context', () => {
    const previousToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    process.env.MEDIFLOW_LOCAL_API_TOKEN = 'test-local-token';

    const request = new Request('https://127.0.0.1/api/v1/patients/patient-1/therapies', {
        headers: {
            Authorization: 'Bearer test-local-token',
            'x-request-id': 'req-native-1',
        },
    });

    assert.deepEqual(
        buildAuditWriteInputFromRequest(
            request,
            {
                id: 'session-1',
                userId: 'user-1',
                username: 'admin',
                role: 'admin',
                authChannel: 'web',
                createdAt: 0,
                expiresAt: 1,
            },
            {
                eventType: 'therapy.updated',
                subjectType: 'therapy',
                subjectRef: 'therapy-1',
                redactedMetadata: {
                    changedFields: ['dosage'],
                },
            },
        ),
        {
            eventType: 'therapy.updated',
            outcome: 'success',
            actorType: 'user',
            actorRef: 'user-1',
            subjectType: 'therapy',
            subjectRef: 'therapy-1',
            sourceSurface: 'native',
            requestId: 'req-native-1',
            redactedMetadata: {
                changedFields: ['dosage'],
                flags: ['auth:local-token'],
            },
        },
    );

    if (previousToken === undefined) {
        delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    } else {
        process.env.MEDIFLOW_LOCAL_API_TOKEN = previousToken;
    }
});

test('summarizeAuditEvents groups PHI-safe operational KPIs', () => {
    const summary = summarizeAuditEvents([
        buildAuditRecord({}),
        buildAuditRecord({
            eventId: 'evt-2',
            occurredAt: '2026-03-18T11:00:00.000Z',
            outcome: 'failure',
            requestId: 'req-2',
            createdAt: '2026-03-18T11:00:00.000Z',
        }),
        buildAuditRecord({
            eventId: 'evt-3',
            eventType: 'auth.login.failed',
            occurredAt: '2026-03-18T12:00:00.000Z',
            outcome: 'denied',
            actorRef: 'anonymous',
            subjectType: 'session',
            subjectRef: null,
            sourceSurface: 'api',
            requestId: 'req-3',
            createdAt: '2026-03-18T12:00:00.000Z',
        }),
    ]);

    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.distinctActors, 2);
    assert.deepEqual(summary.outcomes, {
        success: 1,
        failure: 1,
        denied: 1,
    });
    assert.deepEqual(summary.sourceSurfaces, {
        web: 2,
        native: 0,
        api: 1,
        job: 0,
    });
    assert.deepEqual(summary.subjectTypes, {
        session: 1,
        patient: 2,
        ambulatory: 0,
        checkup: 0,
        entry: 0,
        therapy: 0,
        observation: 0,
        attachment: 0,
        prosthetic_prescription: 0,
        service_prescription: 0,
        service_prescription_item: 0,
        siss_handoff: 0,
        settings: 0,
        ai_review: 0,
    });
    assert.deepEqual(summary.topEventTypes, [
        { eventType: 'patient.updated', count: 2 },
        { eventType: 'auth.login.failed', count: 1 },
    ]);
    assert.equal(summary.isTruncated, false);
});
