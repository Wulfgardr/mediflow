import { createAgentLocalKitContextHttp } from '@/lib/security/agent-local-kit-context-http';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { createAgentLocalKitStore } from '@/lib/agent-local-kit-store';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
const handlers = createAgentLocalKitContextHttp({
    session: readAuthenticatedWebSession,
    store: () => createAgentLocalKitStore(openDbServer()),
});
export const { GET, POST, DELETE } = handlers;
