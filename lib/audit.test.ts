import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AUDIT_APPEND_ONLY_ERROR, ensureAuditSqliteSchema } from './audit-db';
import { sanitizeAuditMetadata } from './audit';

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
