import 'server-only';
import { openDbServer } from './db-server';
import { requireSession } from './security/server-auth';
import { archiveGenerationForSession } from './security/archive-session-generation';
import { createTerritorialPackHostOwner } from './territorial-pack-host';
import { createTerritorialPackHttpHandler } from './territorial-pack-http';

const owner = createTerritorialPackHostOwner({ database: openDbServer, currentWebSession: async () => {
    const session = await requireSession();
    return session ? { ...session, archiveGeneration: archiveGenerationForSession(session) } : null;
} });
export const territorialPackHttpHandler = createTerritorialPackHttpHandler(owner);
