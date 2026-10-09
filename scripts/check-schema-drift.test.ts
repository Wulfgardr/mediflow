import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { collectAuditAppendOnlyProblems } from './schema-drift-audit-append-only.mjs';

// WUL-268 (STREAM A): happy-path test for the schema drift check. On a clean
// checkout, lib/schema.ts and the runtime bootstrap (drizzle migrations +
// applySchemaGuards) agree, so the check must exit 0 and print an OK line.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = path.join(HERE, 'check-schema-drift.mjs');

test('check:schema-drift passes on a clean checkout', () => {
    const result = spawnSync(process.execPath, [CHECK_SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env },
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(
        result.status,
        0,
        `expected exit 0 from check-schema-drift, got ${result.status}. Output:\n${output}`,
    );
    assert.match(output, /\[schema-drift\] OK:/);
});

// WUL-724: the drift check also probes the guard-only audit schema. These cases
// use in-memory databases only.
const AUDIT_TABLE = `
    CREATE TABLE audit_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_ref TEXT,
        source_surface TEXT NOT NULL,
        request_id TEXT,
        redacted_metadata TEXT,
        created_at INTEGER DEFAULT (unixepoch())
    );
`;
const trigger = (name: string, verb: string, body: string) =>
    `CREATE TRIGGER ${name} BEFORE ${verb} ON audit_events BEGIN ${body}; END;`;
const ABORT = "SELECT RAISE(ABORT, 'audit_events is append-only')";

function auditProblems(ddl: string): string[] {
    const db = new Database(':memory:');
    try {
        db.exec(ddl);
        const problems = collectAuditAppendOnlyProblems(db);
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").get()) {
            assert.deepEqual(db.prepare('SELECT count(*) AS count FROM audit_events').get(), { count: 0 });
        }
        return problems;
    } finally {
        db.close();
    }
}

test('audit probe accepts the append-only schema and leaves no row behind', () => {
    assert.deepEqual(auditProblems(
        AUDIT_TABLE
        + trigger('audit_events_no_update', 'UPDATE', ABORT)
        + trigger('audit_events_no_delete', 'DELETE', ABORT),
    ), []);
});

test('audit probe reports a missing table, a view in its place and an incompatible table', () => {
    assert.match(auditProblems('')[0], /^MISSING AUDIT TABLE/);
    assert.match(auditProblems('CREATE VIEW audit_events AS SELECT 1 AS event_id;')[0], /^MISSING AUDIT TABLE/);
    assert.match(auditProblems('CREATE TABLE audit_events (event_id TEXT);')[0], /^INVALID AUDIT TABLE/);
});

test('audit probe reports missing, inert and foreign guards separately for UPDATE and DELETE', () => {
    assert.deepEqual(auditProblems(AUDIT_TABLE).map((problem) => problem.slice(0, 27)), [
        'MISSING AUDIT GUARD: UPDATE',
        'MISSING AUDIT GUARD: DELETE',
    ]);
    const onlyUpdate = auditProblems(AUDIT_TABLE + trigger('audit_events_no_update', 'UPDATE', ABORT));
    assert.equal(onlyUpdate.length, 1);
    assert.match(onlyUpdate[0], /^MISSING AUDIT GUARD: DELETE/);
    const inert = auditProblems(
        AUDIT_TABLE
        + trigger('audit_events_no_update', 'UPDATE', 'SELECT 1')
        + trigger('audit_events_no_delete', 'DELETE', ABORT),
    );
    assert.equal(inert.length, 1);
    assert.match(inert[0], /^MISSING AUDIT GUARD: UPDATE/);
    const foreign = auditProblems(
        AUDIT_TABLE
        + trigger('audit_events_no_update', 'UPDATE', ABORT)
        + trigger('audit_events_no_delete', 'DELETE', "SELECT RAISE(ABORT, 'other reason')"),
    );
    assert.equal(foreign.length, 1);
    assert.match(foreign[0], /^INVALID AUDIT GUARD: DELETE/);
});
