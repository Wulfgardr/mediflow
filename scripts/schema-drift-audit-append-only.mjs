// WUL-724: the audit table and its append-only triggers are guard-only objects,
// absent from lib/schema.ts, so the declared-table comparison cannot see them.
// This probes the bootstrapped database behaviorally: a synthetic event must be
// insertable, and both UPDATE and DELETE on it must abort. Everything happens
// inside a savepoint that is always rolled back, so no row is left behind.

const APPEND_ONLY_ERROR = 'audit_events is append-only';
const SAVEPOINT = 'schema_drift_audit_probe';
const PROBE_EVENT_ID = 'schema-drift-audit-probe';

function attempt(db, sql) {
    try {
        db.prepare(sql).run(PROBE_EVENT_ID);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export function collectAuditAppendOnlyProblems(db) {
    const table = db
        .prepare("SELECT type FROM sqlite_master WHERE name = 'audit_events'")
        .get();
    if (table?.type !== 'table') {
        return ['MISSING AUDIT TABLE: "audit_events" is not a table in the fresh runtime bootstrap.'];
    }

    const problems = [];
    db.exec(`SAVEPOINT ${SAVEPOINT}`);
    try {
        const insertError = attempt(db, `
            INSERT INTO audit_events (
                event_id, event_type, occurred_at, outcome,
                actor_type, actor_ref, subject_type, source_surface
            ) VALUES (?, 'schema.drift.probe', 0, 'success', 'system', 'schema-drift', 'system', 'schema-drift')
        `);
        if (insertError !== null) {
            return [`INVALID AUDIT TABLE: a synthetic "audit_events" row cannot be inserted (${insertError}).`];
        }
        for (const [verb, sql] of [
            ['UPDATE', "UPDATE audit_events SET outcome = 'failure' WHERE event_id = ?"],
            ['DELETE', 'DELETE FROM audit_events WHERE event_id = ?'],
        ]) {
            const error = attempt(db, sql);
            if (error === null) {
                problems.push(`MISSING AUDIT GUARD: ${verb} on "audit_events" is not rejected by an append-only trigger.`);
            } else if (!error.includes(APPEND_ONLY_ERROR)) {
                problems.push(`INVALID AUDIT GUARD: ${verb} on "audit_events" failed for another reason (${error}).`);
            }
        }
    } finally {
        db.exec(`ROLLBACK TO ${SAVEPOINT}; RELEASE ${SAVEPOINT}`);
    }
    return problems;
}
