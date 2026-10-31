import type Database from 'better-sqlite3';
import { sql, type SQLWrapper } from 'drizzle-orm';

export type BackupOrigin = 'local' | 'imported';

export function ensurePortableImportOriginsSchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS portable_import_origins (
        kind TEXT NOT NULL CHECK (kind IN ('audit', 'therapy_command')),
        ref TEXT NOT NULL CHECK (length(ref) > 0),
        import_event_id TEXT NOT NULL REFERENCES audit_events(event_id),
        PRIMARY KEY (kind, ref)
    );
    CREATE TRIGGER IF NOT EXISTS portable_import_origins_no_update BEFORE UPDATE ON portable_import_origins
        BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS portable_import_origins_no_delete BEFORE DELETE ON portable_import_origins
        BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;`);
}

export function importedAuditPredicate(eventId: SQLWrapper) {
    return sql<number>`EXISTS (SELECT 1 FROM portable_import_origins AS imported_audit
        WHERE imported_audit.kind = 'audit' AND imported_audit.ref = ${eventId})`;
}

export function therapyCommandOrigin(db: Database.Database, commandId: string): BackupOrigin {
    return db.prepare("SELECT 1 FROM portable_import_origins WHERE kind = 'therapy_command' AND ref = ?").get(commandId)
        ? 'imported' : 'local';
}
