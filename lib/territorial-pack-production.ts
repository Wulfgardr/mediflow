import 'server-only';
import { openDbServer } from './db-server';
import { requireSession } from './security/server-auth';
import { archiveGenerationForSession } from './security/archive-session-generation';
import { createTerritorialPackHostOwner } from './territorial-pack-host';
import { createTerritorialPackHttpHandler } from './territorial-pack-http';
import { requireTerritorialPack } from './territorial-pack-store';
import { TerritorialPackError } from './territorial-packs';

const owner = createTerritorialPackHostOwner({ database: openDbServer, currentWebSession: async () => {
    const session = await requireSession();
    return session ? { ...session, archiveGeneration: archiveGenerationForSession(session) } : null;
} });
export const territorialPackHttpHandler = createTerritorialPackHttpHandler(owner);

export const TERRITORIAL_PACK_DISABLED = { code: 'TERRITORIAL_PACK_DISABLED', error: 'Pacchetto Lombardia non attivo' } as const;

/** Rilegge l'assetto dell'host; dentro la transazione del writer quando c'è, altrimenti in una propria. */
export function lombardyPackDenied(): boolean {
    const db = openDbServer();
    try {
        if (db.inTransaction) requireTerritorialPack(db, 'lom');
        else db.transaction(() => requireTerritorialPack(db, 'lom'))();
        return false;
    } catch (error) {
        if (error instanceof TerritorialPackError) return true;
        throw error;
    }
}
