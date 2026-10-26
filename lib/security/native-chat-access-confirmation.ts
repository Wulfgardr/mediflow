import 'server-only';

import { serverSessions } from './web-auth-lifecycle-owner-adapter';
import { sessionMatchesArchive } from './archive-session-generation';
import { verifyHostCredentials } from './host-credential-verification';
import type { PairedNativeSession } from './paired-native-session';
import { dbServer } from '../db-server';
import { users } from '../schema';
import { eq } from 'drizzle-orm';
import { isLockoutActive } from './auth-lockout';

export const CHAT_ACCESS_OPERATION = 'mediflow.chat.access-status.v1';

/** Eligibility alone cannot approve a native request or mint a grant. */
export function nativeChatAccessEligibility(session: PairedNativeSession): 'eligible' | 'denied' | 'locked' {
    const port = serverSessions.mintNativeSessionResourcePort(session);
    if (!port) return 'denied';
    const use = serverSessions.beginNativeSessionResourceUse(port);
    try {
        if (!use || !sessionMatchesArchive(session)) return 'denied';
        const account = dbServer.select({ username: users.username, role: users.role,
            failedLoginAttempts: users.failedLoginAttempts, firstFailedLoginAt: users.firstFailedLoginAt,
            lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, session.userId)).get();
        if (!account || account.username !== session.username || (account.role ?? 'user') !== session.role) return 'denied';
        if (isLockoutActive(account, new Date())) return 'locked';
        return serverSessions.commitNativeSessionResourceUse(use) ? 'eligible' : 'denied';
    } catch { return 'denied'; }
    finally {
        if (use) serverSessions.abortNativeSessionResourceUse(use);
        serverSessions.releaseNativeSessionResourcePort(port);
    }
}

/** A response on the existing paired channel, never a transferable approval proof. */
export async function confirmNativeChatAccessPin(session: PairedNativeSession, pin: string): Promise<'confirmed' | 'denied' | 'locked'> {
    const port = serverSessions.mintNativeSessionResourcePort(session);
    if (!port) return 'denied';
    const use = serverSessions.beginNativeSessionResourceUse(port);
    try {
        if (!use || !sessionMatchesArchive(session)) return 'denied';
        const result = await verifyHostCredentials({ username: session.username, pin });
        if (result.kind === 'denied') return result.failureClass === 'locked' ? 'locked' : 'denied';
        if (result.account.id !== session.userId || result.account.username !== session.username
            || (result.account.role ?? 'user') !== session.role || !sessionMatchesArchive(session)
            || !serverSessions.commitNativeSessionResourceUse(use)) return 'denied';
        return 'confirmed';
    } catch { return 'denied'; }
    finally {
        if (use) serverSessions.abortNativeSessionResourceUse(use);
        serverSessions.releaseNativeSessionResourcePort(port);
    }
}
