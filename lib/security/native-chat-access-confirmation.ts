import 'server-only';

import { serverSessions } from './web-auth-lifecycle-owner-adapter';
import { sessionMatchesArchive } from './archive-session-generation';
import { verifyHostCredentials, readHostConfirmationEligibility } from './host-credential-verification';
import type { PairedNativeSession } from './paired-native-session';

export const CHAT_ACCESS_OPERATION = 'mediflow.chat.access-status.v1';

/** Eligibility alone cannot approve a native request or mint a grant. */
export async function nativeChatAccessEligibility(session: PairedNativeSession): Promise<'eligible' | 'denied' | 'locked'> {
    const port = serverSessions.mintNativeSessionResourcePort(session);
    if (!port) return 'denied';
    const use = serverSessions.beginNativeSessionResourceUse(port);
    try {
        if (!use || !sessionMatchesArchive(session)) return 'denied';
        const status = await readHostConfirmationEligibility({ id: session.userId, username: session.username, role: session.role });
        if (status !== 'eligible') return status;
        if (!sessionMatchesArchive(session)) return 'denied';
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
