/* @Codex */
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { createPortableSupervisorWebSessionActivationHttpHandlerV1 } from '@/lib/security/portable-supervisor-web-session-http';
import { activatePortableSupervisorWebSessionV1 } from '@/lib/security/portable-supervisor-web-session-controller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createPortableSupervisorWebSessionActivationHttpHandlerV1({
    readAuthenticated: async () => (await readAuthenticatedWebSession()) !== null,
    activate: activatePortableSupervisorWebSessionV1,
});
