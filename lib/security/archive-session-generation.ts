import 'server-only';
import { createHash } from 'node:crypto';
import { openDbServer } from '../db-server';
import { ArchiveReplacedError, readSqliteArchiveGeneration } from '../archive-generation';

type Session = { id: string; expiresAt: number; archiveGeneration?: string };
const sessionRef = (id: string) => createHash('sha256').update(id).digest('hex');

export function currentArchiveGeneration(): string {
    return readSqliteArchiveGeneration(openDbServer());
}

/** This is only a generation fence: it never creates or authenticates an owner session. */
export function bindSessionToArchive(session: Session, expected: string): void {
    const db = openDbServer();
    db.transaction(() => {
        if (readSqliteArchiveGeneration(db) !== expected) throw new ArchiveReplacedError();
        db.prepare('DELETE FROM archive_session_generations WHERE expires_at <= ?').run(Date.now());
        const changed = db.prepare(`INSERT INTO archive_session_generations (session_ref, generation, expires_at)
            VALUES (?, ?, ?)`).run(sessionRef(session.id), expected, session.expiresAt);
        if (changed.changes !== 1) throw new Error('Session generation binding failed.');
    }).immediate();
}

export function archiveGenerationForSession(session: Session | null | undefined): string | undefined {
    if (!session || typeof session.id !== 'string') return undefined;
    // The local-token adapter creates this value itself before yielding to a caller.
    if (session.id === 'local-api' || session.id.startsWith('native:')) return session.archiveGeneration;
    const row = openDbServer().prepare('SELECT generation FROM archive_session_generations WHERE session_ref = ?')
        .get(sessionRef(session.id)) as { generation: string } | undefined;
    return row?.generation;
}

export function sessionMatchesArchive(session: Session): boolean {
    return archiveGenerationForSession(session) === currentArchiveGeneration();
}
