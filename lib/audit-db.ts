import type Database from 'better-sqlite3';

/* @Codex */
export const AUDIT_APPEND_ONLY_ERROR = 'audit_events is append-only';

/* @Codex */
export function ensureAuditSqliteSchema(sqlite: Database.Database): void {
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS audit_events (
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
        )
    `).run();

    sqlite.prepare('CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events(occurred_at DESC)').run();
    sqlite.prepare('CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events(event_type)').run();
    sqlite.prepare('CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events(subject_type, subject_ref)').run();
    sqlite.prepare('CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_ref)').run();

    sqlite.prepare(`
        CREATE TRIGGER IF NOT EXISTS audit_events_no_update
        BEFORE UPDATE ON audit_events
        BEGIN
            SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_ERROR}');
        END;
    `).run();

    sqlite.prepare(`
        CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
        BEFORE DELETE ON audit_events
        BEGIN
            SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_ERROR}');
        END;
    `).run();
}
