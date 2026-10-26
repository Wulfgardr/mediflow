import type Database from 'better-sqlite3';

export function ensureTherapyStatusCommandSchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS therapy_status_commands (
        command_id TEXT PRIMARY KEY NOT NULL CHECK (length(command_id) = 36),
        protocol TEXT NOT NULL CHECK (protocol = 'therapy.status.change.v1'),
        archive_generation TEXT NOT NULL CHECK (length(archive_generation) = 36),
        actor_ref TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 256),
        patient_id TEXT NOT NULL CHECK (length(patient_id) BETWEEN 1 AND 256),
        therapy_id TEXT NOT NULL CHECK (length(therapy_id) BETWEEN 1 AND 256),
        expected_version INTEGER NOT NULL CHECK (typeof(expected_version) = 'integer' AND expected_version BETWEEN 1 AND 9007199254740990),
        target TEXT CHECK (target IN ('active','suspended','completed')),
        outcome TEXT NOT NULL CHECK (outcome IN ('applied','rejected','closed')),
        reason TEXT CHECK (reason = 'version_conflict'),
        committed_at INTEGER NOT NULL CHECK (typeof(committed_at) = 'integer' AND committed_at BETWEEN 0 AND 8640000000000),
        result_version INTEGER, result_end_date INTEGER, audit_event_id TEXT, audit_snapshot TEXT,
        CHECK ((outcome = 'closed' AND target IS NULL AND reason IS NULL AND result_version IS NULL AND result_end_date IS NULL AND audit_event_id IS NULL AND audit_snapshot IS NULL)
            OR (outcome = 'rejected' AND target IS NOT NULL AND reason IS NOT NULL AND result_version IS NULL AND result_end_date IS NULL AND audit_event_id IS NULL AND audit_snapshot IS NULL)
            OR (outcome = 'applied' AND target IS NOT NULL AND reason IS NULL AND result_version = expected_version + 1
                AND typeof(result_version) = 'integer' AND audit_event_id IS NOT NULL AND audit_snapshot IS NOT NULL
                AND (result_end_date IS NULL OR typeof(result_end_date) = 'integer')))
    );
    CREATE TRIGGER IF NOT EXISTS therapy_status_commands_no_update BEFORE UPDATE ON therapy_status_commands
        BEGIN SELECT RAISE(ABORT, 'therapy status commands are append only'); END;
    CREATE TRIGGER IF NOT EXISTS therapy_status_commands_no_delete BEFORE DELETE ON therapy_status_commands
        BEGIN SELECT RAISE(ABORT, 'therapy status commands are append only'); END;`);
}
