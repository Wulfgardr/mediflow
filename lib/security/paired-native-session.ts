/* @Codex */
import 'server-only';

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { users } from '../schema';
import { authenticateNetworkPairedClient, getNetworkOperatingMode } from '../network-home-base-server';
import {
    getSession, isPairedNativeServerSession, peekSession,
    retireServerSessionForLogout, SESSION_COOKIE_NAME, type ServerSession,
} from './server-session';
import { requireSession } from './server-auth';

export type PairedNativeSession = ServerSession & { authChannel: 'native' };

/** Only the current authenticated device can use its exact server-tagged operator session. */
export async function requirePairedNativeSession(request: Request): Promise<PairedNativeSession | null> {
    try {
        const client = await authenticateNetworkPairedClient(request);
        if (!client || await getNetworkOperatingMode() !== 'network-home-base') return null;
        const bearer = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
        if (!bearer || !/^[a-f0-9]{64}$/u.test(bearer)) return null;
        const session = peekSession(bearer);
        const binding = { clientId: client.clientId, clientPlatform: client.clientPlatform, tokenHash: client.tokenHash };
        if (!session || session.authChannel !== 'native' || !isPairedNativeServerSession(session, binding)) return null;
        const user = dbServer.select({ id: users.id, username: users.username, role: users.role })
            .from(users).where(eq(users.id, session.userId)).get();
        if (!user || user.username !== session.username || (user.role ?? 'user') !== session.role) {
            retireServerSessionForLogout(session.id);
            return null;
        }
        return getSession(bearer) === session ? session : null;
    } catch { return null; }
}

/** Account routes share transport, but each channel supplies its own authenticated authority. */
export async function requireAccountSession(request: Request) {
    return await requireSession() ?? await requirePairedNativeSession(request);
}
