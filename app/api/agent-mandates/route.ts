import { createAgentMandateHttp } from '@/lib/security/agent-mandate-http';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
import { createAgentMandateStore } from '@/lib/agent-mandate-store';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
const handlers = createAgentMandateHttp({
    session: readAuthenticatedWebSession,
    async verifyPin(username, pin) {
        const result = await verifyHostCredentials({ username, pin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    list: actorRef => createAgentRegistrationStore(openDbServer()).listOneOffMandates(actorRef),
    store: () => createAgentMandateStore(openDbServer()),
});
export const { GET, POST, DELETE } = handlers;
