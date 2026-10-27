import type Database from 'better-sqlite3';

export function ensureAmbulatoryDestructiveCommandSchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS ambulatory_destructive_commands (
        command_id TEXT PRIMARY KEY NOT NULL CHECK (length(command_id)=36),
        protocol TEXT NOT NULL CHECK (protocol='ambulatory.destructive.v1'),
        operation TEXT NOT NULL CHECK (operation IN ('ambulatory.clear-test.v1','ambulatory.delete.v1')),
        original_archive_generation TEXT NOT NULL CHECK (length(original_archive_generation)=36),
        original_scope_id TEXT NOT NULL CHECK (length(original_scope_id) BETWEEN 1 AND 256),
        ambulatory_id TEXT NOT NULL CHECK (length(ambulatory_id) BETWEEN 1 AND 256),
        expected_version INTEGER NOT NULL CHECK (typeof(expected_version)='integer' AND expected_version BETWEEN 1 AND 9007199254740991),
        plan_digest TEXT NOT NULL CHECK (length(plan_digest)=64),
        actor_ref TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 256),
        device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 256),
        device_platform TEXT NOT NULL CHECK (device_platform IN ('macos','windows','linux','ios','ipados')),
        device_token_hash TEXT NOT NULL CHECK (length(device_token_hash)=64),
        outcome TEXT NOT NULL CHECK (outcome IN ('applied','rejected','closed')),
        reason TEXT CHECK (reason IN ('plan_changed','not_admissible')),
        committed_at INTEGER NOT NULL CHECK (typeof(committed_at)='integer' AND committed_at BETWEEN 0 AND 8640000000000),
        result_json TEXT, audit_snapshots TEXT,
        CHECK ((outcome='closed' AND reason IS NULL AND result_json IS NULL AND audit_snapshots IS NULL)
            OR (outcome='rejected' AND reason IS NOT NULL AND result_json IS NULL AND audit_snapshots IS NULL)
            OR (outcome='applied' AND reason IS NULL AND result_json IS NOT NULL AND audit_snapshots IS NOT NULL))
    );
    CREATE TRIGGER IF NOT EXISTS ambulatory_destructive_commands_no_update BEFORE UPDATE ON ambulatory_destructive_commands
        BEGIN SELECT RAISE(ABORT,'ambulatory destructive commands are append only'); END;
    CREATE TRIGGER IF NOT EXISTS ambulatory_destructive_commands_no_delete BEFORE DELETE ON ambulatory_destructive_commands
        BEGIN SELECT RAISE(ABORT,'ambulatory destructive commands are append only'); END;`);
}
