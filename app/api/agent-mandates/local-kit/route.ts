import { createAgentLocalKitHttp } from '@/lib/security/agent-local-kit-http';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
import { createAgentLocalKitStore } from '@/lib/agent-local-kit-store';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
const handlers = createAgentLocalKitHttp({
    session: readAuthenticatedWebSession,
    async verifyPin(username, pin) {
        const result = await verifyHostCredentials({ username, pin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    store: () => createAgentLocalKitStore(openDbServer()),
});
export const { GET, PUT, POST, DELETE } = handlers;
