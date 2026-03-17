import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AUDIT_APPEND_ONLY_ERROR, ensureAuditSqliteSchema } from './audit-db';
import {
    AUDIT_SOURCE_SURFACE_HEADER,
    auditContextFromSession,
    auditSourceSurfaceFromRequest,
    sanitizeAuditMetadata,
    withAuditContextMetadata,
} from './audit';

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
