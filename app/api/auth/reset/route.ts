import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import {
    abortNativeSystemAdminReset,
    commitNativeSystemAdminReset,
    prepareNativeSystemAdminReset,
    SESSION_COOKIE_NAME,
} from '@/lib/security/server-session';
/* @Codex */
import {
    abortAdminReset,
    commitAdminReset,
    prepareAdminReset,
} from '@/lib/security/web-auth-lifecycle-owner-adapter';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';

/* @Codex */
function resetFailure(status: 409 | 500, code: string, message: string) {
    const response = NextResponse.json({ success: false, error: message, code }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

/* @Codex */
function abortPreparedReset(webCapability: object | null, nativeCapability: object | null): void {
    if (webCapability) {
        try { abortAdminReset(webCapability); } catch { /* no database mutation has occurred */ }
    }
    if (nativeCapability) {
        try { abortNativeSystemAdminReset(nativeCapability); } catch { /* no database mutation has occurred */ }
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    let webCapability: object | null = null;
    let nativeCapability: object | null = null;
    try {
        webCapability = prepareAdminReset(session);
        if (!webCapability) {
            return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni Web.');
        }
        nativeCapability = prepareNativeSystemAdminReset();
        if (!nativeCapability) {
            abortPreparedReset(webCapability, null);
            return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni native.');
        }
    } catch {
        abortPreparedReset(webCapability, nativeCapability);
        return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni.');
    }

    try {
        // The two authority capabilities are already fenced before this destructive DB mutation.
        await dbServer.delete(users);
    } catch (error) {
        abortPreparedReset(webCapability, nativeCapability);
        console.error('Reset error:', error);
        return resetFailure(500, 'RESET_DATABASE_FAILED', 'Reset non completato.');
    }

    let webOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    let nativeOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try { webOutcome = commitAdminReset(webCapability).outcome; } catch { webOutcome = 'failed'; }
    try { nativeOutcome = commitNativeSystemAdminReset(nativeCapability).outcome; } catch { nativeOutcome = 'failed'; }

    const completed = webOutcome === 'completed' && nativeOutcome === 'completed';
    const response = completed
        ? NextResponse.json({ success: true })
        : resetFailure(500, 'RESET_AUTHORITY_COMMIT_FAILED', 'Reset eseguito, ma la chiusura delle sessioni non è stata confermata.');
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        ...sessionCookieOptionsForRequest(request),
        maxAge: 0,
    });
    return response;
}
