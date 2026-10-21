import type Database from 'better-sqlite3';
import { readSqliteArchiveGeneration, ArchiveReplacedError } from './archive-generation';
import { commitTerritorialPackTransition, readTerritorialPacks } from './territorial-pack-store';
import { TerritorialPackError } from './territorial-packs';

export type TerritorialPackWebSession = Readonly<{ userId: string; authChannel: string; expiresAt: number; archiveGeneration?: string }>;

/** Only the trusted composition root supplies the live session resolver; requests never supply authority. */
export function createTerritorialPackHostOwner(ports: {
    database: () => Database.Database;
    currentWebSession: () => Promise<TerritorialPackWebSession | null>;
}) {
    async function admit(request?: Request) {
        const session = await ports.currentWebSession();
        if (!session || session.authChannel !== 'web' || session.expiresAt <= Date.now()) throw new TerritorialPackError('channel_denied');
        const db = ports.database();
        const assertAuthority = () => {
            if (session.expiresAt <= Date.now()) throw new TerritorialPackError('channel_denied');
            if (session.archiveGeneration !== readSqliteArchiveGeneration(db)
                || (request && request.headers.get('x-mediflow-archive-generation') !== session.archiveGeneration)) throw new ArchiveReplacedError();
        };
        assertAuthority();
        return { db, session, assertAuthority };
    }
    return Object.freeze({
        async read() { const { db } = await admit(); return readTerritorialPacks(db); },
        async transition(request: Request, input: unknown) {
            const { db, session, assertAuthority } = await admit(request);
            return commitTerritorialPackTransition(db, input,
                { actorType: 'user', actorRef: session.userId, sourceSurface: 'web' }, assertAuthority);
        },
    });
}
