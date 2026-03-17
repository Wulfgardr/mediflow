import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
/* @Codex */
import {
    auditSourceSurfaceFromRequest,
    hashAuditRef,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/audit';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
/* @Codex */
import {
    AUTH_LOCKOUT_MAX_FAILURES,
    createInvalidCredentialsPayload,
    createLockedPayload,
    isLockoutActive,
    recordFailedLogin,
    resetLockoutState,
} from '@/lib/auth-lockout';
/* @Codex */
import { createSession, SESSION_COOKIE_NAME } from '@/lib/server-session';

/* @Codex */
function recordFailedLoginAttempt(request: Request, username: unknown): void {
    const sourceSurface = auditSourceSurfaceFromRequest(request, 'web');
    void writeAuditEvent({
        eventType: 'auth.login.failed',
        outcome: 'failure',
        actorType: 'user',
        actorRef: hashAuditRef(typeof username === 'string' ? username : ''),
        subjectType: 'session',
        sourceSurface,
        requestId: requestIdFromRequest(request),
        redactedMetadata: withAuditContextMetadata({
            actorType: 'user',
            actorRef: 'anonymous',
            sourceSurface,
            authContext: 'anonymous',
        }, {
            reasonCode: 'invalid_credentials',
        }),
    }).catch((error) => {
        console.error('Audit login failure write failed:', error);
    });
}

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
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!username || !password) {
            return authFailureResponse({ error: 'Missing credentials', code: 'AUTH_MISSING_CREDENTIALS' }, 400);
        }

        const user = await dbServer.select().from(users).where(eq(users.username, username)).get();
        const now = new Date();

        if (!user || !user.passwordHash) {
            recordFailedLoginAttempt(request, username);
            console.warn('[Auth] Failed login for unknown user', { username });
            return authFailureResponse(createInvalidCredentialsPayload(), 401);
        }

        const activeLockout = isLockoutActive(user, now);
        if (activeLockout) {
            console.warn('[Auth] Login blocked by active lockout', {
                username: user.username,
                lockedUntil: activeLockout.toISOString(),
            });
            return authFailureResponse(
                createLockedPayload(
                    activeLockout,
                    Math.max(user.failedLoginAttempts ?? AUTH_LOCKOUT_MAX_FAILURES, AUTH_LOCKOUT_MAX_FAILURES),
                ),
                423,
            );
        }
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
            const nextState = recordFailedLogin(user, now);
            await dbServer
                .update(users)
                .set({
                    failedLoginAttempts: nextState.failedLoginAttempts,
                    firstFailedLoginAt: nextState.firstFailedLoginAt,
                    lockedUntil: nextState.lockedUntil,
                })
                .where(eq(users.id, user.id))
                .run();

            recordFailedLoginAttempt(request, user.username);

            if (nextState.isLocked && nextState.lockedUntil) {
                console.warn('[Auth] User locked out after failed login threshold', {
                    username: user.username,
                    failedLoginAttempts: nextState.failedLoginAttempts,
                    lockedUntil: nextState.lockedUntil.toISOString(),
                });
                return authFailureResponse(createLockedPayload(nextState.lockedUntil, nextState.failedLoginAttempts), 423);
            }

            console.warn('[Auth] Invalid credentials', {
                username: user.username,
                failedLoginAttempts: nextState.failedLoginAttempts,
                remainingAttempts: nextState.remainingAttempts,
            });
            return authFailureResponse(createInvalidCredentialsPayload(nextState), 401);
        }

        if (user.failedLoginAttempts > 0 || user.firstFailedLoginAt || user.lockedUntil) {
            await dbServer
                .update(users)
                .set(resetLockoutState())
                .where(eq(users.id, user.id))
                .run();
        }
        }

        // Return the encrypted key blob. 
        // NOTE: We do NOT set a session cookie here yet because this is a local app 
        // and we rely on the client holding the decrypted MasterKey in memory as the "Session".
        // If they reload, they must login again to decrypt the key. 
        // This is arguably more secure than a persistent cookie for a medical app.

        /* @Codex */
        const sourceSurface = auditSourceSurfaceFromRequest(request, 'web');
        const session = createSession(
            { id: user.id, username: user.username, role: user.role || 'user' },
            sourceSurface === 'native' ? 'native' : 'web',
        );
        try {
            await writeAuditEvent({
                eventType: 'auth.login.succeeded',
                outcome: 'success',
                actorType: 'user',
                actorRef: user.id,
                subjectType: 'session',
                subjectRef: session.id,
                sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata({
                    actorType: 'user',
                    actorRef: user.id,
                    sourceSurface,
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
        response.cookies.set(SESSION_COOKIE_NAME, session.id, {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/'
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        console.error("Login error:", error);
        return authFailureResponse({ error: "Login failed", code: "AUTH_LOGIN_FAILED" }, 500);
    }
}
