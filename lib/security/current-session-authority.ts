import 'server-only';

import {
    isPairedNativeServerSession,
    peekSession,
    type NativeServerSessionBinding,
    type ServerSession,
} from './server-session';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
} from './web-auth-lifecycle-owner-adapter';

/** The admitted paired-client tag a native session was issued with. */
export type PairedNativeBinding = NativeServerSessionBinding & { tokenHash: string };

/**
 * Session-only currentness. A Web session keeps its authority through the
 * lifecycle owner's resource port; a native session is only current while the
 * exact process-local session and its admitted paired-client tag still agree.
 */
export function isCurrentServerSession(
    session: ServerSession,
    nativeBinding: PairedNativeBinding | null = null,
): boolean {
    if (session.authChannel === 'native') {
        if (!nativeBinding) return false;
        return peekSession(session.id) === session && isPairedNativeServerSession(session, nativeBinding);
    }
    if (session.authChannel !== 'web') return false;
    // Authenticate the original owner projection, not a copied/fresh projection.
    const port = mintResourcePort(session);
    if (!port) return false;
    let use: ReturnType<typeof beginResourceUse> = null;
    try {
        use = beginResourceUse(port);
        const current = use !== null && commitResourceUse(use);
        if (!current && use) abortResourceUse(use);
        return current;
    } finally { releaseResourcePort(port); }
}
