import { randomUUID } from 'node:crypto';
import { RESTORE_RECEIPT_PREFIX } from './backup-restore-receipt-contract';
import type Database from 'better-sqlite3';
import { sql, type SQLWrapper } from 'drizzle-orm';

export type BackupOrigin = 'local' | 'imported' | 'unattested';

export function ensurePortableImportOriginsSchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS portable_import_origins (
        kind TEXT NOT NULL CHECK (kind IN ('audit', 'therapy_command')),
        ref TEXT NOT NULL CHECK (length(ref) > 0),
        import_event_id TEXT NOT NULL REFERENCES audit_events(event_id),
        origin TEXT NOT NULL DEFAULT 'imported' CHECK (origin IN ('imported', 'unattested')),
        PRIMARY KEY (kind, ref)
    );`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS portable_import_origins_no_update BEFORE UPDATE ON portable_import_origins
        BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS portable_import_origins_no_delete BEFORE DELETE ON portable_import_origins
        BEGIN SELECT RAISE(ABORT, 'portable import origins is append-only'); END;`);
}

export function auditOrigin(eventId: SQLWrapper) {
    return sql<BackupOrigin>`COALESCE((SELECT origin FROM portable_import_origins AS audit_origin
        WHERE audit_origin.kind = 'audit' AND audit_origin.ref = ${eventId}), 'local')`;
}

export function therapyCommandOrigin(db: Database.Database, commandId: string): BackupOrigin {
    return (db.prepare("SELECT origin FROM portable_import_origins WHERE kind = 'therapy_command' AND ref = ?").get(commandId) as { origin: BackupOrigin } | undefined)?.origin ?? 'local';
}

export function freezeUnattestedBackupHistory(db: Database.Database): void {
    if (!db.inTransaction) throw new Error('Origin migration requires transaction');
    const restored = db.prepare("SELECT 1 FROM settings WHERE key GLOB ? LIMIT 1").get(RESTORE_RECEIPT_PREFIX + '*')
        || db.prepare("SELECT 1 FROM audit_events WHERE event_type = 'backup.portable.imported' LIMIT 1").get();
    if (!restored) return;
    const events = db.prepare("SELECT event_id AS ref FROM audit_events WHERE NOT EXISTS (SELECT 1 FROM portable_import_origins WHERE kind='audit' AND ref=event_id)").all() as { ref: string }[];
    const commands = db.prepare("SELECT command_id AS ref FROM therapy_status_commands WHERE NOT EXISTS (SELECT 1 FROM portable_import_origins WHERE kind='therapy_command' AND ref=command_id)").all() as { ref: string }[];
    if (!events.length && !commands.length) return;
    const root = randomUUID();
    db.prepare("INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,source_surface) VALUES (?,'backup.provenance.unattested',unixepoch(),'success','system','archive-migration','backup','job')").run(root);
    const insert = db.prepare("INSERT INTO portable_import_origins(kind,ref,import_event_id,origin) VALUES (?,?,?,'unattested')");
    for (const { ref } of events) insert.run('audit', ref, root);
    for (const { ref } of commands) insert.run('therapy_command', ref, root);
}

export function recordPortableImportOrigin(db: Database.Database, kind: 'audit' | 'therapy_command', ref: string, importEventId: string): void {
    const result = db.prepare('INSERT INTO portable_import_origins (kind, ref, import_event_id) VALUES (?, ?, ?)').run(kind, ref, importEventId);
    if (result.changes !== 1) throw new Error('Import origin did not persist');
}
