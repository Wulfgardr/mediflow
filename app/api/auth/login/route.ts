import { NextResponse } from 'next/server';
/* @Codex */
import {
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
/* @Codex */
import { verifyHostCredentials } from '@/lib/security/host-credential-verification';
/* @Codex */
import { createSession, SESSION_COOKIE_NAME } from '@/lib/security/server-session';
/* @Codex */
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';

/* @Codex */
function authFailureResponse(payload: Record<string, unknown>, status: number) {
    const response = NextResponse.json(payload, { status });
    const retryAfterSeconds = typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null;
    if (retryAfterSeconds) {
        response.headers.set('Retry-After', String(retryAfterSeconds));
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const requestedUsername = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!password) {
            return authFailureResponse({ error: 'Missing credentials', code: 'AUTH_MISSING_CREDENTIALS' }, 400);
        }

        // The shared verifier records 'auth.login.failed' with Web-only context.
        const verification = await verifyHostCredentials({ username: requestedUsername, pin: password });
        if (verification.kind === 'denied') return authFailureResponse(verification.body, verification.status);
        const user = verification.account;

        // Return the encrypted key blob. 
        // NOTE: We do NOT set a session cookie here yet because this is a local app 
        // and we rely on the client holding the decrypted MasterKey in memory as the "Session".
        // If they reload, they must login again to decrypt the key. 
        // This is arguably more secure than a persistent cookie for a medical app.

        /* @Codex */
        const session = createSession(
            { id: user.id, username: user.username, role: user.role || 'user' },
            'web',
        );
        try {
            await writeAuditEvent({
                eventType: 'auth.login.succeeded',
                outcome: 'success',
                actorType: 'user',
                actorRef: user.id,
                subjectType: 'session',
                subjectRef: session.id,
                sourceSurface: 'web',
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata({
                    actorType: 'user',
                    actorRef: user.id,
                    sourceSurface: 'web',
                    authContext: 'session',
                }, null),
            });
        } catch (error) {
            console.error('Audit login success write failed:', error);
        }
        const response = NextResponse.json({
            success: true,
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            ambulatoryName: user.ambulatoryName,
            role: user.role,
            encryptedMasterKey: user.encryptedMasterKey,
            salt: user.salt
        });
        response.cookies.set(SESSION_COOKIE_NAME, session.id, sessionCookieOptionsForRequest(request));
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error("Login error:", error);
        return authFailureResponse({ error: "Login failed", code: "AUTH_LOGIN_FAILED" }, 500);
    }
}
