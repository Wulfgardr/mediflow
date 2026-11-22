import { createAgentLocalKitHttp } from '@/lib/security/agent-local-kit-http';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
import { createAgentLocalKitStore } from '@/lib/agent-local-kit-store';
import { createAgentRegistrationStore } from '@/lib/agent-registration-store';
import { confirmDirectAgentRenewal, isAgentUnlockActive } from '@/lib/security/agent-unlock-session';
import { webAuthControlIdFromRequest } from '@/lib/security/web-auth-control-transport';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
const handlers = createAgentLocalKitHttp({
    session: readAuthenticatedWebSession,
    async verifyPin(username, pin) {
        const result = await verifyHostCredentials({ username, pin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    store: () => createAgentLocalKitStore(openDbServer()),
    isUnlockActive: isAgentUnlockActive,
    renew(request, session, generation) {
        const controlId = webAuthControlIdFromRequest(request);
        if (!controlId) return false;
        return confirmDirectAgentRenewal(session.id, controlId, session.userId, unlockRef => {
            createAgentRegistrationStore(openDbServer()).renew(session.userId, generation, unlockRef);
        });
    },
});
export const { GET, PUT, POST, PATCH, DELETE } = handlers;
