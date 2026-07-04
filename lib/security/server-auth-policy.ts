/* @Codex */
import type { ServerSession } from '@/lib/security/server-session';

/* @Codex */
export function isWebAdminSession(session: ServerSession | null | undefined): session is ServerSession {
    return session?.role === 'admin' && session.authChannel === 'web';
}
