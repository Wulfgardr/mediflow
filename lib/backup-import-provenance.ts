import type Database from 'better-sqlite3';
import { sql, type SQLWrapper } from 'drizzle-orm';

export type BackupOrigin = 'local' | 'imported';

export function importedAuditPredicate(eventId: SQLWrapper) {
    return sql<number>`EXISTS (SELECT 1 FROM audit_events AS imported_audit
        WHERE imported_audit.event_type = 'backup.audit.imported'
        AND imported_audit.subject_type = 'audit_event' AND imported_audit.subject_ref = ${eventId})`;
}

export function therapyCommandOrigin(db: Database.Database, commandId: string, auditEventId: string | null): BackupOrigin {
    const imported = db.prepare(`SELECT 1 FROM audit_events WHERE
        (event_type = 'backup.therapy-command.imported' AND subject_type = 'therapy_command' AND subject_ref = ?)
        OR (event_type = 'backup.audit.imported' AND subject_type = 'audit_event' AND subject_ref = ?) LIMIT 1`)
        .get(commandId, auditEventId);
    return imported ? 'imported' : 'local';
}
